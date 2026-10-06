import { expect, test } from '@playwright/test'
import { SPECIFIC_DEPOSIT_NAMES } from '../src/mocks/fixtures/codes'
import { noOperationOperator } from '../src/mocks/fixtures/currentOperator'
import { customers } from '../src/mocks/fixtures/customers'
import { holdings } from '../src/mocks/fixtures/holdings'
import { formatJpyUnit } from '../src/utils/format'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/holding-search.md（タイトル先頭の [HSE-nn] が対応 ID）
// 預り検索は顧客をまたいで預りを探す読むだけの検索一覧。開いた時点で条件なしの一覧を出す（顧客検索と同じ）。
// ページ位置と検索条件は URL クエリを正とするため、URL と画面の同期と、
// 顧客名から顧客詳細へ・買い / 売りから新規注文へ移る導線をここで守る。
// mockApi() は固定の body を返すだけでクエリを解釈しない。ページングと絞り込みは
// クエリを実際に処理する既定ハンドラ（src/mocks/handlers/holdings.js）で検証する。

const PATH = '/customers/holdings'

// src/stores/holdingSearch.js の HOLDING_SEARCH_PAGE_SIZE（= utils/pagination.js の DEFAULT_PAGE_SIZE）と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

const SERVER_ERROR = 'サーバーでエラーが発生しました。'

/** 列の並び（HSE-13）。セルを列名で引くための索引を兼ねる（src/views/HoldingSearchView.vue の columns） */
const COLUMNS = [
  '部店',
  '口座番号',
  '顧客名',
  'ティッカー',
  '銘柄コード',
  '銘柄名',
  '預り区分',
  '数量',
  '参考単価（USD）',
  '参考為替（USD/JPY）',
  '取得金額／評価額（円）',
  '評価損益／評価損益率',
  'CA',
  '操作',
]

/*
 * 預りの特定預り区分 → 注文の預り区分（URL の deposit）。
 * src/utils/orderEntryQuery.js の toDepositCategory の再掲（向きが逆なので、実装をなぞらず期待値として書く）。
 */
const DEPOSIT_QUERY_FOR = { 1: '0', 0: '1', 6: '6' }

// 並びはフィクスチャの順（既定ハンドラがそのまま返す）
const TOTAL = holdings.length
const firstPage = holdings.slice(0, PAGE_SIZE)
const secondPage = holdings.slice(PAGE_SIZE)
const firstRow = holdings[0]

/** 先頭行の顧客（顧客マスタ側の行。ID を顧客詳細の URL に使う） */
const FIRST_CUSTOMER = customers.find((row) => row.口座番号 === firstRow.口座番号)

/** 先頭行とは別の部店（HSE-04） */
const BRANCH_CODE = [...new Set(holdings.map((row) => row.部店コード))][1]
const byBranch = holdings.filter((row) => row.部店コード === BRANCH_CODE)

/** 先頭行の口座（HSE-05） */
const ACCOUNT_NUMBER = String(firstRow.口座番号)
const byAccount = holdings.filter((row) => String(row.口座番号) === ACCOUNT_NUMBER)

/** 先頭行の姓（漢字 / カナ）。顧客名の部分一致に使う（HSE-06 / 21） */
const NAME_KEYWORD = firstRow.顧客名.split(' ')[0]
const KANA_KEYWORD = firstRow.顧客名カナ.split(' ')[0]
const matchesName = (keyword) => (row) => row.顧客名.includes(keyword) || row.顧客名カナ.includes(keyword)
const byKana = holdings.filter(matchesName(KANA_KEYWORD))
const byBranchAndName = holdings.filter(
  (row) => row.部店コード === firstRow.部店コード && matchesName(NAME_KEYWORD)(row),
)

/** CA 発生中の明細（HSE-07 / 14） */
const CA_ROW = holdings.find((row) => row.CA)
const bySymbol = holdings.filter(
  (row) => row.ティッカー === CA_ROW.ティッカー || row.銘柄コード === CA_ROW.ティッカー,
)

