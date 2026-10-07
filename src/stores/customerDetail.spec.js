import { beforeEach, describe, expect, it } from 'vitest'
import { watch } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { customers } from '@/mocks/fixtures/customers'
import { holdings } from '@/mocks/fixtures/holdings'
import { CUSTOMER_HOLDINGS_LIMIT, useCustomerDetailStore } from './customerDetail'

/*
 * 既定の MSW ハンドラ（顧客 1 件・預り検索）に当てる。応答の遅延や失敗が要るときだけ server.use で差し替える。
 * 使う顧客と期待値はフィクスチャから導く（口座番号や件数を直接書かない）。
 */

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const holdingsOf = (accountNo) => holdings.filter((row) => row.口座番号 === accountNo)

/** CA 発生中の明細を持つ顧客 */
const CA_CUSTOMER = customers.find((row) => holdingsOf(row.口座番号).some((h) => h.CA))
/** 預りはあるが CA の無い顧客 */
const PLAIN_CUSTOMER = customers.find((row) => {
  const rows = holdingsOf(row.口座番号)
  return rows.length > 0 && rows.every((h) => !h.CA)
})
/** 預りの無い顧客 */
const EMPTY_CUSTOMER = customers.find((row) => holdingsOf(row.口座番号).length === 0)
// 3 種のどれかがフィクスチャから消えたら、シナリオが意味を失うので読み込みの時点で落とす
if (!CA_CUSTOMER || !PLAIN_CUSTOMER || !EMPTY_CUSTOMER) {
  throw new Error(
    'customerDetail.spec: フィクスチャに CA あり / CA なし / 預りなし の顧客が揃っていない',
  )
}

/** フィクスチャに無い行 ID */
const MISSING_ID = String(Math.max(...customers.map((row) => row.ID)) + 1)

const idOf = (customer) => String(customer.ID)
/** 預りの行キー（口座番号:銘柄コード:預り売買区分。src/api/holdings.js の Holding の id） */
const holdingIdsOf = (customer) =>
  holdingsOf(customer.口座番号).map((h) => String(h.ID))
const sumOf = (rows, key) => rows.reduce((total, row) => total + row[key], 0)

/** 顧客 1 件の応答を差し替える。respond は行 ID を受けて Response を返す */
function customerHandler(respond) {
  server.use(http.get('*/api/masters/customers/:id', ({ params }) => respond(params.id)))
}

/** 顧客 1 件の正常応答（フィクスチャの行） */
const customerResponse = (id) =>
  HttpResponse.json({ account: customers.find((row) => row.ID === Number(id)) })

/**
 * 預りの応答を差し替える。
 *
 * @param {{ wait?: number, rowsFor?: (rows: object[]) => object[], totalFor?: (rows: object[]) => number,
 *   onRequest?: (params: URLSearchParams) => void }} [options]
 */
function holdingsHandler({ wait = 0, rowsFor = (rows) => rows, totalFor, onRequest } = {}) {
  server.use(
    http.get('*/api/holdings', async ({ request }) => {
      const params = new URL(request.url).searchParams
      onRequest?.(params)
      if (wait) await delay(wait)
      const rows = rowsFor(holdingsOf(Number(params.get('account_no'))))
      return HttpResponse.json({ total: totalFor ? totalFor(rows) : rows.length, holdings: rows })
    }),
  )
}

async function loadedStore(customer) {
  const store = useCustomerDetailStore()
  await store.load(idOf(customer))
  return store
}

