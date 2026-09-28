import { http, HttpResponse } from 'msw'
import { mizuhoExecutions } from '../fixtures/mizuhoExecutions'
import { toNonNegativeInt } from './_shared'

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
    約定数量合計: rows.reduce((sum, row) => sum + row.約定数量, 0),
    約定代金合計_USD: rows.reduce((sum, row) => sum + (row.約定代金 ?? 0), 0),
    手数料合計_USD: rows.reduce((sum, row) => sum + (row.手数料 ?? 0), 0),
  }
}

export const mizuhoExecutionHandlers = [
  /*
   * 約定一覧のうち、預託先＝みずほ（route=0）の問い合わせだけに応える。
   * それ以外（route なし・IB など）は何も返さず、次に一致するハンドラ
   * （約定照会のモックができればそちら）か実 API へ流す。
   *
   * クエリ名は実 API と同じ。部店・売買区分・処理状況は完全一致、銘柄は銘柄コードか
   * Ticker への完全一致（大文字小文字を区別しない）、約定日は日付部分での範囲。
   */
  http.get('*/api/executions', ({ request }) => {
    const params = new URL(request.url).searchParams
    if (!MIZUHO_ROUTES.has(params.get('route') ?? '')) return

    const branchCode = params.get('branch_code') ?? ''
    const symbol = (params.get('symbol') ?? '').trim().toUpperCase()
    const side = params.get('side') ?? ''
    const status = params.get('status') ?? ''
    const startDate = toIsoDate(params.get('start_date'))
    const endDate = toIsoDate(params.get('end_date'))
    const ascending = params.get('sort') === 'asc'
    const limit = toNonNegativeInt(params.get('limit'), EXECUTIONS_DEFAULT_LIMIT)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    const filtered = mizuhoExecutions
      .filter((row) => {
        const executedOn = (row.約定日時 ?? '').slice(0, 10)
        return (
          (!branchCode || row.部店 === branchCode) &&
          (!symbol || row.銘柄コード === symbol || row.Ticker === symbol) &&
          (!side || row.売買区分 === side) &&
          (!status || row.処理状況 === status) &&
          (!startDate || executedOn >= startDate) &&
          (!endDate || executedOn <= endDate)
        )
      })
      .sort((a, b) =>
        ascending ? a.約定日時.localeCompare(b.約定日時) : b.約定日時.localeCompare(a.約定日時),
      )

    return HttpResponse.json({
      // total は絞り込み後・ページ切り出し前の件数。summary も同じ範囲で数える
      total: filtered.length,
      limit,
      offset,
      summary: summarize(filtered),
      executions: filtered.slice(offset, offset + limit),
    })
  }),
]