/** 先頭行の銘柄名の一部（HSE-08） */
const STOCK_NAME_KEYWORD = firstRow.銘柄名.slice(0, Math.max(2, Math.floor(firstRow.銘柄名.length / 2)))
const byStockName = holdings.filter((row) => row.銘柄名.includes(STOCK_NAME_KEYWORD))

/** 成長投資枠（HSE-09） */
const GROWTH = '6'
const GROWTH_LABEL = SPECIFIC_DEPOSIT_NAMES[GROWTH]
const byGrowth = holdings.filter((row) => row.預り売買区分 === GROWTH)

/** 非特定（表示名「一般」。HSE-22） */
const NON_SPECIFIC = '0'
const NON_SPECIFIC_LABEL = SPECIFIC_DEPOSIT_NAMES[NON_SPECIFIC]
const byNonSpecific = holdings.filter((row) => row.預り売買区分 === NON_SPECIFIC)

/** 1 ページ目にある、評価益・評価損・損益 0・売却不可・売却可の明細（HSE-14 / 18） */
const PROFIT_ROW = firstPage.find((row) => row.評価損益 > 0)
const LOSS_ROW = firstPage.find((row) => row.評価損益 < 0)
const EVEN_ROW = firstPage.find((row) => row.評価損益 === 0)
const SELL_PROHIBITED_ROW = firstPage.find((row) => row.売却不可区分 === 1)
const SELLABLE_ROW = firstPage.find((row) => row.売却不可区分 === 0)

// フィクスチャのどの顧客名・カナにも当たらない文字列
const NO_MATCH = 'ZZZZ'

/** 符号付きの円（src/utils/profitLoss.js の書式。負号は U+2212） */
function signedJpy(value) {
  if (value > 0) return `+${formatJpyUnit(value)}`
  if (value < 0) return `−${formatJpyUnit(-value)}`
  return formatJpyUnit(0)
}

/** 符号付きの率。フィクスチャは '13.58%' の形の文字列 */
function signedPercent(text) {
  const value = Number(text.replace('%', ''))
  if (value > 0) return `+${value.toFixed(2)}%`
  if (value < 0) return `−${Math.abs(value).toFixed(2)}%`
  return '0.00%'
}

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('holding-search-table').getByTestId('data-table-row')
}

/** 1 ページ目のフィクスチャの明細に対応する行（並びはフィクスチャの順） */
function rowOf(page, holding) {
  const index = firstPage.indexOf(holding)
  if (index < 0) throw new Error('1 ページ目に無い明細です')
  return rowsOf(page).nth(index)
}

/** 行の中の 1 セル。列名から位置を引く */
function cellOf(row, column) {
  return row.locator('td').nth(COLUMNS.indexOf(column))
}

/** 表のある列の全セル */
function columnCells(page, column) {
  return page
    .getByTestId('holding-search-table')
    .locator(`tbody td:nth-child(${COLUMNS.indexOf(column) + 1})`)
}

/** ヘッダの見出し（画面は h1 を持たず、AppHeader が meta.title を出す） */
function pageHeading(page, name) {
  return page.getByRole('heading', { level: 1, name, exact: true })
}

function queryOf(page) {
  return Object.fromEntries(new URL(page.url()).searchParams)
}

/** 一覧を開いて 1 ページ目が描かれるまで待つ（開いた時点で条件なしの一覧が出る） */
async function openList(page) {
  await page.goto(PATH)
  await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
}

/** 検索欄に値を入れて「検索」を押す */
async function searchBy(page, testId, value) {
  await page.getByTestId(testId).fill(value)
  await page.getByTestId('holding-search-search-submit').click()
}

