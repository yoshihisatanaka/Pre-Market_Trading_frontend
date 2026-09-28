import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { closedMizuhoClosingStatus, mizuhoClosingStatus } from '@/mocks/fixtures/closing'
import { ApiError } from './client'
import { fetchMizuhoClosingStatus } from './closing'

/*
 * API 層のテスト。締め状態の照会に載せるクエリと、ClosingStatusResponse → アプリ内モデルの変換を固定する。
 * 期待値はフィクスチャから導く。
 */
const STATUS_PATH = '*/api/closing/status'

/** 最後に届いたリクエストのクエリ */
let lastParams = null

afterEach(() => {
  lastParams = null
})

/** リクエストを記録して、指定の応答を返すハンドラを立てる */
function record(response) {
  server.use(
    http.get(STATUS_PATH, ({ request }) => {
      lastParams = new URL(request.url).searchParams
      return response()
    }),
  )
}

// シナリオ: docs/unit/api-closing.md
describe('api/closing', () => {
  it('[CLS-01] closing_type=MIZUHO で問い合わせ、受付中の状態を返す', async () => {
    record(() => HttpResponse.json(mizuhoClosingStatus))

    const status = await fetchMizuhoClosingStatus()

    expect(lastParams.get('closing_type')).toBe('MIZUHO')
    expect(status).toEqual({ closed: false, updatedAt: null, operator: '' })
  })

  it('[CLS-02] 締め済の応答は closed が true で、更新日時と実行者を運ぶ', async () => {
    record(() => HttpResponse.json(closedMizuhoClosingStatus))

    const status = await fetchMizuhoClosingStatus()

    expect(status).toEqual({
      closed: true,
      updatedAt: closedMizuhoClosingStatus.更新日時,
      operator: closedMizuhoClosingStatus.実行者,
    })
  })

  it('[CLS-03] 本文が空の応答は null を返す', async () => {
    record(() => new HttpResponse(null, { status: 204 }))

    await expect(fetchMizuhoClosingStatus()).resolves.toBeNull()
  })

  it('[CLS-04] 500 は ApiError で reject する', async () => {
    record(() => HttpResponse.json({ detail: 'サーバーでエラーが発生しました。' }, { status: 500 }))

    await expect(fetchMizuhoClosingStatus()).rejects.toBeInstanceOf(ApiError)
  })
})
