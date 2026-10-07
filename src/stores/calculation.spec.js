import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http } from 'msw'
import { server } from '@/mocks/server'
import { customers } from '@/mocks/fixtures/customers'
import { symbols } from '@/mocks/fixtures/symbols'
import { calculationMessages } from '@/mocks/fixtures/calculations'
import { useCalculationStore } from './calculation'

/*
 * ストアのテスト。MSW の既定ハンドラ（POST /calculations）に当てて、実行・失敗・やり直し・reset の状態を確かめる。
 * 応答の待ちは、本文の銘柄で選んだ要求だけを握り、解放後は既定ハンドラへ落として再現する。
 */
const PATH = '*/api/calculations'
const MISSING_SYMBOL = 'ZZZZ'

const yamada = customers.find((row) => row.口座番号 === 1230001)
const aapl = symbols.find((row) => row.Ticker === 'AAPL')
const msft = symbols.find((row) => row.Ticker === 'MSFT')

/** 送る条件（アプリ内モデル）。既定は AAPL を特定で 10 株売り、任意項目は空 */
function input(overrides = {}) {
  return {
    accountNumber: String(yamada.口座番号),
    symbol: aapl.Ticker,
    side: '1',
    quantity: 10,
    unitPrice: 230.5,
    specificDeposit: '1',
    fxRate: null,
    localFee1: null,
    localFee2: null,
    localTax1: null,
    localTax2: null,
    localTax3: null,
    otherCost1: null,
    otherCost2: null,
    feePattern: null,
    feeMultiplier: null,
    basisPoints: null,
    taxExempt: false,
    feeMin: null,
    feeMax: null,
    ...overrides,
  }
}

/**
 * 本文の銘柄コードが symbol の要求だけ応答を握る。解放後は既定ハンドラへ落ちる。
 *
 * @returns {() => void} 解放する関数
 */
function gateSymbol(symbol) {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http.post(PATH, async ({ request }) => {
      const body = await request.clone().json()
      if (body.銘柄コード === symbol) await promise
    }),
  )
  return release
}

// シナリオ: docs/unit/stores-calculation.md
describe('useCalculationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[TCS-01] run は結果を返し、result に入る', async () => {
    const store = useCalculationStore()

    const result = await store.run(input())

    expect(result.symbolCode).toBe(aapl.銘柄コード)
    expect(result.quantity).toBe(10)
    expect(store.result).toEqual(result)
    expect(store.error).toBeNull()
    expect(store.loading).toBe(false)
  })

  it('[TCS-02] 応答を待つ間は loading が true で result は null', async () => {
    const release = gateSymbol(aapl.Ticker)
    const store = useCalculationStore()

    const pending = store.run(input())
    expect(store.loading).toBe(true)
    expect(store.result).toBeNull()

    release()
    await pending
    expect(store.loading).toBe(false)
    expect(store.result.symbolCode).toBe(aapl.銘柄コード)
  })

  it('[TCS-03] やり直すと、応答を待つ間は前の結果を消す', async () => {
    const store = useCalculationStore()
    await store.run(input())
    expect(store.result.symbolCode).toBe(aapl.銘柄コード)

    const release = gateSymbol(msft.Ticker)
    const pending = store.run(input({ symbol: msft.Ticker }))
    expect(store.result).toBeNull()

    release()
    await pending
    expect(store.result.symbolCode).toBe(msft.銘柄コード)
  })

  it('[TCS-04] 失敗したら null を返し、error に理由、前の結果は残さない', async () => {
    const store = useCalculationStore()
    await store.run(input())

    const result = await store.run(input({ symbol: MISSING_SYMBOL }))

    expect(result).toBeNull()
    expect(store.error?.message).toBe(calculationMessages.symbolNotFound(MISSING_SYMBOL))
    expect(store.result).toBeNull()
    expect(store.loading).toBe(false)
  })

  it('[TCS-05] 失敗のあとに成功したら error は消える', async () => {
    const store = useCalculationStore()
    await store.run(input({ symbol: MISSING_SYMBOL }))
    expect(store.error).not.toBeNull()

    await store.run(input())

    expect(store.error).toBeNull()
    expect(store.result.symbolCode).toBe(aapl.銘柄コード)
  })

  it('[TCS-06] reset は結果とエラーを捨てる', async () => {
    const store = useCalculationStore()
    await store.run(input())
    store.reset()
    expect(store.result).toBeNull()

    await store.run(input({ symbol: MISSING_SYMBOL }))
    expect(store.error).not.toBeNull()
    store.reset()

    expect(store.result).toBeNull()
    expect(store.error).toBeNull()
    expect(store.loading).toBe(false)
  })

  it('[TCS-07] reset のあとに届いた結果は捨てる', async () => {
    const release = gateSymbol(aapl.Ticker)
    const store = useCalculationStore()

    const pending = store.run(input())
    store.reset()
    expect(store.loading).toBe(false)
    release()
    await pending

    expect(store.result).toBeNull()
    expect(store.error).toBeNull()
  })

  it('[TCS-08] reset のあとに届いた失敗は捨てる', async () => {
    const release = gateSymbol(MISSING_SYMBOL)
    const store = useCalculationStore()

    const pending = store.run(input({ symbol: MISSING_SYMBOL }))
    store.reset()
    release()
    await pending

    expect(store.error).toBeNull()
    expect(store.result).toBeNull()
  })

  it('[TCS-09] 追い越された要求の結果で上書きしない', async () => {
    const release = gateSymbol(aapl.Ticker)
    const store = useCalculationStore()

    const older = store.run(input())
    await store.run(input({ symbol: msft.Ticker }))
    expect(store.result.symbolCode).toBe(msft.銘柄コード)

    release()
    await older

    expect(store.result.symbolCode).toBe(msft.銘柄コード)
  })

  it('[TCS-10] 追い越された要求の失敗は出さない', async () => {
    const release = gateSymbol(MISSING_SYMBOL)
    const store = useCalculationStore()

    const older = store.run(input({ symbol: MISSING_SYMBOL }))
    await store.run(input({ symbol: msft.Ticker }))
    release()
    await older

    expect(store.error).toBeNull()
    expect(store.result.symbolCode).toBe(msft.銘柄コード)
  })

  it('[TCS-11] 先の要求が先に終わっても、後の要求を待つ間は loading が true のまま', async () => {
    const releaseOlder = gateSymbol(aapl.Ticker)
    const releaseNewer = gateSymbol(msft.Ticker)
    const store = useCalculationStore()

    const older = store.run(input())
    const newer = store.run(input({ symbol: msft.Ticker }))
    releaseOlder()
    await older
    expect(store.loading).toBe(true)

    releaseNewer()
    await newer
    expect(store.loading).toBe(false)
    expect(store.result.symbolCode).toBe(msft.銘柄コード)
  })
})
