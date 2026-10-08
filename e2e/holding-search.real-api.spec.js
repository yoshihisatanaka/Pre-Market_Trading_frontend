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

/* ---------- 直接発注導線（HSR-09〜11）。新規注文の画面へ URL クエリで引き継ぐ ---------- */

const SYMBOLS_API_PATH = '/api/masters/symbols'
// 銘柄一覧の応答の配列キー（src/api/symbols.js の fetchSymbols）
const SYMBOLS_LIST_KEY = 'stocks'
// 預り一覧の応答の配列キー（openapi.json の HoldingListResponse）
const HOLDINGS_LIST_KEY = 'holdings'

/*
 * 預りの特定預り区分 → 注文の預り区分（URL の deposit）。
 * src/utils/orderEntryQuery.js の toDepositCategory の再掲（向きが逆なので、実装をなぞらず期待値として書く）。
 * 4 NISA / 8 継続管理勘定は注文の預り区分に無いので載らない。
 */
const DEPOSIT_QUERY_FOR = { 1: '0', 0: '1', 6: '6' }
const GROWTH_DEPOSIT = '6'
/** 注文の預り区分の値 → ラベル（src/utils/orderEntryOptions.js の DEPOSIT_CATEGORY_OPTIONS） */
const DEPOSIT_LABELS = { 0: '特定', 1: '一般', 6: '成長投資枠' }

/** 照会結果のヒントの文言（src/views/OrderEntryView.vue の customerHint / symbolHint） */
const HINT_NOT_FOUND = { customer: '該当なし', symbol: '銘柄なし' }

function queryOf(page) {
  return Object.fromEntries(new URL(page.url()).searchParams)
}

/** 実 API の明細 1 件から、「買い」「売り」が組み立てる URL クエリの期待値（空の値は載らない） */
function expectedOrderQuery(holding, side) {
  const deposit = DEPOSIT_QUERY_FOR[String(holding.預り売買区分 ?? '')] ?? ''
  const entries = [
    ['branch_code', holding.部店コード ?? ''],
    ['account_number', String(holding.口座番号 ?? '')],
    ['ticker', holding.ティッカー ?? ''],
    ['side', side],
    // 買付に成長投資枠は選べないので、「買い」は成長投資枠の明細でも預り区分を引き継がない
    ['deposit', side === 'buy' && deposit === GROWTH_DEPOSIT ? '' : deposit],
    // 「売り」だけ売却可能株数を数量として引き継ぐ（正の整数のときだけ。#36 ⑤・src/utils/orderEntryQuery.js）
    ['quantity', side === 'sell' && holding.売却可能株数 > 0 ? String(holding.売却可能株数) : ''],
  ]
  return Object.fromEntries(entries.filter(([, value]) => value))
}

/**
 * 表の n 行目に対応する実 API の明細。画面の行 ID と同じ組（口座番号・銘柄コード・預り区分）で引く
 * （並びが API と同じとは限らないので、位置では引かない）。
 */
async function holdingOfRow(page, holdings, index) {
  const accountNumber = await cellText(page, '口座番号', index)
  const symbolCode = await cellText(page, '銘柄コード', index)
  const depositName = await cellText(page, '預り区分', index)
  const holding = holdings.find(
    (row) =>
      String(row.口座番号 ?? '') === accountNumber &&
      (row.銘柄コード || EMPTY_CELL) === symbolCode &&
      (row.預り売買区分名 || EMPTY_CELL) === depositName,
  )
  expect(
    holding,
    `${index + 1} 行目（口座 ${accountNumber} / 銘柄 ${symbolCode}）が実 API の一覧に無い`,
  ).toBeTruthy()
  return holding
}

/**
 * 預り検索を開き、操作列に「買い」「売り」が出ていることを確かめ、実 API からも全件を読む。
 * 0 件、または操作列が「閲覧のみ」（発注権限なし）ならスキップ。返した api は使い終えたら dispose する
 */
