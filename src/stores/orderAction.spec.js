import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { orderInquiryRows } from '@/mocks/fixtures/orderInquiry'
import { useOrderActionStore } from './orderAction'

/*
 * ストアのテスト。MSW の既定ハンドラ（handlers/orders.js）に当てて、対象注文・訂正・取消の
 * 3 系統の状態遷移を固定する。変換の中身は api 層の spec（OIA）が見る。
 */
const DETAIL = '*/api/orders/:orderId'
const AMEND = '*/api/orders/:orderId/amend'

const byId = (id) => orderInquiryRows.find((row) => row.ID === id)
// 状況ごとの対象注文（フィクスチャの並びが変わっても状況で引く）
const PENDING = byId(36) // 000 未発注
const WORKING = byId(34) // 003 注文中
const PARTIAL = byId(35) // 010 一部出来
const FILLED = byId(41) // 011 全部出来（訂正・取消できない）
const idOf = (row) => String(row.ID)
const MISSING_ID = String(Math.max(...orderInquiryRows.map((row) => row.ID)) + 100)

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/**
 * 指定のパスの応答を握るハンドラを立てる。解放すると respond の結果を返す
 * （respond が undefined を返すと既定のハンドラに流れる）。onlyId を渡すとその注文 ID だけ握る。
 *
 * @returns {() => void} 呼ぶと応答が返る
 */
function gate(method, path, { onlyId, respond = () => undefined } = {}) {
  let release
  const wait = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http[method](path, async ({ params }) => {
      if (onlyId && params.orderId !== onlyId) return undefined
      await wait
      return respond()
    }),
  )
  return release
}

const serverError = () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })

// シナリオ: docs/unit/stores-order-action.md
describe('useOrderActionStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('[OAS-01] load で注文 ID と詳細が入る', async () => {
    const store = useOrderActionStore()

    await store.load(idOf(PARTIAL))

    expect(store.orderId).toBe(idOf(PARTIAL))
    expect(store.order.id).toBe(idOf(PARTIAL))
    expect(store.order.filledQuantity).toBe(PARTIAL.出来数量)
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('[OAS-02] 応答までは loading が true で order は null', async () => {
    const release = gate('get', DETAIL)
    const store = useOrderActionStore()

    const pending = store.load(idOf(PARTIAL))

    expect(store.loading).toBe(true)
    expect(store.order).toBeNull()

    release()
    await pending
    expect(store.loading).toBe(false)
  })

  it('[OAS-03] 無い注文は error.status が 404 で order は null', async () => {
    const store = useOrderActionStore()

    await store.load(MISSING_ID)

    expect(store.error.status).toBe(404)
    expect(store.order).toBeNull()
  })

  it('[OAS-04] 失敗のあと reload で同じ注文を読み直す', async () => {
    server.use(http.get(DETAIL, serverError))
    const store = useOrderActionStore()

    await store.load(idOf(PARTIAL))
    expect(store.error.message).toBe(ERROR_MESSAGE)

    server.resetHandlers()
    await store.reload()

    expect(store.order.id).toBe(idOf(PARTIAL))
    expect(store.error).toBeNull()
  })

  it('[OAS-05] load は前の注文と結果・失敗を消してから読む', async () => {
    const store = useOrderActionStore()
    await store.load(idOf(PENDING))
    await store.amend({ quantity: PENDING.数量 + 5 })
    expect(store.amendResult).not.toBeNull()

    const pending = store.load(idOf(WORKING))

    expect(store.order).toBeNull()
    expect(store.amendResult).toBeNull()
    expect(store.amendError).toBeNull()
    expect(store.cancelResult).toBeNull()
    expect(store.cancelError).toBeNull()

    await pending
    expect(store.order.id).toBe(idOf(WORKING))
  })

  it('[OAS-06] 古い注文の応答で新しい注文を上書きしない', async () => {
    const release = gate('get', DETAIL, { onlyId: idOf(PARTIAL) })
    const store = useOrderActionStore()

    const stale = store.load(idOf(PARTIAL))
    await store.load(idOf(PENDING))
    expect(store.order.id).toBe(idOf(PENDING))

    release()
    await stale

    expect(store.order.id).toBe(idOf(PENDING))
    expect(store.orderId).toBe(idOf(PENDING))
  })

  it('[OAS-07] amend はいまの注文を訂正し結果が入る', async () => {
    const store = useOrderActionStore()
    await store.load(idOf(PENDING))

    await store.amend({ quantity: PENDING.数量 + 5 })

    expect(store.amendResult).toMatchObject({ mode: 'inPlace', originalOrderId: idOf(PENDING) })
    expect(store.amending).toBe(false)
    expect(store.amendError).toBeNull()
  })

  it('[OAS-08] 訂正の応答までは amending が true で order は残る', async () => {
    const store = useOrderActionStore()
    await store.load(idOf(PENDING))
    const release = gate('post', AMEND)

    const pending = store.amend({ quantity: PENDING.数量 + 5 })

    expect(store.amending).toBe(true)
    expect(store.order.id).toBe(idOf(PENDING))

    release()
    await pending
    expect(store.amending).toBe(false)
  })

  it('[OAS-09] 訂正できない注文は amendError に理由が入り order は残る', async () => {
    const store = useOrderActionStore()
    await store.load(idOf(FILLED))

    await store.amend({ quantity: 1 })

    expect(store.amendError.message).toBe(`この注文は訂正できません（処理状況: ${FILLED.処理状況}）`)
    expect(store.amendResult).toBeNull()
    expect(store.order.id).toBe(idOf(FILLED))
  })

  it('[OAS-10] cancel はいまの注文を取り消し結果が入る', async () => {
    const store = useOrderActionStore()
    await store.load(idOf(PENDING))

    await store.cancel()

    expect(store.cancelResult).toEqual({
      orderId: idOf(PENDING),
      message: `注文を取り消しました（注文ID: ${PENDING.ID}）`,
      warnings: [],
    })
    expect(store.canceling).toBe(false)
  })

  it('[OAS-11] 取消できない注文は cancelError に理由が入り order は残る', async () => {
    const store = useOrderActionStore()
    await store.load(idOf(FILLED))

    await store.cancel()

    expect(store.cancelError.message).toBe(`この注文は取消できません（処理状況: ${FILLED.処理状況}）`)
    expect(store.cancelResult).toBeNull()
    expect(store.order.id).toBe(idOf(FILLED))
  })

  it('[OAS-12] 古い注文の失敗で新しい注文をエラー表示にしない', async () => {
    const release = gate('get', DETAIL, { onlyId: idOf(PARTIAL), respond: serverError })
    const store = useOrderActionStore()

    const stale = store.load(idOf(PARTIAL))
    await store.load(idOf(PENDING))
    expect(store.order.id).toBe(idOf(PENDING))

    release()
    await stale

    expect(store.order.id).toBe(idOf(PENDING))
    expect(store.error).toBeNull()
  })
})
