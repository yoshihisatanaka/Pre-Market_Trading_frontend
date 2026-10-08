import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { clickSideMenuLink } from './helpers/sideMenu'
import { orderInquiryRows } from '../src/mocks/fixtures/orderInquiry'
import { formatQuantity, formatUsdUnit } from '../src/utils/format'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/stalled-orders.md（タイトル先頭の [SO-nn] が対応 ID）
// 注文エラー / 注文中の 2 本の一覧の 4 状態と URL クエリの同期、フロントで組み立てる CSV 3 種の
// ダウンロード（ファイル名と中身）、コンファメーション CSV の取込（成功 / 行エラー / 400 / 500）を
// 実ブラウザで通す。一覧は注文照会と同じ GET /orders を処理状況で絞って 2 回引くので、期待値は
// orderInquiryRows を処理状況で絞って導く（絞り込みはクエリを解釈する既定ハンドラで検証する）。
// 取込は実 API が入ったので MSW の既定ハンドラが無い（素通し）。取込のシナリオは応答を mockApi() で
// page.goto() の前に差し込み、画面の出し分けだけを見る。取込の結果が一覧に反映されることは検証しない。
// CSV の値の変換の細かい分岐、エラー理由の選び分け、ページ送りは単体テスト側が担保する。

const PATH = '/operations/stalled-orders'
const LIST_PATH = '*/api/orders'
const IMPORT_PATH = '*/api/operations/stalled-orders/confirmation-import'

/*
 * 2 本の一覧に載せる処理状況。src/api/stalledOrders.js の ORDER_ERROR_STATUSES / WORKING_STATUS の写し
 * （api 層は import.meta.env を辿る api/client.js に依存しており Playwright からは import できない）。
 * 並びはサーバの既定（注文 ID の降順）
 */
const ORDER_ERROR_STATUSES = ['101', '103']
const WORKING_STATUS = '003'
const byIdDesc = (a, b) => b.ID - a.ID
const stalledOrderErrors = orderInquiryRows
  .filter((row) => ORDER_ERROR_STATUSES.includes(row.処理状況))
  .sort(byIdDesc)
const stalledWorkingOrders = orderInquiryRows
  .filter((row) => row.処理状況 === WORKING_STATUS)
  .sort(byIdDesc)

/** 売買区分コード → 表の表記 */
const SIDE_LABELS = { 1: '売', 3: '買' }

/** 表の価格セル（src/components/operations/StalledOrderTable.vue の priceLabel と同じ） */
const priceLabel = (raw) => (raw.指成区分 === 'MO' ? '成行' : `指値 ${formatUsdUnit(raw.指値単価)}`)

/*
 * エラー理由（src/api/stalledOrders.js の toErrorReason の写し）。101 は Dreamエラー内容、
 * それ以外は エラー内容 を先に見る
 */
const errorReasonOf = (raw) =>
  raw.処理状況 === '101'
    ? raw.Dreamエラー内容 || raw.エラー内容
    : raw.エラー内容 || raw.Dreamエラー内容

const SERVER_ERROR = 'サーバーでエラーが発生しました。'

/** BOM と改行。書式の出典は src/utils/csv.js（BOM 付き・CRLF・最終行の後にも改行） */
const BOM = '﻿'
const CRLF = '\r\n'

/** 別システム発注 CSV のヘッダ（src/utils/stalledOrderCsv.js の TWS_ORDER_HEADER と同じ） */
const TWS_ORDER_HEADER =
  'order_id,account_number,symbol,action,quantity,order_type,limit_price,time_in_force,market_category'

/** コンファメーション CSV のヘッダ（src/utils/stalledOrderCsv.js と同じ） */
const CONFIRMATION_HEADER =
  'order_id,confirmation_ref,confirmation_status,filled_quantity,average_price,confirmed_at,message'

/*
 * フィクスチャ（バックエンドの生の形）の 1 行 → 別システム発注 CSV の 1 行。
 * 対応は src/utils/stalledOrderCsv.js の toTwsOrderRow の仕様（売買区分 1/3 → SELL/BUY、
 * 指成区分 MO/LO → MKT/LMT、成行は価格が空欄、執行条件は常に DAY）と、api 層の symbol
 * （Ticker。無ければ銘柄コード）・market_category（発注範囲名）の取り方を再掲したもの。
 */
