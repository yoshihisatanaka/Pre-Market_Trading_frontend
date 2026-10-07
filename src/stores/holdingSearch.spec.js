import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { customers } from '@/mocks/fixtures/customers'
import { holdings } from '@/mocks/fixtures/holdings'
import { HOLDING_SEARCH_PAGE_SIZE, useHoldingSearchStore } from './holdingSearch'

/*
 * 既定の MSW ハンドラ（src/mocks/handlers/holdings.js / customers.js）に当てる。
 * 期待値はフィクスチャと表示件数から導く。
 */
const HOLDINGS = '*/api/holdings'
const CUSTOMERS = '*/api/masters/customers'

const PAGE_SIZE = HOLDING_SEARCH_PAGE_SIZE
const TOTAL = holdings.length
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** api 層が付ける行キー（明細の行 ID） */
const keyOf = (row) => String(row.ID)
const idsOf = (store) => store.items.map((item) => item.id)

const head = holdings[0]
/** 口座ID の無い明細（顧客マスタを引き直す道を通る） */
const headHolding = { branchCode: head.部店コード, accountNumber: String(head.口座番号) }
const headCustomer = customers.find(
  (row) => row.口座番号 === head.口座番号 && row.部店コード === head.部店コード,
)

/** 送られたリクエストのクエリを控える（応答は既定ハンドラに任せる） */
function recordQueries(path) {
  const queries = []
  server.use(
    http.get(path, ({ request }) => {
      queries.push(new URL(request.url).searchParams)
    }),
  )
  return queries
}

/** 指定のパスの応答を握る。解放すると既定のハンドラに流れる */
function gate(path) {
  let release
  const wait = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http.get(path, async () => {
      await wait
      return undefined
    }),
  )
  return release
}

