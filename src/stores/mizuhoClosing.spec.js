import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { mizuhoClosingStatus } from '@/mocks/fixtures/closing'
import { useMizuhoClosingStore } from './mizuhoClosing'

/*
 * 既定の MSW ハンドラ（src/mocks/handlers/closing.js）に当てる。
 */
const STATUS_PATH = '*/api/closing/status'
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 応答を release() まで止めるハンドラ */
function gatedStatus() {
  let open = null
  server.use(
    http.get(STATUS_PATH, async () => {
      await new Promise((resolve) => (open = resolve))
      return HttpResponse.json(mizuhoClosingStatus)
    }),
  )
  return {
    async release() {
      await vi.waitFor(() => expect(open).toBeTypeOf('function'))
      open()
    },
  }
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
    const gate = gatedStatus()
    const store = useMizuhoClosingStore()

    const pending = store.load()

    expect(store.loading).toBe(true)
    expect(store.isEmpty).toBe(false)

    await gate.release()
    await pending
    expect(store.loading).toBe(false)
  })
})
