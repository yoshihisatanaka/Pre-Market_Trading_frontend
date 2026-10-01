import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { stalledOrderErrors, stalledWorkingOrders } from '../src/mocks/fixtures/stalledOrders'
import { formatUsd } from '../src/utils/format'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/stalled-orders.md（タイトル先頭の [SO-nn] が対応 ID）
// 注文エラー / 注文中の 2 本の一覧の 4 状態と URL クエリの同期、フロントで組み立てる CSV 3 種の
// ダウンロード（ファイル名と中身）、コンファメーション CSV の取込（成功 / 行エラー / 400 / 500）を
// 実ブラウザで通す。取込の既定ハンドラは状態を持つが、page.goto() のたびに初期状態へ戻る。
// CSV の値の変換の細かい分岐や props の境界は単体テスト側が担保する。

const PATH = '/operations/stalled-orders'
const LIST_PATH = '*/api/operations/stalled-orders'
const IMPORT_PATH = '*/api/operations/stalled-orders/confirmation-import'

const SERVER_ERROR = 'サーバーでエラーが発生しました。'

/** BOM と改行。書式の出典は src/utils/csv.js（BOM 付き・CRLF・最終行の後にも改行） */
const BOM = '﻿'
const CRLF = '\r\n'

/** 別システム発注 CSV のヘッダ（src/utils/stalledOrderCsv.js の TWS_ORDER_HEADER と同じ） */
const TWS_ORDER_HEADER =
  'order_id,account_number,symbol,action,quantity,order_type,limit_price,time_in_force,market_category'

/** コンファメーション CSV のヘッダ（src/utils/stalledOrderCsv.js / handlers/stalledOrders.js と同じ） */
const CONFIRMATION_HEADER =
  'order_id,confirmation_ref,confirmation_status,filled_quantity,average_price,confirmed_at,message'

/*
 * フィクスチャ（バックエンドの生の形）の 1 行 → 別システム発注 CSV の 1 行。
 * 対応は src/utils/stalledOrderCsv.js の toTwsOrderRow の仕様（売買区分 1/3 → SELL/BUY、
 * 指成区分 MO/LO → MKT/LMT、成行は価格が空欄、執行条件は常に DAY）を再掲したもの。
 */
const ACTIONS = { 1: 'SELL', 3: 'BUY' }
const ORDER_TYPES = { MO: 'MKT', LO: 'LMT' }
function twsOrderLine(raw) {
  const orderType = ORDER_TYPES[raw.指成区分]
  return [
    raw.ID,
    raw.口座番号,
    raw.銘柄コード,
    ACTIONS[raw.売買区分],
    raw.数量,
    orderType,
    orderType === 'MKT' ? '' : raw.指値単価,
    'DAY',
    raw.発注範囲名,
  ].join(',')
}

/** ヘッダと行から、ダウンロードされるはずの CSV 本文を組み立てる */
function csvText(header, lines) {
  return BOM + [header, ...lines].map((line) => line + CRLF).join('')
}

/** 表の行。data-table-row は全画面共通の名前なので、この画面のそれぞれの表にスコープを切る */
const errorRows = (page) =>
  page.getByTestId('stalled-order-errors-table').getByTestId('data-table-row')
const workingRows = (page) =>
  page.getByTestId('stalled-working-orders-table').getByTestId('data-table-row')

const byId = (rows, id) => rows.find((row) => row.ID === id)
const branch123Errors = stalledOrderErrors.filter((row) => row.部店 === '123')

/** 2 本の一覧の件数を確かめる */
async function expectCounts(page, errors, working) {
  await expect(page.getByTestId('stalled-order-errors-count')).toHaveText(`${errors} 件`)
  await expect(page.getByTestId('stalled-working-orders-count')).toHaveText(`${working} 件`)
}

/** ボタンを押してダウンロードを待ち、ファイル名と本文（BOM を含む生の文字列）を返す */
async function download(page, testId) {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(testId).click(),
  ])
  return { name: file.suggestedFilename(), text: readFileSync(await file.path(), 'utf8') }
}

