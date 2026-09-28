import { http, HttpResponse } from 'msw'
import { executions } from '../fixtures/executions'
import { toNonNegativeInt } from './_shared'

/*
 * 約定照会。クエリ名と応答の形は openapi.json の `GET /executions`（ExecutionListResponse）に
 * 合わせてある。
 *
 * 書き換える操作が無いので可変状態は持たない（resetMockState の対象外）。
 * CSV 出力（`GET /executions/export-csv`）は画面側が未実装なので、まだハンドラを置かない。
 */

/** `/executions` は limit（1〜200・既定 50）を受け取る。これはクエリが無いときに使う値 */
const EXECUTIONS_DEFAULT_LIMIT = 50

export const executionHandlers = [
  http.get('*/api/executions', ({ request }) => {
    const params = new URL(request.url).searchParams
    const branchCode = params.get('branch_code') ?? ''
    const accountNo = toNonNegativeInt(params.get('account_no'), 0)
    const symbol = (params.get('symbol') ?? '').trim().toUpperCase()
    const side = params.get('side') ?? ''
    const route = params.get('route') ?? ''
    const status = params.get('status') ?? ''
    // 仕様は YYYY-MM-DD と YYYYMMDD の両方を受けるので、比較の前にハイフン付きへ揃える
    const dateFrom = toIsoDate(params.get('start_date') ?? '')
    const dateTo = toIsoDate(params.get('end_date') ?? '')
    const sort = params.get('sort') === 'asc' ? 'asc' : 'desc'
    const limit = toNonNegativeInt(params.get('limit'), EXECUTIONS_DEFAULT_LIMIT)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    // 約定日時は 'YYYY-MM-DDTHH:MM:SS' なので、日付部分の文字列比較がそのまま日付の大小になる
    const filtered = executions.filter((row) => {
      const date = (row.約定日時 ?? '').slice(0, 10)

      return (
        // 部店コードは完全一致（仕様の説明どおり）
        (!branchCode || row.部店 === branchCode) &&
        (!accountNo || row.口座番号 === accountNo) &&
        // 銘柄コードまたは Ticker のどちらかに一致すればよい
        (!symbol ||
          row.銘柄コード.toUpperCase() === symbol ||
          (row.Ticker ?? '').toUpperCase() === symbol) &&
        (!side || row.売買区分 === side) &&
        // 預託先はコード値・名称のどちらでも指定できる（仕様の説明どおり）
        (!route || row.注文ルート === route || row.注文ルート名 === route) &&
        (!status || row.処理状況 === status) &&
        (!dateFrom || date >= dateFrom) &&
        (!dateTo || date <= dateTo)
      )
    })

    // 約定日時の並び。同じ日時なら ID で並べて順序を安定させる
    const direction = sort === 'asc' ? 1 : -1
    const sorted = [...filtered].sort(
      (a, b) => direction * (a.約定日時.localeCompare(b.約定日時) || a.ID - b.ID),
    )

    return HttpResponse.json({
      // total と summary は絞り込み後・ページ切り出し前の件数
      total: sorted.length,
      limit,
      offset,
      summary: summarize(sorted),
      executions: sorted.slice(offset, offset + limit),
    })
  }),
]

/** ExecutionSummary（同じ検索条件での集計）を組み立てる */
function summarize(rows) {
  const sum = (pick) => rows.reduce((total, row) => total + (pick(row) ?? 0), 0)

  return {
    件数: rows.length,
    注文件数: new Set(rows.map((row) => row.注文ID)).size,
    売件数: rows.filter((row) => row.売買区分 === '1').length,
    買件数: rows.filter((row) => row.売買区分 === '3').length,
    約定数量合計: sum((row) => row.約定数量),
    // 浮動小数の足し算の誤差をセント単位で丸める
    約定代金合計_USD: Math.round(sum((row) => row.約定代金) * 100) / 100,
    手数料合計_USD: Math.round(sum((row) => row.手数料) * 100) / 100,
  }
}

/** `20260916` → `2026-09-16`。それ以外はそのまま返す */
function toIsoDate(value) {
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
    : value
}
