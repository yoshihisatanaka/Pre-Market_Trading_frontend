import { expect, test } from '@playwright/test'
import {
  apiContext,
  assertRealApi,
  fetchAll,
  listHelpers,
  skipUnlessRealApi,
} from './helpers/realApi.js'

/*
 * 顧客詳細（外株預り・注文照会タブ）を「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/customer-detail-real-api.md（タイトル先頭の [CDTR-xx] が対応 ID）
 *
 * MSW 版（customer-detail.spec.js。作成時点では未作成）とは目的が違う。MSW 版はモックに当てて
 * 画面の挙動を細かく固定する。こちらはフロントとバックエンドの噛み合わせだけを見るので、
 * 期待値に**データの中身を書かない**。顧客 ID は固定せず、顧客検索の先頭の顧客名リンクから入る。
 * 実 API のテストデータは薄い（保有 0 件・注文が噛み合わない）ので、0 件でも通る形にしてある。
 * `GET /holdings` の値の意味は確認中（docs/api/requests.md #36）なので、値の正しさは見ない。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test customer-detail.real-api
 *
 * CDTR-04 以降は新規注文（/orders/new）への導線。部店・口座番号を URL クエリで引き継ぎ、新規注文の画面が
 * 実 API（GET /masters/customers?account_no=）で顧客を引き直せるところまでを見る。注文は送信しない。
 * 発注権限（GET /auth/me の order）は .env の VITE_USER_CODE で決まりテストからは変えられないので、
 * 無ければ（行の操作が「閲覧のみ」なら）スキップする。保有 0 件のときも「買い」「売り」はスキップ。
 *
 * 顧客詳細は読むだけの画面なので、このファイルは実 DB に書き込まない（GET だけ）。
 */

const SEARCH_PATH = '/customers/search'
// 実 API のパス（openapi.json）。dev サーバの /api プロキシ越しに届く
const CUSTOMERS_API_PATH = '/api/masters/customers'
const HOLDINGS_API_PATH = '/api/holdings'
const ORDERS_API_PATH = '/api/orders'
const AUTH_ME_PATH = '/api/auth/me'
// 顧客一覧の応答の配列キー（openapi.json の一覧応答。src/api/customers.js の fetchCustomers）
const CUSTOMERS_LIST_KEY = 'customers'

// src/stores/customerDetail.js の CUSTOMER_HOLDINGS_LIMIT と同じ値（預りは 1 回で読み、ページャーを持たない）。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const HOLDINGS_LIMIT = 200

// src/stores/customerOrders.js の CUSTOMER_ORDERS_PAGE_SIZE（= utils/pagination.js の DEFAULT_PAGE_SIZE）と同じ値。
// 数えるのは注文の行で、画面の行（元注文ごとのまとまり）ではない
const ORDERS_PAGE_SIZE = 50

/*
 * 新規注文の預り売買区分（URL の deposit の値 → 切り替えボタンの表示名）。
 * src/utils/orderEntryOptions.js の DEPOSIT_CATEGORY_OPTIONS の再掲（Playwright から import できない）
 */
const DEPOSIT_LABELS = { 0: '特定', 1: '一般', 6: '成長投資枠' }

const search = listHelpers({ path: SEARCH_PATH, testIdPrefix: 'customer-search' })
const holdings = listHelpers({ path: SEARCH_PATH, testIdPrefix: 'customer-holdings' })
const orders = listHelpers({ path: SEARCH_PATH, testIdPrefix: 'customer-orders' })

/** 実 API の GET のうち、パスとクエリの値が合うものを待つ */
function waitForApiRequest(page, pathname, query, value) {
  return page.waitForRequest((req) => {
    const url = new URL(req.url())
    return url.pathname === pathname && (query === null || url.searchParams.get(query) === value)
  })
}

/**
 * 顧客検索の先頭の顧客名リンクから顧客詳細（外株預り）へ入る。
 * 顧客が 0 件ならスキップする。開いた顧客の ID と、一覧の 1 行目の口座番号を返す。
 * 預りの取得リクエストは顧客を読み終えた直後に飛ぶので、リンクを押す前から待ち受ける。
 */
async function openFirstCustomer(page) {
  await search.openList(page)
  const total = await search.countOf(page)
  test.skip(total === 0, '顧客が 0 件なので顧客詳細へ入れない')

  // 口座番号は 3 列目（src/views/CustomerSearchView.vue の columns）
  const accountNumber = (
    (await search.rowsOf(page).first().locator('td:nth-child(3)').textContent()) ?? ''
  ).trim()
  test.skip(!/^\d+$/.test(accountNumber), `1 行目の口座番号が数字でない（${accountNumber}）`)

  const link = page
    .getByTestId('customer-search-table')
    .locator('[data-testid^="customer-search-detail-"]')
    .first()
  const testId = await link.getAttribute('data-testid')
  const customerId = testId.replace('customer-search-detail-', '')

  const holdingsRequest = waitForApiRequest(page, HOLDINGS_API_PATH, 'account_no', accountNumber)
  await link.click()
  await expect(page).toHaveURL(new RegExp(`/customers/${customerId}/summary$`))
  await expect(page.getByTestId('customer-info-bar')).toBeVisible()

  return { customerId, accountNumber, holdingsRequest }
}

