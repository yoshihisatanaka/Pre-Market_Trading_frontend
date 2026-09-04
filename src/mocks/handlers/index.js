import { http, HttpResponse } from 'msw'
import { orderListResponse } from '../fixtures/orders'
import { marketHolidays } from '../fixtures/marketHolidays'

/*
 * モックハンドラの集約。
 *
 * ルール:
 *  - パスは `* + baseURL` で始める（`*` で origin の違いを吸収し、ブラウザ/Node 双方で一致させる）
 *  - バックエンドで実装された API は、このリストから削除する。
 *    未定義のリクエストは実 API へ素通しされるため、削除するだけで本物に切り替わる。
 */
export const handlers = [
  http.get('*/api/orders', () => HttpResponse.json(orderListResponse)),

  // 海外休場日マスタ。API 仕様は未確定なので limit / offset + total の一般的な形で受ける
  http.get('*/api/market-holidays', ({ request }) => {
    const params = new URL(request.url).searchParams
    const dateFrom = params.get('date_from') ?? ''
    const dateTo = params.get('date_to') ?? ''
    const limit = toNonNegativeInt(params.get('limit'), 50)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    // 'YYYY-MM-DD' は固定長なので、文字列比較がそのまま日付の大小になる
    const filtered = marketHolidays.filter(
      (holiday) => (!dateFrom || holiday.date >= dateFrom) && (!dateTo || holiday.date <= dateTo),
    )

    return HttpResponse.json({
      items: filtered.slice(offset, offset + limit),
      // total は絞り込み後・ページ切り出し前の件数
      total: filtered.length,
    })
  }),
]

function toNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}
