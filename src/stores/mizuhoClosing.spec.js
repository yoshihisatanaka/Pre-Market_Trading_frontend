import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { mizuhoClosingStatus } from '@/mocks/fixtures/closing'
import { mizuhoOrders } from '@/mocks/fixtures/mizuhoOrders'
import { useMizuhoClosingStore } from './mizuhoClosing'

/*
 * 既定の MSW ハンドラ（src/mocks/handlers/closing.js / mizuho.js）に当てる。
 * 締め状態はハンドラの中で書き換わり、テストごとに resetMockState() で受付中へ戻る。
 * 注文ファイルは締め済でないと 400 になるので、先に close() で締める。
 */
const STATUS_PATH = '*/api/closing/status'
const CLOSE_PATH = '*/api/closing/mizuho'
const EXPORT_PATH = '*/api/mizuho/export-orders'
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'
const FORBIDDEN_MESSAGE = '操作権限がありません。'
const NOT_CLOSED_MESSAGE = '注文ファイルは、みずほ注文締め後に作成してください。'
const USER_CODE = 'test-user'
const BASE_DATE = mizuhoClosingStatus.基準日

// 既定のフィクスチャで各ブックに載る件数（Dream 登録済だけ）
const exportedCountOf = (sideCode) =>
  mizuhoOrders.filter((row) => row.売買区分 === sideCode && row.Dream登録状況 === '2').length

/** 応答を release() まで止めるハンドラ */
function gated(method, path, respond) {
  let open = null
  server.use(
    http[method](path, async () => {
      await new Promise((resolve) => (open = resolve))
      return respond()
    }),
  )
  return {
    async release() {
      await vi.waitFor(() => expect(open).toBeTypeOf('function'))
      open()
    },
  }
}

/** 注文ファイルの要求の side を順に記録して、既定のハンドラへ落とす */
function recordExportSides() {
  const sides = []
  server.use(
    http.get(EXPORT_PATH, ({ request }) => {
      sides.push(new URL(request.url).searchParams.get('side'))
    }),
  )
  return sides
}

