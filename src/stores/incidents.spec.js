import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { suspensionHistories, suspensionTargets } from '@/mocks/fixtures/incidents'
import { INCIDENT_HISTORY_PAGE_SIZE, useIncidentsStore } from './incidents'

/*
 * 期待値はフィクスチャから導く（4 行 / 4 件を直接書かない）。
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

/*
 * ページングの確認用。フィクスチャの履歴は 1 ページに収まるので、
 * total が 3 ページ分ある応答を差し込む。行の ID は offset から導き、どのページかを見分ける。
 */
const PAGE = INCIDENT_HISTORY_PAGE_SIZE
const PAGED_TOTAL = PAGE * 2 + 1
const pageRowId = (offset) => offset + 1
const pageBody = (offset) => ({
  total: PAGED_TOTAL,
  limit: PAGE,
  offset,
  histories: [{ ...suspensionHistories[0], ID: pageRowId(offset) }],
})

const paramsOf = (request) => {
  const params = new URL(request.url).searchParams
  return { limit: params.get('limit'), offset: Number(params.get('offset')) }
}

/** 履歴の要求を記録し、offset に応じたページを返す */
function pagedHistories() {
  const requests = []
  server.use(
    http.get(HISTORY_PATH, ({ request }) => {
      const params = paramsOf(request)
      requests.push(params)
      return HttpResponse.json(pageBody(params.offset))
    }),
  )
  return requests
}

/**
 * 応答を手で解放する履歴ハンドラ。release(offset, status) で offset の要求に応答する
 * （status が 500 なら失敗、既定は成功）。届く順序を入れ替えるために使う。
 */
