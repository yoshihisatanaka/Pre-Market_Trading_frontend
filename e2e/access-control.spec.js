import { expect, test } from '@playwright/test'
import { navSections } from '../src/components/layout/navigation'
import { noOperationOperator, salesOperator } from '../src/mocks/fixtures/currentOperator'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/access-control.md（タイトル先頭の [AC-nn] が対応 ID）
// meta.requiredPermission の付いたルート（運用管理の 4 画面 = AC-01〜04 / マスタメンテの 9 画面 = AC-05〜07）を、権限の無い利用者が URL で直接開いたときに
// 権限なしの画面（/forbidden）へ回されることと、権限があれば開けることを守る。
// 各画面の中身はそれぞれのシナリオが見るので、ここでは「その画面の目印が出たか」だけを見る。
// サイドメニューの区分の出し分けは e2e/layout.spec.js（LAY-16 / 17）が見る。

const AUTH_ME_PATH = '*/api/auth/me'
const SERVER_ERROR = 'サーバーでエラーが発生しました。'

/*
 * 運用管理の 4 画面。path と見出しはメニュー定義（navigation.js の「運用管理」区分）から取る
 * （メニューの文言は router/index.js の meta.title と同じ。router は views を辿るので import しない）。
 * marker はその画面にだけ出る data-testid（各画面の view のソースから）。
 */
const MARKERS = {
  '/operations/announcements': 'announcements-status',
  '/operations/stalled-orders': 'stalled-orders-description',
  '/operations/activity-logs': 'activity-logs-description',
  '/operations/incidents': 'incidents-targets',
}
const operationSection = navSections.find((section) => section.label === '運用管理')
const SCREENS = operationSection.items.map((item) => ({
  path: item.to,
  title: item.label,
  marker: MARKERS[item.to],
}))

/*
 * マスタメンテの 9 画面（AC-05〜07）。src/router/index.js の
 * requiredPermission: 'master' のルートと同じ。router は views を辿るので import せず再掲する。
 * 為替マスタ（/masters/fx）は 2026-09-29 にルートができたので足した。
 * 見出しはメニュー定義（navigation.js の「マスタメンテ」区分。meta.title と同じ文言）から取る。
 */
const MASTER_ROUTE_PATHS = [
  '/masters/customers',
  '/masters/permissions',
  '/masters/market-holidays',
  '/masters/blackout-dates',
  '/masters/symbols',
  '/masters/fx',
  '/masters/ca',
  '/masters/hard-limits',
  '/masters/balance-adjustments',
]
const masterSection = navSections.find((section) => section.label === 'マスタメンテ')
const MASTER_SCREENS = MASTER_ROUTE_PATHS.map((path) => ({
  path,
  title: masterSection.items.find((item) => item.to === path)?.label,
}))

const FORBIDDEN_TITLE = 'アクセス権限がありません'

