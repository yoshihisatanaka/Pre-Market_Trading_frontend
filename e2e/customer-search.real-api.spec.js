import { expect, test } from '@playwright/test'
import { listHelpers, skipUnlessRealApi } from './helpers/realApi.js'

/*
 * 顧客検索を「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/customer-search-real-api.md（タイトル先頭の [CSER-xx] が対応 ID）
 *
 * MSW 版（customer-search.spec.js。作成時点では未作成）とは目的が違う。MSW 版はモックに当てて
 * 画面の挙動を細かく固定する。こちらはフロントとバックエンドの噛み合わせだけを見るので、
 * 期待値に**データの中身を書かない**（口座番号・扱者コードは実行時に一覧の 1 行目から読む）。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test customer-search.real-api
 *
 * 顧客検索は読むだけの画面なので、このファイルは実 DB に書き込まない（GET だけ）。
 */

const PATH = '/customers/search'
// 実 API のパス（openapi.json）。dev サーバの /api プロキシ越しに届く
const API_PATH = '/api/masters/customers'

// src/stores/customerSearch.js の CUSTOMER_SEARCH_PAGE_SIZE（= utils/pagination.js の DEFAULT_PAGE_SIZE）と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

/** 列の並び（src/views/CustomerSearchView.vue の columns）。セルを列名で引く索引 */
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

const { openList, countOf, rowsOf, expectListConsistent } = listHelpers({
  path: PATH,
  testIdPrefix: 'customer-search',
})

/** 表の 1 列ぶんのセル（全行） */
function columnOf(page, column) {
  return rowsOf(page).locator(`td:nth-child(${COLUMNS.indexOf(column) + 1})`)
}

/** 1 行目のセルの文字（前後の空白を落とす） */
async function firstCellText(page, column) {
  const text = await columnOf(page, column).first().textContent()
  return (text ?? '').trim()
}

/** 顧客名のリンク（testid は customer-search-detail-<行 ID>） */
function detailLinksOf(page) {
  return page
    .getByTestId('customer-search-table')
    .locator('[data-testid^="customer-search-detail-"]')
}

/** 一覧の取得リクエスト（クエリ名が実 API に届いているかを見る） */
function waitForListRequest(page, query, value) {
  return page.waitForRequest((req) => {
    const url = new URL(req.url())
    return url.pathname === API_PATH && url.searchParams.get(query) === value
  })
}

test.describe('顧客検索（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test('[CSER-01] 実データで件数と一覧（または 0 件の表示）が出る', async ({ page }) => {
    await openList(page)
    await expectListConsistent(page, { pageSize: PAGE_SIZE })
  })

  test('[CSER-02] 1 行目の口座番号で絞り込むと、その口座だけが出て URL に account_number が載る', async ({
    page,
  }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total === 0, '顧客が 0 件なので絞り込みを確かめられない')

    const accountNumber = await firstCellText(page, '口座番号')
    test.skip(!/^\d+$/.test(accountNumber), `1 行目の口座番号が数字でない（${accountNumber}）`)

    const request = waitForListRequest(page, 'account_no', accountNumber)
    await page.getByTestId('customer-search-account-number').fill(accountNumber)
    await page.getByTestId('customer-search-search-submit').click()
    await request

    await expect(page).toHaveURL(new RegExp(`account_number=${accountNumber}(&|$)`))
    const filtered = await countOf(page)
    expect(filtered).toBeGreaterThan(0)
    expect(filtered).toBeLessThanOrEqual(total)

    // 表示行がすべてその口座。クエリ名が黙って無視されていれば他の口座が混ざる
    const shown = Math.min(filtered, PAGE_SIZE)
    await expect(rowsOf(page)).toHaveCount(shown)
    await expect(columnOf(page, '口座番号')).toHaveText(Array(shown).fill(accountNumber))
  })

  test('[CSER-03] 1 行目の顧客名から顧客詳細へ移り、顧客カードの口座番号が一覧と一致する', async ({
    page,
  }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total === 0, '顧客が 0 件なので顧客詳細へ移れない')

    const accountNumber = await firstCellText(page, '口座番号')
    const link = detailLinksOf(page).first()
    const testId = await link.getAttribute('data-testid')
    const customerId = testId.replace('customer-search-detail-', '')

    const detailResponse = page.waitForResponse(
      (res) => new URL(res.url()).pathname === `${API_PATH}/${customerId}`,
    )
    await link.click()
    expect((await detailResponse).ok(), '実 API が一覧の ID で顧客を返さない').toBe(true)

    await expect(page).toHaveURL(new RegExp(`/customers/${customerId}/summary$`))
    await expect(page.getByTestId('customer-info-bar')).toBeVisible()
    await expect(page.getByTestId('customer-info-account')).toHaveText(accountNumber)
    await expect(page.getByTestId('customer-detail-error')).toHaveCount(0)
    await expect(page.getByTestId('customer-detail-not-found')).toHaveCount(0)
  })

  test('[CSER-04] 1 行目の扱者コードで絞り込むと、その扱者の行だけが出る', async ({ page }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total === 0, '顧客が 0 件なので絞り込みを確かめられない')

    // 扱者のセルはコードと名前の 2 段。コードは先頭の span（CustomerSearchView.vue の #cell-handler）
    const handlerCode = (
      (await columnOf(page, '扱者').first().locator('span').first().textContent()) ?? ''
    ).trim()
    test.skip(handlerCode === '' || handlerCode === '—', '1 行目の扱者コードが空')

    const request = waitForListRequest(page, 'handler_code', handlerCode)
    await page.getByTestId('customer-search-handler-code').fill(handlerCode)
    await page.getByTestId('customer-search-search-submit').click()
    await request

    await expect(page).toHaveURL(new RegExp(`sales_rep_code=${encodeURIComponent(handlerCode)}`))
    const filtered = await countOf(page)
    expect(filtered).toBeGreaterThan(0)
    expect(filtered).toBeLessThanOrEqual(total)

    // 完全一致か部分一致かは仕様に書かれていないので、「含む」で見る
    const shown = Math.min(filtered, PAGE_SIZE)
    await expect(rowsOf(page)).toHaveCount(shown)
    for (let i = 0; i < shown; i += 1) {
      await expect(columnOf(page, '扱者').nth(i)).toContainText(handlerCode)
    }
  })
})
