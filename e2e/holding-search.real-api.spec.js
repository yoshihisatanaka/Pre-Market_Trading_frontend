import { expect, test } from '@playwright/test'
import { apiContext, fetchAll, listHelpers, skipUnlessRealApi } from './helpers/realApi.js'

/*
 * 預り検索を「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/holding-search-real-api.md（タイトル先頭の [HSR-xx] が対応 ID）
 *
 * holding-search.spec.js（HSE）とは目的が違う。HSE は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせ（主にクエリ名）だけを見るので、
 * 期待値に**データの中身を書かない**（絞り込みの値は実行時に開いた時点の条件なしの一覧の 1 行目から読む）。
 * ローカル DB は保有が薄い（docs/api/requests.md #32）ので、0 件・値が空ならスキップする形にしてある。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test holding-search.real-api
 *
 * 預り検索は読むだけの画面なので、このファイルは実 DB に書き込まない（GET だけ）。
 */

const PATH = '/customers/holdings'
// 実 API のパス（openapi.json）。dev サーバの /api プロキシ越しに届く
const API_PATH = '/api/holdings'
const CUSTOMERS_API_PATH = '/api/masters/customers'
// 顧客一覧の応答の配列キー（src/api/customers.js の fetchCustomers）
const CUSTOMERS_LIST_KEY = 'customers'

// src/stores/holdingSearch.js の HOLDING_SEARCH_PAGE_SIZE（= utils/pagination.js の DEFAULT_PAGE_SIZE）と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

/** 絞り込みのクエリ名（実 API 側。src/api/holdings.js の fetchHoldings） */
const FILTER_QUERIES = [
  'branch_code',
  'account_no',
  'customer_name',
  'symbol',
  'symbol_name',
  'specific_deposit',
]

/** 列の並び（src/views/HoldingSearchView.vue の columns）。セルを列名で引く索引 */
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

// 空値の表示（HoldingSearchView.vue のセルは値が無いと「—」を出す）
const EMPTY_CELL = '—'

const { openList, countOf, rowsOf, settleList, expectListConsistent } = listHelpers({
  path: PATH,
  testIdPrefix: 'holding-search',
})

/** 表の 1 列ぶんのセル（全行） */
function columnOf(page, column) {
  return rowsOf(page).locator(`td:nth-child(${COLUMNS.indexOf(column) + 1})`)
}

/** n 行目のセルの文字（前後の空白を落とす） */
async function cellText(page, column, index = 0) {
  const text = await columnOf(page, column).nth(index).textContent()
  return (text ?? '').trim()
}

/** 1 行目の顧客名（顧客名のセルはカナとの 2 段なので、リンクの button だけを読む） */
async function customerNameOf(page, index = 0) {
  const text = await rowsOf(page)
    .nth(index)
    .getByTestId('holding-search-customer-link')
    .textContent()
  return (text ?? '').trim()
}

/** 実 API の GET のうち、パスとクエリの値が合うものを待つ */
function waitForApiRequest(page, pathname, query, value) {
  return page.waitForRequest((req) => {
    const url = new URL(req.url())
    return url.pathname === pathname && (query === null || url.searchParams.get(query) === value)
  })
}

/** 「検索」を押して取得が終わるのを待つ */
async function submit(page) {
  await page.getByTestId('holding-search-search-submit').click()
  await expect(page.getByTestId('holding-search-count')).toBeVisible()
  await settleList(page)
}

/** 預り検索を開き（開いた時点で条件なしの一覧を引く）、0 件ならスキップする。全件の件数を返す */
async function openListOrSkip(page) {
  await openList(page)
  const total = await countOf(page)
  test.skip(total === 0, '預りが 0 件なので絞り込みを確かめられない（docs/api/requests.md #32）')
  return total
}

/** 絞り込んだあとの共通の期待値。件数が 1 以上かつ全件以下で、表示行の数が件数と合う */
async function expectNarrowed(page, total) {
  const filtered = await countOf(page)
  expect(filtered).toBeGreaterThan(0)
  expect(filtered).toBeLessThanOrEqual(total)
  await expect(page.getByTestId('holding-search-error')).toHaveCount(0)

  const shown = Math.min(filtered, PAGE_SIZE)
  await expect(rowsOf(page)).toHaveCount(shown)
  return shown
}

