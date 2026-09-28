import { useCurrentOperatorStore } from '@/stores/currentOperator'

/**
 * `meta.requiredPermission` を持つルートを、その権限の無い利用者に開かせないガード。
 * router/index.js の beforeEach に差す（テストでも同じ関数を差せるように切り出してある）。
 *
 * 権限は GET /auth/me から取る。読み終えるまで待つのは権限の要るルートだけで、
 * それ以外の画面は /auth/me を待たずに開く。読めなかったときは権限なしに倒す。
 *
 * 権限が無ければ権限なしの画面（name: 'forbidden'）へ回す。history の積み方は元の遷移のまま
 * （URL 直打ちなら置き換え、メニューからなら積む）にし、戻るで元の画面へ帰れるようにする。
 * メニューの区分を隠すのは AppSidebar の役目で、ここは URL を直接開かれたときの守り。
 *
 * @param {import('vue-router').RouteLocationNormalized} to
 * @returns {Promise<true|{ name: string }>}
 */
export async function permissionGuard(to) {
  const permission = to.meta.requiredPermission
  if (!permission) return true

  const operator = useCurrentOperatorStore()
  await operator.ensureLoaded()

  return operator.can(permission) ? true : { name: 'forbidden' }
}