// シナリオ: docs/unit/stores-mizuho-closing.md
describe('stores/mizuhoClosing', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[MCS-01] 既定モックでは受付中の状態が入り、空ではない', async () => {
    const store = useMizuhoClosingStore()

    await store.load()

    expect(store.status.closed).toBe(mizuhoClosingStatus.締め状態 === 1)
    expect(store.status.closed).toBe(false)
    expect(store.isEmpty).toBe(false)
    expect(store.loading).toBe(false)
  })

  it('[MCS-02] 本文が空の応答なら status は null で空とみなす', async () => {
    server.use(http.get(STATUS_PATH, () => new HttpResponse(null, { status: 204 })))
    const store = useMizuhoClosingStore()

    await store.load()

    expect(store.status).toBeNull()
    expect(store.isEmpty).toBe(true)
  })

  it('[MCS-03] 500 なら error に理由が入り、空とはみなさない', async () => {
    server.use(
      http.get(STATUS_PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
    )
    const store = useMizuhoClosingStore()

    await store.load()

    expect(store.error?.message).toBe(ERROR_MESSAGE)
    expect(store.isEmpty).toBe(false)
  })

  it('[MCS-04] 応答待ちのあいだは loading が立ち、空とはみなさない', async () => {
    const gate = gated('get', STATUS_PATH, () => HttpResponse.json(mizuhoClosingStatus))
    const store = useMizuhoClosingStore()

    const pending = store.load()

    expect(store.loading).toBe(true)
    expect(store.isEmpty).toBe(false)

    await gate.release()
    await pending
    expect(store.loading).toBe(false)
  })

  it('[MCS-05] 締めると操作後の状態を返し、照会を読み直した状態（履歴付き）に差し替わる', async () => {
    const store = useMizuhoClosingStore()
    await store.load()
    let statusRequests = 0
    server.use(
      http.get(STATUS_PATH, () => {
        statusRequests += 1
      }),
    )

    const result = await store.close()

    expect(result.closed).toBe(true)
    expect(result.operator).toBe(USER_CODE)
    expect(statusRequests).toBe(1)
    expect(store.status.closed).toBe(true)
    expect(store.status.updatedAt).toEqual(expect.any(String))
    expect(store.status.operator).toBe(USER_CODE)
    expect(store.status.history).toHaveLength(mizuhoClosingStatus.history.length + 1)
    expect(store.status.history[0]).toMatchObject({ action: 'close', operator: USER_CODE })
    // 読み直しは裏で行うので、取得の loading / error は立たない
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('[MCS-06] 締め解除で受付中に戻り、更新日時は埋まったまま。履歴は新しい順に積まれる', async () => {
    const store = useMizuhoClosingStore()
    await store.load()
    await store.close()

    await store.reopen()

    expect(store.status.closed).toBe(false)
    expect(store.status.updatedAt).toEqual(expect.any(String))
    expect(store.status.history.map((entry) => entry.action)).toEqual(['reopen', 'close'])
  })

  it('[MCS-13] 締めのあとの読み直しが 500 でも、操作の応答の状態のままで error は立たない', async () => {
    const store = useMizuhoClosingStore()
    await store.load()
    server.use(
      http.get(STATUS_PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
    )

    const result = await store.close()

    expect(result.closed).toBe(true)
    expect(store.status).toEqual(result)
    expect(store.error).toBeNull()
    expect(store.saveError).toBeNull()
  })

  it('[MCS-07] 締めが 403 なら saveError に理由が入り、error と状態は変わらない', async () => {
    server.use(
      http.post(CLOSE_PATH, () =>
        HttpResponse.json({ detail: FORBIDDEN_MESSAGE }, { status: 403 }),
      ),
    )
    const store = useMizuhoClosingStore()
    await store.load()

    const result = await store.close()

    expect(result).toBeNull()
    expect(store.saveError?.message).toBe(FORBIDDEN_MESSAGE)
    expect(store.error).toBeNull()
    expect(store.status.closed).toBe(false)
  })

  it('[MCS-08] 締めの応答待ちのあいだは saving が立ち、取得の loading は立たない', async () => {
    const store = useMizuhoClosingStore()
    await store.load()
    const gate = gated('post', CLOSE_PATH, () =>
      HttpResponse.json({ ...mizuhoClosingStatus, 締め状態: 1 }),
    )

    const pending = store.close()

    expect(store.saving).toBe(true)
    expect(store.loading).toBe(false)

    await gate.release()
    await pending
    expect(store.saving).toBe(false)
  })

  it('[MCS-09] 注文ファイルは買い → 売りの順に 2 冊作る', async () => {
    const store = useMizuhoClosingStore()
    await store.close()
    const sides = recordExportSides()

    const { files, failedSide } = await store.createOrderFiles()

    expect(sides).toEqual(['buy', 'sell'])
    expect(failedSide).toBeNull()
    expect(files.map((file) => file.side)).toEqual(['buy', 'sell'])
    expect(files.map((file) => file.filename)).toEqual([
      `オーダーシート_${BASE_DATE}_BUY_US.xlsx`,
      `オーダーシート_${BASE_DATE}_SELL_US.xlsx`,
    ])
    expect(files.map((file) => file.exportedCount)).toEqual([
      exportedCountOf('3'),
      exportedCountOf('1'),
    ])
    expect(store.saveError).toBeNull()
  })

  it('[MCS-10] 売りだけ失敗したら、作れた買いの 1 冊と失敗した側を返す', async () => {
    const store = useMizuhoClosingStore()
    await store.close()
    server.use(
      http.get(EXPORT_PATH, ({ request }) => {
        if (new URL(request.url).searchParams.get('side') !== 'sell') return
        return HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })
      }),
    )

    const { files, failedSide } = await store.createOrderFiles()

    expect(files.map((file) => file.side)).toEqual(['buy'])
    expect(failedSide).toBe('sell')
    expect(store.saveError?.message).toBe(ERROR_MESSAGE)
  })

  it('[MCS-11] 締める前は買いの 400 で止まり、売りは要求しない', async () => {
    const store = useMizuhoClosingStore()
    const sides = recordExportSides()

    const { files, failedSide } = await store.createOrderFiles()

    expect(files).toEqual([])
    expect(failedSide).toBe('buy')
    expect(store.saveError?.message).toBe(NOT_CLOSED_MESSAGE)
    expect(sides).toEqual(['buy'])
  })

  it('[MCS-12] clearSaveError で操作の失敗を消す', async () => {
    server.use(
      http.post(CLOSE_PATH, () =>
        HttpResponse.json({ detail: FORBIDDEN_MESSAGE }, { status: 403 }),
      ),
    )
    const store = useMizuhoClosingStore()
    await store.close()
    expect(store.saveError).not.toBeNull()

    store.clearSaveError()

    expect(store.saveError).toBeNull()
  })
})
