import { setupWorker } from 'msw/browser'
import { http, HttpResponse } from 'msw'
import { handlers } from './handlers'

/** ブラウザ用（dev サーバ・E2E）。main.js から開発時にだけ起動する */
export const worker = setupWorker(...handlers)

/**
 * E2E からシナリオ別にレスポンスを差し替えるためのオーバーライド。
 *
 * E2E コンテナからのアクセスでは MSW がページ内で fetch を横取りする（fallback mode）ため、
 * Playwright の page.route ではリクエストを捕まえられない。
 * 代わりに page.addInitScript で window.__mswOverrides をセットし、ここで worker.use() に変換する。
 * 使い方は frontend/e2e/helpers/mockApi.js を参照。
 *
 * @typedef {{ method?: 'get'|'post'|'put'|'patch'|'delete', path: string, status?: number, body?: unknown }} MswOverride
 */
function overridesFromWindow() {
  /** @type {MswOverride[]} */
  const overrides = Array.isArray(window.__mswOverrides) ? window.__mswOverrides : []
  return overrides.map(({ method = 'get', path, status = 200, body = null }) =>
    http[method](path, () => HttpResponse.json(body, { status })),
  )
}

export async function startWorker() {
  worker.use(...overridesFromWindow())
  await worker.start({
    // ハンドラ未定義のリクエストは実 API へ素通しする。
    // これにより API が1本実装されるたびに handlers を消すだけで移行できる。
    onUnhandledRequest: 'bypass',
    quiet: false,
  })
}