// シナリオ: docs/unit/stores-holding-search.md
describe('stores/holdingSearch', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[HSS-01] 既定の読み込みで 1 ページ目と全件数が入る', async () => {
    const store = useHoldingSearchStore()

    await store.load()

    expect(store.limit).toBe(PAGE_SIZE)
    expect(store.offset).toBe(0)
    expect(store.total).toBe(TOTAL)
    expect(idsOf(store)).toEqual(holdings.slice(0, PAGE_SIZE).map(keyOf))
  })

  it('[HSS-02] offset を渡すと 2 ページ目の行が入り offset が写される', async () => {
    const secondPage = holdings.slice(PAGE_SIZE, PAGE_SIZE * 2)
    expect(secondPage.length).toBeGreaterThan(0)
    const store = useHoldingSearchStore()

    await store.load({ offset: PAGE_SIZE })

    expect(store.offset).toBe(PAGE_SIZE)
    expect(store.total).toBe(TOTAL)
    expect(idsOf(store)).toEqual(secondPage.map(keyOf))
  })

  it('[HSS-03] 部店と預り区分で絞り込み、条件が ref に写される', async () => {
    const branchCode = '345'
    const specificDeposit = '1'
    const expected = holdings.filter(
      (row) => row.部店コード === branchCode && row.預り売買区分 === specificDeposit,
    )
    expect(expected.length).toBeGreaterThan(0)
    expect(expected.length).toBeLessThan(TOTAL)
    const store = useHoldingSearchStore()

    await store.load({ branchCode, specificDeposit })

    expect(store.total).toBe(expected.length)
    expect(idsOf(store)).toEqual(expected.slice(0, PAGE_SIZE).map(keyOf))
    expect(store.branchCode).toBe(branchCode)
    expect(store.specificDeposit).toBe(specificDeposit)
  })

  it('[HSS-04] filterKeys に無いキーは無視され、API へも送られない', async () => {
    const branchCode = head.部店コード
    const expected = holdings.filter((row) => row.部店コード === branchCode)
    const queries = recordQueries(HOLDINGS)
    const store = useHoldingSearchStore()

    await store.load({ offset: 0, unknownKey: 'x', branchCode })

    expect(store.error).toBeNull()
    expect(store.total).toBe(expected.length)
    expect(idsOf(store)).toEqual(expected.slice(0, PAGE_SIZE).map(keyOf))
    expect(queries).toHaveLength(1)
    expect(queries[0].get('branch_code')).toBe(branchCode)
    expect(queries[0].has('unknownKey')).toBe(false)
    expect(queries[0].has('unknown_key')).toBe(false)
  })

  it('[HSS-05] 取得に失敗したときは error に理由が入り、items は空のまま', async () => {
    server.use(
      http.get(HOLDINGS, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
    )
    const store = useHoldingSearchStore()

    await store.load()

    expect(store.error?.message).toBe(ERROR_MESSAGE)
    expect(store.items).toEqual([])
    expect(store.loading).toBe(false)
  })

  it('[HSS-06] 0 件の応答は空とみなす', async () => {
    server.use(
      http.get(HOLDINGS, () =>
        HttpResponse.json({ total: 0, limit: PAGE_SIZE, offset: 0, holdings: [] }),
      ),
    )
    const store = useHoldingSearchStore()

    await store.load()

    expect(store.isEmpty).toBe(true)
  })

  it('[HSS-12] 明細に customerId があれば顧客マスタを引かずにそれを返す', async () => {
    const queries = recordQueries(CUSTOMERS)
    const store = useHoldingSearchStore()
    const customerId = String(head.口座ID)

    const pending = store.openCustomer({ ...headHolding, customerId })
    expect(store.customerLookupPending).toBe(false)
    const id = await pending

    expect(id).toBe(customerId)
    expect(queries).toHaveLength(0)
    expect(store.customerLookupError).toBeNull()
  })

  it('[HSS-07] 口座ID の無い明細は部店・口座番号で顧客マスタを引き、その顧客の ID を返す', async () => {
    expect(headCustomer).toBeTruthy()
    const queries = recordQueries(CUSTOMERS)
    const store = useHoldingSearchStore()

    const id = await store.openCustomer(headHolding)

    expect(id).toBe(String(headCustomer.ID))
    expect(queries).toHaveLength(1)
    expect(queries[0].get('branch_code')).toBe(headHolding.branchCode)
    expect(queries[0].get('account_no')).toBe(headHolding.accountNumber)
    expect(store.customerLookupError).toBeNull()
  })

  it('[HSS-08] 部店コードが空の明細は口座番号だけで引く', async () => {
    const queries = recordQueries(CUSTOMERS)
    const store = useHoldingSearchStore()

    const id = await store.openCustomer({
      branchCode: '',
      accountNumber: headHolding.accountNumber,
    })

    expect(id).toBe(String(headCustomer.ID))
    expect(queries).toHaveLength(1)
    expect(queries[0].has('branch_code')).toBe(false)
    expect(queries[0].get('account_no')).toBe(headHolding.accountNumber)
  })

  it('[HSS-09] 別の口座番号の行しか返らないときは null と理由を返す', async () => {
    const other = customers.find((row) => row.口座番号 !== head.口座番号)
    server.use(
      http.get(CUSTOMERS, () =>
        HttpResponse.json({ total: 1, limit: 10, offset: 0, customers: [other] }),
      ),
    )
    const store = useHoldingSearchStore()

    const id = await store.openCustomer(headHolding)

    expect(id).toBeNull()
    expect(store.customerLookupError?.message).toBe(
      `口座番号 ${headHolding.accountNumber} の顧客が顧客マスタに見つかりません。`,
    )
  })

  it('[HSS-10] 顧客マスタが 500 のときは null とサーバの理由。clear で消える', async () => {
    server.use(
      http.get(CUSTOMERS, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
    )
    const store = useHoldingSearchStore()

    const id = await store.openCustomer(headHolding)

    expect(id).toBeNull()
    expect(store.customerLookupError?.message).toBe(ERROR_MESSAGE)

    store.clearCustomerLookupError()
    expect(store.customerLookupError).toBeNull()
  })

  it('[HSS-11] 顧客を引いているあいだだけ customerLookupPending が true', async () => {
    const release = gate(CUSTOMERS)
    const store = useHoldingSearchStore()

    const pending = store.openCustomer(headHolding)
    expect(store.customerLookupPending).toBe(true)

    release()
    await pending
    expect(store.customerLookupPending).toBe(false)
  })
})
