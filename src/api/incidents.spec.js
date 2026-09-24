import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { suspensionHistories, suspensionTargets } from '@/mocks/fixtures/incidents'
import {
  fetchSuspensionHistories,
  fetchSuspensionStatus,
  resumeOrders,
  suspendOrders,
} from './incidents'

/*
 * API 層のテスト。ここだけが「バックエンドの形」（日本語キー）を知ってよい層なので、
 * 変換の結果と、送り出すリクエストそのものを固定する。
 * 期待値はフィクスチャから導く（件数・停止対象名・日時を直接書かない）。
 */

const STATUS_PATH = '*/api/operations/order-suspensions'
const HISTORY_PATH = '*/api/operations/order-suspensions/history'
const SUSPEND_PATH = '*/api/operations/order-suspensions/suspend'
const RESUME_PATH = '*/api/operations/order-suspensions/resume'

// 停止・再開の対象は IB（注文ルートコード 1）。行はフィクスチャから引く
const IB = suspensionTargets.find((row) => row['停止対象'] === '1')
const REASON = 'IB回線障害'

/** 最後に届いたリクエスト */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

/**
 * リクエストを記録するだけのハンドラを立てる。応答は返さず既定のハンドラへ落とす
 * （モックの状態遷移をそのまま使うため）。
 *
 * @param {'get'|'post'} method
 * @param {string} path
 */
function record(method, path) {
  server.use(
    http[method](path, async ({ request }) => {
      const url = new URL(request.url)
      lastRequest = {
        url,
        params: url.searchParams,
        // GET は本文が無いので読まない。既定のハンドラも読むので clone する
        body: method === 'post' ? await request.clone().json() : null,
      }
    }),
  )
}

const detailHandler = (method, path, status, detail) =>
  http[method](path, () => HttpResponse.json({ detail }, { status }))

