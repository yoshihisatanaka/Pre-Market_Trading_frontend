import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { orderInquiryRows } from '@/mocks/fixtures/orderInquiry'
import { useOrderInquiryStore } from './orderInquiry'

/*
 * ストアのテスト。MSW の既定ハンドラに当てて、取得・絞り込みと 4 状態のもとになる値を固定する。
 * 期待値はフィクスチャ（バックエンドの生の形）から導く。
 */
const rootOf = (row) => String(row.元注文ID ?? row.ID)
/** 行の集合を元注文ごとにまとめたときの id（最初に現れた順。サーバは ID の降順で返す） */
const groupIds = (rows) => [
  ...new Set([...rows].sort((a, b) => b.ID - a.ID).map(rootOf)),
]

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

// シナリオ: docs/unit/stores-order-inquiry.md
describe('useOrderInquiryStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('[OIS-01] load で元注文ごとの行と注文の行数が入る', async () => {
    const store = useOrderInquiryStore()

    await store.load()

    expect(store.items.map((group) => group.id)).toEqual(groupIds(orderInquiryRows))
    expect(store.total).toBe(orderInquiryRows.length)
  })

  it('[OIS-02] 部店で絞り込むとその部店の行だけになり条件が残る', async () => {
    const BRANCH = '123'
    const inBranch = orderInquiryRows.filter((row) => row.部店 === BRANCH)
    const store = useOrderInquiryStore()

    await store.load({ branchCode: BRANCH })

    expect(store.items.map((group) => group.id)).toEqual(groupIds(inBranch))
    expect(store.items.map((group) => group.id)).toEqual(['38', '41'])
    expect(store.total).toBe(inBranch.length)
    expect(store.branchCode).toBe(BRANCH)
  })

  it('[OIS-03] 取得が 500 なら error に理由が入り items は空で loading が戻る', async () => {
    server.use(
      http.get('*/api/orders', () =>
        HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
      ),
    )
    const store = useOrderInquiryStore()

    await store.load()

    expect(store.error.message).toBe(ERROR_MESSAGE)
    expect(store.items).toEqual([])
    expect(store.loading).toBe(false)
  })

  it('[OIS-04] 0 件なら isEmpty が true', async () => {
    server.use(http.get('*/api/orders', () => HttpResponse.json({ orders: [], total: 0 })))
    const store = useOrderInquiryStore()

    await store.load()

    expect(store.isEmpty).toBe(true)
  })

  it('[OIS-05] 出来状況「注文中」で処理状況 003 の行だけに絞り込まれる', async () => {
    const working = orderInquiryRows.filter((row) => row.処理状況 === '003')
    const store = useOrderInquiryStore()

    await store.load({ executionStatus: '注文中' })

    expect(store.executionStatus).toBe('注文中')
    expect(store.total).toBe(working.length)
    expect(store.items.map((group) => group.latest.id)).toEqual(
      [...working].sort((a, b) => b.ID - a.ID).map((row) => String(row.ID)),
    )
  })

  it('[OIS-06] 登録・更新・削除は公開しない', () => {
    const store = useOrderInquiryStore()

    expect(store.create).toBeUndefined()
    expect(store.update).toBeUndefined()
    expect(store.remove).toBeUndefined()
  })
})
