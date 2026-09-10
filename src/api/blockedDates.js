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
 *   items: Array<{
 *     id: string, date: string, market: string, reason: string, updatedAt: string,
 *   }>,
 *   total: number,
 * }>} updatedAt は編集の楽観的ロックで送り返す合札（updateBlockedDate 参照）
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
 * 編集のときは id を渡す。日付を変えずに理由だけ直す場合に「自分自身と重複している」と
 * 弾かれないよう、更新であることと対象をサーバへ伝える。
 *
 * @param {{ date: string, reason: string, id?: string }} params date は 'YYYY-MM-DD'。
 *   id は編集のときだけ渡す（省略時は新規登録の事前検証として扱われる）
 * @returns {Promise<{ valid: boolean, errors: string[] }>}
 *   valid が false のときだけ errors に理由が入る
 */
export async function validateBlockedDate({ date, reason, id = '' }) {
  const { data } = await apiClient.post(
    '/blocked-dates/validate',
    { date, reason },
    // 実仕様の /blackout-dates/validate は is_update しか持たず、対象を渡す口が無い
    // （兄弟 API の /market-holidays/validate は holiday_date を持つ）。
    // 自己除外の判断にはサーバ側でも対象が必要なので、同じ場所に id を載せて補っている
    id ? { params: { is_update: true, id } } : undefined,
  )

  return {
    valid: Boolean(data?.valid),
    errors: Array.isArray(data?.errors) ? data.errors : [],
  }
}

/**
 * 受注不可日を 1 件登録する。
 *
 * 対象市場（market）は送らない。docs/api/openapi.json の BlackoutDateRequest に
 * 対応する項目が無く、サーバ側が既定値を決める前提（一覧にも列は出さない）。
 *
 * @param {{ date: string, reason: string }} params date は 'YYYY-MM-DD'
 * @returns {Promise<{
 *   id: string, date: string, market: string, reason: string, updatedAt: string,
 * }>} 登録された 1 件
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
 * 受注不可日を 1 件更新する（日付と理由の両方を変更できる）。
 *
 * updatedAt は一覧取得時の更新日時をそのまま送り返す楽観的ロックの合札で、
 * サーバ側の現在値と違えば 409 で弾かれる（他の利用者が先に更新していた場合）。
 * 値は照合するだけなので Date には通さない。
 *
 * 実仕様（docs/api/openapi.json の Update Blackout Date Endpoint）とのギャップ:
 * パスは `PUT /blackout-dates/{blackout_date}` で主キーは日付の integer / 本文は日本語キーの
 * BlackoutDateRequest / `X-User-Code` ヘッダ必須（認証方式が決まったら client.js の
 * interceptor で全 API に付けるので、ここでは付けない）/ 応答は BlackoutDateResponse。
 * 一覧・登録・削除が /blocked-dates のままなので、画面内の一貫性を優先して同じ形で受ける。
 *
 * @param {{ id: string, date: string, reason: string, updatedAt: string }} params
 *   date は 'YYYY-MM-DD'、updatedAt は 'YYYY-MM-DD HH:MM:SS'
 * @returns {Promise<{
 *   id: string, date: string, market: string, reason: string, updatedAt: string,
 * }>} 更新後の 1 件
 */
export async function updateBlockedDate({ id, date, reason, updatedAt }) {
  const { data } = await apiClient.put(`/blocked-dates/${encodeURIComponent(id)}`, {
    date,
    reason,
    updated_at: updatedAt,
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
    // 楽観的ロックの合札。'YYYY-MM-DD HH:MM:SS' は非 ISO でブラウザ差があるので
    // date と同じく Date には通さない。undefined のまま持つと更新時の JSON.stringify で
    // キーごと消え、サーバから見て「送っていない」と「空」が区別できなくなるため文字列に寄せる
    updatedAt: raw.updated_at ?? '',
  }
}
