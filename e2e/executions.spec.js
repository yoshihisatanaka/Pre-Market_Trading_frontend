import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { salesOperator, viewerOperator } from '../src/mocks/fixtures/currentOperator'
import { executions } from '../src/mocks/fixtures/executions'
import { formatQuantity } from '../src/utils/format'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/executions.md（タイトル先頭の [EX-nn] が対応 ID）
// 約定を検索して読むだけの画面。ページ位置と検索条件は URL クエリを正とするため、
// URL と画面の同期と、一覧と同じ応答から出す件数カードをここで守る。
// あわせて、ヘッダの「CSV出力」が一覧の条件で落ちること（EX-14〜17）と、
// 預託先の欄・列がロールで出し分けられること（EX-18 / EX-19）を守る。
// mockApi() は固定の body を返すだけで offset や検索条件のクエリを解釈しない。
// ページングと絞り込み（EX-02〜EX-08 / EX-12 / EX-13）はクエリを実際に処理する既定ハンドラで検証する。

const PATH = '/executions'

// src/stores/executions.js の EXECUTIONS_PAGE_SIZE（= utils/pagination.js の DEFAULT_PAGE_SIZE）と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

/** 列の並び。見出しの検証（EX-10）と、セルを列名で引くための索引を兼ねる */
const COLUMNS = [
  '約定ID',
  '注文ID',
  '口座番号',
  '顧客名',
  '銘柄',
  '売買',
  '元注文数量',
  '約定数量',
  '約定単価(USD)',
  '約定代金(USD)',
  '約定日時',
  '出来状況',
  '預託先',
]

/*
 * フィクスチャは生成順（約定日時の昇順）なので、実 API と同じ並び（約定日時の降順・同時刻は ID の降順）に
 * 直してから期待値の出どころにする（src/mocks/handlers/executions.js と同じ規則）。
 */
const sorted = [...executions].sort(
  (a, b) => b.約定日時.localeCompare(a.約定日時) || b.ID - a.ID,
)
const TOTAL = sorted.length
const firstRow = sorted[0]
const secondPage = sorted.slice(PAGE_SIZE)

// 売買区分のコード（'1' 売 / '3' 買）。openapi.json の side の説明どおり
const SELL = '1'
const BUY = '3'

// 絞り込みに使う値もフィクスチャから導く（件数を直接書かない）
const SYMBOL = 'AAPL'
const matchesSymbol = (row) => row.銘柄コード === SYMBOL || row.Ticker === SYMBOL
const bySymbol = sorted.filter(matchesSymbol)
const bySell = sorted.filter((row) => row.売買区分 === SELL)
const byBuy = sorted.filter((row) => row.売買区分 === BUY)
const PARTIAL = '010'
const byPartial = sorted.filter((row) => row.処理状況 === PARTIAL)
/** 最新の約定日。1 日だけの期間で絞る（EX-06） */
const LATEST_DATE = firstRow.約定日時.slice(0, 10)
const byLatestDate = sorted.filter((row) => row.約定日時.slice(0, 10) === LATEST_DATE)
const bySellAndSymbol = bySell.filter(matchesSymbol)

// フィクスチャのどの銘柄コード・Ticker にも当たらない文字列
const NO_MATCH = 'ZZZZ'

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 件数カード。並び順どおり（EX-11） */
const STAT_CARDS = [
  { testId: 'executions-summary-count', label: '総約定件数' },
  { testId: 'executions-summary-buy', label: '買い約定' },
  { testId: 'executions-summary-sell', label: '売り約定' },
  { testId: 'executions-summary-partial', label: '一部出来' },
]

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('executions-table').getByTestId('data-table-row')
}

/** 行の中の 1 セル。列名から位置を引く */
function cellOf(row, column) {
  return row.locator('td').nth(COLUMNS.indexOf(column))
}

/** 表の 1 列ぶんのセル（全行） */
function columnOf(page, column) {
  return page
    .getByTestId('executions-table')
    .locator(`td:nth-child(${COLUMNS.indexOf(column) + 1})`)
}

/** 件数カードが「見出し + 値」だけを表示していること */
function statText(label, value) {
  return new RegExp(`^\\s*${label}\\s*${value}\\s*$`)
}

async function search(page) {
  await page.getByTestId('executions-search-submit').click()
}

/*
 * CSV 出力の期待値。src/mocks/handlers/executions.js の export-csv と同じ規則
 * （約定日時の昇順・同時刻は ID の昇順、先頭に BOM、改行は CRLF）。
 */
