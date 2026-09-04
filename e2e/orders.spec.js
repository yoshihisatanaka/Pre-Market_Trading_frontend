import { expect, test } from '@playwright/test'
import { orderListResponse } from '../src/mocks/fixtures/orders'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/order-list.md（タイトル先頭の [OL-xx] が対応 ID）
// dev サーバ側で MSW が起動しているため、既定ではフィクスチャの応答が返る。
// シナリオ別に応答を変えたいときは mockApi() を page.goto() より前に呼ぶ。
test.describe('注文一覧', () => {
  test('[OL-01] 注文が 3 件あるとき一覧に表示される', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: '注文一覧' })).toBeVisible()

    const rows = page.getByTestId('data-table-row')
    await expect(rows).toHaveCount(orderListResponse.items.length)

    // 表示整形（api 層 → utils/format）まで通っていることを確認する
    const firstRow = rows.first()
    await expect(firstRow).toContainText('AAPL')
    await expect(firstRow).toContainText('$227.52')
    await expect(firstRow).toContainText('約定済')
  })

  test('[OL-02] API がエラーを返したときエラー表示と再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [
      { path: '*/api/orders', status: 500, body: { message: 'サーバーでエラーが発生しました。' } },
    ])
    await page.goto('/')

    const error = page.getByTestId('orders-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('サーバーでエラーが発生しました。')
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('orders-table')).toHaveCount(0)
  })

  test('[OL-03] 注文が 0 件のとき空状態が表示される', async ({ page }) => {
    await mockApi(page, [{ path: '*/api/orders', body: { items: [], total: 0 } }])
    await page.goto('/')

    await expect(page.getByTestId('orders-empty')).toBeVisible()
    await expect(page.getByTestId('data-table-row')).toHaveCount(0)
  })
})