/** URL のクエリをオブジェクトで読む */
function queryOf(page) {
  return Object.fromEntries(new URL(page.url()).searchParams)
}

/** 新規注文の切り替えボタン（売買・預り区分）。選ばれているかは aria-pressed で見る */
function toggleButton(page, testId, name) {
  return page.getByTestId(testId).getByRole('button', { name, exact: true })
}

/**
 * 顧客カードの表示から、新規注文へ引き継がれるはずの値を読む。
 * カードは空の値を「—」で出す（src/components/customers/CustomerInfoBar.vue）ので、それは空に戻す。
 */
async function readCustomerCard(page) {
  const text = async (testId) => {
    const value = ((await page.getByTestId(testId).textContent()) ?? '').trim()
    return value === '—' ? '' : value
  }
  const branchCode = await text('customer-info-branch')
  const accountNumber = await text('customer-info-account')
  const customerName = await text('customer-info-name')
  test.skip(!/^\d+$/.test(accountNumber), `顧客の口座番号が数字でない（${accountNumber}）`)

  // 引き継ぎのクエリ名は URL 上の契約（src/utils/orderEntryQuery.js）。空の値は載らない
  const query = { account_number: accountNumber }
  if (branchCode) query.branch_code = branchCode
  return { branchCode, accountNumber, customerName, query }
}

/**
 * 顧客詳細から新規注文へ移る導線を押し、新規注文の画面が同じ顧客を実 API で引き直したところまで確かめる。
 * 顧客の照会は新規注文の画面が開いた直後に飛ぶので、押す前から待ち受ける。
 * 返り値は URL のクエリ（導線ごとの差分は呼び出し側で見る）。
 */
async function followOrderEntryLink(page, link, customer) {
  const lookup = waitForApiRequest(page, CUSTOMERS_API_PATH, 'account_no', customer.accountNumber)
  await link.click()

  await expect(page).toHaveURL(/\/orders\/new\?/)
  const request = await lookup
  if (customer.branchCode) {
    expect(new URL(request.url()).searchParams.get('branch_code')).toBe(customer.branchCode)
  }

  await expect(page.getByTestId('order-entry-form')).toBeVisible()
  await expect(page.getByTestId('order-entry-branch')).toHaveValue(customer.branchCode)
  await expect(page.getByTestId('order-entry-account')).toHaveValue(customer.accountNumber)
  // 口座番号の横の照会結果と顧客バー。顧客カードと同じ顧客を引けている
  await expect(page.getByTestId('order-entry-account-hint')).toHaveText(customer.customerName)
  await expect(page.getByTestId('order-entry-customer-name')).toHaveText(customer.customerName)
  await expect(page.getByTestId('order-entry-error')).toHaveCount(0)

  return queryOf(page)
}

/** API を直接同じ口座番号で引き、画面に出た顧客名が応答の 顧客名 と一致することを確かめる */
async function expectCustomerNameFromApi(playwright, customer) {
  const api = await apiContext(playwright)
  const res = await api.get(CUSTOMERS_API_PATH, {
    params: { account_no: customer.accountNumber, limit: 200 },
  })
  expect(res.ok(), `${CUSTOMERS_API_PATH} が ${res.status()} を返した`).toBe(true)
  const rows = (await res.json())[CUSTOMERS_LIST_KEY] ?? []
  await api.dispose()

  // 口座番号は実 API では integer（src/api/customers.js）。部店が分かるときはそれでも絞る
  const found = rows.find(
    (row) =>
      String(row.口座番号) === customer.accountNumber &&
      (!customer.branchCode || row.部店コード === customer.branchCode),
  )
  expect(found, `account_no=${customer.accountNumber} で顧客が引けない`).toBeTruthy()
  expect(found.顧客名).toBe(customer.customerName)
}

/**
 * 外株預りを読み終え、行の操作（「買い」「売り」）が押せる状態まで待つ。
 * 操作は発注権限を読み終えてから出るので、「買い」か「閲覧のみ」のどちらかが出るまで待ってから判定する。
 * 保有 0 件・発注権限なしはスキップ（テストデータと操作者の都合で、フロントの不具合ではない）。
 */
