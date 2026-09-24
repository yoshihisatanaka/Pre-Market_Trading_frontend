import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { suspensionHistories, suspensionTargets } from '@/mocks/fixtures/incidents'
import { useIncidentsStore } from './incidents'

/*
 * 期待値はフィクスチャから導く（6 行 / 4 件を直接書かない）。
 * 停止・再開は既定モックの状態遷移（resetMockState で戻る）をそのまま使う。
 */
const STATUS_PATH = '*/api/operations/order-suspensions'
const HISTORY_PATH = '*/api/operations/order-suspensions/history'
const SUSPEND_PATH = '*/api/operations/order-suspensions/suspend'
const RESUME_PATH = '*/api/operations/order-suspensions/resume'

const TARGET_COUNT = suspensionTargets.length
const HISTORY_COUNT = suspensionHistories.length

const IB = suspensionTargets.find((row) => row['停止対象'] === '1')
const IB_CODE = IB['停止対象']
const REASON = 'IB回線障害'

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'
const REJECT_MESSAGE = `${IB['停止対象名']}は操作できません。（テスト）`

const errorHandler = (path, options) =>
  http.get(path, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }), options)
const rejectHandler = (path) =>
  http.post(path, () => HttpResponse.json({ detail: REJECT_MESSAGE }, { status: 400 }))

/** 停止・再開の本文を記録する（応答は既定のハンドラへ落とす） */
function recordBody(path) {
  const recorded = { body: null }
  server.use(
    http.post(path, async ({ request }) => {
      recorded.body = await request.clone().json()
    }),
  )
  return recorded
}

const rowOf = (store, code) => store.targets.find((row) => row.target === code)

