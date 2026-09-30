import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { closedMizuhoClosingStatus, mizuhoClosingStatus } from '@/mocks/fixtures/closing'
import { ApiError } from './client'
import { closeMizuhoOrders, fetchMizuhoClosingStatus, reopenMizuhoOrders } from './closing'

/*
 * API 層のテスト。締め状態の照会に載せるクエリ、締め実行・締め解除に載せる本文と、
 * ClosingStatusResponse → アプリ内モデルの変換を固定する。
 * 期待値はフィクスチャから導く。操作者コードは vitest.config.js の VITE_USER_CODE（test-user）。
 */
const STATUS_PATH = '*/api/closing/status'
const CLOSE_PATH = '*/api/closing/mizuho'
const REOPEN_PATH = '*/api/closing/mizuho/reset'
const USER_CODE = 'test-user'

/** 最後に届いたリクエストのクエリ */
let lastParams = null
/** 最後に届いた POST の本文 */
let lastBody = null

afterEach(() => {
  lastParams = null
  lastBody = null
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

/** POST の本文を記録して、既定のハンドラへ落とす */
function recordPost(path) {
  server.use(
    http.post(path, async ({ request }) => {
      lastBody = await request.clone().json()
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

  it('[CLS-05] 締め実行は本文に実行者を載せ、操作後の状態を返す', async () => {
    recordPost(CLOSE_PATH)

    const status = await closeMizuhoOrders()

    expect(lastBody).toEqual({ 実行者: USER_CODE })
    expect(status.closed).toBe(true)
    expect(status.updatedAt).toEqual(expect.any(String))
    expect(status.operator).toBe(USER_CODE)
  })

  it('[CLS-06] 締め解除は /reset に実行者を載せ、受付中の状態を返す', async () => {
    recordPost(REOPEN_PATH)

    const status = await reopenMizuhoOrders()

    expect(lastBody).toEqual({ 実行者: USER_CODE })
    expect(status.closed).toBe(false)
    expect(status.operator).toBe(USER_CODE)
  })

  it('[CLS-07] 締め実行の 403 は理由を持つ ApiError で reject する', async () => {
    server.use(
      http.post(CLOSE_PATH, () =>
        HttpResponse.json({ detail: '操作権限がありません。' }, { status: 403 }),
      ),
    )

    const error = await closeMizuhoOrders().catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toBe('操作権限がありません。')
    expect(error.status).toBe(403)
  })
})
