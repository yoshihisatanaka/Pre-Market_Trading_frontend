import { apiClient } from './client'

/*
 * 受注不可日マスタ（実 API `/blackout-dates`）。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次の 6 点。
 *   - プロパティ名が日本語（受注不可日 / 備考 / 取消区分 …）
 *   - 受注不可日は integer の YYYYMMDD（20260101）。アプリ内は 'YYYY-MM-DD'
 *   - id が無い。主キーは受注不可日そのもの
 *   - 一覧は受注不可日の降順で、1 ページ 50 件固定（`limit` を受け付けない）
 *   - 削除は論理削除（取消区分=1）。一覧は既定で取消済みを返さない
 *   - 対象市場に相当する項目が無い（一覧にも列を出さない）
 * 更新系は `X-User-Code` ヘッダが必須。付与は client.js の interceptor が全 API 共通で行う。
 */

/** 1 件のアプリ内モデル（このファイルの JSDoc で使う） */
/**
 * @typedef {{ id: string, date: string, reason: string, updatedAt: string }} BlockedDate
 *   id は受注不可日を文字列にしたもの（'20260101'）。date は 'YYYY-MM-DD'、
 *   reason は実 API の 備考。updatedAt は編集の楽観的ロックで送り返す合札
 */

/**
 * 受注不可日の一覧を取得する。
 *
 * ページャーを持つ一覧なので、配列ではなく `{ items, total }` を返す。
 * （ページングの無い一覧は fetchOrders のように配列を返してよい）
 *
 * 取消済み（論理削除）の行は含めない。実 API の include_deleted は既定 false なので送らない。
 *
 * `limit` は受け取るが送らない。実 API の一覧は 1 ページ 50 件で固定されており
 * `limit` というクエリを持たない（応答の limit は常に 50）。ページャーの表示件数は
 * stores/blockedDates.js の BLOCKED_DATES_PAGE_SIZE 側で 50 に合わせてある。
 *
 * @param {{ limit?: number, offset?: number, dateFrom?: string, dateTo?: string }} [params]
 *   dateFrom / dateTo は 'YYYY-MM-DD'。空文字は「条件なし」としてリクエストに載せない
 * @returns {Promise<{ items: BlockedDate[], total: number }>} 受注不可日の降順
 */
export async function fetchBlockedDates({ offset = 0, dateFrom = '', dateTo = '' } = {}) {
  const { data } = await apiClient.get('/blackout-dates', {
    // クエリ名と日付が integer であることを知ってよいのは、この層だけ。
    // 値が undefined のパラメータは axios が送らない
    params: {
      offset,
      start_date: toApiDate(dateFrom),
      end_date: toApiDate(dateTo),
    },
  })

  return {
    items: (data.blackout_dates ?? []).map(toBlockedDate),
    total: data.total ?? 0,
  }
}

/**
 * 受注不可日の入力内容を事前検証する（DB には登録・更新しない）。
 *
 * 実 API は「事前検証を通過した内容を登録する」前提で、日付の実在性や重複はサーバだけが
 * 判断できる。登録・更新の前にこれを呼び、不合格ならそこへ進まない。
 *
 * 不合格は例外にしない（`{ valid: false, errors }` を返す）。通信・サーバ障害だけが throw される。
 * warnings は実 API が常に空配列を返すため受け取らない（海外休場日と違い、取消済みの日付を
 * 登録し直しても実 API は警告を出さず、そのまま再有効化する）。
 *
 * `is_update` の使いかたに注意がある。実 API の変更検証は「本文の受注不可日が実在し、かつ
 * 取消済みでないこと」を確かめるものなので、**日付を変えるときに使うと「存在しません」で弾かれる**。
 * 一方、日付を変えないときに新規検証を使うと自分自身が重複として弾かれる。
 * そこで日付を変えたかどうかで使い分ける（id は変更前の受注不可日そのもの）。
 *
 * @param {{ date: string, reason: string, id?: string }} params date は 'YYYY-MM-DD'。
 *   id は編集のときだけ渡す（変更前の受注不可日。'20260101'）
 * @returns {Promise<{ valid: boolean, errors: string[] }>}
 *   valid が false のときだけ errors に理由が入る
 */
export async function validateBlockedDate({ date, reason, id = '' }) {
  const isUpdate = Boolean(id) && id === toApiKey(date)

  const { data } = await apiClient.post(
    '/blackout-dates/validate',
    toBlackoutDateRequest({ date, reason }),
    // 既定が新規検証なので、変更検証のときだけクエリを付ける
    isUpdate ? { params: { is_update: true } } : undefined,
  )

  return {
    valid: Boolean(data?.valid),
    // errors は default_factory 付きだが、実 API 以外（プロキシのエラー等）に備える
    errors: Array.isArray(data?.errors) ? data.errors : [],
  }
}