const CSV_FILENAME = 'executions.csv'
const BOM = '﻿'
const CSV_HEADER = [
  '約定日時',
  '約定ID',
  '注文ID',
  '受注番号',
  '部店',
  '部店名',
  '口座番号',
  '顧客名',
  '銘柄コード',
  'Ticker',
  '銘柄名',
  '売買区分',
  '売買区分名',
  '注文ルート',
  '預託先',
  '処理状況',
  '処理状況名',
  '注文数量',
  '伝票注文ID',
  '伝票受注番号',
  '指値単価',
  '約定数量',
  '約定単価',
  '約定代金(USD)',
  '手数料',
  '手数料通貨',
  '決済通貨区分',
  'OrderID',
  'ExecID',
].join(',')

const ascending = (rows) =>
  [...rows].sort((a, b) => a.約定日時.localeCompare(b.約定日時) || a.ID - b.ID)

/*
 * データ行の先頭 2 列（約定日時, 約定ID）。どちらも `,` `"` を含まないので囲まれない。
 * 後ろの列（顧客名・銘柄名など）は囲まれることがあるので、行の特定は先頭だけで行う。
 */
const csvLinePrefix = (row) => `${row.約定日時},${row.ID},`

/** ボタンを押してダウンロードを待ち、ファイル名と本文（BOM を含む生の文字列）を返す */
async function download(page) {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('executions-export').click(),
  ])
  return { name: file.suggestedFilename(), text: readFileSync(await file.path(), 'utf8') }
}

/** BOM があれば除いて CRLF で割る。末尾の CRLF の後ろの空要素は落とす */
function csvLines(text) {
  const lines = (text.startsWith(BOM) ? text.slice(BOM.length) : text).split('\r\n')
  expect(lines.at(-1)).toBe('')
  return lines.slice(0, -1)
}

// 注文ルートのコード（'0' みずほ / '1' IB）。openapi.json の route の説明どおり
const MIZUHO = '0'
const IB = '1'
// route=0 の一覧はみずほ注文締のモック（handlers/mizuhoExecutions.js）が先に応えるので、絞り込みは IB で見る
const byIb = sorted.filter((row) => row.注文ルート === IB)

/** 預託先を除いた列（見られないロールの見出し） */
const COLUMNS_WITHOUT_ROUTE = COLUMNS.filter((column) => column !== '預託先')

