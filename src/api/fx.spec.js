import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { latestUsdFxRate } from '@/mocks/fixtures/fx'
import { ApiError } from './client'
import { fetchLatestFxRate } from './fx'

/*
 * API 層のテスト。GET /masters/fx/latest の送るクエリと、日本語キー・integer の基準日の変換を
 * MSW の既定ハンドラ（src/mocks/handlers/fx.js）に当てて確かめる。
 */
const FX_PATH = '*/api/masters/fx/latest'

/** YYYYMMDD の integer → 'YYYY-MM-DD'（期待値をフィクスチャから導く） */
const toIso = (value) => {
  const text = String(value)
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`
}

const respondWith = (overrides) =>
  server.use(http.get(FX_PATH, () => HttpResponse.json({ ...latestUsdFxRate, ...overrides })))

// シナリオ: docs/unit/api-fx.md
describe('api/fx', () => {
  it('[OFX-01] currency_code=USD を送る', async () => {
    const seen = []
    server.use(
      http.get(FX_PATH, ({ request }) => {
        seen.push(new URL(request.url))
      }),
    )

    await fetchLatestFxRate()

    expect(seen).toHaveLength(1)
    expect(seen[0].pathname).toMatch(/\/masters\/fx\/latest$/)
    expect(seen[0].searchParams.get('currency_code')).toBe('USD')
  })

  it('[OFX-02] 応答を { rate, baseDate, currencyCode } に直す', async () => {
    await expect(fetchLatestFxRate()).resolves.toEqual({
      rate: latestUsdFxRate.為替レート,
      baseDate: toIso(latestUsdFxRate.基準日),
      currencyCode: latestUsdFxRate.通貨コード,
    })
  })

  it('[OFX-03] 数値にならないレートは null', async () => {
    for (const rate of [null, 'abc', 0]) {
      respondWith({ 為替レート: rate })
      const { rate: result } = await fetchLatestFxRate()
      expect(result, String(rate)).toBeNull()
    }
  })

  it('[OFX-04] 8 桁でない基準日は空文字', async () => {
    respondWith({ 基準日: 2026929 })
    const { baseDate } = await fetchLatestFxRate()
    expect(baseDate).toBe('')
  })

  it('[OFX-05] 有効なレートの無い通貨は 404 の ApiError', async () => {
    const error = await fetchLatestFxRate({ currencyCode: 'EUR' }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(404)
  })
})
