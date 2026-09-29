/*
 * お知らせ管理（GET /operations/announcements と /history）が返す生の形。
 * キーは openapi.json の AnnouncementItem / AnnouncementHistoryItem のまま日本語。
 * 日時は FastAPI が datetime を直列化する形（'2026-09-22T17:30:00'）。
 *
 * 履歴は limit の既定 50 を超える 56 件を用意する（ページングを検証するため）。
 * 古い順に「表示 → 本文変更 → 解除」を繰り返して作り、新しい順に並べて返す。
 * 最新の 1 件が現在のお知らせと食い違わないよう、現在値は履歴の末尾から組み立てる。
 *
 * 変更前データ / 変更後データ / 差分データ は openapi.json で型が宣言されていない
 * （anyOf: [{}, null]）。実 API は **JSON 文字列**で返す（2026-09-29 実測）ので、
 * { 表示フラグ, 本文 } の object を JSON.stringify して置く。
 * 実 API の中身は行の全項目（ID / 更新日時 …）の写しだが、画面が読むのは 本文 だけなので 2 項目に絞る。
 */

/** 本文の見本。画面モックのプレースホルダと同じ系統の文面 */
const MESSAGES = [
  '本日は市場休場日前のため、注文条件をご確認ください。',
  '9月27日 06:00〜07:00 に計画メンテナンスを予定しています。',
  '米国市場は短縮取引です。引け時刻にご注意ください。',
  '配当権利落ち銘柄が多い日です。約定後の残高をご確認ください。',
]

const OPERATORS = ['006', '005', '004']

/** 古い順の操作の並び。3 件で 1 周する */
const CYCLE = ['SHOW', 'UPDATE', 'HIDE']

const OPERATION_LABELS = { SHOW: '表示', HIDE: '非表示', UPDATE: '本文変更' }

const HISTORY_COUNT = 56

/** 1 件目の操作日時（UTC で計算し、タイムゾーンを持たない文字列にする） */
const FIRST_OPERATED_AT = Date.UTC(2026, 5, 1, 0, 0, 0)

/** 操作の間隔（36 時間） */
const INTERVAL_MS = 36 * 60 * 60 * 1000

function operatedAt(index) {
  return new Date(FIRST_OPERATED_AT + index * INTERVAL_MS).toISOString().slice(0, 19)
}

/** 変更前後で値が違う項目だけを { 変更前, 変更後 } で持つ */
function diff(before, after) {
  return Object.fromEntries(
    Object.keys(after)
      .filter((key) => before[key] !== after[key])
      .map((key) => [key, { 変更前: before[key], 変更後: after[key] }]),
  )
}

/** 古い順に作る。state は直前の { 表示フラグ, 本文 } */
function buildHistories() {
  let state = { 表示フラグ: 0, 本文: null }

  const rows = Array.from({ length: HISTORY_COUNT }, (_, index) => {
    const operation = CYCLE[index % CYCLE.length]
    const message = MESSAGES[index % MESSAGES.length]
    // 解除では本文も空にする（画面は「—」を出す）
    const next =
      operation === 'HIDE' ? { 表示フラグ: 0, 本文: null } : { 表示フラグ: 1, 本文: message }

    const row = {
      ID: index + 1,
      お知らせID: 1,
      操作区分: operation,
      操作区分名: OPERATION_LABELS[operation],
      操作者: OPERATORS[index % OPERATORS.length],
      変更前データ: JSON.stringify(state),
      変更後データ: JSON.stringify(next),
      差分データ: JSON.stringify(diff(state, next)),
      操作日時: operatedAt(index),
    }
    state = next
    return row
  })

  return rows.reverse()
}

/** 操作履歴（新しい順）。AnnouncementHistoryItem の配列 */
export const announcementHistories = buildHistories()

const latest = announcementHistories[0]
const latestAfter = JSON.parse(latest.変更後データ)

/** 現在のお知らせ。AnnouncementItem（最新の履歴と同じ状態） */
export const announcement = {
  ID: 1,
  表示フラグ: latestAfter.表示フラグ,
  表示中: latestAfter.表示フラグ === 1 && Boolean(latestAfter.本文),
  本文: latestAfter.本文,
  ユーザー操作フラグ: 1,
  作成日時: '2026-01-05T09:00:00',
  作成者: 'SYSTEM',
  更新日時: latest.操作日時,
  更新者: latest.操作者,
}

/** 一度も操作されていない初期状態（非表示・本文なし）。空の履歴と組み合わせて使う */
export const initialAnnouncement = {
  ID: 1,
  表示フラグ: 0,
  表示中: false,
  本文: null,
  ユーザー操作フラグ: 0,
  作成日時: '2026-01-05T09:00:00',
  作成者: 'SYSTEM',
  更新日時: null,
  更新者: null,
}
