import { apiClient } from './client'

/**
 * 受注不可日の一覧を取得する。
 *
 * ページャーを持つ一覧なので、配列ではなく `{ items, total }` を返す。
 * （ページングの無い一覧は fetchOrders のように配列を返してよい）
 *
 * API 仕様は未確定。docs/api/openapi.json の /blackout-dates は要素のスキーマが未定義なので、
 * limit / offset + total の一般的な形で受ける（海外休場日と同じ判断）。
 *
 * @param {{ limit?: number, offset?: number, dateFrom?: string, dateTo?: string }} [params]
 *   dateFrom / dateTo は 'YYYY-MM-DD'。空文字は「条件なし」としてリクエストに載せない
 * @returns {Promise<{
 *   items: Array<{ id: string, date: string, market: string, reason: string }>,
 *   total: number,
 * }>}
 */
export async function fetchBlockedDates({
  limit = 50,
  offset = 0,
  dateFrom = '',
  dateTo = '',
} = {}) {
  const { data } = await apiClient.get('/blocked-dates', {
    // クエリ名が snake_case であることを知ってよいのは、この層だけ。
    // 値が undefined のパラメータは axios が送らない
    params: {
      limit,
      offset,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    },
  })

  return {
    items: (data.items ?? []).map(toBlockedDate),
    total: data.total ?? 0,
  }
}

function toBlockedDate(raw) {
  return {
    id: raw.id,
    // 'YYYY-MM-DD' のまま持つ。Date に通すと UTC 深夜として解釈され、
    // UTC より西のタイムゾーンで前日にずれる
    date: raw.date,
    market: raw.market,
    reason: raw.reason,
  }
}
