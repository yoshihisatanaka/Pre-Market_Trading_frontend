import { apiClient } from './client'

/*
 * お知らせ管理（実 API `/operations/announcements`・タグ Announcements）。
 *
 * お知らせは**全画面共通の 1 行だけ**（ID は常に 1）なので、一覧ではなく単一リソースとして扱う。
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次の 4 点。
 *   - プロパティ名が日本語（表示フラグ / 本文 / 更新日時 …）
 *   - 表示フラグは integer の 0 / 1。アプリ内は boolean
 *   - 本文は nullable。アプリ内は空文字に寄せる（textarea にそのまま流すため）
 *   - 履歴の 変更前データ / 変更後データ は型が宣言されていない（anyOf: [{}, null]）
 * 更新系は `X-User-Code` ヘッダで操作者が決まる。付与は client.js の interceptor が全 API 共通で行う。
 */

/**
 * @typedef {{
 *   id: number | null,
 *   enabled: boolean,
 *   visible: boolean,
 *   message: string,
 *   userEdited: boolean,
 *   updatedAt: string,
 *   updatedBy: string | null,
 * }} Announcement
 *   enabled は表示フラグ（操作者が ON にしたか）。visible は「表示 ON かつ本文あり」で、
 *   利用者画面のバナーに出る条件（サーバが判定する）。updatedAt は楽観的ロックの合札
 */

/**
 * @typedef {{
 *   id: number,
 *   operation: string,
 *   operationLabel: string,
 *   operator: string,
 *   message: string,
 *   operatedAt: string,
 * }} AnnouncementHistory
 *   operation は SHOW / HIDE / UPDATE。operationLabel はサーバが添える表示名で、画面はこちらを出す
 */

/**
 * 現在のお知らせを取得する。
 *
 * 実 API は必ず 200 + AnnouncementItem を**ラッパ無しで**返す（ID / 表示フラグ / 表示中 が required）。
 * 本文なしで来ても落ちないよう null を返す防御は残し、画面はこれを「未登録」として 4 状態のひとつに出す。
 *
 * @returns {Promise<Announcement | null>}
 */
export async function fetchAnnouncement() {
  const { data } = await apiClient.get('/operations/announcements')
  return data ? toAnnouncement(data) : null
}

/**
 * お知らせの表示 ON/OFF と本文を更新する。
 *
 * 実 API の約束（openapi.json の description）:
 *   - 表示 ON で本文が空は 400。本文が 500 文字超も description では 400 だが、
 *     本文に maxLength: 500 があるので実際はサービス層へ届く前に pydantic の 422 になる見込み
 *   - 表示フラグ・本文とも変更が無ければ履歴を残さず現在値を返す
 *   - 更新日時 を送ると楽観的ロックが効き、他の担当者が先に更新していれば 409
 *
 * updatedAt は取得時の更新日時をそのまま送り返す合札。空のときはキーごと送らない
 * （src/api/blackoutDates.js と同じ扱い。まだ一度も更新されていない行は照合する相手が無い）。
 *
 * @param {{ enabled: boolean, message: string, updatedAt?: string }} params
 * @returns {Promise<{ announcement: Announcement, message: string }>}
 *   message はサーバが返す成功文言（AnnouncementActionResponse.message）。画面はそのまま出す
 */
export async function updateAnnouncement({ enabled, message, updatedAt = '' }) {
  const { data } = await apiClient.put('/operations/announcements', {
    表示フラグ: enabled ? 1 : 0,
    本文: message,
    ...(updatedAt ? { 更新日時: updatedAt } : {}),
  })

  return {
    announcement: toAnnouncement(data?.announcement),
    message: data?.message ?? '',
  }
}

/**
 * お知らせの操作履歴を新しい順に取得する。
 *
 * ページャーを持つ表なので、配列ではなく `{ items, total }` を返す。
 * limit は実 API の上限（1〜200）の範囲で呼び出し側が決める。
 *
 * @param {{ limit?: number, offset?: number }} [params]
 * @returns {Promise<{ items: AnnouncementHistory[], total: number }>}
 */
export async function fetchAnnouncementHistory({ limit = 50, offset = 0 } = {}) {
  const { data } = await apiClient.get('/operations/announcements/history', {
    params: { limit, offset },
  })

  return {
    items: (data?.histories ?? []).map(toAnnouncementHistory),
    total: data?.total ?? 0,
  }
}

/** AnnouncementItem → アプリ内モデル */
function toAnnouncement(raw) {
  return {
    id: raw?.ID ?? null,
    enabled: raw?.['表示フラグ'] === 1,
    // 表示 ON かつ本文あり（バナーの表示条件）。判定はサーバが持つので画面で計算し直さない
    visible: Boolean(raw?.['表示中']),
    // nullable。空文字に寄せて、textarea と「変更が無いか」の比較に null を持ち込まない
    message: raw?.['本文'] ?? '',
    userEdited: raw?.['ユーザー操作フラグ'] === 1,
    /*
     * 楽観的ロックの合札。照合はサーバが行うので Date には通さず素の文字列で持つ。
     * null を空文字に寄せ、更新時に「送らない」を選べるようにする（updateAnnouncement）。
     */
    updatedAt: raw?.['更新日時'] ?? '',
    updatedBy: raw?.['更新者'] ?? null,
  }
}

/** AnnouncementHistoryItem → アプリ内モデル */
function toAnnouncementHistory(raw) {
  return {
    id: raw.ID,
    operation: raw['操作区分'] ?? '',
    operationLabel: raw['操作区分名'] ?? '',
    operator: raw['操作者'] ?? '',
    message: historyMessage(raw['変更後データ']),
    operatedAt: raw['操作日時'] ?? '',
  }
}

/**
 * 変更後データから本文を取り出す。
 *
 * 変更後データは openapi.json で型が宣言されていない（anyOf: [{}, null]）。
 * 更新リクエストと同じ `{ 表示フラグ, 本文 }` の object が入る前提で読み、
 * 形が違えば空文字にする（画面は「—」を出す。解除で本文が空になったときと同じ見た目）。
 */
function historyMessage(after) {
  if (!after || typeof after !== 'object') return ''
  return typeof after['本文'] === 'string' ? after['本文'] : ''
}
