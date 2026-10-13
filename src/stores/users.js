import { computed } from 'vue'
import { defineStore } from 'pinia'
import { fetchPermissions } from '@/api/permissions'
import { fetchUsers, updateUser } from '@/api/users'
import { useAsync } from '@/composables/useAsync'
import { useCrudList } from '@/composables/useCrudList'
import { DEFAULT_PAGE_SIZE } from '@/utils/pagination'

/**
 * 一覧 1 ページあたりの表示件数（既定は utils/pagination.js の DEFAULT_PAGE_SIZE）。
 *
 * 実 API（`GET /masters/users`）の limit は 1〜200。
 * この画面だけ変えるときはここを数値で上書きする（api 層が limit として送る）。
 */
export const USERS_PAGE_SIZE = DEFAULT_PAGE_SIZE

/**
 * 検索条件「状態」の値。URL クエリ（status）にこの文字列が載る。
 *
 * 仕様の絞り込みは `include_inactive`（無効も含めるか）だけなので、選べるのは
 * 「すべて」（既定。空文字）と「有効」の 2 つ。画面モックにある「無効」だけの絞り込みは
 * 仕様に無い（docs/api/requests.md #67）。
 */
export const USER_STATUS_ACTIVE = 'active'

/**
 * 検索条件の status → api の includeInactive。
 * 画面モックの既定は「すべて」なので、空（未指定）のときに無効も含める。
 */
function fetchUserPage({ status, ...params }) {
  return fetchUsers({ ...params, includeInactive: status !== USER_STATUS_ACTIVE })
}

/**
 * ユーザ管理マスタのストア。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止・更新の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/users.js の JSDoc を参照。
 *
 * **編集だけを持つ。** 画面モックに新規追加・削除が無いので createItem / deleteItem を渡さない
 * （useCrudList は渡さない限り create / remove を公開しない）。利用者の追加は画面の外で行う。
 * 更新の事前検証 API も無いので validateItem も渡さない。
 *
 * ロールの選択肢（検索と編集のプルダウン）は権限マスタから作る。権限マスタのストアは
 * GET /auth/me も合わせて読むので借りず、api を直接呼ぶ。
 *
 * 並べ替えはサーバの責務で、ここでは触らない。
 */
export const useUsersStore = defineStore('users', () => {
  const list = useCrudList({
    pageSize: USERS_PAGE_SIZE,
    filterKeys: ['branchCode', 'role', 'status', 'keyword'],
    fetchPage: fetchUserPage,
    updateItem: updateUser,
  })

  const {
    data: roles,
    error: rolesError,
    loading: rolesLoading,
    execute: loadRoles,
  } = useAsync(fetchPermissions, { initialData: [] })

  /** BaseSelect の options にそのまま渡せる形。並びは権限マスタの並び（ID 順）。未取得の間は空配列 */
  const roleOptions = computed(() =>
    (roles.value ?? []).map((role) => ({ value: role.role, label: role.roleLabel || role.role })),
  )

  return {
    ...list,
    roleOptions,
    rolesError,
    rolesLoading,
    loadRoles,
  }
})