/** コンファメーション CSV を選ぶ（取込口の中の隠し input に渡す） */
async function chooseCsv(page, name, lines) {
  await page
    .getByTestId('stalled-orders-confirmation-file')
    .locator('input[type="file"]')
    .setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(lines.join('\r\n') + '\r\n') })
}

const importButton = (page) => page.getByTestId('stalled-orders-confirmation-import')

/** #27（注文エラー）を約定、#26（注文エラー）を未約定にするコンファメーション */
const [ORDER_27, ORDER_26] = stalledOrderErrors
const VALID_CONFIRMATION = [
  CONFIRMATION_HEADER,
  `${ORDER_27.ID},TWS-1,FILLED,${ORDER_27.数量},410,2026-09-16 11:00:00,`,
  `${ORDER_26.ID},TWS-2,WORKING,0,0,2026-09-16 11:00:00,`,
]
const CONFIRMATION_NAME = 'confirmation.csv'

test.describe('滞留注文抽出', () => {
  test('[SO-01] サイドメニューから開くと 2 本の一覧が件数付きで表示される', async ({ page }) => {
    await page.goto('/')

    const nav = page.getByRole('navigation', { name: 'メインメニュー' })
    await nav.getByRole('link', { name: '滞留注文抽出', exact: true }).click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByRole('heading', { name: '滞留注文抽出', exact: true })).toBeVisible()
    await expect(page.getByText('注文エラー（別システムで発注要）')).toBeVisible()
    await expect(page.getByText('注文中（コンファメーション取込後・未約定）')).toBeVisible()
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)
    await expect(errorRows(page)).toHaveCount(stalledOrderErrors.length)
    await expect(workingRows(page)).toHaveCount(stalledWorkingOrders.length)
  })

  test('[SO-02] 注文エラーの 1 行目に注文の内容が表示される', async ({ page }) => {
    await page.goto(PATH)

    const first = stalledOrderErrors[0]
    const cells = errorRows(page).first().getByRole('cell')
    await expect(cells.nth(0)).toHaveText(`#${first.ID}`)
    await expect(cells.nth(1)).toHaveText(first.部店)
    await expect(cells.nth(2)).toHaveText(String(first.口座番号))
    await expect(cells.nth(3)).toHaveText(first.顧客名)
    await expect(cells.nth(4)).toHaveText(first.銘柄コード)
    await expect(cells.nth(5)).toHaveText('買')
    await expect(cells.nth(6)).toHaveText(String(first.数量))
    await expect(cells.nth(7)).toHaveText('成行')
    await expect(cells.nth(8)).toHaveText(first.発注範囲名)
    await expect(cells.nth(11)).toHaveText(first.処理状況名)
  })

  test('[SO-03] 注文中の 1 行目に注文の内容と確認状況が表示される', async ({ page }) => {
    await page.goto(PATH)

    const first = stalledWorkingOrders[0]
    const cells = workingRows(page).first().getByRole('cell')
    await expect(cells.nth(0)).toHaveText(`#${first.ID}`)
    await expect(cells.nth(4)).toHaveText(first.銘柄コード)
    await expect(cells.nth(5)).toHaveText('売')
    await expect(cells.nth(7)).toHaveText(`指値 ${formatUsd(first.指値単価)}`)
    await expect(cells.nth(8)).toHaveText(first.発注範囲名)
    await expect(cells.nth(10)).toHaveText(first.確認状況)
    await expect(cells.nth(11)).toHaveText(first.処理状況名)
  })

  test('[SO-04] 部店コードで絞り込むと注文中だけが空になる', async ({ page }) => {
    await page.goto(PATH)
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)

    await page.getByTestId('stalled-orders-branch-code').fill('123')
    await page.getByTestId('stalled-orders-search-submit').click()

    await expect(page).toHaveURL(/[?&]branch_code=123(&|$)/)
    await expectCounts(page, branch123Errors.length, 0)
    await expect(errorRows(page)).toHaveCount(branch123Errors.length)
    await expect(page.getByTestId('stalled-working-orders-empty')).toHaveText(
      'コンファメーション取込後に未約定となっている注文はありません',
    )
  })

  test('[SO-05] 銘柄コードで絞り込むと注文エラーだけが空になる', async ({ page }) => {
    await page.goto(PATH)
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)

    await page.getByTestId('stalled-orders-symbol').fill('AMZN')
    await page.getByTestId('stalled-orders-search-submit').click()

    const amzn = stalledWorkingOrders.filter((row) => row.銘柄コード === 'AMZN')
    await expect(page).toHaveURL(/[?&]symbol=AMZN(&|$)/)
    await expectCounts(page, 0, amzn.length)
    await expect(page.getByTestId('stalled-order-errors-empty')).toHaveText(
      '別システムで発注する注文エラーはありません',
    )
    await expect(workingRows(page)).toHaveCount(amzn.length)
  })

  test('[SO-06] クリアでクエリと入力欄が空になり全件に戻る', async ({ page }) => {
    await page.goto(`${PATH}?branch_code=123`)
    await expectCounts(page, branch123Errors.length, 0)
    await expect(page.getByTestId('stalled-orders-branch-code')).toHaveValue('123')

    await page.getByTestId('stalled-orders-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)
    await expect(page.getByTestId('stalled-orders-branch-code')).toHaveValue('')
    await expect(page.getByTestId('stalled-orders-account-number')).toHaveValue('')
    await expect(page.getByTestId('stalled-orders-symbol')).toHaveValue('')
  })

  test('[SO-07] 該当が無い条件で開くと両方の空の文言が出て説明と検索は残る', async ({ page }) => {
    await page.goto(`${PATH}?branch_code=999`)

    await expectCounts(page, 0, 0)
    await expect(page.getByTestId('stalled-order-errors-empty')).toHaveText(
      '別システムで発注する注文エラーはありません',
    )
    await expect(page.getByTestId('stalled-working-orders-empty')).toHaveText(
      'コンファメーション取込後に未約定となっている注文はありません',
    )
    await expect(page.getByTestId('stalled-orders-description')).toBeVisible()
    await expect(page.getByTestId('stalled-orders-flow')).toBeVisible()
    await expect(page.getByTestId('stalled-orders-search')).toBeVisible()
  })

  test('[SO-08] 一覧の取得が 500 のとき両方のカードに理由と再試行が出る', async ({ page }) => {
    await mockApi(page, [{ path: LIST_PATH, status: 500, body: { detail: SERVER_ERROR } }])
    await page.goto(PATH)

    for (const prefix of ['stalled-order-errors', 'stalled-working-orders']) {
      const error = page.getByTestId(`${prefix}-error`)
      await expect(error).toContainText(SERVER_ERROR)
      await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    }
    await expect(page.getByTestId('stalled-order-errors-table')).toHaveCount(0)
    await expect(page.getByTestId('stalled-working-orders-table')).toHaveCount(0)
    await expect(page.getByTestId('stalled-orders-description')).toBeVisible()
    await expect(page.getByTestId('stalled-orders-search')).toBeVisible()
  })

  test('[SO-09] 応答が返るまで両方のカードに読み込み中が出て件数は出ない', async ({ page }) => {
    await page.goto(`${PATH}?mockDelay=1000`)

    await expect(page.getByTestId('stalled-order-errors-loading')).toBeVisible()
    await expect(page.getByTestId('stalled-working-orders-loading')).toBeVisible()
    await expect(page.getByTestId('stalled-order-errors-count')).toHaveCount(0)
    await expect(page.getByTestId('stalled-working-orders-count')).toHaveCount(0)

    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)
    await expect(page.getByTestId('stalled-order-errors-loading')).toHaveCount(0)
  })

  test('[SO-13] 取込カードに操作可能のバッジと CSV の 3 ボタンが出る', async ({ page }) => {
    await page.goto(PATH)

    await expect(page.getByTestId('stalled-orders-permission')).toHaveText('操作可能')
    await expect(page.getByTestId('stalled-orders-order-sample')).toHaveText(
      '別システム発注CSVサンプル',
    )
    await expect(page.getByTestId('stalled-orders-export')).toHaveText('注文エラーをCSV出力')
    await expect(page.getByTestId('stalled-orders-confirmation-sample')).toHaveText(
      'コンファメーションCSVサンプル',
    )
  })

  test('[SO-14] ファイルを選ぶまで取込ボタンは押せない', async ({ page }) => {
    await page.goto(PATH)
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)

    await expect(importButton(page)).toHaveText('取込して注文照会へ反映')
    await expect(importButton(page)).toBeDisabled()
  })

  test('[SO-15] 別システム発注CSVサンプルがダウンロードできる', async ({ page }) => {
    await page.goto(PATH)

    const file = await download(page, 'stalled-orders-order-sample')

    expect(file.name).toBe('tws_upload_sample.csv')
    expect(file.text).toBe(
      csvText(TWS_ORDER_HEADER, ['6,300003,AMZN,BUY,40,LMT,214.2500,DAY,プレ＋レギュラー']),
    )
  })

  test('[SO-16] コンファメーションCSVサンプルがダウンロードできる', async ({ page }) => {
    await page.goto(PATH)

    const file = await download(page, 'stalled-orders-confirmation-sample')

    expect(file.name).toBe('tws_confirmation_sample.csv')
    expect(file.text).toBe(
      csvText(CONFIRMATION_HEADER, [
        '6,TWS-20260904-0006,CANCELLED,0,0,2026-09-04 10:15:00,TWSで取消確認',
      ]),
    )
  })

  test('[SO-17] 注文エラーを別システム発注CSVとして出力できる', async ({ page }) => {
    await page.goto(PATH)
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)

    const file = await download(page, 'stalled-orders-export')

    expect(file.name).toBe('tws_stalled_orders.csv')
    expect(file.text).toBe(csvText(TWS_ORDER_HEADER, stalledOrderErrors.map(twsOrderLine)))
    // 成行の #27 は価格が空欄（出典どおりの 1 行を明示しておく）
    expect(file.text).toContain(`${CRLF}27,200001,MSFT,BUY,35,MKT,,DAY,レギュラー${CRLF}`)
  })

  test('[SO-18] 絞り込んだ状態で出力すると画面の注文エラーの行だけになる', async ({ page }) => {
    await page.goto(`${PATH}?branch_code=123`)
    await expectCounts(page, branch123Errors.length, 0)

    const file = await download(page, 'stalled-orders-export')

    expect(file.text).toBe(csvText(TWS_ORDER_HEADER, branch123Errors.map(twsOrderLine)))
  })

  test('[SO-19] 注文エラーが 0 件・取得失敗のときは出力を押せない', async ({ page }) => {
    await page.goto(`${PATH}?branch_code=999`)
    await expectCounts(page, 0, 0)
    await expect(page.getByTestId('stalled-orders-export')).toBeDisabled()
    await expect(page.getByTestId('stalled-orders-order-sample')).toBeEnabled()
    await expect(page.getByTestId('stalled-orders-confirmation-sample')).toBeEnabled()

    await mockApi(page, [{ path: LIST_PATH, status: 500, body: { detail: SERVER_ERROR } }])
    await page.goto(PATH)
    await expect(page.getByTestId('stalled-order-errors-error')).toBeVisible()
    await expect(page.getByTestId('stalled-orders-export')).toBeDisabled()
    await expect(page.getByTestId('stalled-orders-order-sample')).toBeEnabled()
    await expect(page.getByTestId('stalled-orders-confirmation-sample')).toBeEnabled()
  })

  test('[SO-20] コンファメーションを取り込むと一覧に反映され選択が外れる', async ({ page }) => {
    await page.goto(PATH)
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)

    await chooseCsv(page, CONFIRMATION_NAME, VALID_CONFIRMATION)
    await expect(page.getByTestId('stalled-orders-confirmation-file')).toContainText(
      CONFIRMATION_NAME,
    )
    await importButton(page).click()

    await expect(page.getByTestId('stalled-orders-import-notice')).toHaveText(
      'コンファメーションを 2 件取り込みました（約定・取消で除外 1 件 / 注文中 1 件）。',
    )
    // #27 は約定で外れ、#26 は注文中へ移る（注文中は受注日時の新しい順）
    const remainingError = byId(stalledOrderErrors, 5)
    const [order28, order6] = stalledWorkingOrders
    await expectCounts(page, 1, 3)
    await expect(errorRows(page).first().getByRole('cell').first()).toHaveText(
      `#${remainingError.ID}`,
    )
    for (const [index, order] of [order28, ORDER_26, order6].entries()) {
      await expect(workingRows(page).nth(index).getByRole('cell').first()).toHaveText(
        `#${order.ID}`,
      )
    }

    await expect(page.getByTestId('stalled-orders-confirmation-file')).not.toContainText(
      CONFIRMATION_NAME,
    )
    await expect(importButton(page)).toBeDisabled()
  })

  test('[SO-21] 滞留一覧に無い注文 ID があると 1 行も取り込まず行エラーを出す', async ({
    page,
  }) => {
    await page.goto(PATH)
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)

    await chooseCsv(page, CONFIRMATION_NAME, [
      CONFIRMATION_HEADER,
      '999,TWS-9,FILLED,1,1,2026-09-16 11:00:00,',
    ])
    await importButton(page).click()

    const errors = page.getByTestId('stalled-orders-import-errors')
    await expect(errors).toContainText(
      '1 行にエラーがあるため、取り込みませんでした。CSV を直して取り込み直してください。',
    )
    const rows = errors.getByTestId('data-table-row')
    await expect(rows).toHaveCount(1)
    const cells = rows.first().getByRole('cell')
    await expect(cells.nth(0)).toHaveText('2')
    await expect(cells.nth(1)).toHaveText('999')
    await expect(cells.nth(2)).toHaveText('注文ID「999」は滞留注文にありません。')

    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)
    await expect(page.getByTestId('stalled-orders-confirmation-file')).toContainText(
      CONFIRMATION_NAME,
    )
    await expect(page.getByTestId('stalled-orders-import-notice')).toHaveCount(0)
  })

  test('[SO-22] ヘッダが違う CSV は理由が出てファイルは選ばれたまま', async ({ page }) => {
    await page.goto(PATH)
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)

    await chooseCsv(page, 'wrong.csv', ['id,status', '27,FILLED'])
    await importButton(page).click()

    await expect(page.getByTestId('stalled-orders-import-error')).toHaveText(
      `ヘッダが違います。1 行目を ${CONFIRMATION_HEADER} にしてください。`,
    )
    await expect(page.getByTestId('stalled-orders-confirmation-file')).toContainText('wrong.csv')
    await expect(importButton(page)).toBeEnabled()
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)
  })

  test('[SO-23] 取込が 500 のとき理由が出てファイルは選ばれたまま', async ({ page }) => {
    await mockApi(page, [
      { method: 'post', path: IMPORT_PATH, status: 500, body: { detail: SERVER_ERROR } },
    ])
    await page.goto(PATH)
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)

    await chooseCsv(page, CONFIRMATION_NAME, VALID_CONFIRMATION)
    await importButton(page).click()

    await expect(page.getByTestId('stalled-orders-import-error')).toHaveText(SERVER_ERROR)
    await expect(page.getByTestId('stalled-orders-confirmation-file')).toContainText(
      CONFIRMATION_NAME,
    )
    await expect(importButton(page)).toBeEnabled()
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)
  })

  test('[SO-24] 取り込んだ後に同じファイルをもう一度選べる', async ({ page }) => {
    await page.goto(PATH)
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)

    await chooseCsv(page, CONFIRMATION_NAME, VALID_CONFIRMATION)
    await importButton(page).click()
    await expect(page.getByTestId('stalled-orders-import-notice')).toBeVisible()
    await expect(importButton(page)).toBeDisabled()

    await chooseCsv(page, CONFIRMATION_NAME, VALID_CONFIRMATION)

    await expect(page.getByTestId('stalled-orders-confirmation-file')).toContainText(
      CONFIRMATION_NAME,
    )
    await expect(importButton(page)).toBeEnabled()
  })
})
