import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { orderInquiryRows } from '@/mocks/fixtures/orderInquiry'
import { useOrderInquiryStore } from './orderInquiry'
import { CUSTOMER_ORDERS_PAGE_SIZE, useCustomerOrdersStore } from './customerOrders'

/*
 * MSW の既定ハンドラ（GET /orders）に当てる。期待値はフィクスチャから導く。
 * 行は元注文ごとにまとまる（stores/orderInquiry.spec.js と同じ導きかた）。
 */

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const rootOf = (row) => String(row.元注文ID ?? row.ID)
/** 行の集合を元注文ごとにまとめたときの id（サーバは ID の降順で返す） */
const groupIds = (rows) => [...new Set([...rows].sort((a, b) => b.ID - a.ID).map(rootOf))]
const idsOf = (store) => store.items.map((group) => group.id)

/** 注文の最も多い口座の注文（顧客詳細で開く顧客の代わり） */
const accountOf = (row) => `${row.部店}:${row.口座番号}`
const counts = orderInquiryRows.reduce(
  (map, row) => map.set(accountOf(row), (map.get(accountOf(row)) ?? 0) + 1),
  new Map(),
)
const [busiestKey] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
const customerRows = orderInquiryRows.filter((row) => accountOf(row) === busiestKey)
const CUSTOMER = {
  branchCode: customerRows[0].部店,
  accountNumber: String(customerRows[0].口座番号),
}

/** 注文の無い口座番号 */
const NO_ORDER_ACCOUNT = String(Math.max(...orderInquiryRows.map((row) => row.口座番号)) + 1)

// シナリオ: docs/unit/stores-customer-orders.md
describe('stores/customerOrders', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[COR-01] 部店と口座番号を固定するとその顧客の注文だけが入る', async () => {
    const store = useCustomerOrdersStore()

    await store.load(CUSTOMER)

    expect(idsOf(store)).toEqual(groupIds(customerRows))
    expect(store.total).toBe(customerRows.length)
    expect(store.branchCode).toBe(CUSTOMER.branchCode)
    expect(store.accountNumber).toBe(CUSTOMER.accountNumber)
    // ほかの口座の注文も入っていなければ、固定の効き目を確かめられない
    expect(customerRows.length).toBeLessThan(orderInquiryRows.length)
  })

  it('[COR-02] 銘柄と出来状況を足すと 4 条件がすべて効く', async () => {
    const target = customerRows[0]
    const symbol = target.Ticker ?? target.銘柄コード
    const upper = symbol.toUpperCase()
    const expected = customerRows.filter(
      (row) =>
        (row.銘柄コード.toUpperCase().includes(upper) ||
          (row.Ticker ?? '').toUpperCase().includes(upper)) &&
        row.処理状況 === target.処理状況,
    )
    const store = useCustomerOrdersStore()

    await store.load({ ...CUSTOMER, symbol, executionStatus: target.処理状況 })

    expect(store.symbol).toBe(symbol)
    expect(store.executionStatus).toBe(target.処理状況)
    expect(store.total).toBe(expected.length)
    /*
     * 処理状況で絞ると親の無いスライス子注文が 1 件ずつの行になる（api/orderInquiry.js の groupOrders）ので、
     * 行の id ではなく、行が持つ注文の ID の集合で突き合わせる
     */
    const orderIds = store.items
      .flatMap((group) => [group.latest, ...group.history, ...group.slices])
      .map((order) => order.id)
    expect(orderIds.sort()).toEqual(expected.map((row) => String(row.ID)).sort())
  })

  it('[COR-03] 注文照会のストアと条件・結果が混ざらない', async () => {
    const inquiry = useOrderInquiryStore()
    const orders = useCustomerOrdersStore()

    await inquiry.load()
    await orders.load(CUSTOMER)

    expect(inquiry.branchCode).toBe('')
    expect(inquiry.accountNumber).toBe('')
    expect(inquiry.total).toBe(orderInquiryRows.length)
    expect(orders.total).toBe(customerRows.length)
    expect(idsOf(orders)).toEqual(groupIds(customerRows))
  })

  it('[COR-04] 登録・更新・削除を公開しない（読むだけの一覧）', () => {
    const store = useCustomerOrdersStore()

    for (const name of ['create', 'update', 'remove', 'creating', 'updating', 'deleting']) {
      expect(store[name], name).toBeUndefined()
    }
  })

  it('[COR-05] 取得に失敗したときは error に入り、空状態にはしない', async () => {
    server.use(
      http.get('*/api/orders', () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
    )
    const store = useCustomerOrdersStore()

    await store.load(CUSTOMER)

    expect(store.error?.message).toBe(ERROR_MESSAGE)
    expect(store.items).toEqual([])
    expect(store.isEmpty).toBe(false)
  })

  it('[COR-06] 注文の無い口座は空とみなす', async () => {
    const store = useCustomerOrdersStore()

    await store.load({ ...CUSTOMER, accountNumber: NO_ORDER_ACCOUNT })

    expect(store.items).toEqual([])
    expect(store.total).toBe(0)
    expect(store.isEmpty).toBe(true)
  })

  it('[COR-07] 1 ページの件数は CUSTOMER_ORDERS_PAGE_SIZE', () => {
    expect(useCustomerOrdersStore().limit).toBe(CUSTOMER_ORDERS_PAGE_SIZE)
  })
})
