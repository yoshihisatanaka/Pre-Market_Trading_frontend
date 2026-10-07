import { defineStore } from 'pinia'
import { calculate } from '@/api/calculations'
import { useAsync } from '@/composables/useAsync'

/**
 * 仮計算（顧客詳細の仮計算タブ）。入力値は画面が持ち、ここは `POST /calculations` の結果と状態だけを持つ。
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

  /** 結果とエラーを捨て、走っている要求の応答も捨てさせる */
  function reset() {
    latestToken += 1
    data.value = null
    error.value = null
    loading.value = false
  }

  return {
    result: data,
    error,
    loading,
    run,
    reset,
  }
})
