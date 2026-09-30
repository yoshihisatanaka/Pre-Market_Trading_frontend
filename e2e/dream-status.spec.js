import { expect, test } from '@playwright/test'
import {
  dreamOrders,
  dreamStatusCodes,
  withDerivedDreamFields,
} from '../src/mocks/fixtures/dreamStatus'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/dream-status.md（タイトル先頭の [DS-nn] が対応 ID）
// 定点RPA登録の処理状況を読む一覧。ページ位置と検索条件は URL クエリを正とするため、
// URL と画面の同期と、状況の出し分け・エラー詳細のポップアップ・STS変更（ダイアログから送信して
// 一覧に反映されるまで）をここで守る。既定ハンドラの PUT は行を書き換えて保持するが、
// 状態はページを開き直すと戻るのでテストごとに独立している。
// mockApi() は固定の body を返すだけで offset や検索条件のクエリを解釈しない。
// ページングと絞り込み（DS-04 / DS-11 / DS-12 / DS-15 / DS-16）はクエリを実際に処理する既定ハンドラで検証する。

const PATH = '/orders/dream-status'
const LIST_API = '*/api/orders/dream-status'

// src/stores/dreamStatus.js の DREAM_STATUS_PAGE_SIZE（= src/utils/pagination.js の DEFAULT_PAGE_SIZE）と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

/** 列の並び。見出しの検証（DS-02）と、セルを列名で引くための索引を兼ねる */
const COLUMNS = [
  'Dream登録状況',
  'STS変更',
  '登録日時',
  'Dream受付番号',
  '注文ID',
  '部店',
  '口座番号',
  '顧客名',
  '銘柄',
  '売買',
  '数量',
]

// 既定ハンドラと同じ並び（作成日時の新しい順）。フィクスチャ自体は ID の昇順
const sorted = [...dreamOrders].sort((a, b) => b.作成日時.localeCompare(a.作成日時))
const TOTAL = sorted.length
const firstPage = sorted.slice(0, PAGE_SIZE)
const secondPage = sorted.slice(PAGE_SIZE)
const firstRow = sorted[0]

/** 先頭 8 件は Dream状況 8 種を 1 件ずつ持つ（フィクスチャの FEATURED） */
const featured = sorted.slice(0, 8)

const isError = (order) => order.Dream状況 === '9' || order.Dream状況 === 'C9'
const errorOrders = sorted.filter(isError)

/** 登録失敗で受付番号なしの行（「登録済」への変更で受付番号を求められる） */
const registrationFailed = firstPage.find(
  (order) => order.Dream状況 === '9' && order.受注番号 === null,
)
const cancelFailed = firstPage.find((order) => order.Dream状況 === 'C9')

const transitionName = (order, code) =>
  order.変更可能状況.find((transition) => transition.コード === code).名称

const errorCode = dreamStatusCodes.find((status) => status.コード === 'ERROR')

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('dream-status-table').getByTestId('data-table-row')
}

/** 注文 ID で行を引く。注文ID 列の「#56」で一意に決まる */
function rowOf(page, order) {
  return rowsOf(page).filter({
    has: page.locator(`td:nth-child(${COLUMNS.indexOf('注文ID') + 1})`, {
      hasText: new RegExp(`^#${order.ID}$`),
    }),
  })
}

/** 行の中の 1 セル。列名から位置を引く */
function cellOf(row, column) {
  return row.locator('td').nth(COLUMNS.indexOf(column))
}

/** 表の 1 列ぶんのセル（全行） */
function columnOf(page, column) {
  return page
    .getByTestId('dream-status-table')
    .locator(`td:nth-child(${COLUMNS.indexOf(column) + 1})`)
}

async function openList(page, path = PATH) {
  await page.goto(path)
  await expect(rowsOf(page)).not.toHaveCount(0)
}

function changeDialog(page) {
  return page.getByRole('dialog', { name: 'Dream状況を変更しますか？' })
}

