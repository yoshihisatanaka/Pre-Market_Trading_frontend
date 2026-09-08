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

/**
 * 受注不可日の入力内容を事前検証する（DB には登録しない）。
 *
 * 実仕様（docs/api/openapi.json の Validate Blackout Date Endpoint）では、登録は
 * 「事前検証を通過した内容を登録する」前提になっている。日付の実在性や重複はサーバだけが
 * 判断できるので、登録の前にこれを呼ぶ。
 *
 * 応答の warnings / details は今回扱わない（実仕様が固まってから足す）。
 *
 * @param {{ date: string, reason: string }} params date は 'YYYY-MM-DD'
 * @returns {Promise<{ valid: boolean, errors: string[] }>}
 *   valid が false のときだけ errors に理由が入る
 */
export async function validateBlockedDate({ date, reason }) {
  const { data } = await apiClient.post('/blocked-dates/validate', { date, reason })

  return {
    valid: Boolean(data?.valid),
    errors: Array.isArray(data?.errors) ? data.errors : [],
  }
}

/**
 * 受注不可日を 1 件登録する。
 *
 * 対象市場（market）は送らない。一覧には列があるが、docs/api/openapi.json の
 * BlackoutDateRequest に対応する項目が無く、サーバ側が既定値を決める前提。
 *
 * @param {{ date: string, reason: string }} params date は 'YYYY-MM-DD'
 * @returns {Promise<{ id: string, date: string, market: string, reason: string }>}
 *   登録された 1 件
 */
export async function createBlockedDate({ date, reason }) {
  const { data } = await apiClient.post('/blocked-dates', {
    // date / reason は 1 語なので snake_case との差は無いが、
    // 変換の責務がこの層にあることを明示するため素通しの形でも書き出す
    date,
    reason,
  })

  return toBlockedDate(data)
}

/**
 * 受注不可日を 1 件削除する。
 *
 * 実仕様（docs/api/openapi.json の Delete Blackout Date Endpoint）は論理削除で 200 + 本文だが、
 * 一覧・登録が /blocked-dates のままなので、画面内の一貫性を優先して海外休場日と同じ
 * 「204 で本文なし」の形で受ける（API が固まったら 3 本まとめて直す）。
 *
 * @param {string} id 削除対象の id
 * @returns {Promise<string>} 削除した id
 */
export async function deleteBlockedDate(id) {
  await apiClient.delete(`/blocked-dates/${encodeURIComponent(id)}`)
  // 204 は本文が無いので、呼び出し側（useAsync）が成功を判定できるよう id を返す
  return id
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
