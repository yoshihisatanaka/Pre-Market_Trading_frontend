import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { customers } from '@/mocks/fixtures/customers'
import { useCustomersStore } from './customers'
import { CUSTOMER_SEARCH_PAGE_SIZE, useCustomerSearchStore } from './customerSearch'

/*
 * 既定の MSW ハンドラ（実 API と同じ絞り込み・並び順）に当てる。
 * 期待値はフィクスチャと表示件数から導く。
 */

const PAGE_SIZE = CUSTOMER_SEARCH_PAGE_SIZE
const TOTAL = customers.length

/** 実 API と同じ並び（口座番号の昇順） */
const sorted = [...customers].sort((a, b) => a.口座番号 - b.口座番号)
const expectedNumbers = sorted.map((row) => String(row.口座番号))
const head = sorted[0]

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const numbersOf = (store) => store.items.map((item) => item.accountNumber)

// シナリオ: docs/unit/stores-customer-search.md
describe('stores/customerSearch', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[CSS-01] 既定の読み込みで 1 ページ目が口座番号の昇順で入る', async () => {
    const store = useCustomerSearchStore()

    await store.load()

    expect(store.limit).toBe(PAGE_SIZE)
    expect(store.offset).toBe(0)
    expect(store.total).toBe(TOTAL)
    expect(numbersOf(store)).toEqual(expectedNumbers.slice(0, PAGE_SIZE))
  })

  it('[CSS-02] 部店・扱者・口座番号・顧客名の 4 条件で絞り込み、条件が残る', async () => {
    const filters = {
      branchCode: head.部店コード,
      handlerCode: head.扱者コード,
      accountNumber: String(head.口座番号),
      customerName: head.顧客名,
    }
    const store = useCustomerSearchStore()

    await store.load(filters)

    expect(numbersOf(store)).toEqual([String(head.口座番号)])
    expect(store.branchCode).toBe(filters.branchCode)
    expect(store.handlerCode).toBe(filters.handlerCode)
    expect(store.accountNumber).toBe(filters.accountNumber)
    expect(store.customerName).toBe(filters.customerName)
  })

  it('[CSS-03] 条件を渡さずに読み直すと前の条件は残らない', async () => {
    const store = useCustomerSearchStore()
    await store.load({ branchCode: head.部店コード, customerName: head.顧客名 })

    await store.load()

    expect(store.branchCode).toBe('')
    expect(store.customerName).toBe('')
    expect(store.total).toBe(TOTAL)
    expect(numbersOf(store)).toEqual(expectedNumbers.slice(0, PAGE_SIZE))
  })

  it('[CSS-04] 該当が無いときは空とみなす', async () => {
    const store = useCustomerSearchStore()

    await store.load({ customerName: '該当なし' })

    expect(store.items).toEqual([])
    expect(store.total).toBe(0)
    expect(store.isEmpty).toBe(true)
  })

  it('[CSS-05] 取得に失敗したときは error に入り、空状態にはしない', async () => {
    server.use(
      http.get('*/api/masters/customers', () =>
        HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
      ),
    )
    const store = useCustomerSearchStore()

    await store.load()

    expect(store.error?.message).toBe(ERROR_MESSAGE)
    expect(store.items).toEqual([])
    expect(store.isEmpty).toBe(false)
  })

  it('[CSS-06] 登録・更新・削除を公開しない（読むだけの一覧）', () => {
    const store = useCustomerSearchStore()

    for (const name of [
      'create',
      'creating',
      'createError',
      'update',
      'updating',
      'updateError',
      'remove',
      'deleting',
      'deleteError',
    ]) {
      expect(store[name], name).toBeUndefined()
    }
  })

  it('[CSS-07] 顧客マスタのストアと条件・ページ位置・結果が混ざらない', async () => {
    const master = useCustomersStore()
    const search = useCustomerSearchStore()

    await master.load({ branchCode: head.部店コード })
    await search.load({ offset: PAGE_SIZE })

    expect(master.branchCode).toBe(head.部店コード)
    expect(master.offset).toBe(0)
    expect(numbersOf(master)).toEqual(
      expectedNumbers
        .filter((_, i) => sorted[i].部店コード === head.部店コード)
        .slice(0, PAGE_SIZE),
    )

    expect(search.branchCode).toBe('')
    expect(search.offset).toBe(PAGE_SIZE)
    expect(numbersOf(search)).toEqual(expectedNumbers.slice(PAGE_SIZE, PAGE_SIZE * 2))
    // 全件が 1 ページに収まっていたら、このシナリオは意味を失う
    expect(search.items.length).toBeGreaterThan(0)
  })
})
