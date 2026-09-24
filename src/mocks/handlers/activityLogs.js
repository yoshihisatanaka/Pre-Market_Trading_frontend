import { http, HttpResponse } from 'msw'
import { activityLogs } from '../fixtures/activityLogs'
import { activityLogTargets } from '../fixtures/activityLogTargets'
import { toNonNegativeInt } from './_shared'

/*
 * 操作ログ。クエリ名と応答の形は openapi.json の `GET /operations/activity-logs` /
 * `GET /operations/activity-logs/targets` に合わせてある。
 *
 * 書き換える操作が無いので可変状態は持たない（resetMockState の対象外）。
 */
export const activityLogHandlers = [
  // 対象種別の一覧（検索のプルダウン用）
  http.get('*/api/operations/activity-logs/targets', () =>
    HttpResponse.json({ targets: activityLogTargets }),
  ),

  http.get('*/api/operations/activity-logs', ({ request }) => {
    const params = new URL(request.url).searchParams
    // 仕様は YYYY-MM-DD と YYYYMMDD の両方を受けるので、比較の前にハイフン付きへ揃える
    const dateFrom = toIsoDate(params.get('start_date') ?? '')
    const dateTo = toIsoDate(params.get('end_date') ?? '')
    const operator = params.get('operator') ?? ''
    const operation = params.get('operation') ?? ''
    const targetTypes = (params.get('target_types') ?? '').split(',').filter(Boolean)
    const targetKey = params.get('target_key') ?? ''
    const sort = params.get('sort') ?? 'desc'
    const limit = toNonNegativeInt(params.get('limit'), 50)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    // 操作日時は 'YYYY-MM-DDTHH:MM:SS' なので、日付部分の文字列比較がそのまま日付の大小になる
    const filtered = activityLogs.filter((log) => {
      const date = (log.操作日時 ?? '').slice(0, 10)

      return (
        (!dateFrom || date >= dateFrom) &&
        (!dateTo || date <= dateTo) &&
        // 操作者・操作区分は完全一致、対象キーは部分一致（仕様の説明どおり）
        (!operator || log.操作者 === operator) &&
        (!operation || log.操作区分 === operation) &&
        (targetTypes.length === 0 || targetTypes.includes(log.対象種別)) &&
        (!targetKey || (log.対象キー ?? '').includes(targetKey))
      )
    })

    // フィクスチャは操作日時の降順。asc のときだけ反転する
    const sorted = sort === 'asc' ? [...filtered].reverse() : filtered

    return HttpResponse.json({
      // total は絞り込み後・ページ切り出し前の件数
      total: sorted.length,
      limit,
      offset,
      activity_logs: sorted.slice(offset, offset + limit),
    })
  }),
]

/** `20260916` → `2026-09-16`。それ以外はそのまま返す */
function toIsoDate(value) {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}` : value
}