test.describe('預り検索（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test('[HSR-01] 開くと条件なしで GET /holdings が送られ、件数と一覧（または 0 件の表示）が出る', async ({
    page,
  }) => {
    // 取得は開いた直後に飛ぶので、goto の前から待ち受ける
    const request = waitForApiRequest(page, API_PATH, null, null)
    await openList(page)

    // 条件なしなので絞り込みのクエリは 1 つも載らない（limit / offset だけ）
    const params = new URL((await request).url()).searchParams
    for (const query of FILTER_QUERIES) {
      expect(params.has(query), `条件なしの検索に ${query} が載っている`).toBe(false)
    }

    await expectListConsistent(page, { pageSize: PAGE_SIZE })
  })

  test('[HSR-02] 1 行目の口座番号で絞り込むと、その口座だけが出て実 API へ account_no が送られる', async ({
    page,
  }) => {
    const total = await openListOrSkip(page)

    const accountNumber = await cellText(page, '口座番号')
    test.skip(!/^\d+$/.test(accountNumber), `1 行目の口座番号が数字でない（${accountNumber}）`)

    const request = waitForApiRequest(page, API_PATH, 'account_no', accountNumber)
    await page.getByTestId('holding-search-account-number').fill(accountNumber)
    await submit(page)
    await request

    await expect(page).toHaveURL(new RegExp(`[?&]account_number=${accountNumber}(&|$)`))
    const shown = await expectNarrowed(page, total)
    // 表示行がすべてその口座。クエリ名が黙って無視されていれば他の口座が混ざる
    await expect(columnOf(page, '口座番号')).toHaveText(Array(shown).fill(accountNumber))
  })

  test('[HSR-03] 1 行目の部店で絞り込むと、その部店の明細だけが出る', async ({ page }) => {
    const total = await openListOrSkip(page)

    const branchCode = await cellText(page, '部店')
    test.skip(branchCode === '' || branchCode === EMPTY_CELL, '1 行目の部店が空')
    // 部店の選択肢はコードマスタ（GET /codes の 部店）から。明細の部店が選択肢に無ければ選べない
    const select = page.getByTestId('holding-search-branch-code')
    const options = await select.locator('option').evaluateAll((els) => els.map((el) => el.value))
    test.skip(!options.includes(branchCode), `部店のプルダウンに ${branchCode} が無い`)

    const request = waitForApiRequest(page, API_PATH, 'branch_code', branchCode)
    await select.selectOption(branchCode)
    await submit(page)
    await request

    await expect(page).toHaveURL(
      new RegExp(`[?&]branch_code=${encodeURIComponent(branchCode)}(&|$)`),
    )
    const shown = await expectNarrowed(page, total)
    await expect(columnOf(page, '部店')).toHaveText(Array(shown).fill(branchCode))
  })

  test('[HSR-04] 1 行目の顧客名で絞り込むと、その顧客名を含む明細だけが出る', async ({ page }) => {
    const total = await openListOrSkip(page)

    const customerName = await customerNameOf(page)
    test.skip(customerName === '' || customerName === EMPTY_CELL, '1 行目の顧客名が空')

    const request = waitForApiRequest(page, API_PATH, 'customer_name', customerName)
    await page.getByTestId('holding-search-customer-name').fill(customerName)
    await submit(page)
    await request

    await expect(page).toHaveURL(/[?&]customer_name=/)
    expect(new URL(page.url()).searchParams.get('customer_name')).toBe(customerName)
    const shown = await expectNarrowed(page, total)
    // 部分一致（src/api/holdings.js の JSDoc）なので「含む」で見る
    for (let i = 0; i < shown; i += 1) {
      await expect(columnOf(page, '顧客名').nth(i)).toContainText(customerName)
    }
  })

  test('[HSR-05] 1 行目の銘柄コードで絞り込むと、その銘柄の明細だけが出る', async ({ page }) => {
    const total = await openListOrSkip(page)

    const symbolCode = await cellText(page, '銘柄コード')
    test.skip(symbolCode === '' || symbolCode === EMPTY_CELL, '1 行目の銘柄コードが空')

    const request = waitForApiRequest(page, API_PATH, 'symbol', symbolCode)
    await page.getByTestId('holding-search-symbol').fill(symbolCode)
    await submit(page)
    await request

    expect(new URL(page.url()).searchParams.get('symbol')).toBe(symbolCode)
    const shown = await expectNarrowed(page, total)
    // 銘柄コードか Ticker の完全一致（src/api/holdings.js の JSDoc）
    await expect(columnOf(page, '銘柄コード')).toHaveText(Array(shown).fill(symbolCode))
  })

  test('[HSR-06] 1 行目の銘柄名で絞り込むと、実 API へ symbol_name が送られ、その銘柄名を含む明細だけが出る', async ({
    page,
  }) => {
    const total = await openListOrSkip(page)

    const symbolName = await cellText(page, '銘柄名')
    test.skip(symbolName === '' || symbolName === EMPTY_CELL, '1 行目の銘柄名が空')

    const request = waitForApiRequest(page, API_PATH, 'symbol_name', symbolName)
    await page.getByTestId('holding-search-symbol-name').fill(symbolName)
    await submit(page)
    await request

    // URL 上の名前は stock_name（画面モックの名前）。実 API へは symbol_name に変えて送る
    expect(new URL(page.url()).searchParams.get('stock_name')).toBe(symbolName)
    const shown = await expectNarrowed(page, total)
    for (let i = 0; i < shown; i += 1) {
      await expect(columnOf(page, '銘柄名').nth(i)).toContainText(symbolName)
    }
  })

  test('[HSR-07] 実在する明細の預り区分で絞り込むと、その区分の明細だけが出る', async ({
    page,
    playwright,
  }) => {
    // 区分のコードは画面に出ない（表示名だけ）ので、先頭の明細を API から直接読む
    const api = await apiContext(playwright)
    const res = await api.get(API_PATH, { params: { limit: 1, offset: 0 } })
    expect(res.ok(), `実 API から ${API_PATH} を取得できない`).toBe(true)
    const body = await res.json()
    await api.dispose()
    const first = body.holdings?.[0]
    test.skip(!first, '預りが 0 件なので絞り込みを確かめられない（docs/api/requests.md #32）')

    const code = String(first.預り売買区分 ?? '')
    const expectedName = first.預り売買区分名 || EMPTY_CELL

    const total = await openListOrSkip(page)
    const select = page.getByTestId('holding-search-specific-deposit')
    const options = await select.locator('option').evaluateAll((els) => els.map((el) => el.value))
    test.skip(code === '' || !options.includes(code), `預り区分のプルダウンに ${code} が無い`)

    const request = waitForApiRequest(page, API_PATH, 'specific_deposit', code)
    await select.selectOption(code)
    await submit(page)
    await request

    expect(new URL(page.url()).searchParams.get('specific_deposit')).toBe(code)
    const shown = await expectNarrowed(page, total)
    await expect(columnOf(page, '預り区分')).toHaveText(Array(shown).fill(expectedName))
  })

  test('[HSR-08] 顧客マスタにある口座の明細の顧客名から、顧客詳細へ移る', async ({
    page,
    playwright,
  }) => {
    // 保有のある口座が顧客マスタに無いことがある（docs/api/requests.md #32）ので、先に顧客マスタを読む
    const api = await apiContext(playwright)
    const customers = await fetchAll(api, CUSTOMERS_API_PATH, CUSTOMERS_LIST_KEY)
    await api.dispose()

    await openListOrSkip(page)

    // 表示中の明細から、顧客マスタで引ける行を探す（stores/holdingSearch.js の findCustomerId と同じ照合）
    const shown = await rowsOf(page).count()
    let target = null
    for (let i = 0; i < shown && !target; i += 1) {
      const accountNumber = await cellText(page, '口座番号', i)
      const branchText = await cellText(page, '部店', i)
      const branchCode = branchText === EMPTY_CELL ? '' : branchText
      const customer = customers.find(
        (row) =>
          String(row.口座番号 ?? '') === accountNumber &&
          (!branchCode || row.部店コード === branchCode),
      )
      if (customer) target = { index: i, accountNumber, customerId: String(customer.ID) }
    }
    test.skip(!target, '表示中の明細に顧客マスタにある口座が無い（docs/api/requests.md #32）')

    const lookup = waitForApiRequest(page, CUSTOMERS_API_PATH, 'account_no', target.accountNumber)
    await rowsOf(page).nth(target.index).getByTestId('holding-search-customer-link').click()
    await lookup

    await expect(page).toHaveURL(new RegExp(`/customers/${target.customerId}/summary$`))
    await expect(page.getByTestId('customer-info-bar')).toBeVisible()
    await expect(page.getByTestId('customer-info-account')).toHaveText(target.accountNumber)
    await expect(page.getByTestId('holding-search-customer-error')).toHaveCount(0)
  })
})
