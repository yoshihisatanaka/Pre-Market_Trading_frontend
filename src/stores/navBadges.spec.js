import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { dreamOrders } from '@/mocks/fixtures/dreamStatus'
import { orderInquiryRows } from '@/mocks/fixtures/orderInquiry'
import { useNavBadgesStore } from './navBadges'

/*
 * 既定の MSW ハンドラ（GET /orders の status 絞り込み・GET /orders/dream-status の擬似コード ERROR）に当てる。
 * 期待値はフィクスチャから導き、件数を直接書かない。
 */

const ORDERS_PATH = '*/api/orders'
const DREAM_PATH = '*/api/orders/dream-status'

/** 注文照会を出来状況「注文エラー」で絞ったときの件数（処理状況 101 / 103） */
const ORDER_ERRORS = orderInquiryRows.filter((row) => ['101', '103'].includes(row.処理状況)).length
/** Dream登録状況を「エラー」で絞ったときの件数（登録失敗 9 / 取消失敗 C9） */
const DREAM_ERRORS = dreamOrders.filter((row) => ['9', 'C9'].includes(row.Dream状況)).length

const fail = (path) =>
  http.get(path, () => HttpResponse.json({ detail: 'サーバーでエラーが発生しました。' }, { status: 500 }))

// シナリオ: docs/unit/stores-nav-badges.md
describe('stores/navBadges', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[NBS-01] 読み込む前の件数はどちらも null', () => {
    const store = useNavBadgesStore()

    expect(store.counts).toEqual({ orderErrors: null, dreamErrors: null })
  })

  it('[NBS-02] load で注文エラーと Dream登録エラーの件数が入る', async () => {
    // 0 件のフィクスチャだと「入った」と「0 のまま」を見分けられない
    expect(ORDER_ERRORS).toBeGreaterThan(0)
    expect(DREAM_ERRORS).toBeGreaterThan(0)
    const store = useNavBadgesStore()

    await store.load()

    expect(store.counts).toEqual({ orderErrors: ORDER_ERRORS, dreamErrors: DREAM_ERRORS })
  })

  it('[NBS-03] 注文の件数だけが失敗しても Dream の件数は入る', async () => {
    server.use(fail(ORDERS_PATH))
    const store = useNavBadgesStore()

    await expect(store.load()).resolves.toBeDefined()

    expect(store.counts).toEqual({ orderErrors: null, dreamErrors: DREAM_ERRORS })
  })

  it('[NBS-04] Dream の件数だけが失敗しても注文の件数は入る', async () => {
    server.use(fail(DREAM_PATH))
    const store = useNavBadgesStore()

    await expect(store.load()).resolves.toBeDefined()

    expect(store.counts).toEqual({ orderErrors: ORDER_ERRORS, dreamErrors: null })
  })

  it('[NBS-05] 取り直しに失敗しても前の件数を保つ', async () => {
    const store = useNavBadgesStore()
    await store.load()
    const before = { ...store.counts }

    server.use(fail(ORDERS_PATH), fail(DREAM_PATH))
    await store.load()

    expect(before).toEqual({ orderErrors: ORDER_ERRORS, dreamErrors: DREAM_ERRORS })
    expect(store.counts).toEqual(before)
  })
})