// シナリオ: docs/unit/stores-incidents.md
describe('useIncidentsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[INS-01] load で停止状態と履歴がまとめて入る', async () => {
    const store = useIncidentsStore()

    await store.load()

    expect(store.error).toBeNull()
    expect(store.status).not.toBeNull()
    expect(store.targets).toHaveLength(TARGET_COUNT)
    expect(store.histories).toHaveLength(HISTORY_COUNT)
  })

  it('[INS-02] 停止状態の取得が 500 なら error が立ち status は null のまま', async () => {
    server.use(errorHandler(STATUS_PATH))
    const store = useIncidentsStore()

    await store.load()

    expect(store.error).toBeInstanceOf(Error)
    expect(store.error.status).toBe(500)
    expect(store.status).toBeNull()
  })

  it('[INS-03] 履歴の取得だけが 500 でも全体の失敗になり status は null のまま', async () => {
    server.use(errorHandler(HISTORY_PATH))
    const store = useIncidentsStore()

    await store.load()

    expect(store.error).toBeInstanceOf(Error)
    expect(store.status).toBeNull()
    expect(store.histories).toEqual([])
  })

  it('[INS-04] 失敗のあと API が回復すれば再度の load で error が消え status が入る', async () => {
    server.use(errorHandler(STATUS_PATH, { once: true }))
    const store = useIncidentsStore()
    await store.load()
    expect(store.error).not.toBeNull()

    await store.load()

    expect(store.error).toBeNull()
    expect(store.status).not.toBeNull()
    expect(store.targets).toHaveLength(TARGET_COUNT)
  })

  it('[INS-05] 取得中は loading が true で isEmpty は false', async () => {
    const store = useIncidentsStore()

    const pending = store.load()

    expect(store.loading).toBe(true)
    expect(store.isEmpty).toBe(false)
    await pending
  })

  it('[INS-06] 停止状態が本文なしなら isEmpty が true で targets は空配列', async () => {
    server.use(http.get(STATUS_PATH, () => new HttpResponse(null, { status: 204 })))
    const store = useIncidentsStore()

    await store.load()

    expect(store.isEmpty).toBe(true)
    expect(store.targets).toEqual([])
  })

  it('[INS-07] 履歴が 0 件でも空ではなく hasHistories が false になる', async () => {
    server.use(
      http.get(HISTORY_PATH, () =>
        HttpResponse.json({ total: 0, limit: 50, offset: 0, histories: [] }),
      ),
    )
    const store = useIncidentsStore()

    await store.load()

    expect(store.isEmpty).toBe(false)
    expect(store.hasHistories).toBe(false)
    expect(store.histories).toEqual([])
  })

  it('[INS-08] 既定モックでは hasHistories が true になる', async () => {
    const store = useIncidentsStore()

    await store.load()

    expect(store.hasHistories).toBe(true)
  })

  it('[INS-09] suspend は応答を返し、取り直しで対象が停止中になり履歴が 1 件増える', async () => {
    const store = useIncidentsStore()
    await store.load()
    expect(rowOf(store, IB_CODE).suspended).toBe(false)

    const result = await store.suspend({ target: IB_CODE, reason: REASON })

    expect(result).not.toBeNull()
    expect(typeof result.message).toBe('string')
    expect(result.message).not.toBe('')
    expect(store.saveError).toBeNull()
    expect(rowOf(store, IB_CODE).suspended).toBe(true)
    expect(store.histories).toHaveLength(HISTORY_COUNT + 1)
  })

  it('[INS-10] suspend は同じ停止対象の行の updatedAt を合札として送る', async () => {
    const store = useIncidentsStore()
    await store.load()
    const expected = rowOf(store, IB_CODE).updatedAt
    const recorded = recordBody(SUSPEND_PATH)

    await store.suspend({ target: IB_CODE, reason: REASON })

    expect(recorded.body['更新日時']).toBe(expected)
  })

  it('[INS-11] 停止 API が 400 なら null を返し saveError だけが立ち status は残る', async () => {
    const store = useIncidentsStore()
    await store.load()
    const before = store.status
    server.use(rejectHandler(SUSPEND_PATH))

    const result = await store.suspend({ target: IB_CODE, reason: REASON })

    expect(result).toBeNull()
    expect(store.saveError).toBeInstanceOf(Error)
    expect(store.saveError.status).toBe(400)
    expect(store.saveError.message).toBe(REJECT_MESSAGE)
    expect(store.error).toBeNull()
    expect(store.status).toBe(before)
  })

  it('[INS-12] 停止の実行中は saving が true で loading は false のまま', async () => {
    const store = useIncidentsStore()
    await store.load()

    const pending = store.suspend({ target: IB_CODE, reason: REASON })

    expect(store.saving).toBe(true)
    expect(store.loading).toBe(false)
    await pending
    expect(store.saving).toBe(false)
  })

  it('[INS-13] clearSaveError で saveError が null に戻る', async () => {
    const store = useIncidentsStore()
    await store.load()
    server.use(rejectHandler(SUSPEND_PATH))
    await store.suspend({ target: IB_CODE, reason: REASON })
    expect(store.saveError).not.toBeNull()

    store.clearSaveError()

    expect(store.saveError).toBeNull()
  })

  it('[INS-14] load 前に suspend すると合札の更新日時は null で送る', async () => {
    const store = useIncidentsStore()
    expect(store.targets).toEqual([])
    const recorded = recordBody(SUSPEND_PATH)

    await store.suspend({ target: IB_CODE, reason: REASON })

    expect(recorded.body).toHaveProperty('更新日時', null)
  })

  it('[INS-15] 停止した対象を resume すると応答が返り、行が通常に戻り履歴が 1 件増える', async () => {
    const store = useIncidentsStore()
    await store.load()
    await store.suspend({ target: IB_CODE, reason: REASON })
    expect(rowOf(store, IB_CODE).suspended).toBe(true)
    const historyCount = store.histories.length

    const result = await store.resume({ target: IB_CODE })

    expect(result).not.toBeNull()
    expect(result.message).not.toBe('')
    expect(store.saveError).toBeNull()
    expect(rowOf(store, IB_CODE).suspended).toBe(false)
    expect(store.histories).toHaveLength(historyCount + 1)
  })

  it('[INS-16] 再開 API が 400 なら null を返し saveError が立ち status は残る', async () => {
    const store = useIncidentsStore()
    await store.load()
    const before = store.status
    server.use(rejectHandler(RESUME_PATH))

    const result = await store.resume({ target: IB_CODE })

    expect(result).toBeNull()
    expect(store.saveError).toBeInstanceOf(Error)
    expect(store.saveError.status).toBe(400)
    expect(store.error).toBeNull()
    expect(store.status).toBe(before)
  })
})
