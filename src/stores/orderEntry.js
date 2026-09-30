import { computed } from 'vue'
import { defineStore } from 'pinia'
import { fetchBlackoutDates } from '@/api/blackoutDates'
import { fetchCustomers } from '@/api/customers'
import { fetchLatestFxRate } from '@/api/fx'
import { fetchSuspensionStatus } from '@/api/incidents'
import { fetchMarketHolidays } from '@/api/marketHolidays'
import { createOrder, validateOrder } from '@/api/orderEntry'
import { fetchSymbols } from '@/api/symbols'
import { useAsync } from '@/composables/useAsync'
import { HOLIDAY_TYPE } from '@/utils/apiEnums'
import { addDays, CALENDAR_LOOKAHEAD_DAYS, toIsoDate } from '@/utils/orderEntryForm'

/**
 * 照会で取る件数。完全一致の 1 件を探すだけだが、実 API の一致の仕方（部分一致か）が
 * 仕様に書かれていないので、他の行が混ざっても目当ての行を取りこぼさない幅を取る。
 */
const LOOKUP_LIMIT = 50

/** 海外休場日の取得件数（実 API の上限）。先読みの 45 日に収まる件数としては十分に大きい */
const HOLIDAY_LIMIT = 200

/**
 * 新規注文（外株注文入力）。入力値と画面の段階（入力 → 確認 → 完了）は画面が持ち、
 * ここは API とのやり取りの状態だけを持つ。
 *
 * 処理ごとに useAsync を分ける（loading / error を 6 本）。
 *   - 初期読み込み … 期間指定に使う休日（受注不可日・海外休場日）と、発注停止の状態
 *   - 顧客の照会 / 銘柄の照会 … 口座番号・ティッカーの入力のたびに走る
 *   - 事前検証 / 登録 … 送信と確定
 *   - 為替 … 確認画面の概算金額
 * 照会に失敗しても入力は続けられ、為替が取れなくても発注は止めない（概算が「—」になるだけ）。
 *
 * **顧客と銘柄の照会はマスタ画面の store（customers / symbols）を使わない。** Pinia の
 * インスタンスは全画面で共有なので、ここから検索するとマスタ画面の検索条件とページ位置を踏み潰す
 * （stores/customerOptions.js と同じ理由）。
 */