async function openListForOrder(page, playwright) {
  await openListOrSkip(page)

  // 操作列は発注権限を読み終えるまで空なので、どちらかが出るまで待つ
  const firstRow = rowsOf(page).first()
  const buy = firstRow.getByTestId('holding-search-buy')
  const viewOnly = firstRow.getByTestId('holding-search-view-only')
  await expect(buy.or(viewOnly)).toBeVisible()
  test.skip(
    (await viewOnly.count()) > 0,
    '発注権限の無い利用者（VITE_USER_CODE）なので「買い」「売り」が出ない（HSE-19 の担当）',
  )

  const api = await apiContext(playwright)
  const holdings = await fetchAll(api, API_PATH, HOLDINGS_LIST_KEY)
  return { api, holdings }
}

/**
 * 表示中の明細のうち、口座番号（と部店）が顧客マスタで引ける行を表示順に返す
 * （stores/holdingSearch.js の findCustomerId と同じ照合）。保有のある口座が顧客マスタに無いことがある（#32）
 *
 * @returns {Promise<{ index: number, accountNumber: string, customerId: string }[]>}
 */
async function rowsInCustomerMaster(page, customers) {
  const shown = await rowsOf(page).count()
  const found = []
  for (let i = 0; i < shown; i += 1) {
    const accountNumber = await cellText(page, '口座番号', i)
    const branchText = await cellText(page, '部店', i)
    const branchCode = branchText === EMPTY_CELL ? '' : branchText
    const customer = customers.find(
      (row) =>
        String(row.口座番号 ?? '') === accountNumber &&
        (!branchCode || row.部店コード === branchCode),
    )
    if (customer) found.push({ index: i, accountNumber, customerId: String(customer.ID) })
  }
  return found
}

/**
 * 顧客詳細の注文入力タブ（/customers/<id>/order-entry）に移ったあとの共通の期待値。顧客カードとタブ・
 * URL のクエリ・入力欄の初期値・口座番号とティッカーの照会結果。
 * 照会の期待値は stores/orderEntry.js（findCustomer / findSymbol）と同じ照合を実 API で引いて決める。
 */
