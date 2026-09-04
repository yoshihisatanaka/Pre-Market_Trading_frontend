/**
 * E2E でシナリオ別に API 応答を差し替える。
 *
 * page.goto() より前に呼ぶこと。ページ実行前に window.__mswOverrides をセットし、
 * dev サーバ側の MSW（src/mocks/browser.js）が起動時に worker.use() へ変換する。
 *
 * なぜ page.route を使わないか:
 *   MSW はページ内で fetch を横取りするため、リクエストがネットワークに出ず
 *   Playwright の page.route では捕まえられない。
 *
 * @param {import('@playwright/test').Page} page
 * @param {Array<{ method?: 'get'|'post'|'put'|'patch'|'delete', path: string, status?: number, body?: unknown }>} overrides
 *
 * @example
 *   await mockApi(page, [
 *     { path: '*\/api/orders', status: 500, body: { message: 'サーバーでエラーが発生しました。' } },
 *   ])
 *   await page.goto('/')
 */
export async function mockApi(page, overrides) {
  await page.addInitScript((value) => {
    window.__mswOverrides = value
  }, overrides)
}
