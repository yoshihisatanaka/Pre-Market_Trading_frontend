import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { customers } from '@/mocks/fixtures/customers'
import { symbols } from '@/mocks/fixtures/symbols'
import { fxRates } from '@/mocks/fixtures/fxRates'

// GET /masters/fx/latest が返す行（基準日の昇順に並んだフィクスチャの末尾）
const latestUsdFxRate = fxRates.at(-1)
import { FIRST_ORDER_ID } from '@/mocks/fixtures/orderEntry'
import { HOLIDAY_TYPE } from '@/utils/apiEnums'
import { CALENDAR_LOOKAHEAD_DAYS } from '@/utils/orderEntryForm'
import { ORDER_PERSON_MAX_LENGTH, SECURITIES_DELIVERY_DEFAULT } from '@/utils/orderEntryOptions'
import { useOrderEntryStore } from './orderEntry'

/*
 * ストアのテスト。MSW の既定ハンドラに当てて、初期読み込み・照会・事前検証・登録・為替の状態を確かめる。
 * 照会の追い越しは、先の要求の応答を握ったまま後の要求を先に解決させて再現する。
 */
const TODAY = new Date(2026, 8, 29)

const BLACKOUT_PATH = '*/api/masters/blackout-dates'
const HOLIDAYS_PATH = '*/api/masters/market-holidays'
const SUSPENSIONS_PATH = '*/api/operations/order-suspensions'
const CUSTOMERS_PATH = '*/api/masters/customers'
const SYMBOLS_PATH = '*/api/masters/symbols'
const VALIDATE_PATH = '*/api/orders/validate'
const CREATE_PATH = '*/api/orders'
const FX_PATH = '*/api/masters/fx/latest'

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const customerOf = (accountNumber) => customers.find((row) => row.口座番号 === accountNumber)
const symbolOf = (ticker) => symbols.find((row) => row.Ticker === ticker)

const yamada = customerOf(1230001)
const takahashi = customerOf(1230004)
const aapl = symbolOf('AAPL')
const msft = symbolOf('MSFT')

