import { expect, test } from '@playwright/test'
import { navItems, navSections } from '../src/components/layout/navigation'

// シナリオ: docs/e2e/layout.md（タイトル先頭の [LAY-xx] が対応 ID）
// 画面固有の要素はここでは検証しない（各画面のシナリオで扱う）。
// getByRole の name は既定で部分一致のため、「注文」が「注文一覧」に当たらないよう exact: true を付ける。
test.describe('共通レイアウト', () => {
  test('[LAY-01] サイドメニューにシステム名とセクション、全リンクが表示される', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByText('米株発注システム')).toBeVisible()

    const nav = page.getByRole('navigation', { name: 'メインメニュー' })
    for (const section of navSections) {
      await expect(nav.getByRole('heading', { name: section.label, exact: true })).toBeVisible()
    }

    await expect(nav.getByRole('link')).toHaveCount(navItems.length)
    await expect(nav.getByRole('link', { name: '顧客検索', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: '残高補正', exact: true })).toBeVisible()
  })

  test('[LAY-02] ヘッダに画面タイトルと市場ステータスが表示される', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: '注文一覧', exact: true })).toBeVisible()
    await expect(page.getByTestId('market-status')).toHaveText(
      /^(● Pre-Market|● Regular|● After-Hours|○ Closed)$/,
    )
  })

  test('[LAY-03] サイドメニューから遷移すると見出しと現在ページ表示が切り替わる', async ({
    page,
  }) => {
    await page.goto('/')

    const nav = page.getByRole('navigation', { name: 'メインメニュー' })
    await nav.getByRole('link', { name: '顧客検索', exact: true }).click()

    await expect(page).toHaveURL(/\/customers\/search$/)
    await expect(page.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible()
    await expect(nav.getByRole('link', { name: '顧客検索', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    // 現在ページになるのは 1 件だけ
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)
  })

  test('[LAY-04] 未実装の画面を直接開いてもレイアウトは表示される', async ({ page }) => {
    await page.goto('/masters/users')

    const nav = page.getByRole('navigation', { name: 'メインメニュー' })
    await expect(nav).toBeVisible()
    await expect(page.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'ユーザマスタ', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
