import { computed } from 'vue'
import { defineStore } from 'pinia'
import { fetchCalculationSettings, updateCalculationSettings } from '@/api/calculationSettings'
import { useAsync } from '@/composables/useAsync'

/**
 * 仮計算マスタ（取引所税率 / 為替スプレッド / 現地手数料率 / NISA為替上乗せ率 ほか）。
 * 単一のリソースなので一覧のようなページングは持たない。
 *
 * 取得と保存で loading / error を分ける（保存に失敗しても現在値の表示は残したいため）。
 */
export const useCalculationSettingsStore = defineStore('calculationSettings', () => {
  const { data, error, loading, execute } = useAsync(fetchCalculationSettings)

  const settings = computed(() => data.value)
  const isEmpty = computed(() => !loading.value && !error.value && !data.value)

  const {
    error: saveError,
    loading: saving,
    execute: executeSave,
  } = useAsync(updateCalculationSettings)

  /**
   * 画面に出す 4 項目を更新する。楽観的ロックの更新日時は現在値からここで補う。
   * 送らない項目（消費税率・譲渡益税率・備考）は部分更新なのでサーバ側で保たれる。
   *
   * @returns {Promise<string | null>} 成功ならサーバの文言（「変更はありません。」もある）、失敗なら null
   */
  async function save({ exchangeTaxRate, localCommissionBp, fxSpread, nisaFxMarkupRate }) {
    const current = data.value
    // 現在値が無い＝まだ読めていない。何と比べて更新すべきか決まらないので送らない
    if (!current) return null

    const result = await executeSave({
      exchangeTaxRate,
      localCommissionBp,
      fxSpread,
      nisaFxMarkupRate,
      updatedAt: current.updatedAt,
    })
    if (!result) return null

    // PUT の応答が更新後の全項目なので、取得し直さずそのまま現在値にする
    data.value = result.settings
    return result.message
  }

  function clearSaveError() {
    saveError.value = null
  }

  function load() {
    return execute()
  }

  return { settings, loading, error, isEmpty, load, saving, saveError, save, clearSaveError }
})
