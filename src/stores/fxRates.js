import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  createFxRate,
  fetchFxRate,
  fetchLatestFxRate,
  updateFxRate,
  validateFxRate,
} from '@/api/fxRates'
import { useAsync } from '@/composables/useAsync'

/** 画面が扱う通貨。為替マスタは USD/JPY 専用（画面モックの決定） */
export const CURRENCY_CODE = 'USD'

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/**
 * 今日（JST）の 'YYYY-MM-DD'。
 * 業務日は日本時間で決まるので、ブラウザのタイムゾーンには依らせない。
 */
function todayJst() {
  return new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * 今日（JST）以前で最新のレートを、画面に出す 1 件として読む。
 * latest は更新日時・更新者を返さないので、得た ID で詳細を引き直す。
 * 1 件も無ければ null（画面は「未登録」として 4 状態のひとつに出す）。
 */
async function fetchCurrentFxRate() {
  const latest = await fetchLatestFxRate({ currencyCode: CURRENCY_CODE, targetDate: todayJst() })
  if (!latest) return null
  return fetchFxRate(latest.id)
}

/**
 * 為替マスタ（USD/JPY の現在レート）。単一のリソースなので一覧のようなページングは持たない。
 * 公示（社内）レートと源泉レートは同じ行の 2 項目なので、取得も保存も 1 件として扱う。
 *
 * **更新の対象は当日（JST）の行だけ**（2026-09-29 決定。画面モックの「適用日」は置かない）。
 * 現在の行の基準日が今日なら変更（PUT）、今日の行がまだ無ければ今日の基準日で登録（POST）する。
 * どちらも「事前検証 → 登録 / 変更」の 2 段を 1 つの操作として扱う（useCrudList の登録と同じ作法）。
 *
 * 取得と保存で loading / error を分ける（保存に失敗しても現在値の表示は残したいため）。
 */
export const useFxRatesStore = defineStore('fxRates', () => {
  const { data, error, loading, execute } = useAsync(fetchCurrentFxRate)

  const rate = computed(() => data.value)
  const isEmpty = computed(() => !loading.value && !error.value && !data.value)

  /*
   * 事前検証 → 登録 / 変更。検証で弾かれた場合は例外にせず { valid: false, errors } を返す。
   * 警告付きの合格（範囲外のレート）は、承知して押し直すまで保存しない。
   */
  async function validateThenSave({
    rate: nextRate,
    withholdingRate = null,
    acknowledgedWarnings = false,
  }) {
    const baseDate = todayJst()
    const current = data.value
    const target = current?.baseDate === baseDate ? current : null
    const payload = { baseDate, currencyCode: CURRENCY_CODE, rate: nextRate, withholdingRate }

    const validation = await validateFxRate({ ...payload, id: target?.id ?? '' })
    if (!validation.valid) return { valid: false, errors: validation.errors }
    if (validation.warnings.length > 0 && !acknowledgedWarnings) {
      return { valid: true, warnings: validation.warnings }
    }

    const saved = target
      ? await updateFxRate({ ...payload, id: target.id, updatedAt: target.updatedAt })
      : await createFxRate(payload)
    return { valid: true, saved }
  }

  const { error: saveError, loading: saving, execute: executeSave } = useAsync(validateThenSave)

  // サーバの事前検証が返した理由と警告（通信自体は成功しているので saveError とは別に持つ）
  const validationErrors = ref([])
  const validationWarnings = ref([])

  /**
   * 今日のレート（公示（社内）レートと源泉レート）を保存する。
   *
   * @param {{ rate: number, withholdingRate?: number | null, acknowledgedWarnings?: boolean }} params
   *   rate は公示（社内）レート、withholdingRate は源泉レート。
   *   警告を承知して押し直すときは acknowledgedWarnings: true
   * @returns {Promise<object|null>} 保存後の 1 件。保存しなかったときは null
   *   （通信・サーバエラーは saveError、事前検証で弾かれた理由は validationErrors、
   *   確認待ちの警告は validationWarnings に入る）
   */
  async function save(params) {
    validationErrors.value = []
    validationWarnings.value = []

    const result = await executeSave(params)
    if (!result) return null

    if (!result.valid) {
      validationErrors.value = result.errors
      return null
    }
    if (!result.saved) {
      validationWarnings.value = result.warnings
      return null
    }

    // 応答が保存後の全項目なので、取得し直さずそのまま現在値にする
    data.value = result.saved
    return result.saved
  }

  function clearSaveError() {
    saveError.value = null
    validationErrors.value = []
    validationWarnings.value = []
  }

  function load() {
    return execute()
  }

  return {
    rate,
    loading,
    error,
    isEmpty,
    load,
    saving,
    saveError,
    validationErrors,
    validationWarnings,
    save,
    clearSaveError,
  }
})
