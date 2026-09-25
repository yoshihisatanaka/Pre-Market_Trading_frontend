import { computed } from 'vue'
import { defineStore } from 'pinia'
import { fetchCurrentOperator } from '@/api/auth'
import { fetchPermissions, updateRolePermission } from '@/api/permissions'
import { useAsync } from '@/composables/useAsync'

/** 権限マスタを変更できるロール（PUT /masters/permissions/{role_code} の description） */
const EDITOR_ROLE = 'supervisor'

/**
 * 一覧と、いまの利用者を一緒に読む。
 *
 * 一覧の応答には「編集できるか」が無いので、GET /auth/me のロールで決める。
 * /auth/me が落ちても一覧は見せたいので、そちらの失敗は null（＝閲覧のみ）に倒して握る。
 * 一覧の失敗はそのまま投げ、画面のエラー状態にする。
 */
async function fetchPermissionsWithOperator() {
  const [roles, operator] = await Promise.all([
    fetchPermissions(),
    fetchCurrentOperator().catch(() => null),
  ])
  return { roles, operator }
}

/**
 * 権限マスタ（ロール別の権限）。
 *
 * ロールは 4 つ固定で検索条件もページングも無いので、一覧系の useCrudList ではなく
 * useAsync を直に使う（単一リソースを扱う useSliceCriteriaStore と同じ形）。
 * 取得と保存で loading / error を分ける（保存に失敗しても一覧の表示は残したいため）。
 */
export const usePermissionsStore = defineStore('permissions', () => {
  const { data, error, loading, execute } = useAsync(fetchPermissionsWithOperator)

  const roles = computed(() => data.value?.roles ?? [])

  /** いまの利用者が権限を変更できるか。false なら一覧の「操作」列ごと出さない */
  const canEdit = computed(() => data.value?.operator?.roleCode === EDITOR_ROLE)

  const isEmpty = computed(() => !loading.value && !error.value && roles.value.length === 0)

  const {
    error: saveError,
    loading: saving,
    execute: executeSave,
  } = useAsync(updateRolePermission)

  function load() {
    return execute()
  }

  /**
   * ロール 1 件の権限を保存する。
   *
   * 楽観的ロックの合札（updatedAt）は画面に出さないので、手元の行からここで補う。
   * PUT の応答が更新後の行なので、取得し直さずその行で差し替える。
   *
   * data は shallowRef なので、行の中身を書き換えるだけでは画面が更新されない。
   * 配列ごと・オブジェクトごと作り直して data 自体を差し替える。
   *
   * @param {string} role 対象のロールコード
   * @param {object} values 権限の真偽値（キーは utils/permissionTypes.js の PERMISSION_ITEMS）
   * @returns {Promise<{ role: object, message: string }|null>}
   *   更新後の行とサーバの文言。失敗・未取得なら null（理由は saveError）
   */
  async function save(role, values) {
    const current = roles.value.find((item) => item.role === role)
    // まだ読めていない＝何を更新すべきか決まらないので送らない
    if (!current) return null

    const result = await executeSave(role, { ...values, updatedAt: current.updatedAt })
    if (!result) return null

    data.value = {
      ...data.value,
      roles: data.value.roles.map((item) => (item.role === role ? result.role : item)),
    }
    return result
  }

  function clearSaveError() {
    saveError.value = null
  }

  return {
    roles,
    canEdit,
    loading,
    error,
    isEmpty,
    load,
    saving,
    saveError,
    save,
    clearSaveError,
  }
})