/** フィクスチャがシナリオの前提を満たしているか（変わったらここで気づく） */
test.beforeAll(() => {
  expect(TOTAL).toBeGreaterThan(PAGE_SIZE)
  expect(TOTAL).toBeLessThanOrEqual(PAGE_SIZE * 2)
  expect(FIRST_CUSTOMER).toBeDefined()
  expect(BRANCH_CODE).toBeDefined()
  expect(byBranch.length).toBeLessThan(TOTAL)
  expect(byAccount.length).toBeGreaterThan(1)
  expect(byKana.length).toBeGreaterThan(0)
  expect(byKana.length).toBeLessThan(PAGE_SIZE)
  expect(byBranchAndName.length).toBeGreaterThan(0)
  expect(CA_ROW).toBeDefined()
  expect(CA_ROW.銘柄コード).not.toBe(CA_ROW.ティッカー)
  expect(byStockName.length).toBeGreaterThan(0)
  expect(byStockName.length).toBeLessThan(PAGE_SIZE)
  expect(byGrowth.length).toBeGreaterThan(0)
  expect(GROWTH_LABEL).toBe('成長投資枠')
  expect(NON_SPECIFIC_LABEL).toBe('一般')
  expect(byNonSpecific.length).toBeGreaterThan(0)
  expect(byNonSpecific.length).toBeLessThan(TOTAL)
  for (const row of [PROFIT_ROW, LOSS_ROW, EVEN_ROW, SELL_PROHIBITED_ROW, SELLABLE_ROW]) {
    expect(row).toBeDefined()
  }
  expect(firstPage.includes(CA_ROW)).toBe(true)
  expect(holdings.some(matchesName(NO_MATCH))).toBe(false)
  // HSE-17 の deposit=0 は先頭行が「特定」であることが前提
  expect(firstRow.預り売買区分).toBe('1')
})

