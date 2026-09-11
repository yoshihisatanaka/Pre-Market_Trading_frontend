import { expect, test } from '@playwright/test'
import { corporateActions } from '../src/mocks/fixtures/ca'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/ca.md（タイトル先頭の [CA-xx] が対応 ID）
// ページ位置と検索条件は URL クエリを正とするため、URL と画面の同期をここで守る。
// mockApi() は固定の body を返すだけで offset / stock_code / ca_type を解釈しない。
// ページングと絞り込み（CA-02 / 03 / 04 / 05）は
// クエリを実際に処理する既定ハンドラで検証する。

const PATH = '/masters/ca'

// src/stores/ca.js の CA_PAGE_SIZE と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

/*
 * フィクスチャはバックエンドの生の形（日本語キー / 日付は YYYYMMDD の integer）なので、
 * 期待値は api 層と同じ変換でアプリ内モデルの形に直してから使う。
 */
const toIsoDate = (value) => {
  const digits = String(value ?? '')
  if (!/^\d{8}$/.test(digits)) return ''
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}
const toRow = (ca) => ({
  stockCode: ca.銘柄コード,
  ticker: ca.Ticker ?? '',
  caTypeName: ca.CA種別名 ?? '',
  effectiveDate: toIsoDate(ca.効力発生日),
  ratio: ca.比率 ?? '',
  note: ca.備考 ?? '',
  userModified: ca.ユーザー操作フラグ === 1,
})

/** 実 API と同じ並び（効力発生日の降順、同じなら ID の降順） */
const sortKey = (ca) => ca.効力発生日 ?? ca.権利付最終日 ?? 99999999
const sorted = [...corporateActions].sort((a, b) => sortKey(b) - sortKey(a) || b.ID - a.ID)
const allRows = sorted.map(toRow)
const TOTAL = allRows.length
const secondPage = allRows.slice(PAGE_SIZE)
const firstRow = allRows[0]

// 絞り込みに使う値もフィクスチャから導く（'AAPL' や '110' を直接書かない）
const TICKER = firstRow.ticker
const byTicker = allRows.filter((row) => row.ticker === TICKER)
const CA_TYPE = sorted[0].CA種別
const CA_TYPE_NAME = firstRow.caTypeName
const byCaType = allRows.filter((row) => row.caTypeName === CA_TYPE_NAME)

// フィクスチャのどの銘柄コード・Ticker にも当たらない文字列
const NO_MATCH = 'ZZZZ'

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('ca-table').getByTestId('data-table-row')
}

/** 行の背景色。CSS クラス名ではなく「見えかた」で確かめる（CA-08） */
function backgroundColorOf(row) {
  return row.evaluate((el) => getComputedStyle(el).backgroundColor)
}