test.describe('約定照会', () => {
  test('[EX-01] サイドメニューから開くと一覧と件数が表示される', async ({ page }) => {
    await page.goto('/')

    await page
      .getByRole('navigation', { name: 'メインメニュー' })
      .getByRole('link', { name: '約定照会', exact: true })
      .click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByRole('heading', { name: '約定照会', exact: true })).toBeVisible()

    await expect(page.getByTestId('executions-count')).toHaveText(`${TOTAL} 件`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)
    await expect(cellOf(rows.first(), '約定ID')).toHaveText(`#${firstRow.ID}`)
  })

  test('[EX-02] 「次のページ」を押すと 2 ページ目が表示される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    const pagination = page.getByTestId('executions-pagination')
    await pagination.getByRole('button', { name: '次のページ' }).click()

    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(secondPage.length)
    await expect(cellOf(rows.first(), '約定ID')).toHaveText(`#${secondPage[0].ID}`)
    await expect(pagination.getByTestId('pagination-range')).toHaveText(
      `${TOTAL} 件中 ${PAGE_SIZE + 1}–${TOTAL} 件`,
    )
  })

  test('[EX-03] 銘柄コードで絞り込むと URL と一覧に反映される', async ({ page }) => {
    // 絞り込みが効いたと言えること（全件より少なく、0 件でない）
    expect(bySymbol.length).toBeGreaterThan(0)
    expect(bySymbol.length).toBeLessThan(TOTAL)

    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('executions-symbol').fill(SYMBOL)
    await search(page)

    await expect(page.getByTestId('executions-count')).toHaveText(`${bySymbol.length} 件`)
    expect(new URL(page.url()).searchParams.get('symbol')).toBe(SYMBOL)
    await expect(rowsOf(page)).toHaveCount(bySymbol.length)
    await expect(columnOf(page, '銘柄')).toHaveText(Array(bySymbol.length).fill(SYMBOL))
  })

  test('[EX-04] 売買区分で「売り」を選ぶと売りの約定だけが出る', async ({ page }) => {
    expect(bySell.length).toBeGreaterThan(0)

    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('executions-side').selectOption({ label: '売り' })
    await search(page)

    await expect(page).toHaveURL(/side=sell/)
    await expect(page.getByTestId('executions-count')).toHaveText(`${bySell.length} 件`)
    await expect(rowsOf(page)).toHaveCount(bySell.length)
    await expect(columnOf(page, '売買')).toHaveText(Array(bySell.length).fill('売'))
  })

  test('[EX-05] 出来状況で「一部出来」を選ぶと一部出来の約定だけが出る', async ({ page }) => {
    expect(byPartial.length).toBeGreaterThan(0)

    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('executions-status').selectOption({ label: '一部出来' })
    await search(page)

    await expect(page).toHaveURL(new RegExp(`status=${PARTIAL}`))
    await expect(page.getByTestId('executions-count')).toHaveText(`${byPartial.length} 件`)
    await expect(rowsOf(page)).toHaveCount(byPartial.length)
    await expect(columnOf(page, '出来状況')).toHaveText(Array(byPartial.length).fill('一部出来'))
  })

  test('[EX-06] 約定日の期間で絞り込むとその日の約定だけが出る', async ({ page }) => {
    expect(byLatestDate.length).toBeGreaterThan(0)
    expect(byLatestDate.length).toBeLessThan(TOTAL)

    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('executions-date-from').fill(LATEST_DATE)
    await page.getByTestId('executions-date-to').fill(LATEST_DATE)
    await search(page)

    await expect(page.getByTestId('executions-count')).toHaveText(`${byLatestDate.length} 件`)
    const query = new URL(page.url()).searchParams
    expect(query.get('start_date')).toBe(LATEST_DATE)
    expect(query.get('end_date')).toBe(LATEST_DATE)
    await expect(rowsOf(page)).toHaveCount(byLatestDate.length)
  })

  test('[EX-07] 「クリア」を押すと絞り込みが解除される', async ({ page }) => {
    await page.goto(PATH)

    await page.getByTestId('executions-symbol').fill(SYMBOL)
    await page.getByTestId('executions-side').selectOption({ label: '売り' })
    await search(page)
    await expect(rowsOf(page)).toHaveCount(bySellAndSymbol.length)

    await page.getByTestId('executions-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('executions-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('executions-symbol')).toHaveValue('')
    await expect(page.getByTestId('executions-side')).toHaveValue('')
  })

  test('[EX-08] 該当が無いときは空状態が表示され、件数カードは 0 になる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('executions-symbol').fill(NO_MATCH)
    await search(page)

    await expect(page.getByTestId('executions-empty')).toHaveText('該当する約定はありません。')
    await expect(page.getByTestId('executions-table')).toBeHidden()
    // 0 件のときこそ条件を直したいので、検索カードと件数カードは消えない
    await expect(page.getByTestId('executions-search')).toBeVisible()
    await expect(page.getByTestId('executions-summary-count')).toHaveText(
      statText('総約定件数', formatQuantity(0)),
    )
  })

  test('[EX-09] API がエラーを返したときエラー表示と再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [
      { path: '*/api/executions', status: 500, body: { detail: ERROR_MESSAGE } },
    ])
    await page.goto(PATH)

    const error = page.getByTestId('executions-error')
    await expect(error).toContainText(ERROR_MESSAGE)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('executions-table')).toBeHidden()
    // エラーのときも検索カードは消えず、件数カードは確定前の値を出さない
    await expect(page.getByTestId('executions-search')).toBeVisible()
    for (const { testId, label } of STAT_CARDS) {
      await expect(page.getByTestId(testId)).toHaveText(statText(label, '—'))
    }
  })

  test('[EX-10] 列順が仕様どおり', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await expect(page.getByTestId('executions-table').locator('th')).toHaveText(COLUMNS)
  })

  test('[EX-11] 件数カードが総数・買い・売り・一部出来の順に出る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    // ExecutionSummary に一部出来の件数が無いので、一部出来のカードは '—' のまま
    const values = [formatQuantity(TOTAL), formatQuantity(byBuy.length), formatQuantity(bySell.length), '—']

    const cards = page.getByTestId(/^executions-summary-/)
    await expect(cards).toHaveCount(STAT_CARDS.length)
    for (const [index, { testId, label }] of STAT_CARDS.entries()) {
      await expect(cards.nth(index)).toHaveAttribute('data-testid', testId)
      await expect(cards.nth(index)).toHaveText(statText(label, values[index]))
    }
  })

  test('[EX-12] ブラウザバックで前のページに戻る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page
      .getByTestId('executions-pagination')
      .getByRole('button', { name: '次のページ' })
      .click()
    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))
    await expect(rowsOf(page)).toHaveCount(secondPage.length)

    await page.goBack()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(cellOf(rowsOf(page).first(), '約定ID')).toHaveText(`#${firstRow.ID}`)
  })

  test('[EX-13] 条件付きの URL を直接開くと検索欄と一覧に復元される', async ({ page }) => {
    // 併用の意味を持つ形（どちらの単独条件より少なく、0 件でない）でないとシナリオが成立しない
    expect(bySellAndSymbol.length).toBeGreaterThan(0)
    expect(bySellAndSymbol.length).toBeLessThan(Math.min(bySell.length, bySymbol.length))

    await page.goto(`${PATH}?side=sell&symbol=${SYMBOL}`)

    await expect(page.getByTestId('executions-side')).toHaveValue('sell')
    await expect(page.getByTestId('executions-symbol')).toHaveValue(SYMBOL)

    await expect(page.getByTestId('executions-count')).toHaveText(`${bySellAndSymbol.length} 件`)
    await expect(rowsOf(page)).toHaveCount(bySellAndSymbol.length)
    await expect(columnOf(page, '銘柄')).toHaveText(Array(bySellAndSymbol.length).fill(SYMBOL))
    await expect(columnOf(page, '売買')).toHaveText(Array(bySellAndSymbol.length).fill('売'))
  })

  test('[EX-14] 「CSV出力」で全件の CSV が約定日時の昇順で保存される', async ({ page }) => {
    await page.goto(PATH)
    await expect(page.getByTestId('executions-count')).toHaveText(`${TOTAL} 件`)

    const file = await download(page)

    expect(file.name).toBe(CSV_FILENAME)
    // BOM はハンドラが付けるが、MSW の XHR 横取りで落ちるので見ない（EX-20 は保留。docs/e2e/executions.md）
    const [header, ...data] = csvLines(file.text)
    expect(header).toBe(CSV_HEADER)
    expect(data).toHaveLength(TOTAL)
    const expected = ascending(executions)
    // 1 行目は最古の約定。以降も約定日時の昇順に並ぶ
    expect(data[0].startsWith(csvLinePrefix(expected[0]))).toBe(true)
    data.forEach((line, index) => {
      expect(line.startsWith(csvLinePrefix(expected[index]))).toBe(true)
    })
  })

  test('[EX-15] 絞り込んだ一覧の「CSV出力」は同じ条件の行だけになる', async ({ page }) => {
    expect(bySymbol.length).toBeLessThan(TOTAL)

    await page.goto(`${PATH}?symbol=${SYMBOL}`)
    await expect(page.getByTestId('executions-count')).toHaveText(`${bySymbol.length} 件`)

    const file = await download(page)

    const [, ...data] = csvLines(file.text)
    expect(data).toHaveLength(bySymbol.length)
    // 一覧と同じ AAPL の約定が、約定日時の昇順で並ぶ
    ascending(bySymbol).forEach((row, index) => {
      expect(data[index].startsWith(csvLinePrefix(row))).toBe(true)
    })
  })

  test('[EX-16] CSV 出力が失敗すると理由が出て、一覧は残る', async ({ page }) => {
    await mockApi(page, [
      { path: '*/api/executions/export-csv', status: 500, body: { detail: ERROR_MESSAGE } },
    ])
    const downloads = []
    page.on('download', (file) => downloads.push(file))

    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('executions-export').click()

    const alert = page.getByTestId('executions-export-error')
    await expect(alert).toContainText(ERROR_MESSAGE)
    await expect(alert).toHaveAttribute('role', 'alert')
    expect(downloads).toHaveLength(0)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('executions-count')).toHaveText(`${TOTAL} 件`)
    await expect(page.getByTestId('executions-export')).toHaveText('CSV出力')
  })

  test('[EX-17] 0 件のときは「CSV出力」が押せない', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('executions-export')).toBeEnabled()

    await page.getByTestId('executions-symbol').fill(NO_MATCH)
    await search(page)

    await expect(page.getByTestId('executions-empty')).toBeVisible()
    await expect(page.getByTestId('executions-export')).toBeDisabled()
  })

  test('[EX-18] 営業員には預託先の欄と列が無く、URL の route も効かない', async ({ page }) => {
    await mockApi(page, [{ path: '*/api/auth/me', body: salesOperator }])
    await page.goto(`${PATH}?route=${MIZUHO}`)

    await expect(page.getByTestId('executions-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('executions-route')).toHaveCount(0)
    await expect(page.getByTestId('executions-table').locator('th')).toHaveText(
      COLUMNS_WITHOUT_ROUTE,
    )
  })

  test('[EX-19] 管理者には預託先の欄と列があり、URL の route で絞り込まれる', async ({ page }) => {
    // 1 ページに収まり、全件より少ない（絞り込みが効いたと言える）
    expect(byIb.length).toBeGreaterThan(0)
    expect(byIb.length).toBeLessThan(Math.min(TOTAL, PAGE_SIZE + 1))

    await mockApi(page, [{ path: '*/api/auth/me', body: viewerOperator }])
    await page.goto(`${PATH}?route=${IB}`)

    await expect(page.getByTestId('executions-route')).toHaveValue(IB)
    await expect(page.getByTestId('executions-route').locator('option:checked')).toHaveText('IB')
    await expect(page.getByTestId('executions-count')).toHaveText(`${byIb.length} 件`)
    await expect(page.getByTestId('executions-table').locator('th')).toHaveText(COLUMNS)
    await expect(columnOf(page, '預託先')).toHaveText(byIb.map((row) => row.注文ルート名))
  })
})