function gatedHistories() {
  const gates = new Map()
  server.use(
    http.get(HISTORY_PATH, async ({ request }) => {
      const { offset } = paramsOf(request)
      const status = await new Promise((resolve) => gates.set(offset, resolve))
      return status === 500
        ? HttpResponse.json({ detail: ERROR_MESSAGE }, { status })
        : HttpResponse.json(pageBody(offset))
    }),
  )
  return {
    async release(offset, status = 200) {
      await vi.waitFor(() => expect(gates.has(offset)).toBe(true))
      gates.get(offset)(status)
    },
  }
}

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

  it('[INS-17] load で historyTotal が履歴の全体件数、historyOffset が 0 になる', async () => {
    const store = useIncidentsStore()

    await store.load()

    expect(store.historyTotal).toBe(HISTORY_COUNT)
    expect(store.historyOffset).toBe(0)
  })

  it('[INS-18] load は履歴を limit = INCIDENT_HISTORY_PAGE_SIZE・offset=0 で取得する', async () => {
    const requests = pagedHistories()
    const store = useIncidentsStore()

    await store.load()

    expect(requests).toEqual([{ limit: String(PAGE), offset: 0 }])
  })

  it('[INS-19] load(offset) はそのページの履歴を読み、historyOffset がその値になる', async () => {
    const requests = pagedHistories()
    const store = useIncidentsStore()

    await store.load(PAGE)

    expect(requests.at(-1).offset).toBe(PAGE)
    expect(store.historyOffset).toBe(PAGE)
    expect(store.historyTotal).toBe(PAGED_TOTAL)
    expect(store.histories.map((row) => row.id)).toEqual([pageRowId(PAGE)])
  })

  it('[INS-20] loadHistory でそのページの履歴に替わり、status は残り error は立たない', async () => {
    const requests = pagedHistories()
    const store = useIncidentsStore()
    await store.load()
    const before = store.status

    await store.loadHistory(PAGE)

    expect(requests.at(-1)).toEqual({ limit: String(PAGE), offset: PAGE })
    expect(store.histories.map((row) => row.id)).toEqual([pageRowId(PAGE)])
    expect(store.historyOffset).toBe(PAGE)
    expect(store.historyTotal).toBe(PAGED_TOTAL)
    expect(store.status).toBe(before)
    expect(store.error).toBeNull()
    expect(store.historyError).toBeNull()
  })

  it('[INS-21] ページ送りの取得中は historyLoading が true で loading は false のまま', async () => {
    pagedHistories()
    const store = useIncidentsStore()
    await store.load()

    const pending = store.loadHistory(PAGE)

    expect(store.historyLoading).toBe(true)
    expect(store.loading).toBe(false)
    await pending
    expect(store.historyLoading).toBe(false)
  })

  it('[INS-22] ページ送りが 500 なら historyError だけが立ち、停止状態は残る', async () => {
    pagedHistories()
    const store = useIncidentsStore()
    await store.load()
    const before = store.status
    server.use(errorHandler(HISTORY_PATH))

    await store.loadHistory(PAGE)

    expect(store.historyError).toBeInstanceOf(Error)
    expect(store.historyError.status).toBe(500)
    expect(store.historyOffset).toBe(PAGE)
    expect(store.error).toBeNull()
    expect(store.status).toBe(before)
    expect(store.targets).toHaveLength(TARGET_COUNT)
  })

  it('[INS-23] 回復後に引数なしの loadHistory で失敗したページを読み直し historyError が消える', async () => {
    const requests = pagedHistories()
    const store = useIncidentsStore()
    await store.load()
    server.use(errorHandler(HISTORY_PATH, { once: true }))
    await store.loadHistory(PAGE)
    expect(store.historyError).not.toBeNull()

    await store.loadHistory()

    expect(requests.at(-1).offset).toBe(PAGE)
    expect(store.historyError).toBeNull()
    expect(store.histories.map((row) => row.id)).toEqual([pageRowId(PAGE)])
  })

  it('[INS-24] 2 ページ目を見ていても suspend 成功後の取り直しは先頭ページになる', async () => {
    const requests = pagedHistories()
    const store = useIncidentsStore()
    await store.load()
    await store.loadHistory(PAGE)
    expect(store.historyOffset).toBe(PAGE)

    await store.suspend({ target: IB_CODE, reason: REASON })

    expect(store.saveError).toBeNull()
    expect(requests.at(-1).offset).toBe(0)
    expect(store.historyOffset).toBe(0)
    expect(store.histories.map((row) => row.id)).toEqual([pageRowId(0)])
  })

  it('[INS-25] ページ送りの失敗が残っていても suspend が成功すれば historyError が消える', async () => {
    pagedHistories()
    const store = useIncidentsStore()
    await store.load()
    server.use(errorHandler(HISTORY_PATH, { once: true }))
    await store.loadHistory(PAGE)
    expect(store.historyError).not.toBeNull()

    await store.suspend({ target: IB_CODE, reason: REASON })

    expect(store.saveError).toBeNull()
    expect(store.historyError).toBeNull()
  })

  it('[INS-26] ページ送りの失敗が残っていても load で historyError が消え履歴が入る', async () => {
    pagedHistories()
    const store = useIncidentsStore()
    await store.load()
    server.use(errorHandler(HISTORY_PATH, { once: true }))
    await store.loadHistory(PAGE)
    expect(store.historyError).not.toBeNull()

    await store.load()

    expect(store.historyError).toBeNull()
    expect(store.histories.map((row) => row.id)).toEqual([pageRowId(0)])
  })

  it('[INS-27] 先に出したページ送りの応答が後から届いても、最後の要求の結果を保つ', async () => {
    pagedHistories()
    const store = useIncidentsStore()
    await store.load()
    const gate = gatedHistories()
    const first = PAGE
    const last = PAGE * 2

    const firstPending = store.loadHistory(first)
    const lastPending = store.loadHistory(last)
    await gate.release(last)
    await lastPending
    await gate.release(first)
    await firstPending

    expect(store.historyOffset).toBe(last)
    expect(store.histories.map((row) => row.id)).toEqual([pageRowId(last)])
  })

  it('[INS-28] 先に出したページ送りが後から 500 で届いても historyError は立たない', async () => {
    pagedHistories()
    const store = useIncidentsStore()
    await store.load()
    const gate = gatedHistories()
    const first = PAGE
    const last = PAGE * 2

    const firstPending = store.loadHistory(first)
    const lastPending = store.loadHistory(last)
    await gate.release(last)
    await lastPending
    await gate.release(first, 500)
    await firstPending

    expect(store.historyError).toBeNull()
    expect(store.histories.map((row) => row.id)).toEqual([pageRowId(last)])
  })

  it('[INS-29] 先に出したページ送りの応答が先に届いても、最後の要求を待つあいだ historyLoading を下ろさない', async () => {
    pagedHistories()
    const store = useIncidentsStore()
    await store.load()
    const gate = gatedHistories()
    const first = PAGE
    const last = PAGE * 2

    const firstPending = store.loadHistory(first)
    const lastPending = store.loadHistory(last)
    await gate.release(first)
    // A の応答が届いて処理されるまで待つ（B はまだ応答待ち）
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(store.historyLoading).toBe(true)
    // 追い越された A の応答では表を替えない
    expect(store.histories.map((row) => row.id)).toEqual([pageRowId(0)])

    await gate.release(last)
    await Promise.all([firstPending, lastPending])

    expect(store.historyLoading).toBe(false)
    expect(store.historyOffset).toBe(last)
    expect(store.histories.map((row) => row.id)).toEqual([pageRowId(last)])
  })
})
