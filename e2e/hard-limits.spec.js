import { expect, test } from '@playwright/test'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/hard-limits.md（タイトル先頭の [HL-xx] が対応 ID）
// dev サーバ側で MSW が起動しているため、既定ではフィクスチャの応答が返る。
// モックの可変状態はページ単位なので、保存しても他のテストには持ち越さない。
test.describe('ハードリミットマスタ', () => {
  test('[HL-01] 現在のハードリミットが 3 項目とも表示される', async ({ page }) => {
    await page.goto('/masters/hard-limits')

    // 比率 0.05 → 5.00%、整形（utils/format）まで通っていることを確認する
    await expect(page.getByTestId('hard-limits-rate')).toHaveText('5.00%')
    await expect(page.getByTestId('hard-limits-quantity')).toHaveText('10,000 株')
    await expect(page.getByTestId('hard-limits-amount')).toHaveText('USD 1,000,000')
  })

  test('[HL-02] 取得が失敗したときエラー表示と再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [
      {
        path: '*/api/slice-settings',
        status: 500,
        body: { message: 'サーバーでエラーが発生しました。' },
      },
    ])
    await page.goto('/masters/hard-limits')

    const error = page.getByTestId('hard-limits-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('サーバーでエラーが発生しました。')
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('hard-limits-form')).toHaveCount(0)
  })

  test('[HL-03] 上限を変えて保存すると現在値に反映される', async ({ page }) => {
    await page.goto('/masters/hard-limits')
    await expect(page.getByTestId('hard-limits-rate')).toHaveText('5.00%')

    await page.getByTestId('hard-limits-rate-input').fill('3')
    await page.getByTestId('hard-limits-quantity-input').fill('5000')
    await page.getByTestId('hard-limits-amount-input').fill('500000')
    await page.getByTestId('hard-limits-save').click()

    await expect(page.getByTestId('hard-limits-notice')).toContainText(
      'ハードリミットを保存しました。',
    )
    await expect(page.getByTestId('hard-limits-rate')).toHaveText('3.00%')
    await expect(page.getByTestId('hard-limits-quantity')).toHaveText('5,000 株')
    await expect(page.getByTestId('hard-limits-amount')).toHaveText('USD 500,000')
  })

  test('[HL-04] 範囲外の値で保存すると理由が出て現在値は変わらない', async ({ page }) => {
    await page.goto('/masters/hard-limits')
    await expect(page.getByTestId('hard-limits-rate')).toHaveText('5.00%')

    await page.getByTestId('hard-limits-rate-input').fill('0')
    await page.getByTestId('hard-limits-save').click()

    await expect(page.getByTestId('hard-limits-save-error')).toBeVisible()
    await expect(page.getByTestId('hard-limits-notice')).toHaveCount(0)
    await expect(page.getByTestId('hard-limits-rate')).toHaveText('5.00%')
  })

  test('[HL-05] サイドメニューから遷移できる', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('link', { name: 'ハードリミットマスタ', exact: true }).click()

    await expect(page).toHaveURL(/\/masters\/hard-limits$/)
    await expect(page.getByTestId('hard-limits-current')).toBeVisible()
  })
})