test.describe('預り検索', () => {
  test('[HSE-01] サイドメニューから開くと条件なしの一覧と件数が表示される', async ({ page }) => {
    await page.goto('/')

    await page
      .getByRole('navigation', { name: 'メインメニュー' })
      .getByRole('link', { name: '預り検索', exact: true })
      .click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(pageHeading(page, '預り検索')).toBeVisible()
    await expect(page.getByTestId('holding-search-search')).toBeVisible()
    await expect(page.getByTestId('holding-search-count')).toHaveText(`${TOTAL} 件`)
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)
    await expect(cellOf(rows.first(), '口座番号')).toHaveText(String(firstRow.口座番号))
    await expect(cellOf(rows.first(), '顧客名')).toContainText(firstRow.顧客名)
    await expect(cellOf(rows.first(), 'ティッカー')).toHaveText(firstRow.ティッカー)
  })

  test('[HSE-02] 条件なしで「検索」を押しても URL は空のまま全件が出ている', async ({ page }) => {
    await openList(page)

    await page.getByTestId('holding-search-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('holding-search-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
  })

  test('[HSE-03] 「次のページ」を押すと 2 ページ目が表示される', async ({ page }) => {
    await openList(page)

    const pagination = page.getByTestId('holding-search-pagination')
    await pagination.getByRole('button', { name: '次のページ' }).click()

    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))
    await expect(rowsOf(page)).toHaveCount(secondPage.length)
    await expect(cellOf(rowsOf(page).first(), '口座番号')).toHaveText(
      String(secondPage[0].口座番号),
    )
    await expect(pagination.getByTestId('pagination-range')).toHaveText(
      `${TOTAL} 件中 ${PAGE_SIZE + 1}–${TOTAL} 件`,
    )
  })

  test('[HSE-04] 部店で絞り込むと URL と一覧に反映される', async ({ page }) => {
    await page.goto(PATH)
    await page.getByTestId('holding-search-branch-code').selectOption(BRANCH_CODE)
    await page.getByTestId('holding-search-search-submit').click()

    await expect(page.getByTestId('holding-search-count')).toHaveText(`${byBranch.length} 件`)
    expect(queryOf(page).branch_code).toBe(BRANCH_CODE)
    await expect(rowsOf(page)).toHaveCount(byBranch.length)
    await expect(columnCells(page, '部店')).toHaveText(Array(byBranch.length).fill(BRANCH_CODE))
  })

  test('[HSE-05] 口座番号で絞り込むとその口座の明細だけが表示される', async ({ page }) => {
    await page.goto(PATH)
    await searchBy(page, 'holding-search-account-number', ACCOUNT_NUMBER)

    await expect(page.getByTestId('holding-search-count')).toHaveText(`${byAccount.length} 件`)
    expect(queryOf(page).account_number).toBe(ACCOUNT_NUMBER)
    await expect(rowsOf(page)).toHaveCount(byAccount.length)
    await expect(columnCells(page, '口座番号')).toHaveText(
      Array(byAccount.length).fill(ACCOUNT_NUMBER),
    )
  })

  test('[HSE-06] 顧客名にカナを入れても当たる', async ({ page }) => {
    await page.goto(PATH)
    await searchBy(page, 'holding-search-customer-name', KANA_KEYWORD)

    await expect(page.getByTestId('holding-search-count')).toHaveText(`${byKana.length} 件`)
    expect(queryOf(page).customer_name).toBe(KANA_KEYWORD)
    await expect(rowsOf(page)).toHaveCount(byKana.length)
    // 顧客名の列は顧客名とカナの 2 段。全行にそのカナが出ている
    await expect(columnCells(page, '顧客名').filter({ hasText: KANA_KEYWORD })).toHaveCount(
      byKana.length,
    )
  })

  test('[HSE-07] ティッカーでも銘柄コードでもその銘柄の明細が引ける', async ({ page }) => {
    const bySymbolCode = holdings.filter(
      (row) => row.銘柄コード === CA_ROW.銘柄コード || row.ティッカー === CA_ROW.銘柄コード,
    )
    // ティッカーと銘柄コードのどちらで引いても同じ明細になる
    expect(bySymbolCode).toEqual(bySymbol)

    await page.goto(PATH)
    for (const value of [CA_ROW.ティッカー, CA_ROW.銘柄コード]) {
      await searchBy(page, 'holding-search-symbol', value)

      await expect(page).toHaveURL(new RegExp(`[?&]symbol=${value}(&|$)`))
      await expect(page.getByTestId('holding-search-count')).toHaveText(`${bySymbol.length} 件`)
      await expect(rowsOf(page)).toHaveCount(bySymbol.length)
      await expect(columnCells(page, 'ティッカー')).toHaveText(
        Array(bySymbol.length).fill(CA_ROW.ティッカー),
      )
    }
  })

  test('[HSE-08] 銘柄名の一部で絞り込むと URL と一覧に反映される', async ({ page }) => {
    await page.goto(PATH)
    await searchBy(page, 'holding-search-symbol-name', STOCK_NAME_KEYWORD)

    await expect(page.getByTestId('holding-search-count')).toHaveText(`${byStockName.length} 件`)
    expect(queryOf(page).stock_name).toBe(STOCK_NAME_KEYWORD)
    await expect(rowsOf(page)).toHaveCount(byStockName.length)
    await expect(columnCells(page, '銘柄名').filter({ hasText: STOCK_NAME_KEYWORD })).toHaveCount(
      byStockName.length,
    )
  })

  test('[HSE-09] 預り区分「成長投資枠」で絞り込むと URL と一覧に反映される', async ({ page }) => {
    await page.goto(PATH)
    await page
      .getByTestId('holding-search-specific-deposit')
      .selectOption({ label: GROWTH_LABEL })
    await page.getByTestId('holding-search-search-submit').click()

    await expect(page.getByTestId('holding-search-count')).toHaveText(`${byGrowth.length} 件`)
    expect(queryOf(page).specific_deposit).toBe(GROWTH)
    await expect(rowsOf(page)).toHaveCount(byGrowth.length)
    await expect(columnCells(page, '預り区分')).toHaveText(
      Array(byGrowth.length).fill(GROWTH_LABEL),
    )
  })

  test('[HSE-10] 「クリア」を押すとクエリが消えて全件の一覧に戻る', async ({ page }) => {
    await openList(page)
    await page.getByTestId('holding-search-branch-code').selectOption(firstRow.部店コード)
    await searchBy(page, 'holding-search-customer-name', NAME_KEYWORD)
    await expect(rowsOf(page)).toHaveCount(byBranchAndName.length)

    await page.getByTestId('holding-search-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('holding-search-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('holding-search-branch-code')).toHaveValue('')
    await expect(page.getByTestId('holding-search-customer-name')).toHaveValue('')
  })

  test('[HSE-11] 該当が無いときは空状態が表示される', async ({ page }) => {
    await page.goto(PATH)
    await searchBy(page, 'holding-search-customer-name', NO_MATCH)

    await expect(page.getByTestId('holding-search-empty')).toHaveText('該当する預りはありません')
    await expect(page.getByTestId('holding-search-table')).toBeHidden()
    // 0 件のときこそ条件を直したいので、検索カードは消えない
    await expect(page.getByTestId('holding-search-search')).toBeVisible()
  })

  test('[HSE-12] API がエラーを返したときエラー表示と再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [{ path: '*/api/holdings', status: 500, body: { detail: SERVER_ERROR } }])
    await page.goto(PATH)

    const error = page.getByTestId('holding-search-error')
    await expect(error).toContainText(SERVER_ERROR)
    const retry = error.getByRole('button', { name: '再試行' })
    await expect(retry).toBeVisible()
    await expect(page.getByTestId('holding-search-table')).toBeHidden()
    await expect(page.getByTestId('holding-search-search')).toBeVisible()

    // 取り直しても同じ応答なので、理由が出たまま壊れない
    await retry.click()
    await expect(page.getByTestId('holding-search-error')).toContainText(SERVER_ERROR)
    await expect(page.getByTestId('holding-search-table')).toBeHidden()
  })

  test('[HSE-13] 列順が仕様どおりで、「仮計算」のボタンは無い', async ({ page }) => {
    await openList(page)

    const table = page.getByTestId('holding-search-table')
    await expect(table.locator('th')).toHaveText(COLUMNS)
    await expect(page.getByRole('button', { name: '仮計算' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: '仮計算' })).toHaveCount(0)
  })

  test('[HSE-14] 評価損益は符号付きで益と損で色が違い、CA 発生中の明細に CA が出る', async ({
    page,
  }) => {
    await openList(page)

    for (const holding of [PROFIT_ROW, LOSS_ROW, EVEN_ROW]) {
      const cell = cellOf(rowOf(page, holding), '評価損益／評価損益率')
      await expect(cell).toContainText(signedJpy(holding.評価損益))
      await expect(cell).toContainText(signedPercent(holding.評価損益率))
    }

    // 色は CSS クラス名ではなく「見えかた」で比べる
    const colorOf = (holding) =>
      cellOf(rowOf(page, holding), '評価損益／評価損益率')
        .locator('div')
        .first()
        .evaluate((el) => getComputedStyle(el).color)
    expect(await colorOf(PROFIT_ROW)).not.toBe(await colorOf(LOSS_ROW))

    await expect(cellOf(rowOf(page, CA_ROW), 'CA')).toHaveText(CA_ROW.CA)
    const withoutCa = firstPage.filter((row) => !row.CA)
    await expect(columnCells(page, 'CA').filter({ hasText: '—' })).toHaveCount(withoutCa.length)
  })

  test('[HSE-15] 顧客名を押すと顧客詳細へ移る', async ({ page }) => {
    await openList(page)

    await rowsOf(page).first().getByTestId('holding-search-customer-link').click()

    await expect(page).toHaveURL(new RegExp(`/customers/${FIRST_CUSTOMER.ID}/summary$`))
    await expect(pageHeading(page, '顧客詳細')).toBeVisible()
    await expect(page.getByTestId('customer-info-name')).toHaveText(firstRow.顧客名)
  })

  test('[HSE-16] 顧客を引けないと理由を出して一覧に留まる', async ({ page }) => {
    await mockApi(page, [
      { path: '*/api/masters/customers', status: 500, body: { detail: SERVER_ERROR } },
    ])
    await openList(page)

    await rowsOf(page).first().getByTestId('holding-search-customer-link').click()

    const error = page.getByTestId('holding-search-customer-error')
    await expect(error).toContainText('顧客詳細を開けませんでした。')
    await expect(error).toContainText(SERVER_ERROR)
    expect(new URL(page.url()).pathname).toBe(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
  })

  test('[HSE-17] 「買い」で顧客詳細の注文入力タブへ顧客・銘柄・売買・預り区分を引き継ぐ', async ({
    page,
  }) => {
    await openList(page)

    await rowsOf(page).first().getByTestId('holding-search-buy').click()

    await expect(page).toHaveURL(new RegExp(`/customers/${FIRST_CUSTOMER.ID}/order-entry\\?`))
    expect(queryOf(page)).toEqual({
      branch_code: firstRow.部店コード,
      account_number: String(firstRow.口座番号),
      ticker: firstRow.ティッカー,
      side: 'buy',
      deposit: DEPOSIT_QUERY_FOR[firstRow.預り売買区分],
    })
    // 顧客カードとタブが上に出て、注文入力タブが選択中（モックの customer_context）
    await expect(pageHeading(page, '顧客詳細')).toBeVisible()
    await expect(page.getByTestId('customer-info-name')).toHaveText(firstRow.顧客名)
    await expect(page.getByTestId('customer-detail-tab-order-entry')).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(page.getByTestId('order-entry-ticker')).toHaveValue(firstRow.ティッカー)
  })

  test('[HSE-18] 売却不可の明細は「売り」が押せず、売却できる明細の「売り」で注文入力タブへ移る', async ({
    page,
  }) => {
    await openList(page)

    await expect(rowOf(page, SELL_PROHIBITED_ROW).getByTestId('holding-search-sell')).toBeDisabled()

    const sell = rowOf(page, SELLABLE_ROW).getByTestId('holding-search-sell')
    await expect(sell).toBeEnabled()
    await sell.click()

    await expect(page).toHaveURL(/\/customers\/\d+\/order-entry\?/)
    await expect(page.getByTestId('customer-info-name')).toHaveText(SELLABLE_ROW.顧客名)
    const query = queryOf(page)
    expect(query.side).toBe('sell')
    expect(query.ticker).toBe(SELLABLE_ROW.ティッカー)
    expect(query.account_number).toBe(String(SELLABLE_ROW.口座番号))
  })

  test('[HSE-19] 発注権限が無いと操作は「閲覧のみ」で、顧客名のリンクは出る', async ({ page }) => {
    await mockApi(page, [{ path: '*/api/auth/me', body: noOperationOperator }])
    await openList(page)

    await expect(page.getByTestId('holding-search-view-only')).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('holding-search-buy')).toHaveCount(0)
    await expect(page.getByTestId('holding-search-sell')).toHaveCount(0)
    await expect(page.getByTestId('holding-search-customer-link')).toHaveCount(PAGE_SIZE)
  })

  test('[HSE-20] ブラウザバックで 1 ページ目に戻る', async ({ page }) => {
    await openList(page)
    await page
      .getByTestId('holding-search-pagination')
      .getByRole('button', { name: '次のページ' })
      .click()
    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))
    await expect(rowsOf(page)).toHaveCount(secondPage.length)

    await page.goBack()

    await expect(page).not.toHaveURL(/offset=/)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(cellOf(rowsOf(page).first(), '口座番号')).toHaveText(String(firstRow.口座番号))
  })

  test('[HSE-21] 条件付きの URL を直接開くと検索済みとして復元される', async ({ page }) => {
    await page.goto(
      `${PATH}?branch_code=${firstRow.部店コード}&customer_name=${encodeURIComponent(NAME_KEYWORD)}`,
    )

    await expect(page.getByTestId('holding-search-branch-code')).toHaveValue(firstRow.部店コード)
    await expect(page.getByTestId('holding-search-customer-name')).toHaveValue(NAME_KEYWORD)
    await expect(page.getByTestId('holding-search-count')).toHaveText(
      `${byBranchAndName.length} 件`,
    )
    await expect(rowsOf(page)).toHaveCount(byBranchAndName.length)
  })

  test('[HSE-22] 預り区分「一般」で絞り込むと非特定の明細が表示される', async ({ page }) => {
    await openList(page)
    await page
      .getByTestId('holding-search-specific-deposit')
      .selectOption({ label: NON_SPECIFIC_LABEL })
    await page.getByTestId('holding-search-search-submit').click()

    await expect(page.getByTestId('holding-search-count')).toHaveText(`${byNonSpecific.length} 件`)
    expect(queryOf(page).specific_deposit).toBe(NON_SPECIFIC)
    await expect(rowsOf(page)).toHaveCount(byNonSpecific.length)
    await expect(columnCells(page, '預り区分')).toHaveText(
      Array(byNonSpecific.length).fill(NON_SPECIFIC_LABEL),
    )
  })
})
