import { http, HttpResponse } from 'msw'
import { currentOperatorFor, supervisorOperator } from '../fixtures/currentOperator'
import { rolePermissions, withPermissionFlags } from '../fixtures/permissions'
import { detailError, isSameTimestamp, nowTimestamp } from './_shared'

/*
 * 権限マスタ（/masters/permissions）とログイン中の操作者（/auth/me）。
 *
 * 実 API は実装済みだが、単体テストと E2E がこの handlers を共用しているのでハンドラは残し、
 * **実 API と同じ形**に寄せてある（日本語キー・0 / 1・拒否は { detail }）。
 * 実 API の挙動は ../Pre-Market_Trading の app/services/role_permission_service.py に合わせた。
 */

/** 保存で書き換わるので、フィクスチャの写しを持つ */
let permissionRows = rolePermissions.map((row) => ({ ...row }))

/** モックの可変状態をフィクスチャの内容に戻す */
export function resetPermissionRows() {
  permissionRows = rolePermissions.map((row) => ({ ...row }))
}

/**
 * 更新の本文に載る権限（RolePermissionUpdateRequest の 4 権限と、契約提案の 4 権限。
 * 提案の側は fixtures/permissions.js のコメントを参照）
 */
const PERMISSION_COLUMNS = [
  '発注権限',
  'マスタ更新権限',
  '運用管理権限',
  '全店参照権限',
  '参照権限',
  '強制発注権限',
  'CSV一括発注権限',
  'ユーザ管理権限',
]

/**
 * 発注を前提にする権限（契約提案）。画面モックはサーバ側でも検証するので、提案として同じ拒否を返す。
 * 文言はモックの _validate_role_permissions と同じ
 */
const REQUIRES_ORDER = [
  ['強制発注権限', '「発注（強制）」を許可するには「発注」も許可してください。'],
  ['CSV一括発注権限', '「CSV一括発注」を許可するには「発注」も許可してください。'],
]

/** 楽観的ロックの競合。実 API が返すのと同じ文言 */
const PERMISSION_CONFLICT_DETAIL =
  '他のユーザーによって更新されています。最新の情報を取得してからやり直してください。'

export const permissionHandlers = [
  /*
   * ログイン中の操作者。実 API と同じく X-User-Code（.env の VITE_USER_CODE）で決まる。
   * 知らないコードは管理責任者（権限マスタを編集できる）。切り替え先は fixtures/currentOperator.js の devOperators。
   */
  http.get('*/api/auth/me', ({ request }) =>
    HttpResponse.json(currentOperatorFor(request.headers.get('X-User-Code'))),
  ),

  http.get('*/api/masters/permissions', () => HttpResponse.json({ roles: permissionRows })),

  /*
   * ロール 1 件の権限を更新する。拒否の形は実 API に合わせる。
   *
   *   404 ErrorResponse … ロールが存在しない
   *   409 ErrorResponse … 楽観的ロックの競合（更新日時 が現在値と違う）
   *   422 ErrorResponse … 発注なしで強制発注 / CSV一括発注を許可した（契約提案。画面モックの検証）
   *
   * 403（管理責任者以外）は認可強制が有効なときだけ出るので、ここでは返さない
   * （実 API の既定も 認可強制 false）。
   * 送られなかった権限は現在値を保つ（実 API の 全店参照権限 と同じ扱いを提案の 4 権限にも当てる）。
   * 変更が無ければ更新日時を進めず「変更はありません。」を返す。
   */
  http.put('*/api/masters/permissions/:roleCode', async ({ params, request }) => {
    const body = (await request.json().catch(() => null)) ?? {}
    const current = permissionRows.find((row) => row.ロールコード === params.roleCode)
    if (!current) {
      return detailError(404, `ロール ${params.roleCode} は存在しません。`)
    }

    // 送られなかった（null も含む）権限は現在値を保つ
    const next = Object.fromEntries(
      PERMISSION_COLUMNS.map((column) => {
        const sent = body[column]
        return [column, sent === undefined || sent === null ? current[column] : Number(Boolean(sent))]
      }),
    )

    if (next.発注権限 !== 1) {
      const violated = REQUIRES_ORDER.find(([column]) => next[column] === 1)
      if (violated) return detailError(422, violated[1])
    }

    const unchanged = PERMISSION_COLUMNS.every((column) => current[column] === next[column])
    if (unchanged) {
      return HttpResponse.json({ success: true, role: current, message: '変更はありません。' })
    }

    if (!isSameTimestamp(body.更新日時 ?? null, current.更新日時)) {
      return detailError(409, PERMISSION_CONFLICT_DETAIL)
    }

    const updated = withPermissionFlags({
      ...current,
      ...next,
      // 画面から更新したので 1 が立つ（システム連携ではない）
      ユーザー操作フラグ: 1,
      更新日時: nowTimestamp(),
      更新者: supervisorOperator.操作者コード,
    })
    permissionRows = permissionRows.map((row) => (row === current ? updated : row))

    return HttpResponse.json({
      success: true,
      role: updated,
      message: `${updated.ロール名}の権限設定を更新しました。`,
    })
  }),
]