// シナリオ: docs/unit/stores-customer-detail.md
describe('stores/customerDetail', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[CDE-01] 顧客とその口座の預りを読む', async () => {
    const store = await loadedStore(CA_CUSTOMER)

    expect(store.customer).toMatchObject({
      id: idOf(CA_CUSTOMER),
      accountNumber: String(CA_CUSTOMER.口座番号),
    })
    expect(store.holdings.map((h) => h.id)).toEqual(holdingIdsOf(CA_CUSTOMER))
    expect(store.holdingsTotal).toBe(holdingsOf(CA_CUSTOMER.口座番号).length)
    expect(store.holdingsPending).toBe(false)
    expect(store.holdingsEmpty).toBe(false)
  })

  it('[CDE-02] 預りは顧客の部店・口座番号と上限件数で読む', async () => {
    let seen = null
    holdingsHandler({ onRequest: (params) => (seen = params) })

    await loadedStore(CA_CUSTOMER)

    expect(seen.get('branch_code')).toBe(CA_CUSTOMER.部店コード)
    expect(seen.get('account_no')).toBe(String(CA_CUSTOMER.口座番号))
    expect(seen.get('limit')).toBe(String(CUSTOMER_HOLDINGS_LIMIT))
  })

  it('[CDE-03] 顧客が 404 なら customerNotFound が立ち、預りは読まない', async () => {
    let holdingRequests = 0
    holdingsHandler({ onRequest: () => (holdingRequests += 1) })
    const store = useCustomerDetailStore()

    await store.load(MISSING_ID)

    expect(store.customerNotFound).toBe(true)
    expect(store.customer).toBeNull()
    expect(holdingRequests).toBe(0)
  })

  it('[CDE-04] 顧客が 500 なら customerError に入り、見つからない扱いにはしない', async () => {
    customerHandler(() => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }))
    const store = useCustomerDetailStore()

    await store.load(idOf(CA_CUSTOMER))

    expect(store.customerError?.message).toBe(ERROR_MESSAGE)
    expect(store.customerNotFound).toBe(false)
  })

  it('[CDE-05] 預りが失敗しても顧客は残る', async () => {
    server.use(
      http.get('*/api/holdings', () =>
        HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
      ),
    )

    const store = await loadedStore(CA_CUSTOMER)

    expect(store.customer?.id).toBe(idOf(CA_CUSTOMER))
    expect(store.holdingsError?.message).toBe(ERROR_MESSAGE)
    expect(store.holdingsPending).toBe(false)
    expect(store.holdingsEmpty).toBe(false)
    expect(store.valuation).toBeNull()
  })

  it('[CDE-06] reloadHoldings で預りだけを読み直す', async () => {
    server.use(
      http.get('*/api/holdings', () =>
        HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
      ),
    )
    const store = await loadedStore(CA_CUSTOMER)
    expect(store.holdingsError).toBeTruthy()

    server.resetHandlers()
    await store.reloadHoldings()

    expect(store.holdingsError).toBeNull()
    expect(store.holdings.map((h) => h.id)).toEqual(holdingIdsOf(CA_CUSTOMER))
  })

  it('[CDE-07] 顧客を読む前の reloadHoldings は何もしない', async () => {
    let holdingRequests = 0
    holdingsHandler({ onRequest: () => (holdingRequests += 1) })
    const store = useCustomerDetailStore()

    const result = store.reloadHoldings()

    expect(result).toBeNull()
    expect(holdingRequests).toBe(0)
  })

  it('[CDE-08] 別の顧客を読み始めたら前の顧客の値を即座に捨てる', async () => {
    const store = await loadedStore(CA_CUSTOMER)

    const pending = store.load(idOf(PLAIN_CUSTOMER))

    expect(store.customer).toBeNull()
    expect(store.holdings).toEqual([])
    expect(store.valuation).toBeNull()

    await pending
    expect(store.customer?.id).toBe(idOf(PLAIN_CUSTOMER))
  })

  it('[CDE-09] 同じ顧客の読み直しは値を残したまま読む', async () => {
    const store = await loadedStore(CA_CUSTOMER)

    const pending = store.load(idOf(CA_CUSTOMER))

    expect(store.customer?.id).toBe(idOf(CA_CUSTOMER))
    expect(store.holdings.map((h) => h.id)).toEqual(holdingIdsOf(CA_CUSTOMER))

    await pending
    expect(store.customer?.id).toBe(idOf(CA_CUSTOMER))
    expect(store.holdings.map((h) => h.id)).toEqual(holdingIdsOf(CA_CUSTOMER))
  })

  it('[CDE-10] 古い load の結果が新しい結果を上書きしない', async () => {
    customerHandler(async (id) => {
      await delay(id === idOf(CA_CUSTOMER) ? 60 : 10)
      return customerResponse(id)
    })
    const store = useCustomerDetailStore()

    await Promise.all([store.load(idOf(CA_CUSTOMER)), store.load(idOf(PLAIN_CUSTOMER))])

    expect(store.customer?.id).toBe(idOf(PLAIN_CUSTOMER))
    expect(store.holdings.map((h) => h.id)).toEqual(holdingIdsOf(PLAIN_CUSTOMER))
  })

  it('[CDE-11] 古い load の失敗が新しい結果を上書きしない', async () => {
    customerHandler(async (id) => {
      if (id === idOf(CA_CUSTOMER)) {
        await delay(60)
        return HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })
      }
      await delay(10)
      return customerResponse(id)
    })
    const store = useCustomerDetailStore()

    await Promise.all([store.load(idOf(CA_CUSTOMER)), store.load(idOf(PLAIN_CUSTOMER))])

    expect(store.customer?.id).toBe(idOf(PLAIN_CUSTOMER))
    expect(store.customerError).toBeNull()
  })

  it('[CDE-12] holdingsPending は顧客を読み終えて預りを読み始める前も立っている', async () => {
    const store = useCustomerDetailStore()
    // 預りのリクエストが届いた時点（= 読み込み中）の値を控える。ポーリングで待つと応答に追い越される
    const whileLoading = []
    holdingsHandler({
      onRequest: () => whileLoading.push([store.holdingsLoading, store.holdingsPending]),
    })
    expect(store.holdingsPending).toBe(true)

    const atCustomerLoaded = []
    const stop = watch(
      () => store.customer,
      (customer) => {
        if (customer) atCustomerLoaded.push(store.holdingsPending)
      },
      { flush: 'sync' },
    )

    await store.load(idOf(CA_CUSTOMER))
    stop()

    expect(atCustomerLoaded).toEqual([true])
    expect(whileLoading).toEqual([[true, true]])
    expect(store.holdingsPending).toBe(false)
  })

  it('[CDE-13] 預りの無い顧客は空で、評価額は 0 円', async () => {
    const store = await loadedStore(EMPTY_CUSTOMER)

    expect(store.holdingsEmpty).toBe(true)
    expect(store.valuation).toEqual({ valueJpy: 0, profitLossJpy: 0 })
    expect(store.hasCorporateAction).toBe(false)
  })

  it('[CDE-14] CA 発生中の明細があるときだけ hasCorporateAction が立つ', async () => {
    const withCa = await loadedStore(CA_CUSTOMER)
    expect(withCa.hasCorporateAction).toBe(true)

    await withCa.load(idOf(PLAIN_CUSTOMER))
    expect(withCa.hasCorporateAction).toBe(false)
  })

  it('[CDE-15] valuation は評価額_JPY と評価損益の合計', async () => {
    const rows = holdingsOf(CA_CUSTOMER.口座番号)

    const store = await loadedStore(CA_CUSTOMER)

    expect(store.valuation).toEqual({
      valueJpy: sumOf(rows, '評価額_JPY'),
      profitLossJpy: sumOf(rows, '評価損益'),
    })
  })

  it('[CDE-16] 読み切れていない（total が件数より多い）ときは valuation を出さない', async () => {
    holdingsHandler({ totalFor: (rows) => rows.length + 1 })

    const store = await loadedStore(CA_CUSTOMER)

    expect(store.holdings.length).toBeGreaterThan(0)
    expect(store.valuation).toBeNull()
  })

  it('[CDE-17] null の金額は合計に入れない', async () => {
    holdingsHandler({
      rowsFor: (rows) =>
        rows.map((row, i) => (i === 0 ? { ...row, 評価額_JPY: null, 評価損益: null } : row)),
    })
    const rest = holdingsOf(CA_CUSTOMER.口座番号).slice(1)

    const store = await loadedStore(CA_CUSTOMER)

    expect(store.valuation).toEqual({
      valueJpy: sumOf(rest, '評価額_JPY'),
      profitLossJpy: sumOf(rest, '評価損益'),
    })
  })

  it('[CDE-18] 預りの読み込み中は valuation を出さない', async () => {
    const store = useCustomerDetailStore()
    // 預りのリクエストが届いた時点（= 読み込み中）の値を控える
    const whileLoading = []
    holdingsHandler({
      onRequest: () => whileLoading.push([store.holdingsLoading, store.valuation]),
    })

    await store.load(idOf(CA_CUSTOMER))

    expect(whileLoading).toEqual([[true, null]])
    expect(store.valuation).not.toBeNull()
  })
})
