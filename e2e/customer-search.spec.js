import { expect, test } from '@playwright/test'
import { customers } from '../src/mocks/fixtures/customers'
import { CAUTION_RANKS } from '../src/utils/customerCautions'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/customer-search.md（タイトル先頭の [CSE-nn] が対応 ID）
// 顧客検索は読むだけの検索一覧。ページ位置と検索条件は URL クエリを正とするため、
// URL と画面の同期と、行のクリックから顧客詳細へ移る導線をここで守る。
// mockApi() は固定の body を返すだけでクエリを解釈しない。ページングと絞り込みは
// クエリを実際に処理する既定ハンドラ（src/mocks/handlers/customers.js）で検証する。

const PATH = '/customers/search'

// src/stores/customerSearch.js の CUSTOMER_SEARCH_PAGE_SIZE（= utils/pagination.js の DEFAULT_PAGE_SIZE）と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

/** 列の並び（CSE-11）。セルを列名で引くための索引を兼ねる */
const COLUMNS = [
  '部店',
  '扱者',
  '口座番号',
  '顧客名',
  '年齢',
  'コンプラランク',
  '投資方針',
  '預り金（円貨）',
  '預り金（USD）',
  '成長投資枠',
  '取引規制',
]

/*
 * フィクスチャはバックエンドの生の形（日本語キー / 口座番号は integer）なので、
 * 実 API と同じ並び（口座番号の昇順）に直してから期待値の出どころにする。
 */
const sorted = [...customers].sort((a, b) => a.口座番号 - b.口座番号)
const TOTAL = sorted.length
const firstPage = sorted.slice(0, PAGE_SIZE)
const secondPage = sorted.slice(PAGE_SIZE)
const firstRow = sorted[0]

// 絞り込みに使う値もフィクスチャから導く（'山田' や '123' を直接書かない）
/** 先頭行とは別の部店（CSE-03 / 16） */
const BRANCH_CODE = [...new Set(sorted.map((customer) => customer.部店コード))][1]
const byBranch = sorted.filter((customer) => customer.部店コード === BRANCH_CODE)

/** 先頭行の扱者コード（CSE-04） */
const HANDLER_CODE = firstRow.扱者コード
const byHandler = sorted.filter((customer) => customer.扱者コード === HANDLER_CODE)

/** 2 ページ目の先頭。1 ページ目に居ない口座でも引けることを見る（CSE-05） */
const accountTarget = secondPage[0]

/** 先頭行の姓（漢字 / カナ）。顧客名の部分一致に使う（CSE-06 / 07） */
const NAME_KEYWORD = firstRow.顧客名.split(' ')[0]
const KANA_KEYWORD = firstRow.顧客名カナ.split(' ')[0]
const matchesName = (keyword) => (customer) =>
  customer.顧客名.includes(keyword) || customer.顧客名カナ.includes(keyword)
const byName = sorted.filter(matchesName(NAME_KEYWORD))
const byKana = sorted.filter(matchesName(KANA_KEYWORD))
const byBranchAndName = byBranch.filter(matchesName(NAME_KEYWORD))

// フィクスチャのどの顧客名・カナにも当たらない文字列
const NO_MATCH = 'ZZZZ'

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('customer-search-table').getByTestId('data-table-row')
}

/** 口座番号で行を引く。口座番号は一意で、ほかの列には現れない桁数 */
function rowOf(page, customer) {
  return rowsOf(page).filter({ hasText: String(customer.口座番号) })
}

/** 行の中の 1 セル。列名から位置を引く */
function cellOf(row, column) {
  return row.locator('td').nth(COLUMNS.indexOf(column))
}

/** 表のある列の全セル */
function columnCells(page, column) {
  return page
    .getByTestId('customer-search-table')
    .locator(`tbody td:nth-child(${COLUMNS.indexOf(column) + 1})`)
}

/** ヘッダの見出し（画面は h1 を持たず、AppHeader が meta.title を出す） */
function pageHeading(page, name) {
  return page.getByRole('heading', { level: 1, name, exact: true })
}