const ACTIONS = { 1: 'SELL', 3: 'BUY' }
const ORDER_TYPES = { MO: 'MKT', LO: 'LMT' }
function twsOrderLine(raw) {
  const orderType = ORDER_TYPES[raw.指成区分]
  return [
    raw.ID,
    raw.口座番号,
    raw.Ticker || raw.銘柄コード,
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

/*
 * 片方の一覧だけが空になる絞り込み。部店 234 は注文エラーだけ、銘柄 AAPL は注文中だけに当たる
 * （既定ハンドラは部店を完全一致、銘柄を銘柄コード / Ticker の部分一致で絞る）
 */
const ERROR_ONLY_BRANCH = '234'
const WORKING_ONLY_SYMBOL = 'AAPL'
const branchErrors = stalledOrderErrors.filter((row) => row.部店 === ERROR_ONLY_BRANCH)
const symbolWorking = stalledWorkingOrders.filter(
  (row) => row.銘柄コード.includes(WORKING_ONLY_SYMBOL) || row.Ticker.includes(WORKING_ONLY_SYMBOL),
)

/** 1 行の 12 セルが生の行の内容どおりかを確かめる（理由の列は variant ごとに渡す） */
async function expectRow(row, raw, reason) {
  const cells = row.getByRole('cell')
  await expect(cells.nth(0)).toHaveText(`#${raw.ID}`)
  await expect(cells.nth(1)).toHaveText(raw.部店)
  await expect(cells.nth(2)).toHaveText(String(raw.口座番号))
  await expect(cells.nth(3)).toHaveText(raw.顧客名)
  await expect(cells.nth(4)).toHaveText(raw.Ticker || raw.銘柄コード)
  await expect(cells.nth(5)).toHaveText(SIDE_LABELS[raw.売買区分])
  await expect(cells.nth(6)).toHaveText(formatQuantity(raw.数量))
  await expect(cells.nth(7)).toHaveText(priceLabel(raw))
  await expect(cells.nth(8)).toHaveText(raw.発注範囲名)
  await expect(cells.nth(10)).toHaveText(reason)
  await expect(cells.nth(11)).toHaveText(raw.表示状況名 || raw.処理状況名)
}

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

/** 注文エラーの 1 件目を約定、2 件目を未約定にするコンファメーション */
const [FILLED_ORDER, WORKING_ORDER] = stalledOrderErrors
const VALID_CONFIRMATION = [
  CONFIRMATION_HEADER,
  `${FILLED_ORDER.ID},TWS-1,FILLED,${FILLED_ORDER.数量},410,2026-09-16 11:00:00,`,
  `${WORKING_ORDER.ID},TWS-2,WORKING,0,0,2026-09-16 11:00:00,`,
]
const CONFIRMATION_NAME = 'confirmation.csv'

/*
 * 取込の応答（CsvImportResponse の生の形）。実 API の文言は持っていないので、message は
 * このテストが決めた値で、画面がそれをそのまま出すことを見る。
 */
const IMPORT_SUCCESS = {
  success: true,
  total_count: 2,
  success_count: 2,
  error_count: 0,
  errors: [],
  message: 'コンファメーションを 2 件取り込みました。',
}
const UNKNOWN_ORDER_ERROR = '注文ID「999」は滞留注文にありません。'
const IMPORT_ROW_ERROR = {
  success: false,
  total_count: 1,
  success_count: 0,
  error_count: 1,
  errors: [
    {
      line_number: 2,
      errors: [UNKNOWN_ORDER_ERROR],
      row_data: { order_id: '999', confirmation_status: 'FILLED' },
    },
  ],
  message: '1 行にエラーがあるため、取り込みませんでした。CSV を直して取り込み直してください。',
}
const HEADER_ERROR = `ヘッダが違います。1 行目を ${CONFIRMATION_HEADER} にしてください。`

/** 取込の応答を差し替える。page.goto() より前に呼ぶ */
function mockImport(page, status, body) {
  return mockApi(page, [{ method: 'post', path: IMPORT_PATH, status, body }])
}

test.describe('滞留注文抽出', () => {
  test('[SO-01] サイドメニューから開くと 2 本の一覧が件数付きで表示される', async ({ page }) => {
    await page.goto('/')

    await clickSideMenuLink(page, '滞留注文抽出')

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByRole('heading', { name: '滞留注文抽出', exact: true })).toBeVisible()
    await expect(page.getByText('注文エラー（別システムで発注要）')).toBeVisible()
    await expect(page.getByText('注文中（コンファメーション取込後・未約定）')).toBeVisible()
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)
    await expect(errorRows(page)).toHaveCount(stalledOrderErrors.length)
    await expect(workingRows(page)).toHaveCount(stalledWorkingOrders.length)
  })

  test('[SO-02] 注文エラーの 1 行目に注文の内容とエラー理由が表示される', async ({ page }) => {
    await page.goto(PATH)

    const first = stalledOrderErrors[0]
    // 1 行目は Dream発注失敗（101）の注文（既定モックの並びの前提を明示しておく）
    expect(first.処理状況).toBe('101')
    await expectRow(errorRows(page).first(), first, errorReasonOf(first))
  })

  test('[SO-03] 注文中の 1 行目に注文の内容が出て確認状況は「—」になる', async ({ page }) => {
    await page.goto(PATH)

    await expectRow(workingRows(page).first(), stalledWorkingOrders[0], '—')
    // 確認状況はサーバに項目が無いので、注文中の全行で「—」
    await expect(workingRows(page)).toHaveCount(stalledWorkingOrders.length)
    for (let index = 0; index < stalledWorkingOrders.length; index += 1) {
      await expect(workingRows(page).nth(index).getByRole('cell').nth(10)).toHaveText('—')
    }
  })

  test('[SO-04] 部店コードで絞り込むと注文中だけが空になる', async ({ page }) => {
    await page.goto(PATH)
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)

    await page.getByTestId('stalled-orders-branch-code').fill(ERROR_ONLY_BRANCH)
    await page.getByTestId('stalled-orders-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`[?&]branch_code=${ERROR_ONLY_BRANCH}(&|$)`))
    await expectCounts(page, branchErrors.length, 0)
    await expect(errorRows(page)).toHaveCount(branchErrors.length)
    await expect(errorRows(page).first().getByRole('cell').first()).toHaveText(
      `#${branchErrors[0].ID}`,
    )
    await expect(page.getByTestId('stalled-working-orders-empty')).toHaveText(
      'コンファメーション取込後に未約定となっている注文はありません',
    )
  })

  test('[SO-05] 銘柄コードで絞り込むと注文エラーだけが空になる', async ({ page }) => {
    await page.goto(PATH)
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)

    await page.getByTestId('stalled-orders-symbol').fill(WORKING_ONLY_SYMBOL)
    await page.getByTestId('stalled-orders-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`[?&]symbol=${WORKING_ONLY_SYMBOL}(&|$)`))
    await expectCounts(page, 0, symbolWorking.length)
    await expect(page.getByTestId('stalled-order-errors-empty')).toHaveText(
      '別システムで発注する注文エラーはありません',
    )
    await expect(workingRows(page)).toHaveCount(symbolWorking.length)
    await expect(workingRows(page).first().getByRole('cell').first()).toHaveText(
      `#${symbolWorking[0].ID}`,
    )
  })

  test('[SO-06] クリアでクエリと入力欄が空になり全件に戻る', async ({ page }) => {
    await page.goto(`${PATH}?branch_code=${ERROR_ONLY_BRANCH}`)
    await expectCounts(page, branchErrors.length, 0)
    await expect(page.getByTestId('stalled-orders-branch-code')).toHaveValue(ERROR_ONLY_BRANCH)

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
    // 指値の #40 と、成行で価格が空欄の #29（シナリオに書いた 2 行を明示しておく）
    expect(file.text).toContain(
      `${CRLF}40,300003,AMZN,SELL,40,LMT,214.25,DAY,プレ＋レギュラー${CRLF}`,
    )
    expect(file.text).toContain(`${CRLF}29,200001,MSFT,BUY,35,MKT,,DAY,レギュラー${CRLF}`)
  })

  test('[SO-18] 絞り込んだ状態で出力すると画面の注文エラーの行だけになる', async ({ page }) => {
    await page.goto(`${PATH}?branch_code=${ERROR_ONLY_BRANCH}`)
    await expectCounts(page, branchErrors.length, 0)

    const file = await download(page, 'stalled-orders-export')

    expect(file.text).toBe(csvText(TWS_ORDER_HEADER, branchErrors.map(twsOrderLine)))
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

  test('[SO-20] 取込に成功すると応答の文言が通知に出て選択が外れる', async ({ page }) => {
    await mockImport(page, 200, IMPORT_SUCCESS)
    await page.goto(PATH)
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)

    await chooseCsv(page, CONFIRMATION_NAME, VALID_CONFIRMATION)
    await expect(page.getByTestId('stalled-orders-confirmation-file')).toContainText(
      CONFIRMATION_NAME,
    )
    await importButton(page).click()

    await expect(page.getByTestId('stalled-orders-import-notice')).toHaveText(
      IMPORT_SUCCESS.message,
    )
    await expect(page.getByTestId('stalled-orders-import-errors')).toHaveCount(0)
    await expect(page.getByTestId('stalled-orders-confirmation-file')).not.toContainText(
      CONFIRMATION_NAME,
    )
    await expect(importButton(page)).toBeDisabled()
    // 一覧は出たまま（反映の中身はバックエンドの責務で、mockApi() の固定応答では見られない）
    await expect(page.getByTestId('stalled-order-errors-table')).toBeVisible()
    await expect(page.getByTestId('stalled-working-orders-table')).toBeVisible()
  })

  test('[SO-21] 行エラーが返ると理由の表が出てファイルは選ばれたまま', async ({ page }) => {
    await mockImport(page, 200, IMPORT_ROW_ERROR)
    await page.goto(PATH)
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)

    await chooseCsv(page, CONFIRMATION_NAME, [
      CONFIRMATION_HEADER,
      '999,TWS-9,FILLED,1,1,2026-09-16 11:00:00,',
    ])
    await importButton(page).click()

    const errors = page.getByTestId('stalled-orders-import-errors')
    await expect(errors).toContainText(IMPORT_ROW_ERROR.message)
    const rows = errors.getByTestId('data-table-row')
    await expect(rows).toHaveCount(1)
    const cells = rows.first().getByRole('cell')
    await expect(cells.nth(0)).toHaveText('2')
    await expect(cells.nth(1)).toHaveText('999')
    await expect(cells.nth(2)).toHaveText(UNKNOWN_ORDER_ERROR)

    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)
    await expect(page.getByTestId('stalled-orders-confirmation-file')).toContainText(
      CONFIRMATION_NAME,
    )
    await expect(page.getByTestId('stalled-orders-import-notice')).toHaveCount(0)
  })

  test('[SO-22] ファイルごと拒否（400）されると理由が出てファイルは選ばれたまま', async ({
    page,
  }) => {
    await mockImport(page, 400, { detail: HEADER_ERROR })
    await page.goto(PATH)
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)

    await chooseCsv(page, 'wrong.csv', ['id,status', '27,FILLED'])
    await importButton(page).click()

    await expect(page.getByTestId('stalled-orders-import-error')).toHaveText(HEADER_ERROR)
    await expect(page.getByTestId('stalled-orders-confirmation-file')).toContainText('wrong.csv')
    await expect(importButton(page)).toBeEnabled()
    await expectCounts(page, stalledOrderErrors.length, stalledWorkingOrders.length)
  })

  test('[SO-23] 取込が 500 のとき理由が出てファイルは選ばれたまま', async ({ page }) => {
    await mockImport(page, 500, { detail: SERVER_ERROR })
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
    await mockImport(page, 200, IMPORT_SUCCESS)
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

  test('[SO-25] 注文エラーに IB発注失敗（103）の注文が理由付きで載る', async ({ page }) => {
    await page.goto(PATH)

    const ibFailed = stalledOrderErrors.filter((row) => row.処理状況 === '103')
    // 既定モックに 103 の行が無ければこのシナリオは成り立たない（フィクスチャの変更で黙って空振りさせない）
    expect(ibFailed.length).toBeGreaterThan(0)
    await expect(errorRows(page)).toHaveCount(stalledOrderErrors.length)
    for (const raw of ibFailed) {
      const index = stalledOrderErrors.indexOf(raw)
      await expectRow(errorRows(page).nth(index), raw, errorReasonOf(raw))
    }
  })
})
