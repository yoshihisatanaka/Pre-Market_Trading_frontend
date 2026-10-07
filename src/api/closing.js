import { apiClient } from './client'

/*
 * 締め管理（実 API `/closing/*`）。みずほ注文締の状態照会・締め実行・締め解除を持つ。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次の 4 点。
 *   - プロパティ名が日本語（締め状態 / 締め状態名 / 更新日時 / 実行者 / history の 操作区分・操作日時）
 *   - 締め状態は integer のフラグ（0:未締め・締め解除 / 1:締め済）。アプリ内は boolean
 *   - 締め種別はクエリ `closing_type` で選ぶ（既定 MIZUHO。IB 締めも同じ口を使う）
 *   - 履歴の 操作区分 は 'CLOSE'（締め）/ 'RESET'（解除）。アプリ内は 'close' / 'reopen'
 *
 * 締め実行・締め解除の本文（ClosingActionRequest）は空で送る。実行者はサーバが認証情報
 * （セッション → X-User-Code）から解決し、本文の 実行者 は無視される（docs/api/requests.md #29）。
 *
 * 画面モックの「状態変更履歴」は照会の `history[]`（新しい順。件数は `history_limit`）から出す
 * （docs/api/requests.md #22 ④）。history を持たない応答（古いサーバ・締め実行の応答）では、
 * 更新日時 / 実行者（最後の 1 回の変更）から 1 行を組み立てる。
 *
 * 締めの二重実行はサーバが拒否しない（上書きになる）。画面は状態に応じてボタンを出し分ける。
 */

/** 締め種別（`GET /closing/status` の closing_type）。みずほ注文締 */
const MIZUHO_CLOSING_TYPE = 'MIZUHO'

/**
 * 状態変更履歴を何件読むか（`history_limit`）。画面モックの件数が判らないので、
 * 実 API の既定と同じ 3 件にしている（明示して送り、既定が変わっても画面の件数が変わらないようにする）
 */
export const CLOSING_HISTORY_LIMIT = 3

/** 履歴の 操作区分 → アプリ内の操作 */
const HISTORY_ACTIONS = { CLOSE: 'close', RESET: 'reopen' }

/**
 * @typedef {{
 *   id: string,
 *   action: 'close'|'reopen'|'',
 *   operator: string,
 *   operatedAt: string|null,
 * }} ClosingHistoryEntry
 *   action は締め（close）か解除（reopen）。知らない操作区分は ''。
 *   operator は実行者（null は ''）、operatedAt は操作日時（ISO の日時文字列）
 */

/**
 * @typedef {{
 *   closed: boolean,
 *   updatedAt: string|null,
 *   operator: string,
 *   history: ClosingHistoryEntry[],
 * }} ClosingStatus
 *   closed は 締め状態=1。締め状態名（サーバの名称）は運ばない。画面は「受付中 / 締め済」を
 *   画面モックの語で出すため。
 *   updatedAt / operator は最後に状態を変えた日時と実行者。まだ一度も変えていなければ null / ''
 *   history は状態変更履歴（新しい順）。変更の記録が無ければ []
 */

/**
 * みずほ注文締の状態を取得する（状態変更履歴を CLOSING_HISTORY_LIMIT 件まで含む）。
 *
 * 実 API は必ず 200 + ClosingStatusResponse を返すが、本文なしで来ても落ちないよう
 * null を返す防御は残す（fetchSuspensionStatus と同じ）。画面はこれを「空」として出す。
 *
 * @returns {Promise<ClosingStatus|null>}
 */
export async function fetchMizuhoClosingStatus() {
  const { data } = await apiClient.get('/closing/status', {
    params: { closing_type: MIZUHO_CLOSING_TYPE, history_limit: CLOSING_HISTORY_LIMIT },
  })
  return data ? toClosingStatus(data) : null
}

/**
 * みずほ注文を締める（締め状態を 1 にする）。以降、みずほ経由の新規注文はサーバが受け付けない。
 *
 * @returns {Promise<ClosingStatus>} 操作後の状態（更新日時・実行者が埋まって返る）
 */
export async function closeMizuhoOrders() {
  const { data } = await apiClient.post('/closing/mizuho', {})
  return toClosingStatus(data)
}

/**
 * みずほ注文の締めを解除する（締め状態を 0 に戻し、受付中にする）。
 *
 * @returns {Promise<ClosingStatus>} 操作後の状態（更新日時・実行者が埋まって返る）
 */
export async function reopenMizuhoOrders() {
  const { data } = await apiClient.post('/closing/mizuho/reset', {})
  return toClosingStatus(data)
}

/** ClosingStatusResponse → アプリ内モデル */
function toClosingStatus(raw) {
  const closed = raw?.締め状態 === 1
  const updatedAt = raw?.更新日時 ?? null
  const operator = raw?.実行者 ?? ''

  return {
    closed,
    updatedAt,
    operator,
    history: Array.isArray(raw?.history)
      ? raw.history.map(toHistoryEntry)
      : fallbackHistory({ closed, updatedAt, operator }),
  }
}

/** ClosingHistoryItem → アプリ内モデル */
function toHistoryEntry(raw) {
  return {
    id: raw?.ID == null ? '' : String(raw.ID),
    action: HISTORY_ACTIONS[raw?.操作区分] ?? '',
    operator: raw?.実行者 ?? '',
    operatedAt: raw?.操作日時 ?? null,
  }
}

/**
 * history の無い応答の履歴。最後の 1 回の変更だけを 1 行にする。
 * 何をしたかは今の状態から決まる（締め済なら最後の変更は締め、受付中なら締め解除）。
 */
function fallbackHistory({ closed, updatedAt, operator }) {
  if (!updatedAt) return []
  return [{ id: '', action: closed ? 'close' : 'reopen', operator, operatedAt: updatedAt }]
}
