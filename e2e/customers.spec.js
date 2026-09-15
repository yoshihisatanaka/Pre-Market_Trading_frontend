import { expect, test } from '@playwright/test'
import { codeMasters } from '../src/mocks/fixtures/codes'
import { customers } from '../src/mocks/fixtures/customers'
import { formatJpyUnit, formatUsdUnit } from '../src/utils/format'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/customers.md（タイトル先頭の [CU-xx] が対応 ID）
// ページ位置と検索条件は URL クエリを正とするため、URL と画面の同期をここで守る。
// mockApi() は固定の body を返すだけで offset や検索条件のクエリを解釈しない。
// ページングと絞り込み（CU-02 / 03 / 04 / 06 / 07 / 08）は
// クエリを実際に処理する既定ハンドラで検証する。

const PATH = '/masters/customers'

// src/stores/customers.js の CUSTOMERS_PAGE_SIZE と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

/** 列の並び。見出しの検証（CU-11）と、セルを列名で引くための索引を兼ねる */
const COLUMNS = [
  '部店',
  '扱者',
  '口座番号',
  '顧客名',
  '年齢',
  '取引規制',
  '投資方針',
  'コンプラ',
  '口座区分',
  '個人／法人',
  '円貨預り金',
  'USD預り金',
  '成長投資枠',
  '米国株評価額',
  '評価損益',
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

// 絞り込みに使う値もフィクスチャから導く（'山田' や '1' を直接書かない）
/** 先頭行の姓。顧客名の部分一致に使う */
const NAME_KEYWORD = firstRow.顧客名.split(' ')[0]
const byName = sorted.filter(
  (customer) =>
    customer.顧客名.includes(NAME_KEYWORD) || customer.顧客名カナ.includes(NAME_KEYWORD),
)
/** 先頭行とは別の部店。顧客名との併用で 1 件まで絞れることを見る（CU-04） */
const BRANCH_CODE = [...new Set(sorted.map((customer) => customer.部店コード))][1]
const byNameAndBranch = byName.filter((customer) => customer.部店コード === BRANCH_CODE)

const corporateSample = sorted.find((customer) => customer.法人区分 === '1')
const CORPORATE_CODE = corporateSample.法人区分
const CORPORATE_NAME = corporateSample.法人区分名
const byCorporate = sorted.filter((customer) => customer.法人区分 === CORPORATE_CODE)

// フィクスチャのどの顧客名・カナにも当たらない文字列
const NO_MATCH = 'ZZZZ'

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 検索カードのプルダウンと、選択肢の出どころ（GET /codes のコードマスタ名） */
const SELECTS = [
  { testId: 'customers-branch-code', codeKey: '部店' },
  { testId: 'customers-handler-code', codeKey: '扱者' },
  { testId: 'customers-restriction', codeKey: '取引停止区分_全取引' },
  { testId: 'customers-account-type', codeKey: '口座区分' },
  { testId: 'customers-corporate-type', codeKey: '法人区分' },
]

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('customers-table').getByTestId('data-table-row')
}

/** 口座番号で行を引く。口座番号は一意で、ほかの列には現れない桁数 */
function rowOf(page, customer) {
  return rowsOf(page).filter({ hasText: String(customer.口座番号) })
}

/** 行の中の 1 セル。列名から位置を引く */
function cellOf(row, column) {
  return row.locator('td').nth(COLUMNS.indexOf(column))
}

/** 行の背景色。CSS クラス名ではなく「見えかた」で確かめる（CU-10） */
function backgroundColorOf(row) {
  return row.evaluate((el) => getComputedStyle(el).backgroundColor)
}

