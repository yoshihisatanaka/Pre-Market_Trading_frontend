import { defineStore } from 'pinia'
import { calculate } from '@/api/calculations'
import { fetchLatestFxRate } from '@/api/fxRates'
import { fetchSymbols } from '@/api/symbols'
import { useAsync } from '@/composables/useAsync'

/**
 * 銘柄マスタの照会で取る件数。完全一致の 1 件を探すだけだが、`symbol` は部分一致なので
 * 他の行が混ざっても目当ての行を取りこぼさない幅を取る（stores/orderEntry.js と同じ）。
 */
const SYMBOL_LOOKUP_LIMIT = 50

/** 仮計算の為替は USD/JPY だけ（画面の欄も「為替（USD/JPY）」） */
const FX_CURRENCY_CODE = 'USD'

/**
 * 仮計算（顧客詳細の仮計算タブ）。入力値は画面が持ち、ここは `POST /calculations` の結果と状態、
 * それに画面を開いたときの初期値の取得（loadDefaults）を持つ。
 *
 * 結果は最後に実行した 1 件だけ。実行し直すと、応答を待つ間は前の結果を消す（新しい条件の結果と
 * 取り違えない。失敗したときも前の結果を残さない）。
 *
 * Pinia は画面をまたいで残るので、画面を開き直したら reset() で前回の結果を捨てる。
 * 開き直す前に出した要求の応答があとから届いても、最後に出した要求の結果でなければ捨てる
 * （stores/customerDetail.js と同じ）。
 */
export const useCalculationStore = defineStore('calculation', () => {
  let latestToken = 0
  /** 応答を待っている要求のトークン */
  const inFlight = new Set()

  async function calculateLatest(input, token) {
    try {
      const result = await calculate(input)
      return token === latestToken ? result : data.value
    } catch (e) {
      if (token === latestToken) throw e
      return data.value
    }
  }

  const { data, error, loading, execute } = useAsync(calculateLatest)

  /**
   * 仮計算を実行する。
   *
   * @param {import('@/api/calculations').CalculationInput} input
   * @returns {Promise<import('@/api/calculations').Calculation | null>}
   *   失敗したときは null（理由は error）
   */
  async function run(input) {
    const token = ++latestToken
    data.value = null
    inFlight.add(token)
    try {
      return await execute(input, token)
    } finally {
      inFlight.delete(token)
      // useAsync は古い要求が終わったときも loading を false に戻す。最新の要求がまだ走っていれば戻し直す
      if (inFlight.has(latestToken)) loading.value = true
    }
  }

  /* ---------- 初期値（モックの calculations.py の _default_input と同じ意味） ---------- */

  /** 為替欄の初期値: 為替マスタの現在レート（`GET /masters/fx/latest`）。無ければ null */
  async function fetchFxDefault() {
    const latest = await fetchLatestFxRate({ currencyCode: FX_CURRENCY_CODE })
    return latest?.rate ?? null
  }

  /**
   * 単価欄の初期値: 銘柄マスタの前日終値（`GET /masters/symbols`）。
   * 照会は部分一致なので、ティッカー → 銘柄コードの順に完全一致の 1 件へ絞る（stores/orderEntry.js と同じ）。
   * 銘柄が無い・前日終値が未取得なら null
   */
  async function fetchPriceDefault(symbol) {
    const needle = symbol.trim().toUpperCase()
    const { items } = await fetchSymbols({ symbolCode: needle, limit: SYMBOL_LOOKUP_LIMIT })
    const found =
      items.find((item) => item.ticker.toUpperCase() === needle) ??
      items.find((item) => item.symbolCode.toUpperCase() === needle) ??
      null
    return found?.previousClose ?? null
  }

  // 取れなかった項目は空のままにするだけなので、error は画面に出さない（useAsync が例外を null に畳む）
  const { execute: executeFxDefault, loading: fxDefaultLoading } = useAsync(fetchFxDefault)
  const { execute: executePriceDefault, loading: priceDefaultLoading } =
    useAsync(fetchPriceDefault)

  /** loadDefaults の要求を区別する。reset() で進め、古い応答を捨てる */
  let defaultsToken = 0

  /**
   * 画面を開いたときの初期値（単価・為替）を引く。2 本は並行に引き、どちらかが失敗しても
   * もう一方の値は返す（失敗した項目は null）。
   *
   * @param {{ symbol?: string }} [params]
   *   symbol は単価を引く銘柄（銘柄コード／ティッカー）。空なら単価は引かない（null）。
   *   預りの現在値がクエリで来ているときは、画面が symbol を渡さない
   * @returns {Promise<{ unitPrice: number|null, fxRate: number|null }>}
   *   reset() のあとに届いた応答は捨てる（両方 null）
   */
  async function loadDefaults({ symbol = '' } = {}) {
    const token = ++defaultsToken
    const [fxRate, unitPrice] = await Promise.all([
      executeFxDefault(),
      symbol.trim() ? executePriceDefault(symbol) : Promise.resolve(null),
    ])
    if (token !== defaultsToken) return { unitPrice: null, fxRate: null }
    return { unitPrice, fxRate }
  }

  /** 結果とエラーを捨て、走っている要求の応答も捨てさせる（初期値の取得も同じ） */
  function reset() {
    latestToken += 1
    defaultsToken += 1
    data.value = null
    error.value = null
    loading.value = false
  }

  return {
    result: data,
    error,
    loading,
    fxDefaultLoading,
    priceDefaultLoading,
    run,
    loadDefaults,
    reset,
  }
})
