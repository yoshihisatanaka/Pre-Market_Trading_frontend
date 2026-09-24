import { http, HttpResponse } from 'msw'
import { ACTOR_GROUP_ROLES, activityLogs } from '../fixtures/activityLogs'
import { toNonNegativeInt } from './_shared'

export const activityLogHandlers = [
  /*
   * 操作ログの一覧。
   *
   * **実 API とは形が違う。** openapi.json の ActivityLogItem には 操作区分（業務操作 等）・
   * 操作者名・実行者区分・対象機能・操作内容・内容・結果 が無く、クエリも
   * start_date / end_date / operator / operation / target_types / target_key / sort しか無い
   * （期間と操作区分のクエリ名は 2026-09-18 の取り込みで変わった。src/api/activityLogs.js を参照）。
   * ここは画面モックの見た目を出すための暫定で、実 API が繋がったらこのハンドラを消し、
   * src/api/activityLogs.js の変換と画面の列を仕様側と決め直す。
   *
   * 書き換える操作が無いので可変状態は持たない（resetMockState の対象外）。
   */
  http.get('*/api/operations/activity-logs', ({ request }) => {
    const params = new URL(request.url).searchParams
    const dateFrom = params.get('start_date') ?? ''
    const dateTo = params.get('end_date') ?? ''
    const operator = params.get('operator') ?? ''
    const category = params.get('operation') ?? ''
    const feature = params.get('feature') ?? ''
    const action = params.get('action') ?? ''
    const actorGroup = params.get('actor_group') ?? ''
    const result = params.get('result') ?? ''
    const targetKey = params.get('target_key') ?? ''
    const limit = toNonNegativeInt(params.get('limit'), 50)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    // 操作日時は 'YYYY-MM-DDTHH:MM:SS' なので、日付部分の文字列比較がそのまま日付の大小になる
    const filtered = activityLogs.filter((log) => {
      const date = log.操作日時.slice(0, 10)

      return (
        (!dateFrom || date >= dateFrom) &&
        (!dateTo || date <= dateTo) &&
        (!operator || log.操作者コード === operator) &&
        (!category || log.操作区分 === category) &&
        (!feature || log.対象機能 === feature) &&
        (!action || log.操作内容 === action) &&
        (!actorGroup || (ACTOR_GROUP_ROLES[actorGroup] ?? []).includes(log.実行者区分)) &&
        (!result || log.結果 === result) &&
        // 「対象ID・名称」は対象の表示名とキーのどちらに当たってもよい
        (!targetKey || log.対象表示名.includes(targetKey) || log.対象キー.includes(targetKey))
      )
    })

    return HttpResponse.json({
      // total は絞り込み後・ページ切り出し前の件数
      total: filtered.length,
      limit,
      offset,
      // フィクスチャが既に操作日時の降順なので、ここでは並べ替えない
      activity_logs: filtered.slice(offset, offset + limit),
    })
  }),
]
