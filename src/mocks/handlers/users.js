import { http, HttpResponse } from 'msw'
import { users } from '../fixtures/users'
import { toNonNegativeInt } from './_shared'

/*
 * 操作者（ユーザ）マスタの一覧。クエリ名と応答の形は openapi.json の `GET /masters/users`
 * （OperatorListResponse）に合わせてある。いまの呼び出し元は操作ログの操作者プルダウンだけ。
 *
 * 書き換える操作をまだ持たないので可変状態は持たない（resetMockState の対象外）。
 */
export const userHandlers = [
  http.get('*/api/masters/users', ({ request }) => {
    const params = new URL(request.url).searchParams
    const role = params.get('role') ?? ''
    const branchCode = params.get('branch_code') ?? ''
    const includeInactive = params.get('include_inactive') === 'true'
    const limit = toNonNegativeInt(params.get('limit'), 50)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    const filtered = users.filter(
      (user) =>
        (includeInactive || user.有効フラグ === 1) &&
        (!role || user.ロールコード === role) &&
        (!branchCode || user.部店コード === branchCode),
    )

    return HttpResponse.json({
      total: filtered.length,
      limit,
      offset,
      operators: filtered.slice(offset, offset + limit),
    })
  }),
]