async function expectOrderEntryPrefilled(page, api, expected) {
  await expect(page).toHaveURL(/\/customers\/\d+\/order-entry\?/)
  expect(queryOf(page)).toEqual(expected)
  await expect(page.getByTestId('customer-info-bar')).toBeVisible()
  await expect(page.getByTestId('customer-detail-tab-order-entry')).toHaveAttribute(
    'aria-current',
    'page',
  )

  // 期間指定に使う休日・発注停止の状態を実 API から読み終えると入力フォームが出る
  await expect(page.getByTestId('order-entry-form')).toBeVisible()
  await expect(page.getByTestId('order-entry-error')).toHaveCount(0)

  const branchCode = expected.branch_code ?? ''
  const accountNumber = expected.account_number ?? ''
  const ticker = (expected.ticker ?? '').toUpperCase()
  await expect(page.getByTestId('order-entry-branch')).toHaveValue(branchCode)
  await expect(page.getByTestId('order-entry-account')).toHaveValue(accountNumber)
  await expect(page.getByTestId('order-entry-ticker')).toHaveValue(ticker)
  await expect(
    page
      .getByTestId('order-entry-side')
      .getByRole('button', { name: expected.side === 'buy' ? '買い' : '売り', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  // 預り売買区分はセグメント（button の aria-pressed）なので、押されているラベルで比べる
  const deposit = page.getByTestId('order-entry-deposit-category')
  if (expected.deposit) {
    await expect(
      deposit.getByRole('button', { name: DEPOSIT_LABELS[expected.deposit], exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
  } else {
    await expect(
      deposit.getByRole('button', { name: DEPOSIT_LABELS[GROWTH_DEPOSIT], exact: true }),
    ).toHaveAttribute('aria-pressed', 'false')
  }
  // 数量は「売り」でだけクエリの売却可能株数が 3 桁区切りで入る。「買い」は空
  await expect(page.getByTestId('order-entry-quantity')).toHaveValue(
    expected.quantity ? Number(expected.quantity).toLocaleString('ja-JP') : '',
  )

  // 口座番号の照会。保有のある口座が顧客マスタに無いと「該当なし」（docs/api/requests.md #32）。
  // 照会に失敗したときは何も出ない（それも食い違いとしてここで落ちる）
  const customers = await fetchAll(api, CUSTOMERS_API_PATH, CUSTOMERS_LIST_KEY, {
    account_no: accountNumber,
    ...(branchCode ? { branch_code: branchCode } : {}),
  })
  const customer = customers.find(
    (row) =>
      String(row.口座番号 ?? '') === accountNumber && (!branchCode || row.部店コード === branchCode),
  )
  await expect(page.getByTestId('order-entry-account-hint')).toHaveText(
    customer?.顧客名 || HINT_NOT_FOUND.customer,
  )

  // ティッカーの照会（ティッカーの無い明細はクエリに載らず、銘柄欄は空のまま）
  if (ticker) {
    const stocks = await fetchAll(api, SYMBOLS_API_PATH, SYMBOLS_LIST_KEY, { ticker })
    const symbol = stocks.find((row) => (row.Ticker ?? '').toUpperCase() === ticker)
    await expect(page.getByTestId('order-entry-ticker-hint')).toHaveText(
      symbol?.銘柄名_英字 || symbol?.銘柄名 || HINT_NOT_FOUND.symbol,
    )
  } else {
    await expect(page.getByTestId('order-entry-ticker-hint')).toHaveCount(0)
  }
}

/* ---------- 仮計算導線（HSR-12〜13）。顧客詳細の仮計算タブへ URL クエリで引き継ぐ ---------- */

const CALCULATIONS_API_PATH = '/api/calculations'
/**
 * 仮計算で選べる預り区分（src/utils/calculationOptions.js の CALCULATION_DEPOSIT_OPTIONS の値）。
 * 預りの 預り売買区分 と同じ向きなので読み替えない。4 NISA / 8 継続管理勘定はクエリに載らない
 */
const CALCULATION_DEPOSITS = ['1', '0', '6']
// 預り区分のクエリが無いときの仮計算フォームの既定（src/utils/calculationForm.js の createCalculationForm）
const DEFAULT_CALCULATION_DEPOSIT = '1'

/** 実 API の明細 1 件から、「仮計算」が組み立てる URL クエリの期待値（src/utils/calculationQuery.js。空の値は載らない） */
function expectedCalculationQuery(holding) {
  const deposit = String(holding.預り売買区分 ?? '')
  const entries = [
    ['symbol', holding.ティッカー || holding.銘柄コード || ''],
    ['side', 'sell'],
    ['specific_deposit', CALCULATION_DEPOSITS.includes(deposit) ? deposit : ''],
  ]
  return Object.fromEntries(entries.filter(([, value]) => value))
}

/** n 行目の「仮計算」。発注権限を読み終えるまで操作列は空なので、出るまで待ってから返す */
async function calculationButtonOf(page, index) {
  const button = rowsOf(page).nth(index).getByTestId('holding-search-calculation')
  await expect(button).toBeVisible()
  return button
}

/** 仮計算の実行（POST /calculations）が飛んでいないことを見るために、送った POST を数える */
function recordCalculationPosts(page) {
  const posts = []
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === CALCULATIONS_API_PATH) {
      posts.push(req.url())
    }
  })
  return posts
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
    const holdings = await fetchAll(api, API_PATH, HOLDINGS_LIST_KEY)
    await api.dispose()

    await openListOrSkip(page)

    const [target] = await rowsInCustomerMaster(page, customers)
    test.skip(!target, '表示中の明細に顧客マスタにある口座が無い（docs/api/requests.md #32）')

    // 明細に 口座ID があれば通信せずその ID へ移り、無ければ顧客マスタを引き直す
    // （stores/holdingSearch.js の openCustomer。#36 ⑦）
    const holding = await holdingOfRow(page, holdings, target.index)
    const accountId = holding.口座ID == null ? '' : String(holding.口座ID)
    const lookup = accountId
      ? null
      : waitForApiRequest(page, CUSTOMERS_API_PATH, 'account_no', target.accountNumber)
    await rowsOf(page).nth(target.index).getByTestId('holding-search-customer-link').click()
    if (lookup) await lookup

    await expect(page).toHaveURL(new RegExp(`/customers/${accountId || target.customerId}/summary$`))
    await expect(page.getByTestId('customer-info-bar')).toBeVisible()
    await expect(page.getByTestId('customer-info-account')).toHaveText(target.accountNumber)
    await expect(page.getByTestId('holding-search-customer-error')).toHaveCount(0)
  })

  test('[HSR-09] 顧客マスタにある口座の明細の「買い」で新規注文へ移り、実 API のその明細の顧客・銘柄が引き継がれる', async ({
    page,
    playwright,
  }) => {
    const { api, holdings } = await openListForOrder(page, playwright)
    try {
      // 新規注文は顧客詳細のタブなので、顧客マスタで引けない口座の明細では移れない（#32）
      const customers = await fetchAll(api, CUSTOMERS_API_PATH, CUSTOMERS_LIST_KEY)
      const [target] = await rowsInCustomerMaster(page, customers)
      test.skip(!target, '表示中の明細に顧客マスタにある口座が無い（docs/api/requests.md #32）')

      const holding = await holdingOfRow(page, holdings, target.index)

      await rowsOf(page).nth(target.index).getByTestId('holding-search-buy').click()

      await expectOrderEntryPrefilled(page, api, expectedOrderQuery(holding, 'buy'))
    } finally {
      await api.dispose()
    }
  })

  test('[HSR-10] 売却できる明細の「売り」で新規注文へ移り、売りとして顧客・銘柄・預り区分が引き継がれる', async ({
    page,
    playwright,
  }) => {
    const { api, holdings } = await openListForOrder(page, playwright)
    try {
      // 顧客マスタにある口座の明細のうち、「売り」が押せる最初の明細
      // （売却不可の明細は押せない button になっている。顧客マスタに無い口座では移れない。#32）
      const customers = await fetchAll(api, CUSTOMERS_API_PATH, CUSTOMERS_LIST_KEY)
      const candidates = await rowsInCustomerMaster(page, customers)
      test.skip(candidates.length === 0, '表示中の明細に顧客マスタにある口座が無い（docs/api/requests.md #32）')
      let index = -1
      for (const { index: i } of candidates) {
        if (await rowsOf(page).nth(i).getByTestId('holding-search-sell').isEnabled()) {
          index = i
          break
        }
      }
      test.skip(index < 0, '顧客マスタにある口座の明細に「売り」が押せるものが無い')

      const holding = await holdingOfRow(page, holdings, index)
      // 押せるのは実 API で売却不可でない明細だけ
      expect(holding.売却不可区分).not.toBe(1)

      await rowsOf(page).nth(index).getByTestId('holding-search-sell').click()

      await expectOrderEntryPrefilled(page, api, expectedOrderQuery(holding, 'sell'))
    } finally {
      await api.dispose()
    }
  })

  test('[HSR-11] 売却不可の明細だけ「売り」が押せない', async ({ page, playwright }) => {
    const { api, holdings } = await openListForOrder(page, playwright)
    await api.dispose()

    // 表示中の各行を実 API の明細と突き合わせる（売却不可区分は画面に出ないので API から読む）
    const shown = await rowsOf(page).count()
    const prohibited = []
    for (let i = 0; i < shown; i += 1) {
      const holding = await holdingOfRow(page, holdings, i)
      prohibited.push(holding.売却不可区分 === 1)
    }
    test.skip(!prohibited.includes(true), '表示中に売却不可（売却不可区分=1）の明細が無い')

    for (let i = 0; i < shown; i += 1) {
      const row = rowsOf(page).nth(i)
      if (prohibited[i]) {
        await expect(row.getByTestId('holding-search-sell')).toBeDisabled()
        await expect(row.getByTestId('holding-search-buy')).toBeEnabled()
      } else {
        await expect(row.getByTestId('holding-search-sell')).toBeEnabled()
      }
    }
  })

  test('[HSR-12] 顧客マスタにある口座の明細の「仮計算」で仮計算タブへ移り、実 API のその明細の銘柄・売り・預り区分が引き継がれる', async ({
    page,
    playwright,
  }) => {
    // 保有のある口座が顧客マスタに無いことがある（docs/api/requests.md #32）ので、先に顧客マスタを読む
    const api = await apiContext(playwright)
    const customers = await fetchAll(api, CUSTOMERS_API_PATH, CUSTOMERS_LIST_KEY)
    const holdings = await fetchAll(api, API_PATH, HOLDINGS_LIST_KEY)
    await api.dispose()

    const posts = recordCalculationPosts(page)
    await openListOrSkip(page)

    const [target] = await rowsInCustomerMaster(page, customers)
    test.skip(!target, '表示中の明細に顧客マスタにある口座が無い（docs/api/requests.md #32）')

    const holding = await holdingOfRow(page, holdings, target.index)
    const expected = expectedCalculationQuery(holding)
    // 明細に 口座ID があれば通信せずその ID へ移り、無ければ顧客マスタを引き直す（stores/holdingSearch.js の openCustomer）
    const accountId = holding.口座ID == null ? '' : String(holding.口座ID)
    const lookup = accountId
      ? null
      : waitForApiRequest(page, CUSTOMERS_API_PATH, 'account_no', target.accountNumber)
    await (await calculationButtonOf(page, target.index)).click()
    if (lookup) await lookup

    await expect(page).toHaveURL(
      new RegExp(`/customers/${accountId || target.customerId}/calculations(\\?|$)`),
    )
    expect(queryOf(page)).toEqual(expected)
    await expect(page.getByTestId('holding-search-customer-error')).toHaveCount(0)

    await expect(page.getByTestId('customer-info-bar')).toBeVisible()
    await expect(page.getByTestId('customer-info-account')).toHaveText(target.accountNumber)
    await expect(page.getByTestId('customer-detail-tab-calculations')).toHaveAttribute(
      'aria-current',
      'page',
    )

    // 仮計算フォームの初期値（src/utils/calculationQuery.js の parseCalculationQuery → calculationForm.js）
    await expect(page.getByTestId('customer-calc-form')).toBeVisible()
    await expect(page.getByTestId('customer-calc-symbol')).toHaveValue(
      (expected.symbol ?? '').toUpperCase(),
    )
    await expect(
      page.getByTestId('customer-calc-side').getByRole('button', { name: '売り', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('customer-calc-deposit')).toHaveValue(
      expected.specific_deposit ?? DEFAULT_CALCULATION_DEPOSIT,
    )
    await expect(page.getByTestId('customer-calc-quantity')).toHaveValue('')

    // 移っただけで仮計算は実行しない（実行は customer-detail-real-api.md の担当）
    expect(posts).toEqual([])
  })

  test('[HSR-13] 顧客マスタに無い口座の明細の「仮計算」は、顧客を引けなかった帯を出して預り検索に留まる', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright)
    const customers = await fetchAll(api, CUSTOMERS_API_PATH, CUSTOMERS_LIST_KEY)
    const holdings = await fetchAll(api, API_PATH, HOLDINGS_LIST_KEY)
    await api.dispose()

    await openListOrSkip(page)

    // 口座ID の無い明細のうち、顧客マスタで引けない口座の最初の行（口座ID があると通信せずに移ってしまう）
    const inMaster = new Set((await rowsInCustomerMaster(page, customers)).map(({ index }) => index))
    const shown = await rowsOf(page).count()
    let index = -1
    for (let i = 0; i < shown; i += 1) {
      if (inMaster.has(i)) continue
      const holding = await holdingOfRow(page, holdings, i)
      if (holding.口座ID == null) {
        index = i
        break
      }
    }
    test.skip(index < 0, '表示中に、口座ID が空で顧客マスタに無い口座の明細が無い')

    const accountNumber = await cellText(page, '口座番号', index)
    const lookup = waitForApiRequest(page, CUSTOMERS_API_PATH, 'account_no', accountNumber)
    await (await calculationButtonOf(page, index)).click()
    await lookup

    // 文言は src/stores/holdingSearch.js の findCustomerId と HoldingSearchView.vue の帯
    const band = page.getByTestId('holding-search-customer-error')
    await expect(band).toContainText('顧客詳細を開けませんでした。')
    await expect(band).toContainText(`口座番号 ${accountNumber} の顧客が顧客マスタに見つかりません。`)
    await expect(page).toHaveURL(new RegExp(`${PATH}(\\?|$)`))
    await expect(page.getByTestId('holding-search-table')).toBeVisible()
    await expect(rowsOf(page)).toHaveCount(shown)
  })
})
