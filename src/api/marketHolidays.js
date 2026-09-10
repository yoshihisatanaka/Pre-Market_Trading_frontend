import { apiClient } from './client'

/*
 * 海外休場日マスタ（実 API `/holidays`）。
 *
 * バックエンドの形を知ってよいのはこの層だけ。この API は特に差が大きいので、
 * 変換の責務がここに閉じていることを意識して読むこと。
 *   - プロパティ名が日本語（休場日 / 休場区分 / 休場理由 …）
 *   - 日付は integer の YYYYMMDD（20260101）。アプリ内は 'YYYY-MM-DD'
 *   - id が無い。主キーは休場日そのもの
 *   - 削除は論理削除（取消区分=1）。一覧は既定で取消済みを返さない
 *   - 一覧は休場日の降順
 * 更新系は `X-User-Code` ヘッダが必須。付与は client.js の interceptor が全 API 共通で行う。
 */

/** 1 件のアプリ内モデル（このファイルの JSDoc で使う） */
/**
 * @typedef {{ id: string, date: string, reason: string, holidayType: string }} MarketHoliday
 *   id は休場日を文字列にしたもの（'20260101'）。date は 'YYYY-MM-DD'、
 *   holidayType は '0'（終日休場）/ '1'（短縮取引）
 */

/**
 * 海外休場日の一覧を取得する。
 *
 * ページャーを持つ一覧なので、配列ではなく `{ items, total }` を返す。
 * （ページングの無い一覧は fetchOrders のように配列を返してよい）
 *
 * 取消済み（論理削除）の行は含めない。実 API の include_deleted は既定 false なので送らない。
 *
 * @param {{ limit?: number, offset?: number, dateFrom?: string, dateTo?: string,
 *   holidayType?: string }} [params]
 *   dateFrom / dateTo は 'YYYY-MM-DD'、holidayType は '0'（終日休場）/ '1'（短縮取引）。
 *   空文字は「条件なし」としてリクエストに載せない
 * @returns {Promise<{ items: MarketHoliday[], total: number }>} 休場日の降順
 */
export async function fetchMarketHolidays({
  limit = 50,
  offset = 0,
  dateFrom = '',
  dateTo = '',
  holidayType = '',
} = {}) {
  const { data } = await apiClient.get('/holidays', {
    // クエリ名と日付が integer であることを知ってよいのは、この層だけ。
    // 値が undefined のパラメータは axios が送らない
    params: {
      limit,
      offset,
      start_date: toApiDate(dateFrom),
      end_date: toApiDate(dateTo),
      holiday_type: holidayType || undefined,
    },
  })

  return {
    items: (data.holidays ?? []).map(toMarketHoliday),
    total: data.total ?? 0,
  }
}

/**
 * 海外休場日の入力内容を事前検証する（DB には登録しない）。
 *
 * 実 API は「事前検証を通過した内容を登録する」前提で、日付の実在性や重複はサーバだけが
 * 判断できる。登録の前にこれを呼び、不合格なら登録に進まない。
 *
 * errors と warnings は扱いが違う。
 *   errors   … 登録できない理由（例: 「休場日 20260101 は既に登録されています」）
 *   warnings … 登録は通るが伝えるべきこと（例: 取消済みの日付を再有効化する）
 * どちらも例外にはしない。通信・サーバ障害だけが throw される。
 *
 * @param {{ date: string, reason: string, holidayType: string }} params date は 'YYYY-MM-DD'
 * @returns {Promise<{ valid: boolean, errors: string[], warnings: string[] }>}
 */
export async function validateMarketHoliday({ date, reason, holidayType }) {
  // 新規登録の検証なので holiday_date / is_update は送らない（既定が新規検証）
  const { data } = await apiClient.post(
    '/holidays/validate',
    toHolidayRequest({
      date,
      reason,
      holidayType,
    }),
  )

  return {
    valid: Boolean(data?.valid),
    // errors / warnings は required でも default 付きでもないので、無い場合に備える
    errors: Array.isArray(data?.errors) ? data.errors : [],
    warnings: Array.isArray(data?.warnings) ? data.warnings : [],
  }
}

/**
 * 海外休場日を 1 件登録する。
 *
 * 取消済みの同じ日付があるときは、実 API 側が再有効化として扱う（新規行は増えない）。
 *
 * @param {{ date: string, reason: string, holidayType: string }} params date は 'YYYY-MM-DD'
 * @returns {Promise<MarketHoliday>} 登録された 1 件
 */
export async function createMarketHoliday({ date, reason, holidayType }) {
  const { data } = await apiClient.post(
    '/holidays',
    toHolidayRequest({ date, reason, holidayType }),
  )

  return toMarketHoliday(data.holiday)
}

/**
 * 海外休場日を 1 件削除する（実 API は論理削除。取消区分=1 になる）。
 *
 * 応答は削除後の 1 件（HolidayResponse）だが、画面は削除前の行を使ってメッセージを出すので
 * 使い道が無い。呼び出し側が useAsync で成否を判定できるよう、削除した id を返す。
 *
 * @param {string} id 削除対象の id（= 休場日の 'YYYYMMDD'）
 * @returns {Promise<string>} 削除した id
 */
export async function deleteMarketHoliday(id) {
  await apiClient.delete(`/holidays/${encodeURIComponent(id)}`)
  return id
}

/** アプリ内モデル → HolidayRequest（登録・事前検証で共用する入力の形） */
function toHolidayRequest({ date, reason, holidayType }) {
  return {
    休場日: toApiDate(date),
    休場区分: holidayType,
    休場理由: reason,
  }
}

/** HolidayItem → アプリ内モデル */
function toMarketHoliday(raw) {
  return {
    // 実 API に id は無く、主キーは休場日そのもの。
    // 画面と URL では文字列の id として扱うので、ここで 'YYYYMMDD' に寄せる
    id: String(raw?.休場日 ?? ''),
    date: toIsoDate(raw?.休場日),
    // 休場理由は nullable。空文字に寄せて、画面が null を出さないようにする
    reason: raw?.休場理由 ?? '',
    holidayType: raw?.休場区分 ?? '',
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
 * 20260101 → '2026-01-01'。
 *
 * Date には通さない。UTC 深夜として解釈され、UTC より西のタイムゾーンで前日にずれる。
 */
function toIsoDate(value) {
  const digits = String(value ?? '')
  if (!/^\d{8}$/.test(digits)) return ''

  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}