test.describe('アクセス制御', () => {
  test('[AC-01] 運用管理権限が無いと 4 画面とも権限なしの画面へ回される', async ({ page }) => {
    expect(SCREENS).toHaveLength(4)
    await mockApi(page, [{ path: AUTH_ME_PATH, body: noOperationOperator }])

    for (const screen of SCREENS) {
      await page.goto(screen.path)

      await expect(page).toHaveURL(/\/forbidden$/)
      await expect(page.getByRole('heading', { name: FORBIDDEN_TITLE, exact: true })).toBeVisible()
      await expect(page.getByTestId('forbidden-message')).toHaveText(
        'この画面を開く権限がありません。',
      )
      await expect(page.getByTestId(screen.marker)).toHaveCount(0)
      await expect(page.getByRole('heading', { name: screen.title, exact: true })).toHaveCount(0)
    }
  })

  test('[AC-02] 権限なしの画面から注文一覧へ戻れる', async ({ page }) => {
    await mockApi(page, [{ path: AUTH_ME_PATH, body: noOperationOperator }])
    await page.goto('/operations/stalled-orders')
    await expect(page).toHaveURL(/\/forbidden$/)

    await page.getByRole('link', { name: '注文一覧へ戻る' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: '注文一覧', exact: true })).toBeVisible()
  })

  test('[AC-03] 操作者を取得できないときは確認できなかったことを出す', async ({ page }) => {
    await mockApi(page, [{ path: AUTH_ME_PATH, status: 500, body: { detail: SERVER_ERROR } }])

    for (const screen of SCREENS) {
      await page.goto(screen.path)

      await expect(page).toHaveURL(/\/forbidden$/)
      await expect(page.getByTestId('forbidden-check-failed')).toHaveText(
        `権限を確認できませんでした（${SERVER_ERROR}）。時間をおいて開き直してください。`,
      )
      await expect(page.getByTestId('forbidden-message')).toHaveCount(0)
      await expect(page.getByTestId(screen.marker)).toHaveCount(0)
    }
  })

  test('[AC-04] 権限があれば 4 画面とも開ける', async ({ page }) => {
    for (const screen of SCREENS) {
      await page.goto(screen.path)

      await expect(page).toHaveURL(new RegExp(`${screen.path}$`))
      await expect(page.getByRole('heading', { name: screen.title, exact: true })).toBeVisible()
      await expect(page.getByTestId(screen.marker)).toBeVisible()
      await expect(page.getByTestId('forbidden')).toHaveCount(0)
    }
  })

  test('[AC-05] マスタ更新権限が無いとマスタメンテの 9 画面とも権限なしの画面へ回される', async ({
    page,
  }) => {
    test.slow() // 9 画面を読み込み直すので既定の 30 秒では足りないことがある
    // 再掲した path がメニューのマスタメンテ区分から外れていない（改名・移動に気づくため）
    for (const screen of MASTER_SCREENS) expect(screen.title).toBeTruthy()
    // フィクスチャがこのシナリオの前提（マスタ更新権限なし）を満たしている
    expect(salesOperator.権限.master).toBe(false)
    await mockApi(page, [{ path: AUTH_ME_PATH, body: salesOperator }])

    for (const screen of MASTER_SCREENS) {
      await page.goto(screen.path)

      await expect(page).toHaveURL(/\/forbidden$/)
      await expect(page.getByRole('heading', { name: FORBIDDEN_TITLE, exact: true })).toBeVisible()
      await expect(page.getByTestId('forbidden-message')).toHaveText(
        'この画面を開く権限がありません。',
      )
      await expect(page.getByRole('heading', { name: screen.title, exact: true })).toHaveCount(0)
    }
  })

  test('[AC-06] 操作者を取得できないときはマスタメンテでも確認できなかったことを出す', async ({
    page,
  }) => {
    test.slow()
    await mockApi(page, [{ path: AUTH_ME_PATH, status: 500, body: { detail: SERVER_ERROR } }])

    for (const screen of MASTER_SCREENS) {
      await page.goto(screen.path)

      await expect(page).toHaveURL(/\/forbidden$/)
      await expect(page.getByTestId('forbidden-check-failed')).toHaveText(
        `権限を確認できませんでした（${SERVER_ERROR}）。時間をおいて開き直してください。`,
      )
      await expect(page.getByTestId('forbidden-message')).toHaveCount(0)
      await expect(page.getByRole('heading', { name: screen.title, exact: true })).toHaveCount(0)
    }
  })

  test('[AC-07] 権限があればマスタメンテの 9 画面とも開ける', async ({ page }) => {
    test.slow()
    for (const screen of MASTER_SCREENS) {
      await page.goto(screen.path)

      await expect(page).toHaveURL(new RegExp(`${screen.path}$`))
      await expect(page.getByRole('heading', { name: screen.title, exact: true })).toBeVisible()
      await expect(page.getByTestId('forbidden')).toHaveCount(0)
    }
  })
})
