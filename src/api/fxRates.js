import { apiClient } from './client'

/*
 * 為替マスタ（実 API `/masters/fx`）。成熟度 A（一覧・最新・詳細・事前検証・登録・変更・削除が揃う）。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差:
 *   - プロパティ名が日本語（基準日 / 通貨コード / 為替レート …）
 *   - 基準日は integer の YYYYMMDD（20260731）。アプリ内は 'YYYY-MM-DD'
 *   - 主キーは integer の `ID`。アプリ内は文字列の `id`（src/api/ca.js と同じ扱い）。
 *     パスキー `{fx_id}` も ID（docs/api/requests.md #5。2026-09-18 に業務キーから ID へ統一された）
 *   - 登録・変更・削除の応答は `{ success, exchange_rate, message }`、詳細は `{ exchange_rate }` で包まれる
 *   - 最新レートに該当が無いと 404（ErrorResponse）。この層で null に読み替える
 * 更新系は `X-User-Code` ヘッダが必須。付与は client.js の interceptor が全 API 共通で行う。
 *
 * 画面が使うのは 最新（latest）→ 詳細 → 事前検証 → 登録 / 変更 の 5 本。
 * 一覧（GET /masters/fx）と削除・履歴・CSV は画面に導線が無いので関数を置いていない。
 */

/**
 * @typedef {{ id: string, baseDate: string, currencyCode: string, rate: number,
 *   updatedAt: string, updatedBy: string, createdAt: string }} FxRate
 *   baseDate は 'YYYY-MM-DD'。updatedAt / createdAt は実 API の ISO 日時の素の文字列（無ければ ''）
 */

/**
 * 指定日以前で最新の為替レートを取得する。
 *
 * 応答（LatestFxResponse）は ID / 基準日 / 通貨コード / 為替レート の 4 項目だけで、
 * 更新日時（楽観的ロックの合札）も更新者も持たない。画面に出す 1 件は、この ID で
 * fetchFxRate を引き直して得る。
 *
 * @param {{ currencyCode?: string, targetDate?: string }} [params] targetDate は 'YYYY-MM-DD'
 * @returns {Promise<{ id: string, baseDate: string, currencyCode: string, rate: number } | null>}
 *   有効なレートが 1 件も無い（404）ときは null
 */
export async function fetchLatestFxRate({ currencyCode = 'USD', targetDate = '' } = {}) {
  const response = await apiClient.get('/masters/fx/latest', {
    params: { currency_code: currencyCode, target_date: toApiDate(targetDate) },
    // 404 は「まだ登録が無い」という正常な結果なので、例外にせず受け取る
    validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
  })
  if (response.status === 404) return null

  const raw = response.data
  return {
    id: String(raw?.ID ?? ''),
    baseDate: toIsoDate(raw?.基準日),
    currencyCode: raw?.通貨コード ?? '',
    rate: raw?.為替レート ?? null,
  }
}

/**
 * 為替レートを 1 件取得する（パスキーは ID）。
 *
 * @param {string} id 対象の id（実 API の ID）
 * @returns {Promise<FxRate>}
 */
export async function fetchFxRate(id) {
  const { data } = await apiClient.get(`/masters/fx/${encodeURIComponent(id)}`)
  return toFxRate(data.exchange_rate)
}

/**
 * 登録・変更の内容を事前検証する（DB には登録しない）。
 *
 * errors は登録できない理由（重複・存在しない ID など）、warnings は登録は通るが
 * 確かめたいこと（一般的な範囲 50〜300 円から外れるレート）。どちらも例外にはしない。
 * 変更検証のときだけ対象の id をクエリで渡す（src/api/marketHolidays.js と同じ作法）。
 *
 * @param {{ baseDate: string, currencyCode: string, rate: number, id?: string }} params
 * @returns {Promise<{ valid: boolean, errors: string[], warnings: string[] }>}
 */
export async function validateFxRate({ baseDate, currencyCode, rate, id = '' }) {
  const { data } = await apiClient.post(
    '/masters/fx/validate',
    toFxRequest({ baseDate, currencyCode, rate }),
    id ? { params: { fx_id: Number(id), is_update: true } } : undefined,
  )

  return {
    valid: Boolean(data?.valid),
    // errors / warnings は required ではないので、無い場合に備える
    errors: Array.isArray(data?.errors) ? data.errors : [],
    warnings: Array.isArray(data?.warnings) ? data.warnings : [],
  }
}

/**
 * 為替レートを 1 件登録する。取消済みの同じ基準日・通貨があれば実 API 側が復活更新する。
 *
 * @param {{ baseDate: string, currencyCode: string, rate: number }} params
 * @returns {Promise<FxRate>} 登録された 1 件
 */
export async function createFxRate({ baseDate, currencyCode, rate }) {
  const { data } = await apiClient.post(
    '/masters/fx',
    toFxRequest({ baseDate, currencyCode, rate }),
  )
  return toFxRate(data.exchange_rate)
}

/**
 * 為替レートを 1 件変更する（パスキーは ID）。
 *
 * FxRequest は部分更新ではなく 基準日 と 為替レート が required なので、基準日も必ず送る。
 * updatedAt は取得時の更新日時をそのまま送り返す楽観的ロックの合札で、他の担当者が先に
 * 更新していれば 409 で弾かれる。空のときはキーごと送らない（照合する相手が無い）。
 *
 * @param {{ id: string, baseDate: string, currencyCode: string, rate: number,
 *   updatedAt: string }} params
 * @returns {Promise<FxRate>} 更新後の 1 件
 */
export async function updateFxRate({ id, baseDate, currencyCode, rate, updatedAt = '' }) {
  const { data } = await apiClient.put(`/masters/fx/${encodeURIComponent(id)}`, {
    ...toFxRequest({ baseDate, currencyCode, rate }),
    ...(updatedAt ? { 更新日時: updatedAt } : {}),
  })
  return toFxRate(data.exchange_rate)
}

/** アプリ内モデル → FxRequest（登録・変更・事前検証で共用する入力の形） */
function toFxRequest({ baseDate, currencyCode, rate }) {
  return {
    基準日: toApiDate(baseDate),
    通貨コード: currencyCode,
    為替レート: rate,
  }
}

/** FxItem → アプリ内モデル */
function toFxRate(raw) {
  return {
    // 欠けていても基準日へフォールバックしない（行の特定が静かに壊れるのを隠さない。ca.js と同じ）
    id: String(raw?.ID ?? ''),
    baseDate: toIsoDate(raw?.基準日),
    currencyCode: raw?.通貨コード ?? '',
    rate: raw?.為替レート ?? null,
    // 照合はサーバが行うので Date には通さず素の文字列で持つ（blackoutDates.js と同じ）
    updatedAt: raw?.更新日時 ?? '',
    updatedBy: raw?.更新者 ?? '',
    createdAt: raw?.作成日時 ?? '',
  }
}

/**
 * 'YYYY-MM-DD' → 20260731。
 * 空文字や形の違うものは undefined にして、クエリに載せない・本文に入れない。
 */
function toApiDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? Number(date.replaceAll('-', '')) : undefined
}

/**
 * 20260731 → '2026-07-31'。
 *
 * Date には通さない。UTC 深夜として解釈され、UTC より西のタイムゾーンで前日にずれる。
 */
function toIsoDate(value) {
  const digits = String(value ?? '')
  if (!/^\d{8}$/.test(digits)) return ''

  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}