/** 一覧を開いて 1 ページ目が描かれるまで待つ */
async function openList(page) {
  await page.goto(PATH)
  await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
}

/** 検索欄に値を入れて「検索」を押す */
async function searchBy(page, testId, value) {
  await page.getByTestId(testId).fill(value)
  await page.getByTestId('customer-search-search-submit').click()
}

test.describe('顧客検索', () => {
  test('[CSE-01] サイドメニューから開くと条件なしの一覧と件数が表示される', async ({ page }) => {
    await page.goto('/')

    await page
      .getByRole('navigation', { name: 'メインメニュー' })
      .getByRole('link', { name: '顧客検索', exact: true })
      .click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(pageHeading(page, '顧客検索')).toBeVisible()
    await expect(page.getByTestId('customer-search-count')).toHaveText(`${TOTAL} 件`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)
    await expect(rows.first()).toContainText(String(firstRow.口座番号))
    await expect(rows.first()).toContainText(firstRow.顧客名)
  })

  test('[CSE-02] 「次のページ」を押すと 2 ページ目が表示される', async ({ page }) => {
    await openList(page)

    const pagination = page.getByTestId('customer-search-pagination')
    await pagination.getByRole('button', { name: '次のページ' }).click()

    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(secondPage.length)
    await expect(rows.first()).toContainText(String(secondPage[0].口座番号))
    await expect(pagination.getByTestId('pagination-range')).toHaveText(
      `${TOTAL} 件中 ${PAGE_SIZE + 1}–${TOTAL} 件`,
    )
  })

  test('[CSE-03] 部店で絞り込むと URL と一覧に反映される', async ({ page }) => {
    // 絞り込みが意味を持つ（件数が減る）フィクスチャでないとこのシナリオは成立しない
    expect(byBranch.length).toBeGreaterThan(0)
    expect(byBranch.length).toBeLessThan(TOTAL)

    await openList(page)
    await page.getByTestId('customer-search-branch-code').selectOption(BRANCH_CODE)
    await page.getByTestId('customer-search-search-submit').click()

    await expect(page.getByTestId('customer-search-count')).toHaveText(`${byBranch.length} 件`)
    expect(new URL(page.url()).searchParams.get('branch_code')).toBe(BRANCH_CODE)
    await expect(rowsOf(page)).toHaveCount(byBranch.length)
    await expect(columnCells(page, '部店')).toHaveText(Array(byBranch.length).fill(BRANCH_CODE))
  })

  test('[CSE-04] 扱者コードで絞り込むと URL と一覧に反映される', async ({ page }) => {
    expect(byHandler.length).toBeGreaterThan(0)
    expect(byHandler.length).toBeLessThan(TOTAL)

    await openList(page)
    await searchBy(page, 'customer-search-handler-code', HANDLER_CODE)

    await expect(page.getByTestId('customer-search-count')).toHaveText(`${byHandler.length} 件`)
    expect(new URL(page.url()).searchParams.get('sales_rep_code')).toBe(HANDLER_CODE)
    await expect(rowsOf(page)).toHaveCount(byHandler.length)
    // 扱者列はコードと名前の 2 段。全行にそのコードが出ている
    await expect(columnCells(page, '扱者').filter({ hasText: HANDLER_CODE })).toHaveCount(
      byHandler.length,
    )
  })

  test('[CSE-05] 口座番号で絞り込むとその口座の顧客だけが表示される', async ({ page }) => {
    const accountNumber = String(accountTarget.口座番号)

    await openList(page)
    await searchBy(page, 'customer-search-account-number', accountNumber)

    await expect(page.getByTestId('customer-search-count')).toHaveText('1 件')
    expect(new URL(page.url()).searchParams.get('account_number')).toBe(accountNumber)
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(1)
    await expect(cellOf(rows.first(), '口座番号')).toHaveText(accountNumber)
    await expect(cellOf(rows.first(), '顧客名')).toContainText(accountTarget.顧客名)
  })

  test('[CSE-06] 顧客名（漢字）で絞り込むと URL と一覧に反映される', async ({ page }) => {
    expect(byName.length).toBeGreaterThan(0)

    await openList(page)
    await searchBy(page, 'customer-search-customer-name', NAME_KEYWORD)

    await expect(page.getByTestId('customer-search-count')).toHaveText(`${byName.length} 件`)
    expect(new URL(page.url()).searchParams.get('name')).toBe(NAME_KEYWORD)
    await expect(rowsOf(page)).toHaveCount(byName.length)
    await expect(columnCells(page, '顧客名').filter({ hasText: NAME_KEYWORD })).toHaveCount(
      byName.length,
    )
  })

  test('[CSE-07] 顧客名にカナを入れても当たる', async ({ page }) => {
    // 漢字とカナで同じ顧客が引けることを見るので、フィクスチャがそうなっていることを先に確かめる
    expect(byKana.map((customer) => customer.ID)).toEqual(byName.map((customer) => customer.ID))

    await openList(page)
    await searchBy(page, 'customer-search-customer-name', KANA_KEYWORD)

    await expect(page.getByTestId('customer-search-count')).toHaveText(`${byKana.length} 件`)
    expect(new URL(page.url()).searchParams.get('name')).toBe(KANA_KEYWORD)
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(byKana.length)
    for (const customer of byKana) {
      await expect(rowOf(page, customer)).toHaveCount(1)
    }
  })

  test('[CSE-08] 「クリア」を押すと絞り込みが解除される', async ({ page }) => {
    await openList(page)
    await page.getByTestId('customer-search-branch-code').selectOption(BRANCH_CODE)
    await searchBy(page, 'customer-search-customer-name', NAME_KEYWORD)
    await expect(rowsOf(page)).toHaveCount(byBranchAndName.length)

    await page.getByTestId('customer-search-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('customer-search-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('customer-search-branch-code')).toHaveValue('')
    await expect(page.getByTestId('customer-search-customer-name')).toHaveValue('')
  })

  test('[CSE-09] 該当が無いときは空状態が表示される', async ({ page }) => {
    await openList(page)
    await searchBy(page, 'customer-search-customer-name', NO_MATCH)

    await expect(page.getByTestId('customer-search-empty')).toHaveText(
      '該当する顧客が見つかりませんでした',
    )
    await expect(page.getByTestId('customer-search-table')).toBeHidden()
    // 0 件のときこそ条件を直したいので、検索カードは消えない
    await expect(page.getByTestId('customer-search-search')).toBeVisible()
  })

  test('[CSE-10] API がエラーを返したときエラー表示と再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [
      { path: '*/api/masters/customers', status: 500, body: { detail: ERROR_MESSAGE } },
    ])
    await page.goto(PATH)

    const error = page.getByTestId('customer-search-error')
    await expect(error).toContainText(ERROR_MESSAGE)
    const retry = error.getByRole('button', { name: '再試行' })
    await expect(retry).toBeVisible()
    await expect(page.getByTestId('customer-search-table')).toBeHidden()
    // エラーのときも説明文と検索カードは消えない
    await expect(page.getByTestId('customer-search-description')).toBeVisible()
    await expect(page.getByTestId('customer-search-search')).toBeVisible()

    // 取り直しても同じ応答なので、理由が出たまま壊れない
    await retry.click()
    await expect(page.getByTestId('customer-search-error')).toContainText(ERROR_MESSAGE)
    await expect(page.getByTestId('customer-search-table')).toBeHidden()
  })

  test('[CSE-11] 列順が仕様どおりで、行に操作ボタンは無い', async ({ page }) => {
    await openList(page)

    const table = page.getByTestId('customer-search-table')
    await expect(table.locator('th')).toHaveText(COLUMNS)
    // 2026-09-28 に外した列が戻っていない
    for (const removed of ['米国株評価額', '評価損益']) {
      await expect(table.getByRole('columnheader', { name: removed })).toHaveCount(0)
    }
    // 読むだけの一覧。編集・削除などのボタンは無い
    await expect(table.getByRole('button')).toHaveCount(0)
  })

  test('[CSE-12] コンプラランクと全取引停止がバッジで出る', async ({ page }) => {
    const caution = firstPage.find((customer) => CAUTION_RANKS.includes(customer.コンプラランク))
    const plain = firstPage.find((customer) => !CAUTION_RANKS.includes(customer.コンプラランク))
    const suspended = firstPage.find((customer) => customer.取引停止区分_全取引 === 1)
    const active = firstPage.find((customer) => customer.取引停止区分_全取引 === 0)
    // 対比する相手が居ないと「見えかたが違う」「バッジが出る／出ない」を守れない
    expect(caution).toBeDefined()
    expect(plain).toBeDefined()
    expect(suspended).toBeDefined()
    expect(active).toBeDefined()

    await openList(page)

    // バッジかどうかは data-variant（BaseBadge が必ず出す属性）で見る。CSS クラス名には依存しない
    const badge = (customer, column) =>
      cellOf(rowOf(page, customer), column).locator('[data-variant]')

    await expect(badge(caution, 'コンプラランク')).toHaveText(caution.コンプラランク)
    await expect(badge(plain, 'コンプラランク')).toHaveText(plain.コンプラランク)
    const cautionVariant = await badge(caution, 'コンプラランク').getAttribute('data-variant')
    const plainVariant = await badge(plain, 'コンプラランク').getAttribute('data-variant')
    expect(cautionVariant).not.toBe(plainVariant)

    await expect(badge(suspended, '取引規制')).toHaveText('全取引停止')
    await expect(badge(active, '取引規制')).toHaveCount(0)
    await expect(cellOf(rowOf(page, active), '取引規制')).toHaveText('-')
  })

  test('[CSE-13] 行を click すると顧客詳細へ移る', async ({ page }) => {
    await openList(page)

    // 顧客名ではないセルを押す。モックと同じく行全体が押下を受ける
    await cellOf(rowOf(page, firstRow), '口座番号').click()

    await expect(page).toHaveURL(new RegExp(`/customers/${firstRow.ID}/summary$`))
    await expect(pageHeading(page, '顧客詳細')).toBeVisible()
    await expect(page.getByTestId('customer-info-name')).toHaveText(firstRow.顧客名)
  })

  test('[CSE-14] ブラウザバックで前のページに戻る', async ({ page }) => {
    await openList(page)

    await page
      .getByTestId('customer-search-pagination')
      .getByRole('button', { name: '次のページ' })
      .click()
    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))
    await expect(rowsOf(page)).toHaveCount(secondPage.length)

    await page.goBack()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(rowsOf(page).first()).toContainText(String(firstRow.口座番号))
  })

  test('[CSE-15] 絞り込み後にブラウザバックすると条件が外れて入力欄も戻る', async ({ page }) => {
    await openList(page)
    await searchBy(page, 'customer-search-customer-name', NAME_KEYWORD)
    await expect(rowsOf(page)).toHaveCount(byName.length)

    await page.goBack()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('customer-search-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('customer-search-customer-name')).toHaveValue('')
  })

  test('[CSE-16] 条件付きの URL を直接開くと検索欄と一覧に復元される', async ({ page }) => {
    expect(byBranchAndName.length).toBeGreaterThan(0)

    await page.goto(`${PATH}?branch_code=${BRANCH_CODE}&name=${encodeURIComponent(NAME_KEYWORD)}`)

    await expect(page.getByTestId('customer-search-branch-code')).toHaveValue(BRANCH_CODE)
    await expect(page.getByTestId('customer-search-customer-name')).toHaveValue(NAME_KEYWORD)
    await expect(page.getByTestId('customer-search-count')).toHaveText(
      `${byBranchAndName.length} 件`,
    )
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(byBranchAndName.length)
    await expect(rows.first()).toContainText(String(byBranchAndName[0].口座番号))
  })
})
