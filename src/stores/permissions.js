import { computed } from 'vue'
import { defineStore } from 'pinia'
import { fetchPermissions } from '@/api/permissions'
import { useAsync } from '@/composables/useAsync'

/**
 * 権限マスタ（ロール別の権限）。
 *
 * ロールは 4 つ固定で検索条件もページングも無いので、一覧系の useCrudList ではなく
 * useAsync を直に使う（単一リソースを扱う useHardLimitsStore と同じ形）。
 */
export const usePermissionsStore = defineStore('permissions', () => {
  const { data, error, loading, execute } = useAsync(fetchPermissions)

  const roles = computed(() => data.value?.roles ?? [])

  /** いまの利用者が権限を変更できるか。false なら一覧の「操作」列ごと出さない */
  const canEdit = computed(() => data.value?.canEdit ?? false)

  const isEmpty = computed(() => !loading.value && !error.value && roles.value.length === 0)

  function load() {
    return execute()
  }

  /**
   * 編集モーダルの内容を手元の行へ反映する。
   *
   * **保存の通信はまだ無い**（実 API に権限系のエンドポイントが無く、今回は見た目だけを作る）。
   * そのため変更はこのストアの中だけに残り、再読み込みすると元に戻る。
   * 繋ぎ込むときは、ここを `updateRolePermissions()` を呼ぶ非同期の save に置き換え、
   * 保存中・保存失敗の状態（useHardLimitsStore の saving / saveError と同じもの）を足す。
   *
   * data は shallowRef なので、行の中身を書き換えるだけでは画面が更新されない。
   * 配列ごと・オブジェクトごと作り直して data 自体を差し替える。
   *
   * @param {string} role 対象のロールコード
   * @param {object} values 権限の真偽値（キーは utils/permissionTypes.js の PERMISSION_ITEMS）
   */
  function applyLocalEdit(role, values) {
    const current = data.value
    // まだ読めていない＝何に反映すべきか決まらない
    if (!current) return

    data.value = {
      ...current,
      roles: current.roles.map((item) => (item.role === role ? { ...item, ...values } : item)),
    }
  }

  return { roles, canEdit, loading, error, isEmpty, load, applyLocalEdit }
})
