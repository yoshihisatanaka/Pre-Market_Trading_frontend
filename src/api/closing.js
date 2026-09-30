import { apiClient, USER_CODE } from './client'

/*
 * 締め管理（実 API `/closing/*`）。みずほ注文締の状態照会・締め実行・締め解除を持つ。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次の 4 点。
 *   - プロパティ名が日本語（締め状態 / 締め状態名 / 更新日時 / 実行者）
 *   - 締め状態は integer のフラグ（0:未締め・締め解除 / 1:締め済）。アプリ内は boolean
 *   - 締め種別はクエリ `closing_type` で選ぶ（既定 MIZUHO。IB 締めも同じ口を使う）
 *   - 締め実行・締め解除の 実行者 は本文で渡す。サーバは X-User-Code から解決せず、
 *     省くと 'SYSTEM' として記録する（発注停止の api/incidents.js とは逆）
 *
 * 成熟度 B（パスとレスポンスのスキーマ ClosingStatusResponse はあるが、状態変更の履歴を返す口が無い）。
 * 画面モックの「状態変更履歴」は、応答の 更新日時 / 実行者（最後の 1 回の変更）から 1 行だけ出す。
 * 照会（GET）は 更新日時 / 実行者 を返さず、埋まって返るのは締め実行・締め解除の応答だけ。
 *
 * 締めの二重実行はサーバが拒否しない（上書きになる）。画面は状態に応じてボタンを出し分ける。
 */

/** 締め種別（`GET /closing/status` の closing_type）。みずほ注文締 */
const MIZUHO_CLOSING_TYPE = 'MIZUHO'

/**
 * @typedef {{
 *   closed: boolean,
 *   updatedAt: string|null,
 *   operator: string,
 * }} ClosingStatus
 *   closed は 締め状態=1。締め状態名（サーバの名称）は運ばない。画面は「受付中 / 締め済」を
 *   画面モックの語で出すため。
 *   updatedAt / operator は最後に状態を変えた日時と実行者。まだ一度も変えていなければ null / ''
 */

/**
 * みずほ注文締の状態を取得する。
 *
 * 実 API は必ず 200 + ClosingStatusResponse を返すが、本文なしで来ても落ちないよう
 * null を返す防御は残す（fetchSuspensionStatus と同じ）。画面はこれを「空」として出す。
 *
 * @returns {Promise<ClosingStatus|null>}
 */
export async function fetchMizuhoClosingStatus() {
  const { data } = await apiClient.get('/closing/status', {
    params: { closing_type: MIZUHO_CLOSING_TYPE },
  })
  return data ? toClosingStatus(data) : null
}

/**
 * みずほ注文を締める（締め状態を 1 にする）。以降、みずほ経由の新規注文はサーバが受け付けない。
 *
 * @returns {Promise<ClosingStatus>} 操作後の状態（更新日時・実行者が埋まって返る）
 */
export async function closeMizuhoOrders() {
  const { data } = await apiClient.post('/closing/mizuho', toClosingActionRequest())
  return toClosingStatus(data)
}

/**
 * みずほ注文の締めを解除する（締め状態を 0 に戻し、受付中にする）。
 *
 * @returns {Promise<ClosingStatus>} 操作後の状態（更新日時・実行者が埋まって返る）
 */
export async function reopenMizuhoOrders() {
  const { data } = await apiClient.post('/closing/mizuho/reset', toClosingActionRequest())
  return toClosingStatus(data)
}

/** ClosingActionRequest。操作者コードが無ければ空の本文にする（サーバが 'SYSTEM' で記録する） */
function toClosingActionRequest() {
  return USER_CODE ? { 実行者: USER_CODE } : {}
}

/** ClosingStatusResponse → アプリ内モデル */
function toClosingStatus(raw) {
  return {
    closed: raw?.締め状態 === 1,
    updatedAt: raw?.更新日時 ?? null,
    operator: raw?.実行者 ?? '',
  }
}
