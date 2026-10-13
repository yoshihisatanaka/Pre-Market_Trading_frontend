import { http, HttpResponse } from 'msw'
import { supervisorOperator } from '../fixtures/currentOperator'
import { rolePermissions } from '../fixtures/permissions'
import { users } from '../fixtures/users'
import { detailError, nowIsoTimestamp, toNonNegativeInt } from './_shared'

/*
 * 操作者（ユーザ）マスタ。クエリ名と応答の形は openapi.json の `GET /masters/users`
 * （OperatorListResponse）と `PUT /masters/users/{operator_code}`（OperatorUpsertResponse）に合わせてある。
 * 呼び出し元はユーザ管理マスタの画面と、操作ログの操作者プルダウン。
 *
 * 実 API は実装済みだが、単体テストと E2E がこの handlers を共用しているのでハンドラは残し、
 * **実 API と同じ形**に寄せてある。更新の挙動は ../Pre-Market_Trading の
 * app/services/role_permission_service.py の save_operator_account に合わせた。
 *
 * `keyword`（社員コード・氏名の部分一致）は実 API に無いクエリで、ここだけが解釈する
 * （docs/api/requests.md #67。画面モックの「メールアドレス・氏名」の検索）。
 */

/** 保存で書き換わるので、フィクスチャの写しを持つ */
let userRows = users.map((row) => ({ ...row }))

/** モックの可変状態をフィクスチャの内容に戻す */
export function resetUserRows() {
  userRows = users.map((row) => ({ ...row }))
}

/** 空文字・空白だけは null に寄せる（実 API の `(x or "").strip() or None`） */
function blankToNull(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || null
}

export const userHandlers = [
  http.get('*/api/masters/users', ({ request }) => {
    const params = new URL(request.url).searchParams
    const role = params.get('role') ?? ''
    const branchCode = params.get('branch_code') ?? ''
    const keyword = (params.get('keyword') ?? '').trim()
    const includeInactive = params.get('include_inactive') === 'true'
    const limit = toNonNegativeInt(params.get('limit'), 50)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    const filtered = userRows.filter(
      (user) =>
        (includeInactive || user.有効フラグ === 1) &&
        (!role || user.ロールコード === role) &&
        (!branchCode || user.部店コード === branchCode) &&
        (!keyword || user.操作者コード.includes(keyword) || (user.氏名 ?? '').includes(keyword)),
    )

    return HttpResponse.json({
      total: filtered.length,
      limit,
      offset,
      operators: filtered.slice(offset, offset + limit),
    })
  }),

  /*
   * 操作者 1 件の登録／更新（upsert）。拒否の形は実 API に合わせる。
   *
   *   400 ErrorResponse … ロールコードが権限マスタに無い / 受注者コードが 4 文字を超える
   *
   * 本文に無い 氏名・部店コード・受注者コード は null で上書きされる（部分更新ではない）。
   * 楽観的ロックは無い。最後の有効な管理責任者・自分自身の無効化も、実 API が拒否しないので拒否しない
   * （docs/api/requests.md #67 ③）。
   */
  http.put('*/api/masters/users/:operatorCode', async ({ params, request }) => {
    const body = (await request.json().catch(() => null)) ?? {}
    const code = String(params.operatorCode ?? '').trim()

    const orderTakerCode = blankToNull(body.受注者コード)
    if (orderTakerCode && orderTakerCode.length > 4) {
      return detailError(400, `受注者コードは 4 文字以内で指定してください: ${orderTakerCode}`)
    }

    const role = rolePermissions.find((row) => row.ロールコード === body.ロールコード)
    if (!role) {
      const valid = rolePermissions.map((row) => row.ロールコード).join(', ')
      return detailError(400, `ロールコードが不正です: ${body.ロールコード}（指定可能: ${valid}）`)
    }

    const current = userRows.find((row) => row.操作者コード === code)
    const saved = {
      ID: current?.ID ?? Math.max(0, ...userRows.map((row) => row.ID)) + 1,
      操作者コード: code,
      氏名: blankToNull(body.氏名),
      ロールコード: role.ロールコード,
      ロール名: role.ロール名,
      部店コード: blankToNull(body.部店コード),
      受注者コード: orderTakerCode,
      // 仕様の既定は 1
      有効フラグ: body.有効フラグ === 0 ? 0 : 1,
      更新日時: nowIsoTimestamp(),
      更新者: supervisorOperator.操作者コード,
    }
    userRows = current
      ? userRows.map((row) => (row === current ? saved : row))
      : [...userRows, saved]

    return HttpResponse.json({
      success: true,
      operator: saved,
      message: `操作者 ${code} を保存しました。`,
    })
  }),
]
