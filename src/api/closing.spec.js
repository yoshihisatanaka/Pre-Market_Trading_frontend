import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { closedMizuhoClosingStatus, mizuhoClosingStatus } from '@/mocks/fixtures/closing'
import { ApiError } from './client'
import {
  CLOSING_HISTORY_LIMIT,
  closeMizuhoOrders,
  fetchMizuhoClosingStatus,
  reopenMizuhoOrders,
} from './closing'

/*
 * API 層のテスト。締め状態の照会に載せるクエリ、締め実行・締め解除に載せる本文と、
 * ClosingStatusResponse → アプリ内モデルの変換を固定する。
 * 期待値はフィクスチャから導く。操作者コードは vitest.config.js の VITE_USER_CODE（test-user）で、
 * 締め・解除の実行者は MSW が X-User-Code から記録する（本文には載せない）。
 */

/** 履歴の 操作区分 → アプリ内の操作（openapi.json の ClosingHistoryItem の値） */
const HISTORY_ACTIONS = { CLOSE: 'close', RESET: 'reopen' }

/** history を持たない応答（古いサーバの形） */
function withoutHistory(raw) {
  const copy = { ...raw }
  delete copy.history
  return copy
}
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
  it('[CLS-01] closing_type=MIZUHO と履歴の件数で問い合わせ、受付中の状態を返す', async () => {
    record(() => HttpResponse.json(mizuhoClosingStatus))

    const status = await fetchMizuhoClosingStatus()

    expect(lastParams.get('closing_type')).toBe('MIZUHO')
    expect(lastParams.get('history_limit')).toBe(String(CLOSING_HISTORY_LIMIT))
    expect(status).toEqual({ closed: false, updatedAt: null, operator: '', history: [] })
  })

  it('[CLS-02] 締め済の応答は closed が true で、更新日時・実行者と履歴（新しい順）を運ぶ', async () => {
    record(() => HttpResponse.json(closedMizuhoClosingStatus))

    const status = await fetchMizuhoClosingStatus()

    expect(status).toEqual({
      closed: true,
      updatedAt: closedMizuhoClosingStatus.更新日時,
      operator: closedMizuhoClosingStatus.実行者,
      history: closedMizuhoClosingStatus.history.map((entry) => ({
        id: String(entry.ID),
        action: HISTORY_ACTIONS[entry.操作区分],
        operator: entry.実行者,
        operatedAt: entry.操作日時,
      })),
    })
    // 締め・解除の両方が入っている（読み替えの両方向を見るため）
    expect(status.history.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['close', 'reopen']),
    )
  })

  it('[CLS-08] history の無い応答は、更新日時があれば最後の 1 回から 1 件、無ければ [] にする', async () => {
    const closedWithoutHistory = withoutHistory(closedMizuhoClosingStatus)
    record(() => HttpResponse.json(closedWithoutHistory))

    const closed = await fetchMizuhoClosingStatus()
    expect(closed.history).toEqual([
      {
        id: '',
        action: 'close',
        operator: closedMizuhoClosingStatus.実行者,
        operatedAt: closedMizuhoClosingStatus.更新日時,
      },
    ])

    const reopenedAt = closedMizuhoClosingStatus.更新日時
    record(() =>
      HttpResponse.json({ ...closedWithoutHistory, 締め状態: 0, 更新日時: reopenedAt }),
    )
    const reopened = await fetchMizuhoClosingStatus()
    expect(reopened.history).toEqual([
      { id: '', action: 'reopen', operator: closedMizuhoClosingStatus.実行者, operatedAt: reopenedAt },
    ])

    record(() => HttpResponse.json(withoutHistory(mizuhoClosingStatus)))
    expect((await fetchMizuhoClosingStatus()).history).toEqual([])
  })

  it('[CLS-09] 履歴の知らない操作区分は空文字、欠けた ID・実行者は空文字、操作日時は null にする', async () => {
    record(() =>
      HttpResponse.json({
        ...closedMizuhoClosingStatus,
        history: [{ ID: null, 操作区分: 'UNKNOWN', 実行者: null }],
      }),
    )

    const status = await fetchMizuhoClosingStatus()

    expect(status.history).toEqual([{ id: '', action: '', operator: '', operatedAt: null }])
  })

  it('[CLS-03] 本文が空の応答は null を返す', async () => {
    record(() => new HttpResponse(null, { status: 204 }))

    await expect(fetchMizuhoClosingStatus()).resolves.toBeNull()
  })

  it('[CLS-04] 500 は ApiError で reject する', async () => {
    record(() => HttpResponse.json({ detail: 'サーバーでエラーが発生しました。' }, { status: 500 }))

    await expect(fetchMizuhoClosingStatus()).rejects.toBeInstanceOf(ApiError)
  })

  it('[CLS-05] 締め実行は空の本文で送り、操作後の状態（実行者はサーバが解決）を返す', async () => {
    recordPost(CLOSE_PATH)

    const status = await closeMizuhoOrders()

    expect(lastBody).toEqual({})
    expect(status.closed).toBe(true)
    expect(status.updatedAt).toEqual(expect.any(String))
    expect(status.operator).toBe(USER_CODE)
    expect(status.history[0]).toEqual({
      id: expect.any(String),
      action: 'close',
      operator: USER_CODE,
      operatedAt: status.updatedAt,
    })
  })

  it('[CLS-06] 締め解除は /reset に空の本文で送り、受付中の状態を返す', async () => {
    recordPost(REOPEN_PATH)

    const status = await reopenMizuhoOrders()

    expect(lastBody).toEqual({})
    expect(status.closed).toBe(false)
    expect(status.operator).toBe(USER_CODE)
    expect(status.history[0]).toMatchObject({ action: 'reopen', operator: USER_CODE })
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
