import { apiClient } from './client'

/**
 * 海外休場日の一覧を取得する。
 *
 * ページャーを持つ一覧なので、配列ではなく `{ items, total }` を返す。
 * （ページングの無い一覧は fetchOrders のように配列を返してよい）
 *
 * @param {{ limit?: number, offset?: number, dateFrom?: string, dateTo?: string,
 *   holidayType?: string }} [params]
 *   dateFrom / dateTo は 'YYYY-MM-DD'、holidayType は '0'（終日休場）/ '1'（短縮取引）。
 *   空文字は「条件なし」としてリクエストに載せない
 * @returns {Promise<{
 *   items: Array<{ id: string, date: string, reason: string, holidayType: string }>,
 *   total: number
 * }>}
 */
export async function fetchMarketHolidays({
  limit = 50,
  offset = 0,
  dateFrom = '',
  dateTo = '',
  holidayType = '',
} = {}) {
  const { data } = await apiClient.get('/market-holidays', {
    // クエリ名が snake_case であることを知ってよいのは、この層だけ。
    // 値が undefined のパラメータは axios が送らない
    params: {
      limit,
      offset,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      holiday_type: holidayType || undefined,
    },
  })

  return {
    items: (data.items ?? []).map(toMarketHoliday),
    total: data.total ?? 0,
  }
}

function toMarketHoliday(raw) {
  return {
    id: raw.id,
    // 'YYYY-MM-DD' のまま持つ。Date に通すと UTC 深夜として解釈され、
    // UTC より西のタイムゾーンで前日にずれる
    date: raw.date,
    reason: raw.reason,
    holidayType: raw.holiday_type ?? '',
  }
}

/**
 * 海外休場日を 1 件登録する。
 *
 * @param {{ date: string, reason: string, holidayType: string }} params
 *   date は 'YYYY-MM-DD'、holidayType は '0'（終日休場）/ '1'（短縮取引）
 * @returns {Promise<{ id: string, date: string, reason: string, holidayType: string }>}
 *   登録された 1 件
 */
export async function createMarketHoliday({ date, reason, holidayType }) {
  const { data } = await apiClient.post('/market-holidays', {
    // date / reason は 1 語なので snake_case との差は無いが、
    // 変換の責務がこの層にあることを明示するため素通しの形でも書き出す
    date,
    reason,
    holiday_type: holidayType,
  })

  return toMarketHoliday(data)
}

/**
 * 海外休場日を 1 件削除する。
 *
 * 応答に本文は無い（204）。呼び出し側が useAsync で成否を判定できるよう、
 * undefined ではなく削除した id を返す。
 *
 * @param {string} id 削除対象の id
 * @returns {Promise<string>} 削除した id
 */
export async function deleteMarketHoliday(id) {
  await apiClient.delete(`/market-holidays/${encodeURIComponent(id)}`)
  return id
}