async function openHoldingsWithActions(page) {
  const { holdingsRequest } = await openFirstCustomer(page)
  await holdingsRequest
  const customer = await readCustomerCard(page)

  const total = await holdings.countOf(page)
  test.skip(total === 0, '保有が 0 件なので行の「買い」「売り」が無い')

  const buy = page.getByTestId('customer-holdings-buy')
  const viewOnly = page.getByTestId('customer-holdings-view-only')
  await expect(buy.or(viewOnly).first()).toBeVisible()
  test.skip((await viewOnly.count()) > 0, '発注権限が無いので行の操作が「閲覧のみ」')

  return customer
}

/** 預りの行のティッカー（1 列目。src/views/CustomerSummaryView.vue の columns）。無い銘柄は '' */
async function tickerOf(row) {
  const text = ((await row.locator('td:nth-child(1)').textContent()) ?? '').trim()
  return text === '—' ? '' : text
}

/** 新規注文の売買区分と預り売買区分が、URL のクエリと食い違っていない */
async function expectTradeToggles(page, query, sideLabel) {
  await expect(toggleButton(page, 'order-entry-side', sideLabel)).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  if (query.deposit !== undefined) {
    const label = DEPOSIT_LABELS[query.deposit]
    expect(label, `deposit=${query.deposit} は新規注文で選べる預り区分でない`).toBeTruthy()
    await expect(toggleButton(page, 'order-entry-deposit-category', label)).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  }
}

