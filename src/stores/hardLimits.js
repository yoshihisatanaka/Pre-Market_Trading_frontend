import { computed } from 'vue'
import { defineStore } from 'pinia'
import { fetchHardLimits, updateHardLimits } from '@/api/hardLimits'
import { useAsync } from '@/composables/useAsync'

/**
 * ハードリミット（市場関与率 / 1注文あたり数量 / 1注文あたり金額 の上限）。
 * 単一のリソースなので一覧のようなページングは持たない。
 *
 * 取得と保存で loading / error を分ける（保存に失敗しても現在値の表示は残したいため）。
 */
export const useHardLimitsStore = defineStore('hardLimits', () => {
  const { data, error, loading, execute } = useAsync(fetchHardLimits)

  const settings = computed(() => data.value)
  const isEmpty = computed(() => !loading.value && !error.value && !data.value)

  const { error: saveError, loading: saving, execute: executeSave } = useAsync(updateHardLimits)

  /**
   * 3 つの上限を更新する。画面に出さない項目（有効フラグ）と楽観的ロックの
   * 更新日時は、現在値からここで補う。
   */
  async function save({ participationRate, maxQuantity, maxAmount }) {
    const current = data.value
    // 現在値が無い＝まだ読めていない。何と比べて更新すべきか決まらないので送らない
    if (!current) return null

    const updated = await executeSave({
      participationRate,
      maxQuantity,
      maxAmount,
      sliceEnabled: current.sliceEnabled,
      updatedAt: current.updatedAt,
    })
    if (!updated) return null

    // PUT の応答が更新後の全項目なので、取得し直さずそのまま現在値にする
    data.value = updated
    return updated
  }

  function clearSaveError() {
    saveError.value = null
  }

  function load() {
    return execute()
  }

  return { settings, loading, error, isEmpty, load, saving, saveError, save, clearSaveError }
})
