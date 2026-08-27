import { expect, test } from '@playwright/test'
import { orderListResponse } from '../src/mocks/fixtures/orders'

// dev サーバ側で MSW が起動しているため、E2E は追加のモック設定なしでモック応答を受け取る。
test.describe('注文一覧', () => {
  test('MSW のモックデータが一覧に表示される', async ({ page }) => {
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
})
