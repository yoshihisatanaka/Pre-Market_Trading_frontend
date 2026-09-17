import { expect, test } from '@playwright/test'
import { navItems, navSections } from '../src/components/layout/navigation'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/layout.md（タイトル先頭の [LAY-xx] が対応 ID）
// 画面固有の要素はここでは検証しない（各画面のシナリオで扱う）。
// getByRole の name は既定で部分一致のため、「注文」が「注文一覧」に当たらないよう exact: true を付ける。
//
// サイドメニューの初期状態はアプリ起動時に 1 度だけ決まり、以後のリサイズには追従しない。
// 幅を変えるテストは必ず page.goto() より前に setViewportSize すること（後から縮めても何も起きない）。
// 開閉状態は localStorage に残るが、test ごとに context が新しいので保存値は空から始まる。
const toggleButton = (page) => page.getByTestId('sidebar-toggle')
const contentLeft = async (page) => (await page.getByRole('main').boundingBox()).x

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

  test('[LAY-05] 広い画面では既定でサイドメニューが開いている', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')

    await expect(page.getByTestId('app-sidebar')).toBeVisible()
    await expect(toggleButton(page)).toHaveAttribute('aria-expanded', 'true')
  })

  test('[LAY-06] メニューボタンでサイドメニューを畳むと本文が全幅になる', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')

    const sidebar = page.getByTestId('app-sidebar')
    await expect(sidebar).toBeVisible()
    expect(await contentLeft(page)).toBeGreaterThan(0)

    await toggleButton(page).click()

    // 見えなくなるのは visibility: hidden のおかげ。負の margin だけでは矩形が残る
    await expect(sidebar).toBeHidden()
    await expect(toggleButton(page)).toHaveAttribute('aria-expanded', 'false')
    await expect.poll(() => contentLeft(page)).toBe(0)

    await toggleButton(page).click()

    await expect(sidebar).toBeVisible()
    await expect.poll(() => contentLeft(page)).toBeGreaterThan(0)
  })

  test('[LAY-07] 畳んだ状態は再読み込みしても保たれる', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')

    await toggleButton(page).click()
    await expect(page.getByTestId('app-sidebar')).toBeHidden()

    await page.reload()

    await expect(page.getByTestId('app-sidebar')).toBeHidden()
    await expect(toggleButton(page)).toHaveAttribute('aria-expanded', 'false')
  })

  test('[LAY-08] 狭い画面では既定でサイドメニューが畳まれている', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    await page.goto('/')

    const sidebar = page.getByTestId('app-sidebar')
    await expect(sidebar).toBeHidden()
    await expect(toggleButton(page)).toHaveAttribute('aria-expanded', 'false')

    await toggleButton(page).click()

    await expect(sidebar).toBeVisible()
  })

  test('[LAY-09] 畳んだサイドメニューのリンクにはフォーカスが入らない', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')

    await toggleButton(page).click()
    await expect(page.getByTestId('app-sidebar')).toBeHidden()

    // リンク 15 件を通り越す回数だけ送っても、一度も中に入らないことを見る
    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press('Tab')
      const inSidebar = await page.evaluate(
        () => !!document.activeElement?.closest('[data-testid="app-sidebar"]'),
      )
      expect(inSidebar).toBe(false)
    }
  })

  /*
   * 起動時の読み込みオーバーレイ（AppLoadingOverlay）。覆いの中身の出し分けは単体側（ALO）が持つので、
   * ここでは「起動時に実際に覆われるか」「覆いが操作を遮るか」だけを見る。
   *
   * 既定のモックは即座に応答するのでローディングが一瞬すぎて掴めない。
   * ?mockDelay=<ミリ秒> を付けた URL だけ /api/* の応答が遅れる（src/mocks/handlers/index.js）。
   */
  test('[LAY-10] 起動時はコードマスタを読み終えるまで画面全体が覆われる', async ({ page }) => {
    await page.goto('/?mockDelay=2000')

    const loading = page.getByTestId('app-loading')
    await expect(loading).toBeVisible()
    await expect(loading).toContainText('読み込んでいます')

    // 読み終えれば覆いが外れ、下に組み上がっていた画面が現れる
    await expect(loading).toBeHidden()
    await expect(page.getByRole('heading', { name: '注文一覧', exact: true })).toBeVisible()
  })

  test('[LAY-11] コードマスタの取得に失敗すると理由と再試行が覆いの中に出る', async ({ page }) => {
    await mockApi(page, [
      { path: '*/api/codes', status: 500, body: { detail: 'サーバーでエラーが発生しました。' } },
    ])
    await page.goto('/')

    const error = page.getByTestId('app-loading-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('サーバーでエラーが発生しました。')
    await expect(page.getByTestId('app-loading-retry')).toBeVisible()
    // 読み直し中ではないので回転マーク側は出ない
    await expect(page.getByTestId('app-loading')).toHaveCount(0)
  })

  test('[LAY-12] 取得に失敗して覆われている間は画面を操作できない', async ({ page }) => {
    await mockApi(page, [
      { path: '*/api/codes', status: 500, body: { detail: 'サーバーでエラーが発生しました。' } },
    ])
    await page.goto('/')
    await expect(page.getByTestId('app-loading-error')).toBeVisible()

    /*
     * 覆いの下にはレイアウトが組み上がっている（App.vue は AppLayout を v-if で隠さない）。
     * リンクそのものを click すると Playwright の可触判定で止まってしまうので、
     * 座標を取って実際にその位置を押す。覆いが受け止めるので遷移は起きない。
     */
    const link = page.getByRole('link', { name: '顧客検索', exact: true })
    const box = await link.boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByTestId('app-loading-error')).toBeVisible()
  })
})