test.describe('CAマスタ一覧', () => {
  test('[CA-01] サイドメニューから開くと一覧と件数が表示される', async ({ page }) => {
    await page.goto('/')

    await page
      .getByRole('navigation', { name: 'メインメニュー' })
      .getByRole('link', { name: 'CAマスタ', exact: true })
      .click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByRole('heading', { name: 'CAマスタ', exact: true })).toBeVisible()
    // 画面固有の操作がヘッダ（#topbar-actions）へ差し込まれている
    await expect(page.getByTestId('ca-reload')).toBeVisible()

    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL} 件`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)
    await expect(rows.first()).toContainText(firstRow.stockCode)
    await expect(rows.first()).toContainText(firstRow.ticker)
    await expect(rows.first()).toContainText(firstRow.caTypeName)
    await expect(rows.first()).toContainText(firstRow.ratio)
  })

  test('[CA-02] 「次のページ」を押すと 2 ページ目が表示される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    const pagination = page.getByTestId('ca-pagination')
    await pagination.getByRole('button', { name: '次のページ' }).click()

    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(secondPage.length)
    await expect(rows.first()).toContainText(secondPage[0].stockCode)

    await expect(pagination.getByTestId('pagination-range')).toHaveText(
      `${TOTAL} 件中 ${PAGE_SIZE + 1}–${TOTAL} 件`,
    )
  })

  test('[CA-03] 銘柄コードで絞り込むと URL と一覧に反映される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('ca-stock-code').fill(TICKER)
    await page.getByTestId('ca-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`stock_code=${TICKER}`))
    await expect(page.getByTestId('ca-count')).toHaveText(`${byTicker.length} 件`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(byTicker.length)
    // 絞り込んだ銘柄以外が混ざっていない
    await expect(rows.filter({ hasText: TICKER })).toHaveCount(byTicker.length)
  })

  test('[CA-04] CA種別で絞り込むと URL と一覧に反映される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('ca-type').selectOption(CA_TYPE)
    await page.getByTestId('ca-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`ca_type=${CA_TYPE}`))
    await expect(page.getByTestId('ca-count')).toHaveText(`${byCaType.length} 件`)

    const rows = rowsOf(page)
    await expect(rows.filter({ hasText: CA_TYPE_NAME })).toHaveCount(
      Math.min(byCaType.length, PAGE_SIZE),
    )
  })

  test('[CA-05] 「クリア」を押すと絞り込みが解除される', async ({ page }) => {
    await page.goto(PATH)

    await page.getByTestId('ca-stock-code').fill(TICKER)
    await page.getByTestId('ca-search-submit').click()
    await expect(rowsOf(page)).toHaveCount(byTicker.length)

    await page.getByTestId('ca-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('ca-stock-code')).toHaveValue('')
  })

  test('[CA-06] 該当が無いときは空状態が表示される', async ({ page }) => {
    await page.goto(PATH)

    await page.getByTestId('ca-stock-code').fill(NO_MATCH)
    await page.getByTestId('ca-search-submit').click()

    await expect(page.getByTestId('ca-empty')).toHaveText('該当するCAはありません。')
    await expect(page.getByTestId('ca-table')).toBeHidden()
    // 0 件のときこそ条件を直したいので、検索カードは消えない
    await expect(page.getByTestId('ca-search')).toBeVisible()
  })

  test('[CA-07] API がエラーを返したときエラー表示と再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [{ path: '*/api/ca', status: 500, body: { detail: ERROR_MESSAGE } }])
    await page.goto(PATH)

    const error = page.getByTestId('ca-error')
    await expect(error).toContainText(ERROR_MESSAGE)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('ca-table')).toBeHidden()
    // エラーのときも説明バナーと検索カードは消えない
    await expect(page.getByTestId('ca-description')).toBeVisible()
    await expect(page.getByTestId('ca-search')).toBeVisible()
  })

  test('[CA-08] 手動操作された行だけ背景色が変わる', async ({ page }) => {
    await page.goto(PATH)
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)

    const firstPage = allRows.slice(0, PAGE_SIZE)
    const markedIndex = firstPage.findIndex((row) => row.userModified)
    const plainIndex = firstPage.findIndex((row) => !row.userModified)
    // フィクスチャが両方の行を持っていないと、このシナリオは意味を失う
    expect(markedIndex).toBeGreaterThanOrEqual(0)
    expect(plainIndex).toBeGreaterThanOrEqual(0)

    const markedColor = await backgroundColorOf(rows.nth(markedIndex))
    const plainColor = await backgroundColorOf(rows.nth(plainIndex))
    expect(markedColor).not.toBe(plainColor)
  })

  test('[CA-09] 列順が仕様どおりでステータス列と行の操作が無い', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await expect(page.getByTestId('ca-table').locator('th')).toHaveText([
      '銘柄',
      'CA種別',
      '権利付最終日',
      '効力発生日',
      '支払日',
      '比率',
      '備考',
    ])

    // 読むだけの画面。追加の導線も行ごとの操作も持たない
    await expect(page.getByTestId('ca-add')).toHaveCount(0)
    await expect(rowsOf(page).first().getByRole('button')).toHaveCount(0)
  })

  test('[CA-10] ブラウザバックで前のページに戻る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('ca-pagination').getByRole('button', { name: '次のページ' }).click()
    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))
    await expect(rowsOf(page)).toHaveCount(secondPage.length)

    await page.goBack()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(rowsOf(page).first()).toContainText(firstRow.stockCode)
  })
})