/** Date → YYYYMMDD（クエリの期待値） */
const toApiDate = (date) =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`

/** 送る注文（警告の出ない顧客・AAPL・成行 10 株） */
function order(overrides = {}) {
  return {
    branchCode: takahashi.部店コード,
    accountNumber: String(takahashi.口座番号),
    symbolCode: aapl.銘柄コード,
    side: '3',
    quantity: 10,
    orderType: 'MO',
    limitPrice: null,
    executionScope: '03',
    expiryDate: '2026-09-29',
    settlementCurrency: '0',
    depositCategory: '0',
    securitiesDelivery: SECURITIES_DELIVERY_DEFAULT,
    transactionType: '100',
    solicitation: '1',
    orderMethod: '3',
    fundNature: '1',
    orderChannel: 'EGY',
    cashDelivery: '000',
    vwap: false,
    orderDate: '2026-09-29',
    orderTime: '10:30',
    // 受注者は 1〜4 文字（MSW も 4 文字を超えると 422 を返す）
    orderPerson: 'T'.padEnd(ORDER_PERSON_MAX_LENGTH, '0'),
    forced: false,
    createdBy: 'test-user',
    ...overrides,
  }
}

const errorHandler = (method, path, status = 500, detail = ERROR_MESSAGE) =>
  http[method](path, () => HttpResponse.json({ detail }, { status }))

/**
 * 条件に合うリクエストだけ応答を握る。解放後は既定ハンドラへ落ちる。
 *
 * @returns {() => void} 解放する関数
 */
function gateWhere(method, path, predicate) {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http[method](path, async ({ request }) => {
      if (predicate(new URL(request.url))) await promise
    }),
  )
  return release
}

/** 届いた URL を記録する（応答は既定ハンドラに任せる） */
function recordUrls(method, path) {
  const seen = []
  server.use(
    http[method](path, ({ request }) => {
      seen.push(new URL(request.url))
    }),
  )
  return seen
}

function suspensionResponse({ all = false, routes = [] } = {}) {
  const targets = [...(all ? ['ALL'] : []), ...routes]
  return {
    発注停止中: targets.length > 0,
    全体停止中: all,
    停止中の対象: targets,
    targets: [],
  }
}

// シナリオ: docs/unit/stores-order-entry.md
describe('useOrderEntryStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[NOS-01] 受注不可日と終日休場の日付を closedDates にまとめる', async () => {
    server.use(
      http.get(BLACKOUT_PATH, () =>
        HttpResponse.json({
          total: 1,
          blackout_dates: [{ ID: 1, 受注不可日: 20261001, 備考: 'テスト', 更新日時: null }],
        }),
      ),
      http.get(HOLIDAYS_PATH, () =>
        HttpResponse.json({
          total: 1,
          holidays: [{ ID: 1, 休場日: 20261002, 休場区分: '0', 休場理由: 'テスト' }],
        }),
      ),
    )
    const store = useOrderEntryStore()

    await store.loadContext(TODAY)

    expect(store.context.closedDates).toEqual(expect.arrayContaining(['2026-10-01', '2026-10-02']))
    expect(store.context.closedDates).toHaveLength(2)
    expect(store.context.ordersSuspended).toBe(false)
    expect(store.contextError).toBeNull()
  })

  it('[NOS-02] 今日から 45 日後までの休日を、休場日は終日休場だけ求める', async () => {
    const blackoutUrls = recordUrls('get', BLACKOUT_PATH)
    const holidayUrls = recordUrls('get', HOLIDAYS_PATH)
    const store = useOrderEntryStore()

    await store.loadContext(TODAY)

    const from = toApiDate(TODAY)
    const to = toApiDate(
      new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + CALENDAR_LOOKAHEAD_DAYS),
    )
    for (const url of [blackoutUrls[0], holidayUrls[0]]) {
      expect(url.searchParams.get('start_date')).toBe(from)
      expect(url.searchParams.get('end_date')).toBe(to)
    }
    expect(holidayUrls[0].searchParams.get('holiday_type')).toBe(HOLIDAY_TYPE.ALL_DAY)
  })

  it('[NOS-03] 全体（ALL）停止のときだけ ordersSuspended', async () => {
    server.use(http.get(SUSPENSIONS_PATH, () => HttpResponse.json(suspensionResponse({ all: true }))))
    const suspended = useOrderEntryStore()
    await suspended.loadContext(TODAY)
    expect(suspended.context.ordersSuspended).toBe(true)

    server.resetHandlers()
    server.use(
      http.get(SUSPENSIONS_PATH, () => HttpResponse.json(suspensionResponse({ routes: ['MIZUHO'] }))),
    )
    setActivePinia(createPinia())
    const routeOnly = useOrderEntryStore()
    await routeOnly.loadContext(TODAY)
    expect(routeOnly.context.ordersSuspended).toBe(false)
  })

  it('[NOS-04] 初期読み込みの失敗は contextError に入る', async () => {
    server.use(errorHandler('get', BLACKOUT_PATH))
    const store = useOrderEntryStore()

    await store.loadContext(TODAY)

    expect(store.contextError?.message).toBe(ERROR_MESSAGE)
    expect(store.context).toBeNull()
    expect(store.contextLoading).toBe(false)
  })

  it('[NOS-05] 部店と口座番号で顧客を引く', async () => {
    const store = useOrderEntryStore()

    await store.lookupCustomer({ branchCode: yamada.部店コード, accountNumber: '1230001' })

    expect(store.customerLookup.accountNumber).toBe('1230001')
    expect(store.customerLookup.customer.customerName).toBe(yamada.顧客名)
    expect(store.customerError).toBeNull()
  })

  it('[NOS-06] 部店が空なら口座番号だけで引く', async () => {
    const store = useOrderEntryStore()

    await store.lookupCustomer({ branchCode: '', accountNumber: '1230004' })

    expect(store.customerLookup.customer.customerName).toBe(takahashi.顧客名)
  })

  it('[NOS-07] 見つからない口座は customer: null（エラーにしない）', async () => {
    const store = useOrderEntryStore()

    await store.lookupCustomer({ branchCode: '123', accountNumber: '9999999' })

    expect(store.customerLookup).toEqual({
      branchCode: '123',
      accountNumber: '9999999',
      customer: null,
    })
    expect(store.customerError).toBeNull()
  })

  it('[NOS-08] ?symbol= で照会し、完全一致だけを採る', async () => {
    const seen = recordUrls('get', SYMBOLS_PATH)
    const store = useOrderEntryStore()

    await store.lookupSymbol('AAPL')
    expect(seen[0].searchParams.get('symbol')).toBe('AAPL')
    expect(store.symbolLookup.symbol.symbolCode).toBe(aapl.銘柄コード)

    // AAP は AAPL に部分一致するが、完全一致の行は無い
    expect(symbols.some((row) => row.Ticker.includes('AAP') && row.Ticker !== 'AAP')).toBe(true)
    await store.lookupSymbol('AAP')
    expect(store.symbolLookup).toEqual({ ticker: 'AAP', symbol: null })
  })

  it('[NOS-17] 銘柄コードでも引け、入力は銘柄コードのまま残る', async () => {
    const store = useOrderEntryStore()

    await store.lookupSymbol(aapl.銘柄コード)

    expect(store.symbolLookup.ticker).toBe(aapl.銘柄コード)
    expect(store.symbolLookup.symbol.ticker).toBe(aapl.Ticker)
    expect(store.symbolLookup.symbol.symbolCode).toBe(aapl.銘柄コード)
  })

  it('[NOS-09] 追い越された顧客の照会結果で上書きしない', async () => {
    const release = gateWhere('get', CUSTOMERS_PATH, (url) => url.searchParams.get('account_no') === '1230001')
    const store = useOrderEntryStore()

    const older = store.lookupCustomer({ branchCode: '123', accountNumber: '1230001' })
    await store.lookupCustomer({ branchCode: '123', accountNumber: '1230004' })
    expect(store.customerLookup.accountNumber).toBe('1230004')

    release()
    await older

    expect(store.customerLookup.accountNumber).toBe('1230004')
    expect(store.customerLookup.customer.customerName).toBe(takahashi.顧客名)
  })

  it('[NOS-10] 追い越された銘柄の照会結果で上書きしない', async () => {
    const release = gateWhere('get', SYMBOLS_PATH, (url) => url.searchParams.get('symbol') === 'AAPL')
    const store = useOrderEntryStore()

    const older = store.lookupSymbol('AAPL')
    await store.lookupSymbol('MSFT')
    release()
    await older

    expect(store.symbolLookup.ticker).toBe('MSFT')
    expect(store.symbolLookup.symbol.symbolCode).toBe(msft.銘柄コード)
  })

  it('[NOS-11] 照会中に消したら、走っていた結果を捨てる', async () => {
    const releaseCustomer = gateWhere('get', CUSTOMERS_PATH, () => true)
    const releaseSymbol = gateWhere('get', SYMBOLS_PATH, () => true)
    const store = useOrderEntryStore()

    const customer = store.lookupCustomer({ branchCode: '123', accountNumber: '1230001' })
    const symbol = store.lookupSymbol('AAPL')
    store.clearCustomer()
    store.clearSymbol()
    releaseCustomer()
    releaseSymbol()
    await Promise.all([customer, symbol])

    expect(store.customerLookup).toBeNull()
    expect(store.symbolLookup).toBeNull()
  })

  it('[NOS-12] 顧客の照会の失敗は customerError に入る', async () => {
    server.use(errorHandler('get', CUSTOMERS_PATH))
    const store = useOrderEntryStore()

    const result = await store.lookupCustomer({ branchCode: '123', accountNumber: '1230001' })

    expect(result).toBeNull()
    expect(store.customerError?.message).toBe(ERROR_MESSAGE)
  })

  it('[NOS-13] validate は結果を返し、障害のときは validateError に入る', async () => {
    const store = useOrderEntryStore()
    await expect(store.validate(order())).resolves.toEqual({
      valid: true,
      errors: [],
      warnings: [],
    })
    expect(store.validateError).toBeNull()

    server.use(errorHandler('post', VALIDATE_PATH))
    await expect(store.validate(order())).resolves.toBeNull()
    expect(store.validateError?.message).toBe(ERROR_MESSAGE)
    expect(store.validating).toBe(false)
  })

  it('[NOS-14] submit は登録の結果を返し、障害のときは submitError に入る', async () => {
    const store = useOrderEntryStore()
    const result = await store.submit(order())
    expect(result.success).toBe(true)
    expect(result.orderId).toBe(String(FIRST_ORDER_ID))

    server.use(errorHandler('post', CREATE_PATH))
    await expect(store.submit(order())).resolves.toBeNull()
    expect(store.submitError?.message).toBe(ERROR_MESSAGE)
    expect(store.submitting).toBe(false)
  })

  it('[NOS-15] loadFxRate は直近レートを読み、404 なら null', async () => {
    const store = useOrderEntryStore()
    await store.loadFxRate()
    expect(store.fxRate).toBe(latestUsdFxRate.為替レート)

    server.use(errorHandler('get', FX_PATH, 404, '有効な為替レートがありません。'))
    setActivePinia(createPinia())
    const missing = useOrderEntryStore()
    await missing.loadFxRate()
    expect(missing.fxRate).toBeNull()
    // api/fxRates.js は 404 を「レートがまだ無い」正常な結果として null で返す（エラーにしない）
    expect(missing.fxError).toBeNull()
  })

  it('[NOS-16] reset は照会・エラー・為替を消し、初期読み込みの結果は残す', async () => {
    const store = useOrderEntryStore()
    await store.loadContext(TODAY)
    await store.lookupCustomer({ branchCode: '123', accountNumber: '1230001' })
    await store.lookupSymbol('AAPL')
    await store.loadFxRate()
    server.use(errorHandler('post', VALIDATE_PATH), errorHandler('post', CREATE_PATH))
    await store.validate(order())
    await store.submit(order())
    server.use(errorHandler('get', CUSTOMERS_PATH))
    await store.lookupCustomer({ branchCode: '123', accountNumber: '1230004' })
    expect(store.customerError).not.toBeNull()

    store.reset()

    expect(store.customerLookup).toBeNull()
    expect(store.customerError).toBeNull()
    expect(store.symbolLookup).toBeNull()
    expect(store.validateError).toBeNull()
    expect(store.submitError).toBeNull()
    expect(store.fxRate).toBeNull()
    expect(store.context).not.toBeNull()
  })
})