// シナリオ: docs/unit/api-incidents.md
describe('api/incidents', () => {
  it('[INA-01] 停止状態の総合フラグと各行の識別項目が camelCase に変換される', async () => {
    const status = await fetchSuspensionStatus()

    // 既定モックは全対象が通常運用
    const suspendedRows = suspensionTargets.filter((row) => row['発注停止中'])
    expect(status.suspended).toBe(suspendedRows.length > 0)
    expect(status.allSuspended).toBe(suspendedRows.some((row) => row['停止対象'] === 'ALL'))
    expect(status.suspendedTargets).toEqual(suspendedRows.map((row) => row['停止対象']))

    expect(status.targets).toHaveLength(suspensionTargets.length)
    const identities = status.targets.map(({ id, target, targetName, suspended }) => ({
      id,
      target,
      targetName,
      suspended,
    }))
    expect(identities).toEqual(
      suspensionTargets.map((row) => ({
        id: row['ID'],
        target: row['停止対象'],
        targetName: row['停止対象名'],
        suspended: row['発注停止中'],
      })),
    )
    // 並べ替えない（ALL が先頭のまま）
    expect(status.targets[0].target).toBe('ALL')
  })

  it('[INA-02] 各行の停止・再開・更新の記録が camelCase に変換され、発注停止フラグは運ばない', async () => {
    const status = await fetchSuspensionStatus()

    status.targets.forEach((target, index) => {
      const raw = suspensionTargets[index]
      expect(target).toEqual({
        id: raw['ID'],
        target: raw['停止対象'],
        targetName: raw['停止対象名'],
        suspended: raw['発注停止中'],
        reason: raw['停止理由'],
        suspendedAt: raw['停止日時'],
        suspendedBy: raw['停止者'],
        resumedAt: raw['再開日時'],
        resumedBy: raw['再開者'],
        updatedAt: raw['更新日時'],
        updatedBy: raw['更新者'],
      })
      expect(target).not.toHaveProperty('発注停止フラグ')
      expect(target).not.toHaveProperty('suspendedFlag')
    })
  })

  it('[INA-03] 本文が空で返ると null になる', async () => {
    server.use(http.get(STATUS_PATH, () => new HttpResponse(null, { status: 204 })))

    await expect(fetchSuspensionStatus()).resolves.toBeNull()
  })

  it('[INA-04] 履歴が camelCase の配列になり、reason は変更後データの停止理由になる', async () => {
    const histories = await fetchSuspensionHistories()

    expect(histories).toEqual(
      suspensionHistories.map((raw) => ({
        id: raw['ID'],
        target: raw['停止対象'],
        targetName: raw['停止対象名'],
        operation: raw['操作区分'],
        operationName: raw['操作区分名'],
        operator: raw['操作者'],
        reason: raw['変更後データ']['停止理由'],
        operatedAt: raw['操作日時'],
      })),
    )
  })

  it('[INA-05] histories が無い本文なら空配列になる', async () => {
    server.use(http.get(HISTORY_PATH, () => HttpResponse.json({ total: 0 })))

    await expect(fetchSuspensionHistories()).resolves.toEqual([])
  })

  it('[INA-06] 500 は既定の文言の ApiError になる', async () => {
    server.use(http.get(STATUS_PATH, () => new HttpResponse(null, { status: 500 })))

    await expect(fetchSuspensionStatus()).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      message: 'サーバーでエラーが発生しました。',
    })
  })

  it('[INA-07] 停止状態は /operations/order-suspensions に GET する', async () => {
    record('get', STATUS_PATH)

    await fetchSuspensionStatus()

    expect(lastRequest.url.pathname).toBe('/api/operations/order-suspensions')
    expect([...lastRequest.params.keys()]).toEqual([])
  })

  it('[INA-08] 履歴は /operations/order-suspensions/history に limit=50 付きで GET する', async () => {
    record('get', HISTORY_PATH)

    await fetchSuspensionHistories()

    expect(lastRequest.url.pathname).toBe('/api/operations/order-suspensions/history')
    expect(Object.fromEntries(lastRequest.params)).toEqual({ limit: '50' })
  })

  it('[INA-09] 変更後データが null の履歴は reason が null になる', async () => {
    server.use(
      http.get(HISTORY_PATH, () =>
        HttpResponse.json({
          total: 1,
          limit: 50,
          offset: 0,
          histories: [{ ...suspensionHistories[0], 変更後データ: null }],
        }),
      ),
    )

    const histories = await fetchSuspensionHistories()

    expect(histories).toHaveLength(1)
    expect(histories[0].reason).toBeNull()
  })

  it('[INA-10] 停止は /suspend に { 停止対象, 停止理由, 更新日時 } を POST し、実行者は送らない', async () => {
    record('post', SUSPEND_PATH)

    await suspendOrders({ target: IB['停止対象'], reason: REASON, updatedAt: IB['更新日時'] })

    expect(lastRequest.url.pathname).toBe('/api/operations/order-suspensions/suspend')
    expect(lastRequest.body).toEqual({
      停止対象: IB['停止対象'],
      停止理由: REASON,
      更新日時: IB['更新日時'],
    })
    expect(lastRequest.body).not.toHaveProperty('実行者')
  })

  it('[INA-11] 停止の応答は success / camelCase の停止対象 / message になる', async () => {
    const result = await suspendOrders({
      target: IB['停止対象'],
      reason: REASON,
      updatedAt: IB['更新日時'],
    })

    expect(result.success).toBe(true)
    expect(result.target).toMatchObject({
      id: IB['ID'],
      target: IB['停止対象'],
      targetName: IB['停止対象名'],
      suspended: true,
      reason: REASON,
    })
    expect(typeof result.message).toBe('string')
    expect(result.message).not.toBe('')
  })

  it('[INA-12] 停止が 409 のときサーバの detail を message に持つ ApiError になる', async () => {
    const detail = '他のユーザーによって更新されました（テスト）'
    server.use(detailHandler('post', SUSPEND_PATH, 409, detail))

    await expect(
      suspendOrders({ target: IB['停止対象'], reason: REASON, updatedAt: IB['更新日時'] }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 409, message: detail })
  })

  it('[INA-13] updatedAt を省略すると本文の更新日時が null になる', async () => {
    record('post', SUSPEND_PATH)

    await suspendOrders({ target: IB['停止対象'], reason: REASON })

    expect(lastRequest.body).toHaveProperty('更新日時', null)
  })

  it('[INA-14] 再開は /resume に { 停止対象, 更新日時 } を POST し、停止理由と実行者は送らない', async () => {
    // 先に止めておく（既定モックは通常運用なので、そのままでは再開が 400 になる）
    const suspended = await suspendOrders({ target: IB['停止対象'], reason: REASON, updatedAt: null })
    record('post', RESUME_PATH)

    const result = await resumeOrders({
      target: IB['停止対象'],
      updatedAt: suspended.target.updatedAt,
    })

    expect(lastRequest.url.pathname).toBe('/api/operations/order-suspensions/resume')
    expect(lastRequest.body).toEqual({
      停止対象: IB['停止対象'],
      更新日時: suspended.target.updatedAt,
    })
    expect(lastRequest.body).not.toHaveProperty('停止理由')
    expect(lastRequest.body).not.toHaveProperty('実行者')
    expect(result.success).toBe(true)
    expect(result.target.suspended).toBe(false)
  })

  it('[INA-15] 再開が 400 のときサーバの detail を message に持つ ApiError になる', async () => {
    const detail = `${IB['停止対象名']}は停止中ではありません。（テスト）`
    server.use(detailHandler('post', RESUME_PATH, 400, detail))

    await expect(
      resumeOrders({ target: IB['停止対象'], updatedAt: IB['更新日時'] }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 400, message: detail })
  })
})
