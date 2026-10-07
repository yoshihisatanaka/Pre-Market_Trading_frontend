import { http, HttpResponse } from 'msw'
import { mizuhoExecutions } from '../fixtures/mizuhoExecutions'
import { toNonNegativeInt, toStatusList } from './_shared'
import { toExecutionsCsvResponse } from './executions'

/** 注文ルート（預託先）のみずほ。実 API は名称（'みずほ'）でも受け付ける */
const MIZUHO_ROUTES = new Set(['0', 'みずほ'])

/** `/executions` が 1 ページで返す件数の既定値（実 API の limit の既定 50） */
const EXECUTIONS_DEFAULT_LIMIT = 50

/** 約定日の条件（YYYYMMDD または YYYY-MM-DD）→ 'YYYY-MM-DD'。読めなければ '' */
function toIsoDate(value) {
  const digits = (value ?? '').replaceAll('-', '')
  return /^\d{8}$/.test(digits)
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    : ''
}

/** 同じ検索条件での集計（ExecutionSummary）。ページの切り出し前の行から数える */
function summarize(rows) {
  return {
    件数: rows.length,
    注文件数: new Set(rows.map((row) => row.注文ID)).size,
    売件数: rows.filter((row) => row.売買区分 === '1').length,
    買件数: rows.filter((row) => row.売買区分 === '3').length,
    // 一部出来（処理状況 010）の注文の件数。約定の行数ではなく注文 ID で数える（仕様の説明どおり）
    一部出来件数: new Set(rows.filter((row) => row.処理状況 === '010').map((row) => row.注文ID))
      .size,
    約定数量合計: rows.reduce((sum, row) => sum + row.約定数量, 0),
    約定代金合計_USD: rows.reduce((sum, row) => sum + (row.約定代金 ?? 0), 0),
    手数料合計_USD: rows.reduce((sum, row) => sum + (row.手数料 ?? 0), 0),
  }
}

export const mizuhoExecutionHandlers = [
  /*
   * 約定一覧のうち、預託先＝みずほ（route=0）の問い合わせだけに応える。
   * それ以外（route なし・IB など）は何も返さず、次に一致するハンドラ
   * （約定照会のモック）か実 API へ流す。クエリ名は実 API と同じ（絞り込みは filterMizuhoExecutions）。
   */
  http.get('*/api/executions', ({ request }) => {
    const params = new URL(request.url).searchParams
    if (!MIZUHO_ROUTES.has(params.get('route') ?? '')) return

    const limit = toNonNegativeInt(params.get('limit'), EXECUTIONS_DEFAULT_LIMIT)
    const offset = toNonNegativeInt(params.get('offset'), 0)
    const filtered = sortByExecutedAt(filterMizuhoExecutions(params), params.get('sort') === 'asc')

    return HttpResponse.json({
      // total は絞り込み後・ページ切り出し前の件数。summary も同じ範囲で数える
      total: filtered.length,
      limit,
      offset,
      summary: summarize(filtered),
      executions: filtered.slice(offset, offset + limit),
    })
  }),

  // CSV 出力も route=0 だけを拾う。条件は一覧と同じで、並びは約定日時の昇順（約定照会のモックと同じ書式）
  http.get('*/api/executions/export-csv', ({ request }) => {
    const params = new URL(request.url).searchParams
    if (!MIZUHO_ROUTES.has(params.get('route') ?? '')) return

    return toExecutionsCsvResponse(sortByExecutedAt(filterMizuhoExecutions(params), true))
  }),
]

/*
 * 検索条件（一覧と CSV 出力で共通のクエリ）に合う行を返す。
 * 部店・売買区分は完全一致、処理状況はカンマ区切りのどれかに一致、銘柄は銘柄コードか Ticker への完全一致
 * （大文字小文字を区別しない）、約定日は日付部分での範囲。
 */
function filterMizuhoExecutions(params) {
  const branchCode = params.get('branch_code') ?? ''
  const symbol = (params.get('symbol') ?? '').trim().toUpperCase()
  const side = params.get('side') ?? ''
  // 処理状況はカンマ区切りで複数指定できる（例: 032,034）
  const statuses = toStatusList(params.get('status'))
  const startDate = toIsoDate(params.get('start_date'))
  const endDate = toIsoDate(params.get('end_date'))

  return mizuhoExecutions.filter((row) => {
    const executedOn = (row.約定日時 ?? '').slice(0, 10)
    return (
      (!branchCode || row.部店 === branchCode) &&
      (!symbol || row.銘柄コード === symbol || row.Ticker === symbol) &&
      (!side || row.売買区分 === side) &&
      (statuses.length === 0 || statuses.includes(row.処理状況)) &&
      (!startDate || executedOn >= startDate) &&
      (!endDate || executedOn <= endDate)
    )
  })
}

function sortByExecutedAt(rows, ascending) {
  return [...rows].sort((a, b) =>
    ascending ? a.約定日時.localeCompare(b.約定日時) : b.約定日時.localeCompare(a.約定日時),
  )
}