/**
 * 受注不可日を 1 件登録する。
 *
 * 取消済みの同じ日付があるときは、実 API 側が再有効化として扱う（新規行は増えない）。
 * 海外休場日と違い事前検証は警告を返さないので、画面はその区別をしない。
 *
 * @param {{ date: string, reason: string }} params date は 'YYYY-MM-DD'
 * @returns {Promise<BlockedDate>} 登録された 1 件
 */
export async function createBlockedDate({ date, reason }) {
  const { data } = await apiClient.post('/blackout-dates', toBlackoutDateRequest({ date, reason }))

  return toBlockedDate(data.blackout_date)
}

/**
 * 受注不可日を 1 件更新する（日付と理由の両方を変更できる）。
 *
 * パスは変更前の受注不可日、本文の 受注不可日 が変更後の日付になる。
 *
 * updatedAt は一覧取得時の更新日時をそのまま送り返す楽観的ロックの合札で、
 * サーバ側の現在値と違えば 409 で弾かれる（他の利用者が先に更新していた場合）。
 * 値は照合するだけなので Date には通さない。空のときはキーごと送らない
 * （登録直後の行は実 API 側の更新日時が未設定で、照合する相手が無い）。
 *
 * @param {{ id: string, date: string, reason: string, updatedAt: string }} params
 *   id は変更前の受注不可日（'20260101'）、date は変更後の 'YYYY-MM-DD'
 * @returns {Promise<BlockedDate>} 更新後の 1 件
 */
export async function updateBlockedDate({ id, date, reason, updatedAt }) {
  const { data } = await apiClient.put(
    `/blackout-dates/${encodeURIComponent(id)}`,
    toBlackoutDateRequest({ date, reason, updatedAt }),
  )

  return toBlockedDate(data.blackout_date)
}

/**
 * 受注不可日を 1 件削除する（実 API は論理削除。取消区分=1 になる）。
 *
 * 応答は削除後の 1 件（BlackoutDateResponse）だが、画面は削除前の行を使ってメッセージを出すので
 * 使い道が無い。呼び出し側が useAsync で成否を判定できるよう、削除した id を返す。
 *
 * @param {string} id 削除対象の id（= 受注不可日の 'YYYYMMDD'）
 * @returns {Promise<string>} 削除した id
 */
export async function deleteBlockedDate(id) {
  await apiClient.delete(`/blackout-dates/${encodeURIComponent(id)}`)
  return id
}

/** アプリ内モデル → BlackoutDateRequest（登録・更新・事前検証で共用する入力の形） */
function toBlackoutDateRequest({ date, reason, updatedAt = '' }) {
  return {
    受注不可日: toApiDate(date),
    備考: reason,
    // 合札が無いときはキーごと送らない（実 API 側は未指定を「照合しない」と解釈する）
    ...(updatedAt ? { 更新日時: updatedAt } : {}),
  }
}

/** BlackoutDateItem → アプリ内モデル */
function toBlockedDate(raw) {
  return {
    // 実 API に id は無く、主キーは受注不可日そのもの。
    // 画面と URL では文字列の id として扱うので、ここで 'YYYYMMDD' に寄せる
    id: toApiKey(toIsoDate(raw?.受注不可日)),
    date: toIsoDate(raw?.受注不可日),
    // 備考は nullable。空文字に寄せて、画面が null を出さないようにする
    reason: raw?.備考 ?? '',
    /*
     * 楽観的ロックの合札。実 API は ISO の日時（'2026-09-11T10:00:00'）を返し、
     * 登録直後の行では null になる。照合はサーバが行うので Date には通さず素の文字列で持つ。
     * undefined のまま持つと更新時の JSON.stringify でキーごと消え、サーバから見て
     * 「送っていない」と「空」が区別できなくなるため文字列に寄せる。
     */
    updatedAt: raw?.更新日時 ?? '',
  }
}

/**
 * 'YYYY-MM-DD' → 20260101。
 * 空文字や形の違うものは undefined にして、クエリに載せない・本文に入れない。
 */
function toApiDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? Number(date.replaceAll('-', '')) : undefined
}

/**
 * 'YYYY-MM-DD' → '20260101'（主キーとして使う文字列）。
 * 形の違うものは空文字にする。toApiDate と違い、パスや id の比較に使うので文字列で返す。
 */
function toApiKey(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date.replaceAll('-', '') : ''
}

/**
 * 20260101 → '2026-01-01'。
 *
 * Date には通さない。UTC 深夜として解釈され、UTC より西のタイムゾーンで前日にずれる。
 */
function toIsoDate(value) {
  const digits = String(value ?? '')
  if (!/^\d{8}$/.test(digits)) return ''

  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}