const CHANGE_API = '*/api/orders/dream-status/:orderId'

/** 変更後の行。既定ハンドラと同じ導出（withDerivedDreamFields）で状況名を引く */
const changedTo = (order, fields) => withDerivedDreamFields({ ...order, ...fields })

/** 既定ハンドラ（src/mocks/handlers/dreamStatus.js）が返す処理結果の文言 */
const successMessage = (order, code) =>
  `注文ID ${order.ID} のDream状況を「${transitionName(order, code)}」へ変更しました。`

/** 行のプルダウンで遷移先を選び、ダイアログが開くのを待つ */
async function chooseTransition(page, order, code) {
  await rowOf(page, order)
    .getByTestId('dream-status-change')
    .selectOption({ label: transitionName(order, code) })
  const dialog = changeDialog(page)
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('Dream登録状況', () => {
  test('[DS-01] サイドメニューから開くと見出し・現在地・件数・1 ページ目が表示される', async ({
    page,
  }) => {
    await page.goto('/')

    const nav = page.getByRole('navigation', { name: 'メインメニュー' })
    await nav.getByRole('link', { name: 'Dream登録状況', exact: true }).click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByRole('heading', { name: 'Dream登録状況', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Dream登録状況', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )

    await expect(page.getByTestId('dream-status-count')).toHaveText(`${TOTAL} 件`)
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)
    await expect(cellOf(rows.first(), '注文ID')).toHaveText(`#${firstRow.ID}`)
  })

  test('[DS-02] 列が仕様どおりの順に並ぶ', async ({ page }) => {
    await openList(page)

    await expect(page.getByTestId('dream-status-table').locator('th')).toHaveText(COLUMNS)
  })

  test('[DS-03] 先頭 8 行に Dream状況 8 種が出し分けられる', async ({ page }) => {
    // 8 種がそろっていないとシナリオが成立しない
    expect(new Set(featured.map((order) => order.Dream状況)).size).toBe(8)

    await openList(page)

    const rows = rowsOf(page)
    for (const [index, order] of featured.entries()) {
      await expect(cellOf(rows.nth(index), 'Dream登録状況')).toHaveText(order.Dream状況名)
      await expect(cellOf(rows.nth(index), '注文ID')).toHaveText(`#${order.ID}`)
    }
  })

  test('[DS-04] 「次のページ」を押すと 2 ページ目が表示される', async ({ page }) => {
    await openList(page)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    const pagination = page.getByTestId('dream-status-pagination')
    await pagination.getByRole('button', { name: '次のページ' }).click()

    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(secondPage.length)
    await expect(cellOf(rows.first(), '注文ID')).toHaveText(`#${secondPage[0].ID}`)
    await expect(pagination.getByTestId('pagination-range')).toHaveText(
      `${TOTAL} 件中 ${PAGE_SIZE + 1}–${TOTAL} 件`,
    )
  })

  test('[DS-05] 登録失敗の状況に触れるとエラー詳細が出て、離れると消える', async ({ page }) => {
    await openList(page)

    const trigger = rowOf(page, registrationFailed).getByTestId('dream-status-error-trigger')
    await trigger.hover()

    const tooltip = page.getByRole('tooltip')
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText('Dream登録エラー詳細')
    await expect(tooltip).toContainText(registrationFailed.Dreamエラー内容)

    await page.mouse.move(0, 0)
    await expect(tooltip).toBeHidden()
  })

  test('[DS-06] 取消失敗の状況に触れると取消エラーの詳細が出る', async ({ page }) => {
    await openList(page)

    await rowOf(page, cancelFailed).getByTestId('dream-status-error-trigger').hover()

    const tooltip = page.getByRole('tooltip')
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText('Dream取消エラー詳細')
    await expect(tooltip).toContainText(cancelFailed.Dreamエラー内容)
  })

  test('[DS-07] STS変更は登録失敗・取消失敗の行だけプルダウンで、ほかは「変更不可」', async ({
    page,
  }) => {
    const changeable = firstPage.filter((order) => order.STS変更可)
    expect(changeable.map((order) => order.ID)).toEqual(
      firstPage.filter(isError).map((order) => order.ID),
    )

    await openList(page)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    const table = page.getByTestId('dream-status-table')
    await expect(table.getByTestId('dream-status-change')).toHaveCount(changeable.length)
    await expect(table.getByTestId('dream-status-locked')).toHaveCount(
      PAGE_SIZE - changeable.length,
    )
    await expect(table.getByTestId('dream-status-locked')).toHaveText(
      Array(PAGE_SIZE - changeable.length).fill('変更不可'),
    )

    for (const order of [registrationFailed, cancelFailed]) {
      const select = rowOf(page, order).getByTestId('dream-status-change')
      // 先頭はいまの状況（空値）、続けて遷移先
      await expect(select.locator('option')).toHaveText([
        order.Dream状況名,
        ...order.変更可能状況.map((transition) => transition.名称),
      ])
      await expect(select).toHaveValue('')
    }

    // 変更できない状況の行の例
    const done = firstPage.find((order) => order.Dream状況 === '2')
    await expect(rowOf(page, done).getByTestId('dream-status-locked')).toHaveText('変更不可')
    await expect(rowOf(page, done).getByTestId('dream-status-change')).toHaveCount(0)
  })

  test('[DS-08] 受付番号なしの登録失敗を「登録済」にすると受付番号欄付きのダイアログが開く', async ({
    page,
  }) => {
    const target = transitionName(registrationFailed, '2')

    await openList(page)
    await rowOf(page, registrationFailed)
      .getByTestId('dream-status-change')
      .selectOption({ label: target })

    const dialog = changeDialog(page)
    await expect(dialog).toBeVisible()

    const summary = dialog.getByTestId('dream-status-change-summary')
    await expect(summary).toContainText(`#${registrationFailed.ID}`)
    await expect(summary).toContainText(registrationFailed.Dream状況名)
    await expect(summary).toContainText(target)

    await expect(dialog.getByTestId('dream-status-change-receipt-number')).toBeVisible()
    await expect(dialog.getByTestId('dream-status-change-reason')).toBeVisible()
    await expect(page.getByTestId('dream-status-change-submit')).toBeEnabled()
  })

  test('[DS-09] 「未登録」へ変えるときは受付番号欄が出ない', async ({ page }) => {
    const target = transitionName(registrationFailed, '0')

    await openList(page)
    await rowOf(page, registrationFailed)
      .getByTestId('dream-status-change')
      .selectOption({ label: target })

    const dialog = changeDialog(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('dream-status-change-summary')).toContainText(target)
    await expect(dialog.getByTestId('dream-status-change-receipt-number')).toHaveCount(0)
    await expect(page.getByTestId('dream-status-change-submit')).toBeEnabled()
  })

  test('[DS-10] 「キャンセル」でダイアログが閉じ、プルダウンがいまの状況に戻る', async ({
    page,
  }) => {
    await openList(page)

    const select = rowOf(page, registrationFailed).getByTestId('dream-status-change')
    await select.selectOption({ label: transitionName(registrationFailed, '2') })

    const dialog = changeDialog(page)
    await expect(dialog).toBeVisible()

    await page.getByTestId('dream-status-change-cancel').click()

    await expect(dialog).toBeHidden()
    await expect(select).toHaveValue('')
  })

  test('[DS-11] Dream登録状況を「エラー」で絞り込むと URL と一覧に反映される', async ({ page }) => {
    expect(errorOrders.length).toBeGreaterThan(0)
    const errorNames = new Set(errorOrders.map((order) => order.Dream状況名))

    await openList(page)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('dream-status-status').selectOption({ label: errorCode.名称 })
    await page.getByTestId('dream-status-search-submit').click()

    await expect(page).toHaveURL(/dream_status=ERROR/)
    await expect(page.getByTestId('dream-status-count')).toHaveText(`${errorOrders.length} 件`)
    await expect(rowsOf(page)).toHaveCount(errorOrders.length)
    const names = await columnOf(page, 'Dream登録状況').allInnerTexts()
    expect(names).toHaveLength(errorOrders.length)
    for (const name of names) expect(errorNames.has(name.trim())).toBe(true)
  })

  test('[DS-12] 「クリア」を押すと絞り込みが既定に戻る', async ({ page }) => {
    await openList(page)

    await page.getByTestId('dream-status-status').selectOption({ label: errorCode.名称 })
    await page.getByTestId('dream-status-search-submit').click()
    await expect(rowsOf(page)).toHaveCount(errorOrders.length)

    await page.getByTestId('dream-status-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('dream-status-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('dream-status-status')).toHaveValue('')
  })

  test('[DS-13] 0 件のときは空状態が表示される', async ({ page }) => {
    await mockApi(page, [
      { path: LIST_API, body: { total: 0, limit: PAGE_SIZE, offset: 0, orders: [] } },
    ])
    await page.goto(PATH)

    await expect(page.getByTestId('dream-status-empty')).toHaveText('該当する注文はありません。')
    await expect(page.getByTestId('dream-status-table')).toBeHidden()
    await expect(page.getByTestId('dream-status-description')).toBeVisible()
    await expect(page.getByTestId('dream-status-search')).toBeVisible()
  })

  test('[DS-14] API がエラーを返したときエラー表示と再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [{ path: LIST_API, status: 500, body: { detail: ERROR_MESSAGE } }])
    await page.goto(PATH)

    const error = page.getByTestId('dream-status-error')
    await expect(error).toContainText(ERROR_MESSAGE)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('dream-status-table')).toBeHidden()
    await expect(page.getByTestId('dream-status-description')).toBeVisible()
    await expect(page.getByTestId('dream-status-search')).toBeVisible()
  })

  test('[DS-15] 条件付きの URL を直接開くと検索欄と一覧に復元される', async ({ page }) => {
    await page.goto(`${PATH}?dream_status=ERROR`)

    await expect(page.getByTestId('dream-status-status')).toHaveValue(errorCode.コード)
    await expect(page.getByTestId('dream-status-count')).toHaveText(`${errorOrders.length} 件`)
    await expect(rowsOf(page)).toHaveCount(errorOrders.length)
  })

  test('[DS-16] ブラウザバックで 1 ページ目に戻る', async ({ page }) => {
    await openList(page)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page
      .getByTestId('dream-status-pagination')
      .getByRole('button', { name: '次のページ' })
      .click()
    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))
    await expect(rowsOf(page)).toHaveCount(secondPage.length)

    await page.goBack()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(cellOf(rowsOf(page).first(), '注文ID')).toHaveText(`#${firstRow.ID}`)
  })

  test('[DS-17] 登録失敗を「未登録」へ変更するとお知らせが出て、行が未登録・変更不可になる', async ({
    page,
  }) => {
    const expected = changedTo(registrationFailed, { Dream登録状況: '0' })

    await openList(page)
    const dialog = await chooseTransition(page, registrationFailed, '0')
    await dialog.getByTestId('dream-status-change-reason').fill('Dream 側で再送するため')
    await page.getByTestId('dream-status-change-submit').click()

    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('dream-status-notice')).toHaveText(
      successMessage(registrationFailed, '0'),
    )
    const row = rowOf(page, registrationFailed)
    await expect(cellOf(row, 'Dream登録状況')).toHaveText(expected.Dream状況名)
    await expect(row.getByTestId('dream-status-locked')).toHaveText('変更不可')
    await expect(row.getByTestId('dream-status-change')).toHaveCount(0)
  })

  test('[DS-18] 受付番号を入れて「登録済」へ変更すると、行が登録済になり受付番号が入る', async ({
    page,
  }) => {
    const expected = changedTo(registrationFailed, { Dream登録状況: '2' })
    const receiptNumber = 'DR-E2E-0001'

    await openList(page)
    const dialog = await chooseTransition(page, registrationFailed, '2')
    await dialog.getByTestId('dream-status-change-receipt-number').fill(receiptNumber)
    await page.getByTestId('dream-status-change-submit').click()

    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('dream-status-notice')).toHaveText(
      successMessage(registrationFailed, '2'),
    )
    const row = rowOf(page, registrationFailed)
    await expect(cellOf(row, 'Dream登録状況')).toHaveText(expected.Dream状況名)
    await expect(cellOf(row, 'Dream受付番号')).toHaveText(receiptNumber)
    await expect(row.getByTestId('dream-status-locked')).toHaveText('変更不可')
  })

  test('[DS-19] 受付番号が空のまま「登録済」へ変えようとすると欄にエラーが出て送信しない', async ({
    page,
  }) => {
    await openList(page)
    const dialog = await chooseTransition(page, registrationFailed, '2')
    await page.getByTestId('dream-status-change-submit').click()

    await expect(dialog.getByTestId('dream-status-change-receipt-number-field')).toContainText(
      'Dream受付番号を入力してください。',
    )
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('dream-status-notice')).toHaveCount(0)
    await expect(cellOf(rowOf(page, registrationFailed), 'Dream登録状況')).toHaveText(
      registrationFailed.Dream状況名,
    )
  })

  test('[DS-20] 取消失敗を「取消済」へ変更すると、行が取消済・変更不可になる', async ({ page }) => {
    const expected = changedTo(cancelFailed, { Dream取消状況: '2' })

    await openList(page)
    const dialog = await chooseTransition(page, cancelFailed, 'C2')
    await page.getByTestId('dream-status-change-submit').click()

    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('dream-status-notice')).toHaveText(
      successMessage(cancelFailed, 'C2'),
    )
    const row = rowOf(page, cancelFailed)
    await expect(cellOf(row, 'Dream登録状況')).toHaveText(expected.Dream状況名)
    await expect(row.getByTestId('dream-status-locked')).toHaveText('変更不可')
    await expect(row.getByTestId('dream-status-change')).toHaveCount(0)
  })

  test('[DS-21] 変更が 409 で弾かれるとダイアログ内に理由が出て、キャンセルで閉じられる', async ({
    page,
  }) => {
    const conflict =
      '他のユーザーによって更新されています。最新の情報を取得してからやり直してください。'
    await mockApi(page, [
      { method: 'put', path: CHANGE_API, status: 409, body: { detail: conflict } },
    ])

    await openList(page)
    const dialog = await chooseTransition(page, registrationFailed, '0')
    await page.getByTestId('dream-status-change-submit').click()

    await expect(dialog.getByTestId('dream-status-change-error')).toContainText(conflict)
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('dream-status-notice')).toHaveCount(0)
    await expect(cellOf(rowOf(page, registrationFailed), 'Dream登録状況')).toHaveText(
      registrationFailed.Dream状況名,
    )

    await page.getByTestId('dream-status-change-cancel').click()
    await expect(dialog).toBeHidden()
  })

  test('[DS-22] 「エラー」で絞り込んだまま変更すると、件数が減り変更した行が表から消える', async ({
    page,
  }) => {
    expect(errorOrders).toContainEqual(registrationFailed)

    await openList(page, `${PATH}?dream_status=ERROR`)
    await expect(rowsOf(page)).toHaveCount(errorOrders.length)

    await chooseTransition(page, registrationFailed, '0')
    await page.getByTestId('dream-status-change-submit').click()

    await expect(page.getByTestId('dream-status-notice')).toBeVisible()
    await expect(page).toHaveURL(/dream_status=ERROR/)
    await expect(page.getByTestId('dream-status-count')).toHaveText(
      `${errorOrders.length - 1} 件`,
    )
    await expect(rowsOf(page)).toHaveCount(errorOrders.length - 1)
    await expect(rowOf(page, registrationFailed)).toHaveCount(0)
  })
})
