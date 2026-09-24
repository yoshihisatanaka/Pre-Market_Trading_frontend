import { expect, test } from '@playwright/test'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/slice-criteria.md（タイトル先頭の [SC-xx] が対応 ID）
// dev サーバ側で MSW が起動しているため、既定ではフィクスチャの応答が返る。
// モックの可変状態はページ単位なので、保存しても他のテストには持ち越さない。
test.describe('スライス基準マスタ', () => {
  test('[SC-01] 現在のスライス基準が 3 項目とも表示される', async ({ page }) => {
    await page.goto('/masters/hard-limits')

    // 比率 0.05 → 5.00%、整形（utils/format）まで通っていることを確認する
    await expect(page.getByTestId('slice-criteria-rate')).toHaveText('5.00%')
    await expect(page.getByTestId('slice-criteria-quantity')).toHaveText('10,000 株')
    await expect(page.getByTestId('slice-criteria-amount')).toHaveText('USD 1,000,000')
  })

  test('[SC-02] 取得が失敗したときエラー表示と再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [
      {
        path: '*/api/masters/hard-limits',
        status: 500,
        body: { detail: 'サーバーでエラーが発生しました。' },
      },
    ])
    await page.goto('/masters/hard-limits')

    const error = page.getByTestId('slice-criteria-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('サーバーでエラーが発生しました。')
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('slice-criteria-form')).toHaveCount(0)
  })

  test('[SC-03] 上限を変えて保存すると現在値に反映される', async ({ page }) => {
    await page.goto('/masters/hard-limits')
    await expect(page.getByTestId('slice-criteria-rate')).toHaveText('5.00%')

    await page.getByTestId('slice-criteria-rate-input').fill('3')
    await page.getByTestId('slice-criteria-quantity-input').fill('5000')
    await page.getByTestId('slice-criteria-amount-input').fill('500000')
    await page.getByTestId('slice-criteria-save').click()

    await expect(page.getByTestId('slice-criteria-notice')).toContainText(
      'スライス基準を保存しました。',
    )
    await expect(page.getByTestId('slice-criteria-rate')).toHaveText('3.00%')
    await expect(page.getByTestId('slice-criteria-quantity')).toHaveText('5,000 株')
    await expect(page.getByTestId('slice-criteria-amount')).toHaveText('USD 500,000')
  })

  test('[SC-04] 範囲外の値で保存すると理由が出て現在値は変わらない', async ({ page }) => {
    await page.goto('/masters/hard-limits')
    await expect(page.getByTestId('slice-criteria-rate')).toHaveText('5.00%')

    await page.getByTestId('slice-criteria-rate-input').fill('0')
    await page.getByTestId('slice-criteria-save').click()

    await expect(page.getByTestId('slice-criteria-save-error')).toBeVisible()
    await expect(page.getByTestId('slice-criteria-notice')).toHaveCount(0)
    await expect(page.getByTestId('slice-criteria-rate')).toHaveText('5.00%')
  })

  test('[SC-05] サイドメニューから遷移できる', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('link', { name: 'スライス基準マスタ', exact: true }).click()

    await expect(page).toHaveURL(/\/masters\/hard-limits$/)
    await expect(page.getByTestId('slice-criteria-current')).toBeVisible()
  })

  test('[SC-06] 他の担当者が先に更新していると競合が出て現在値は変わらない', async ({ page }) => {
    // GET は既定のまま（画面は正常に開く）。PUT だけを 409 に差し替える
    await mockApi(page, [
      {
        method: 'put',
        path: '*/api/masters/hard-limits',
        status: 409,
        body: { detail: '他のユーザーによってスライス設定が更新されました。' },
      },
    ])
    await page.goto('/masters/hard-limits')
    await expect(page.getByTestId('slice-criteria-rate')).toHaveText('5.00%')

    await page.getByTestId('slice-criteria-rate-input').fill('3')
    await page.getByTestId('slice-criteria-save').click()

    await expect(page.getByTestId('slice-criteria-save-error')).toContainText('更新されました')
    await expect(page.getByTestId('slice-criteria-notice')).toHaveCount(0)
    await expect(page.getByTestId('slice-criteria-rate')).toHaveText('5.00%')
  })

  test('[SC-07] 閲覧のみで開くと設定変更フォームが出ない', async ({ page }) => {
    await page.goto('/masters/hard-limits?as_user=viewer')

    await expect(page.getByTestId('slice-criteria-role')).toHaveText('閲覧のみ')
    await expect(page.getByTestId('slice-criteria-readonly')).toHaveText(
      '更新は管理責任者だけが実行できます。',
    )
    await expect(page.getByTestId('slice-criteria-form')).toHaveCount(0)
    // 現在値は閲覧のみでも読める
    await expect(page.getByTestId('slice-criteria-rate')).toHaveText('5.00%')
  })
})
