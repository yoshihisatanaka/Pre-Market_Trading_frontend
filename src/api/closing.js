import { apiClient } from './client'

/*
 * 締め管理（実 API `/closing/*`）。いまはみずほ注文締の状態照会だけを持つ。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次の 3 点。
 *   - プロパティ名が日本語（締め状態 / 締め状態名 / 更新日時 / 実行者）
 *   - 締め状態は integer のフラグ（0:未締め・締め解除 / 1:締め済）。アプリ内は boolean
 *   - 締め種別はクエリ `closing_type` で選ぶ（既定 MIZUHO。IB 締めも同じ口を使う）
 *
 * 成熟度 B（パスとレスポンスのスキーマ ClosingStatusResponse はあるが、状態変更の履歴を返す口が無い）。
 * 画面モックの「状態変更履歴」は、応答の 更新日時 / 実行者（最後の 1 回の変更）から 1 行だけ出す。
 *
 * TODO(処理実装): 締め実行 `POST /closing/mizuho` と締め解除 `POST /closing/mizuho/reset`
 *   （どちらも応答は ClosingStatusResponse）。画面は確認ダイアログまで置いてある。
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

/** ClosingStatusResponse → アプリ内モデル */
function toClosingStatus(raw) {
  return {
    closed: raw?.締め状態 === 1,
    updatedAt: raw?.更新日時 ?? null,
    operator: raw?.実行者 ?? '',
  }
}