test.describe('顧客マスタ一覧', () => {
  test('[CU-01] サイドメニューから開くと一覧と件数が表示される', async ({ page }) => {
    await page.goto('/')

    await page
      .getByRole('navigation', { name: 'メインメニュー' })
      .getByRole('link', { name: '顧客マスタ', exact: true })
      .click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByRole('heading', { name: '顧客マスタ', exact: true })).toBeVisible()
    // 画面固有の操作がヘッダ（#topbar-actions）へ差し込まれている
    await expect(page.getByTestId('customers-reload')).toBeVisible()

    await expect(page.getByTestId('customers-count')).toHaveText(`${TOTAL} 件`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)
    await expect(rows.first()).toContainText(String(firstRow.口座番号))
    await expect(rows.first()).toContainText(firstRow.顧客名)
    await expect(rows.first()).toContainText(firstRow.部店名)
    await expect(rows.first()).toContainText(firstRow.扱者コード)
  })

  test('[CU-02] 「次のページ」を押すと 2 ページ目が表示される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    const pagination = page.getByTestId('customers-pagination')
    await pagination.getByRole('button', { name: '次のページ' }).click()

    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(secondPage.length)
    await expect(rows.first()).toContainText(String(secondPage[0].口座番号))
    await expect(rows.first()).toContainText(secondPage[0].顧客名)

    await expect(pagination.getByTestId('pagination-range')).toHaveText(
      `${TOTAL} 件中 ${PAGE_SIZE + 1}–${TOTAL} 件`,
    )
  })

  test('[CU-03] 顧客名で絞り込むと URL と一覧に反映される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('customers-customer-name').fill(NAME_KEYWORD)
    await page.getByTestId('customers-search-submit').click()

    await expect(page.getByTestId('customers-count')).toHaveText(`${byName.length} 件`)
    expect(new URL(page.url()).searchParams.get('customer_name')).toBe(NAME_KEYWORD)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(byName.length)
    // 顧客名に当たらない行が混ざっていない
    await expect(rows.filter({ hasText: NAME_KEYWORD })).toHaveCount(byName.length)
  })

  test('[CU-04] 部店と顧客名を併用すると 1 件まで絞り込める', async ({ page }) => {
    // フィクスチャが併用の意味を持つ形（併用前より件数が減る）でないとこのシナリオは成立しない
    expect(byNameAndBranch.length).toBe(1)
    expect(byName.length).toBeGreaterThan(byNameAndBranch.length)

    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('customers-branch-code').selectOption(BRANCH_CODE)
    await page.getByTestId('customers-customer-name').fill(NAME_KEYWORD)
    await page.getByTestId('customers-search-submit').click()

    await expect(page.getByTestId('customers-count')).toHaveText(`${byNameAndBranch.length} 件`)

    const query = new URL(page.url()).searchParams
    expect(query.get('branch_code')).toBe(BRANCH_CODE)
    expect(query.get('customer_name')).toBe(NAME_KEYWORD)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(byNameAndBranch.length)
    await expect(rows.first()).toContainText(String(byNameAndBranch[0].口座番号))
    await expect(cellOf(rows.first(), '部店')).toContainText(BRANCH_CODE)
  })

  test('[CU-05] 検索のプルダウンにコードマスタの選択肢が並ぶ', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    for (const { testId, codeKey } of SELECTS) {
      const options = page.getByTestId(testId).locator('option')
      // 先頭は「すべて」相当の空選択肢
      await expect(options).toHaveCount(codeMasters[codeKey].length + 1)
      for (const { label } of codeMasters[codeKey]) {
        await expect(options.filter({ hasText: label })).toHaveCount(1)
      }
    }
  })

  test('[CU-06] 個人／法人で絞り込むと URL と一覧に反映される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('customers-corporate-type').selectOption(CORPORATE_CODE)
    await page.getByTestId('customers-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`corporate_type=${CORPORATE_CODE}`))
    await expect(page.getByTestId('customers-count')).toHaveText(`${byCorporate.length} 件`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(byCorporate.length)
    await expect(
      page
        .getByTestId('customers-table')
        .locator(`td:nth-child(${COLUMNS.indexOf('個人／法人') + 1})`),
    ).toHaveText(Array(byCorporate.length).fill(CORPORATE_NAME))
  })

  test('[CU-07] 「クリア」を押すと絞り込みが解除される', async ({ page }) => {
    await page.goto(PATH)

    await page.getByTestId('customers-customer-name').fill(NAME_KEYWORD)
    await page.getByTestId('customers-search-submit').click()
    await expect(rowsOf(page)).toHaveCount(byName.length)

    await page.getByTestId('customers-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('customers-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('customers-customer-name')).toHaveValue('')
  })

  test('[CU-08] 該当が無いときは空状態が表示される', async ({ page }) => {
    await page.goto(PATH)

    await page.getByTestId('customers-customer-name').fill(NO_MATCH)
    await page.getByTestId('customers-search-submit').click()

    await expect(page.getByTestId('customers-empty')).toHaveText('該当する顧客はありません。')
    await expect(page.getByTestId('customers-table')).toBeHidden()
    // 0 件のときこそ条件を直したいので、検索カードは消えない
    await expect(page.getByTestId('customers-search')).toBeVisible()
  })

  test('[CU-09] API がエラーを返したときエラー表示と再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [{ path: '*/api/masters/customers', status: 500, body: { detail: ERROR_MESSAGE } }])
    await page.goto(PATH)

    const error = page.getByTestId('customers-error')
    await expect(error).toContainText(ERROR_MESSAGE)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('customers-table')).toBeHidden()
    // エラーのときも説明バナーと検索カードは消えない
    await expect(page.getByTestId('customers-description')).toBeVisible()
    await expect(page.getByTestId('customers-search')).toBeVisible()
  })

  test('[CU-10] 手動操作された行だけ背景色が変わる', async ({ page }) => {
    await page.goto(PATH)
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)

    const markedIndex = firstPage.findIndex((customer) => customer.ユーザー操作フラグ === 1)
    const plainIndex = firstPage.findIndex((customer) => customer.ユーザー操作フラグ === 0)
    // フィクスチャが両方の行を持っていないと、このシナリオは意味を失う
    expect(markedIndex).toBeGreaterThanOrEqual(0)
    expect(plainIndex).toBeGreaterThanOrEqual(0)

    const markedColor = await backgroundColorOf(rows.nth(markedIndex))
    const plainColor = await backgroundColorOf(rows.nth(plainIndex))
    expect(markedColor).not.toBe(plainColor)
  })

  test('[CU-11] 列順が仕様どおりで、評価額の列は空のまま行の操作も無い', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    const table = page.getByTestId('customers-table')
    await expect(table.locator('th')).toHaveText(COLUMNS)

    // 値の出所が未定の 2 列は、見出しだけで中身を持たない
    for (const column of ['米国株評価額', '評価損益']) {
      await expect(table.locator(`td:nth-child(${COLUMNS.indexOf(column) + 1})`)).toHaveText(
        Array(PAGE_SIZE).fill('—'),
      )
    }

    // 読むだけの画面。追加の導線も行ごとの操作も持たない
    await expect(page.getByTestId('customers-add')).toHaveCount(0)
    await expect(rowsOf(page).first().getByRole('button')).toHaveCount(0)
  })

  test('[CU-12] 金額は単位を後置し、欠損と 0 と年齢を書き分ける', async ({ page }) => {
    const zeroCash = firstPage.find((customer) => customer.円貨預り金 === 0)
    const noUsd = firstPage.find((customer) => customer.外貨預り金 === null)
    const corporate = firstPage.find((customer) => customer.法人区分 === CORPORATE_CODE)
    // 「0」「欠損」「法人」の行がフィクスチャに無いと、このシナリオは意味を失う
    expect(zeroCash).toBeDefined()
    expect(noUsd).toBeDefined()
    expect(corporate).toBeDefined()

    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    const top = rowOf(page, firstRow)
    await expect(cellOf(top, '円貨預り金')).toHaveText(formatJpyUnit(firstRow.円貨預り金))
    await expect(cellOf(top, 'USD預り金')).toHaveText(formatUsdUnit(firstRow.外貨預り金))
    await expect(cellOf(top, '年齢')).toHaveText(`${firstRow.年齢}歳`)

    // 残高 0 は '—' ではなく '0 円'
    await expect(cellOf(rowOf(page, zeroCash), '円貨預り金')).toHaveText(formatJpyUnit(0))
    // 値が無い列は '—'
    await expect(cellOf(rowOf(page, noUsd), 'USD預り金')).toHaveText('—')
    // 法人は年齢を持たない
    await expect(cellOf(rowOf(page, corporate), '年齢')).toHaveText('—')
  })

  test('[CU-13] 取引停止と事故処理口座にはバッジが出る', async ({ page }) => {
    const restricted = firstPage.find((customer) => customer.取引停止区分_全取引 === 1)
    const normal = firstPage.find((customer) => customer.取引停止区分_全取引 === 0)
    const accident = firstPage.find((customer) => customer.事故処理口座区分 === '1')
    const noAccident = firstPage.find((customer) => customer.事故処理口座区分 === '0')
    // 対比する相手が居ないと「バッジが出る／出ない」を守れない
    expect(restricted).toBeDefined()
    expect(normal).toBeDefined()
    expect(accident).toBeDefined()
    expect(noAccident).toBeDefined()

    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    // バッジかどうかは data-variant（BaseBadge が必ず出す属性）で見る。CSS クラス名には依存しない
    const badge = (row, column) => cellOf(row, column).locator('[data-variant]')

    const restrictedCell = cellOf(rowOf(page, restricted), '取引規制')
    await expect(restrictedCell.locator('[data-variant]')).toHaveText(
      restricted.取引停止区分_全取引名,
    )
    await expect(badge(rowOf(page, normal), '取引規制')).toHaveCount(0)
    await expect(cellOf(rowOf(page, normal), '取引規制')).toHaveText(normal.取引停止区分_全取引名)

    await expect(badge(rowOf(page, accident), '口座区分')).toHaveText('事故')
    await expect(cellOf(rowOf(page, accident), '口座区分')).toContainText(accident.口座区分名)
    await expect(badge(rowOf(page, noAccident), '口座区分')).toHaveCount(0)
  })

  test('[CU-14] 条件付きの URL を直接開くと検索欄と一覧に復元される', async ({ page }) => {
    await page.goto(
      `${PATH}?branch_code=${BRANCH_CODE}&customer_name=${encodeURIComponent(NAME_KEYWORD)}`,
    )

    await expect(page.getByTestId('customers-branch-code')).toHaveValue(BRANCH_CODE)
    await expect(page.getByTestId('customers-customer-name')).toHaveValue(NAME_KEYWORD)

    await expect(page.getByTestId('customers-count')).toHaveText(`${byNameAndBranch.length} 件`)
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(byNameAndBranch.length)
    await expect(rows.first()).toContainText(String(byNameAndBranch[0].口座番号))
  })

  test('[CU-15] ブラウザバックで前のページに戻る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page
      .getByTestId('customers-pagination')
      .getByRole('button', { name: '次のページ' })
      .click()
    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))
    await expect(rowsOf(page)).toHaveCount(secondPage.length)

    await page.goBack()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(rowsOf(page).first()).toContainText(String(firstRow.口座番号))
  })
})