test.describe('顧客詳細（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test('[CDTR-01] 顧客カードと外株預りの一覧（または「保有外株なし」）が出る', async ({ page }) => {
    const { accountNumber, holdingsRequest } = await openFirstCustomer(page)

    // 顧客カードは一覧の行と同じ口座。預りはその口座番号で引いている
    await expect(page.getByTestId('customer-info-account')).toHaveText(accountNumber)
    await holdingsRequest

    // 件数（「N 銘柄」）は預りを読み終えてから出る。ページャーは持たない
    await expect(page.getByTestId('customer-holdings-count')).toBeVisible()
    await holdings.expectListConsistent(page, { pageSize: HOLDINGS_LIMIT, pagination: false })
    if ((await holdings.countOf(page)) === 0) {
      await expect(page.getByTestId('customer-holdings-empty')).toHaveText('保有外株なし')
    }

    await expect(page.getByTestId('customer-detail-error')).toHaveCount(0)
    await expect(page.getByTestId('customer-detail-not-found')).toHaveCount(0)
  })

  test('[CDTR-02] 注文照会タブで、その顧客の口座番号で引いた注文一覧（または 0 件の表示）が出る', async ({
    page,
  }) => {
    const { customerId, holdingsRequest } = await openFirstCustomer(page)
    // 待ち受けを宙に浮かせない（外株預りの読み込みが終わってからタブを切り替える）
    await holdingsRequest

    // 注文の絞り込みは顧客カードの値（一覧の行ではなく GET /masters/customers/{id} の応答）を使う
    const accountNumber = (
      (await page.getByTestId('customer-info-account').textContent()) ?? ''
    ).trim()
    const branchCode = ((await page.getByTestId('customer-info-branch').textContent()) ?? '').trim()
    test.skip(!/^\d+$/.test(accountNumber), `顧客の口座番号が数字でない（${accountNumber}）`)

    const ordersRequest = waitForApiRequest(page, ORDERS_API_PATH, 'account_no', accountNumber)
    await page.getByTestId('customer-detail-tab-orders').click()
    const request = await ordersRequest

    await expect(page).toHaveURL(new RegExp(`/customers/${customerId}/orders$`))
    if (branchCode !== '' && branchCode !== '—') {
      expect(new URL(request.url()).searchParams.get('branch_code')).toBe(branchCode)
    }

    await expect(page.getByTestId('customer-orders-count')).toBeVisible()
    const total = await orders.countOf(page)
    // 画面の行は元注文ごとのまとまりなので、件数（注文の行数）とは一致しない。範囲で見る
    const groupRows = page.getByTestId('customer-orders-table').getByTestId('order-inquiry-row')
    if (total > 0) {
      await expect(page.getByTestId('customer-orders-table')).toBeVisible()
      await expect(page.getByTestId('customer-orders-pagination')).toBeVisible()
      const shown = await groupRows.count()
      expect(shown).toBeGreaterThan(0)
      expect(shown).toBeLessThanOrEqual(Math.min(total, ORDERS_PAGE_SIZE))
    } else {
      await expect(page.getByTestId('customer-orders-empty')).toHaveText(
        'この顧客の注文はありません',
      )
      await expect(groupRows).toHaveCount(0)
    }
    await expect(page.getByTestId('customer-orders-error')).toHaveCount(0)
  })

  test('[CDTR-03] 存在しない顧客 ID では「該当する顧客が見つかりません」が出る', async ({
    page,
    playwright,
  }) => {
    // 実 DB の最大の ID より十分大きい値にする（固定値だと将来の行と衝突しうる）
    const api = await apiContext(playwright)
    const customers = await fetchAll(api, CUSTOMERS_API_PATH, CUSTOMERS_LIST_KEY)
    await api.dispose()
    const maxId = customers.reduce((max, row) => Math.max(max, Number(row.ID) || 0), 0)
    const missingId = maxId + 1_000_000

    const detailResponse = page.waitForResponse(
      (res) => new URL(res.url()).pathname === `${CUSTOMERS_API_PATH}/${missingId}`,
    )
    await page.goto(`/customers/${missingId}/summary`)
    expect((await detailResponse).status(), '存在しない顧客に 404 を返していない').toBe(404)
    await assertRealApi(page)

    await expect(page.getByTestId('customer-detail-not-found')).toContainText(
      '該当する顧客が見つかりません。',
    )
    await expect(page.getByTestId('customer-detail-back-to-search')).toBeVisible()
    await expect(page.getByTestId('customer-detail-error')).toHaveCount(0)
    await expect(page.getByTestId('customer-info-bar')).toHaveCount(0)
  })

  test('[CDTR-04] タブの「注文入力」で新規注文へ移り、実 API で引き直した顧客名が出る', async ({
    page,
    playwright,
  }) => {
    const { holdingsRequest } = await openFirstCustomer(page)
    await holdingsRequest
    const customer = await readCustomerCard(page)

    const query = await followOrderEntryLink(
      page,
      page.getByTestId('customer-detail-tab-order-entry'),
      customer,
    )

    // 引き継ぐのは部店と口座番号だけ
    expect(query).toEqual(customer.query)
    await expectCustomerNameFromApi(playwright, customer)
  })

  test('[CDTR-05] 預りの行の「買い」で、その行の銘柄と「買い」を引き継いで新規注文へ移る', async ({
    page,
  }) => {
    const customer = await openHoldingsWithActions(page)
    const row = holdings.rowsOf(page).first()
    const ticker = await tickerOf(row)

    const query = await followOrderEntryLink(page, row.getByTestId('customer-holdings-buy'), customer)

    // 顧客・向き・ティッカー（ティッカーの無い銘柄は載らない）。買いに成長投資枠（6）は引き継がない
    const { deposit, ...rest } = query
    expect(rest).toEqual({ ...customer.query, side: 'buy', ...(ticker ? { ticker } : {}) })
    if (deposit !== undefined) expect(deposit).not.toBe('6')

    await expect(page.getByTestId('order-entry-ticker')).toHaveValue(ticker)
    await expectTradeToggles(page, query, '買い')
  })

  test('[CDTR-06] 預りの行の「売り」で、その行の銘柄と「売り」を引き継いで新規注文へ移る', async ({
    page,
  }) => {
    const customer = await openHoldingsWithActions(page)

    // 売却不可の明細は押せないボタン（<button disabled>）なので、リンク（href あり）の「売り」を探す
    const sellLinks = holdings.rowsOf(page).locator('a[data-testid="customer-holdings-sell"]')
    test.skip((await sellLinks.count()) === 0, '押せる「売り」が無い（全行が売却不可）')
    const row = holdings.rowsOf(page).filter({ has: sellLinks.first() }).first()
    const ticker = await tickerOf(row)

    const query = await followOrderEntryLink(page, sellLinks.first(), customer)

    const { deposit, ...rest } = query
    expect(rest).toEqual({ ...customer.query, side: 'sell', ...(ticker ? { ticker } : {}) })
    if (deposit !== undefined) expect(['0', '1', '6']).toContain(deposit)

    await expect(page.getByTestId('order-entry-ticker')).toHaveValue(ticker)
    await expectTradeToggles(page, query, '売り')
  })

  test('[CDTR-07] 「＋ 新規注文」は部店と口座番号だけを引き継ぐ', async ({ page }) => {
    // 発注権限は起動時に main.js が引く GET /auth/me で決まる。保有 0 件だと「閲覧のみ」も出ないので、
    // ブラウザ自身が受け取った応答の 権限.order でスキップを決める（access-control.real-api.spec.js と同じ）
    const me = page.waitForResponse((res) => new URL(res.url()).pathname === AUTH_ME_PATH)
    const { holdingsRequest } = await openFirstCustomer(page)
    await holdingsRequest
    const customer = await readCustomerCard(page)

    const canOrder = Boolean((await (await me).json())?.権限?.order)
    test.skip(!canOrder, '発注権限が無いので「＋ 新規注文」が出ない')
    const newOrder = page.getByTestId('customer-holdings-new-order')
    await expect(newOrder).toBeVisible()

    const query = await followOrderEntryLink(page, newOrder, customer)

    expect(query).toEqual(customer.query)
    await expect(page.getByTestId('order-entry-ticker')).toHaveValue('')
  })
})
