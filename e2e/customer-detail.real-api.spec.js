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
 * `GET /holdings` の値の意味は確認中（docs/api/requests.md #33）なので、値の正しさは見ない。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test customer-detail.real-api
 *
 * 顧客詳細は読むだけの画面なので、このファイルは実 DB に書き込まない（GET だけ）。
 */

const SEARCH_PATH = '/customers/search'
// 実 API のパス（openapi.json）。dev サーバの /api プロキシ越しに届く
const CUSTOMERS_API_PATH = '/api/masters/customers'
const HOLDINGS_API_PATH = '/api/holdings'
const ORDERS_API_PATH = '/api/orders'
// 顧客一覧の応答の配列キー（openapi.json の一覧応答。src/api/customers.js の fetchCustomers）
const CUSTOMERS_LIST_KEY = 'customers'

// src/stores/customerDetail.js の CUSTOMER_HOLDINGS_LIMIT と同じ値（預りは 1 回で読み、ページャーを持たない）。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const HOLDINGS_LIMIT = 200

// src/stores/customerOrders.js の CUSTOMER_ORDERS_PAGE_SIZE（= utils/pagination.js の DEFAULT_PAGE_SIZE）と同じ値。
// 数えるのは注文の行で、画面の行（元注文ごとのまとまり）ではない
const ORDERS_PAGE_SIZE = 50

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
})
