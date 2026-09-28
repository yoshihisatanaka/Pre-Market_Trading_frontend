import { expect, test } from '@playwright/test'
import { navSections } from '../src/components/layout/navigation'
import { salesOperator } from '../src/mocks/fixtures/currentOperator'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/forbidden.md（タイトル先頭の [FB-xx] が対応 ID）
// マスタ更新権限の無い操作者が /masters/* を直接開くと /forbidden へ回されること、
// そこから権限の要らない画面へ戻れること、操作者が取れないときは権限なしに倒れることを守る。
// メニューから隠す側は共通レイアウト（LAY-16）が持つ。

const FORBIDDEN_TITLE = 'アクセス権限がありません'

/** マスタメンテ区分の全項目（navigation.js の permission: 'master' の区分） */
const masterItems = navSections
  .filter((section) => section.permission === 'master')
  .flatMap((section) => section.items)

/*
 * マスタメンテのうち画面（ルート）がある path。src/router/index.js の meta.permission: 'master' の
 * ルートと同じ並び。router は import.meta.env を辿る stores / api に依存しており
 * Playwright からは import できないので再掲する。
 * メニューにあってルートの無い path（/masters/fx）は「ページが見つかりません」に落ちるので含めない。
 */
const MASTER_ROUTE_PATHS = [
  '/masters/customers',
  '/masters/permissions',
  '/masters/market-holidays',
  '/masters/blackout-dates',
  '/masters/symbols',
  '/masters/ca',
  '/masters/hard-limits',
  '/masters/balance-adjustments',
]

/** 営業員（マスタ更新権限なし）で入っている状態にする。page.goto() より前に呼ぶ */
function asSalesOperator(page) {
  return mockApi(page, [{ path: '*/api/auth/me', body: salesOperator }])
}

async function expectForbidden(page) {
  await expect(page).toHaveURL(/\/forbidden$/)
  await expect(page.getByRole('heading', { name: FORBIDDEN_TITLE, exact: true })).toBeVisible()
  await expect(page.getByTestId('forbidden')).toBeVisible()
}

test.describe('アクセス権限がありません', () => {
  test('[FB-01] 権限の無い操作者が顧客マスタを直接開くと forbidden へ回される', async ({
    page,
  }) => {
    // フィクスチャがこのシナリオの前提（マスタ更新権限なし）を満たしている
    expect(salesOperator.権限.master).toBe(false)

    await asSalesOperator(page)
    await page.goto('/masters/customers')

    await expectForbidden(page)
    await expect(page.getByTestId('forbidden')).toContainText('権限がありません')
    await expect(page.getByTestId('customers-table')).toHaveCount(0)
  })

  test('[FB-02] マスタメンテのどの画面を直接開いても forbidden へ回される', async ({ page }) => {
    // 再掲した path がメニューのマスタメンテ区分から外れていない（改名・移動に気づくため）
    const menuPaths = masterItems.map((item) => item.to)
    for (const path of MASTER_ROUTE_PATHS) expect(menuPaths).toContain(path)
    // 8 画面を読み込み直すので、既定の 30 秒では足りないことがある
    test.slow()

    await asSalesOperator(page)

    for (const path of MASTER_ROUTE_PATHS) {
      await page.goto(path)
      await expectForbidden(page)
    }
  })

  test('[FB-03] 「注文一覧へ戻る」で権限の要らない画面へ戻れる', async ({ page }) => {
    await asSalesOperator(page)
    await page.goto('/masters/customers')
    await expectForbidden(page)

    await page.getByRole('link', { name: '注文一覧へ戻る' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: '注文一覧', exact: true })).toBeVisible()
  })

  test('[FB-04] 操作者の取得が失敗すると権限なしとして forbidden へ回される', async ({ page }) => {
    await mockApi(page, [
      {
        path: '*/api/auth/me',
        status: 500,
        body: { detail: 'サーバーでエラーが発生しました。' },
      },
    ])
    await page.goto('/masters/customers')

    await expectForbidden(page)
  })
})