export const useOrderEntryStore = defineStore('orderEntry', () => {
  /* ---------- 初期読み込み ---------- */

  /**
   * 期間指定を作るための休日と、発注停止の状態をまとめて読む。
   *
   * 受注不可日の一覧は 1 ページ 50 件で固定（limit を受けない。src/api/blackoutDates.js）だが、
   * 先読みの 45 日に 50 件を超える受注不可日が入ることは無いので 1 ページだけ読む。
   * 休場日は終日休場だけ（短縮取引の日は注文を受ける。モックの order_validator.py と同じ）。
   * 発注停止は全体（ALL）だけを見る。ルート単位の停止はサーバが注文ルートごとに判断する。
   */
  async function fetchEntryContext(today) {
    const dateFrom = toIsoDate(today)
    const dateTo = toIsoDate(addDays(today, CALENDAR_LOOKAHEAD_DAYS))
    const [blackoutDates, marketHolidays, suspension] = await Promise.all([
      fetchBlackoutDates({ dateFrom, dateTo }),
      fetchMarketHolidays({
        dateFrom,
        dateTo,
        holidayType: HOLIDAY_TYPE.ALL_DAY,
        limit: HOLIDAY_LIMIT,
      }),
      fetchSuspensionStatus(),
    ])

    return {
      closedDates: [...blackoutDates.items, ...marketHolidays.items].map((item) => item.date),
      ordersSuspended: Boolean(suspension?.allSuspended),
    }
  }

  const {
    data: context,
    error: contextError,
    loading: contextLoading,
    execute: executeContext,
  } = useAsync(fetchEntryContext)

  /** @param {Date} today 期間指定の起点（画面を開いた日） */
  function loadContext(today) {
    return executeContext(today)
  }

  /* ---------- 顧客・銘柄の照会 ---------- */

  /*
   * 照会は入力のたびに走り、応答の順が入れ替わりうる（'123' の応答が '1230001' より後に届く）。
   * 追い越された応答で表示を上書きしないよう、最後に出した要求の結果だけを採る。
   * 古い要求の結果と失敗は、いまの値をそのまま返して捨てる（stores/announcements.js の履歴と同じ）。
   * 入力を消したとき（clear*）も番号を進め、走っている要求の結果を捨てさせる。
   */
  let latestCustomerRequest = 0
  let latestSymbolRequest = 0

  async function findCustomer({ branchCode, accountNumber }) {
    const request = ++latestCustomerRequest
    try {
      const { items } = await fetchCustomers({ branchCode, accountNumber, limit: LOOKUP_LIMIT })
      // 部店が空のうちは口座番号だけで引く（部店を後から入れる操作順もある）
      const customer =
        items.find(
          (item) =>
            item.accountNumber === accountNumber && (!branchCode || item.branchCode === branchCode),
        ) ?? null
      return request === latestCustomerRequest
        ? { branchCode, accountNumber, customer }
        : customerLookup.value
    } catch (e) {
      if (request === latestCustomerRequest) throw e
      return customerLookup.value
    }
  }

  async function findSymbol(ticker) {
    const request = ++latestSymbolRequest
    try {
      const { items } = await fetchSymbols({ ticker, limit: LOOKUP_LIMIT })
      const symbol = items.find((item) => item.ticker.toUpperCase() === ticker) ?? null
      return request === latestSymbolRequest ? { ticker, symbol } : symbolLookup.value
    } catch (e) {
      if (request === latestSymbolRequest) throw e
      return symbolLookup.value
    }
  }

  const {
    data: customerLookup,
    error: customerError,
    loading: customerLoading,
    execute: executeCustomer,
  } = useAsync(findCustomer)

  const {
    data: symbolLookup,
    error: symbolError,
    loading: symbolLoading,
    execute: executeSymbol,
  } = useAsync(findSymbol)

  /**
   * 口座番号から顧客を引く。見つからなければ customer が null の結果になる（例外にしない）。
   *
   * @param {{ branchCode: string, accountNumber: string }} params 前後の空白は落としてから渡す
   * @returns {Promise<{ branchCode: string, accountNumber: string, customer: object|null } | null>}
   *   失敗したときは null（理由は customerError）
   */
  function lookupCustomer({ branchCode, accountNumber }) {
    return executeCustomer({ branchCode, accountNumber })
  }

  /**
   * ティッカーから銘柄を引く。Ticker の完全一致（大文字）で 1 件に絞る。
   *
   * @param {string} ticker 大文字にしてから渡す
   * @returns {Promise<{ ticker: string, symbol: object|null } | null>} 失敗したときは null
   */
  function lookupSymbol(ticker) {
    return executeSymbol(ticker)
  }

  function clearCustomer() {
    latestCustomerRequest += 1
    customerLookup.value = null
    customerError.value = null
  }

  function clearSymbol() {
    latestSymbolRequest += 1
    symbolLookup.value = null
    symbolError.value = null
  }

  /* ---------- 事前検証・登録・為替 ---------- */

  const {
    error: validateError,
    loading: validating,
    execute: executeValidate,
  } = useAsync(validateOrder)

  const {
    error: submitError,
    loading: submitting,
    execute: executeSubmit,
  } = useAsync(createOrder)

  const {
    data: fx,
    error: fxError,
    loading: fxLoading,
    execute: executeFx,
  } = useAsync(fetchLatestFxRate)

  const fxRate = computed(() => fx.value?.rate ?? null)

  /**
   * 注文をサーバに検証させる。
   *
   * @param {import('@/api/orderEntry').OrderInput} order
   * @returns {Promise<{ valid: boolean, errors: string[], warnings: string[] } | null>}
   *   通信・サーバ障害のときは null（理由は validateError）
   */
  function validate(order) {
    return executeValidate(order)
  }

  /**
   * 注文を登録する。
   *
   * @param {import('@/api/orderEntry').OrderInput} order
   * @returns {Promise<{ success: boolean, orderId: string, message: string, errors: string[], warnings: string[] } | null>}
   *   通信・サーバ障害のときは null（理由は submitError）
   */
  function submit(order) {
    return executeSubmit(order)
  }

  function loadFxRate() {
    return executeFx({ currencyCode: 'USD' })
  }

  function clearValidateError() {
    validateError.value = null
  }

  function clearSubmitError() {
    submitError.value = null
  }

  /**
   * 画面を開き直したときの状態に戻す（初期読み込みの結果は残す）。
   * Pinia は画面をまたいで残るので、前回の照会結果やエラーを次の注文に持ち越さない。
   */
  function reset() {
    clearCustomer()
    clearSymbol()
    clearValidateError()
    clearSubmitError()
    fx.value = null
    fxError.value = null
  }

  return {
    context,
    contextError,
    contextLoading,
    loadContext,
    customerLookup,
    customerError,
    customerLoading,
    lookupCustomer,
    clearCustomer,
    symbolLookup,
    symbolError,
    symbolLoading,
    lookupSymbol,
    clearSymbol,
    validating,
    validateError,
    validate,
    clearValidateError,
    submitting,
    submitError,
    submit,
    clearSubmitError,
    fxRate,
    fxError,
    fxLoading,
    loadFxRate,
    reset,
  }
})
