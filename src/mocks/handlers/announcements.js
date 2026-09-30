import { http, HttpResponse } from 'msw'
import { announcement, announcementHistories } from '../fixtures/announcements'
import {
  detailError,
  isSameTimestamp,
  nowIsoTimestamp,
  requestValidationError,
  toNonNegativeInt,
} from './_shared'

/*
 * お知らせ管理（/operations/announcements）。拒否の形と履歴の積み方は openapi.json の
 * description に合わせる。
 *
 *   400 ErrorResponse       … 表示 ON なのに本文が空
 *   409 ErrorResponse       … 楽観的ロックの競合（更新日時 が現在値と違う）
 *   422 HTTPValidationError … pydantic の制約違反（表示フラグが 0/1 以外、本文が 500 文字超）
 *
 * 本文の 500 文字超は description の 400 にも挙がっているが、AnnouncementUpdateRequest の
 * 本文に maxLength: 500 が付いているので、サービス層へ届く前に pydantic が 422 で弾く。
 * モックは届く順に合わせて 422 を返す。
 *
 * お知らせは 1 行だけなので、行の配列ではなくオブジェクトの写しを持つ（スライス基準と同じ）。
 */
let announcementRow = { ...announcement }
let historyRows = [...announcementHistories]

/** モックの可変状態をフィクスチャの内容に戻す */
export function resetAnnouncementState() {
  announcementRow = { ...announcement }
  historyRows = [...announcementHistories]
}

/** 現在のお知らせ（banner のモックが「お知らせ表示中」を組み立てるのに使う） */
export function currentAnnouncementRow() {
  return announcementRow
}

/** AnnouncementUpdateRequest.本文 の maxLength */
const MESSAGE_MAX_LENGTH = 500

const HISTORY_DEFAULT_LIMIT = 50
const HISTORY_MAX_LIMIT = 200

/** 実 API が返す文言。成功文言は AnnouncementActionResponse.message */
const MESSAGES = {
  required: 'お知らせを表示する場合は本文を入力してください。',
  tooLong: `${MESSAGE_MAX_LENGTH}文字以内で入力してください`,
  conflict: '他のユーザーによってお知らせが更新されました。最新情報を再取得してください。',
  unchanged: '変更はありません。',
  SHOW: 'お知らせを表示しました。',
  HIDE: 'お知らせを非表示にしました。',
  UPDATE: 'お知らせを更新しました。',
}

const OPERATION_LABELS = { SHOW: '表示', HIDE: '非表示', UPDATE: '本文変更' }

export const announcementHandlers = [
  // お知らせは 1 行だけ。ラッパ無しで AnnouncementItem を直接返す
  http.get('*/api/operations/announcements', () => HttpResponse.json(announcementRow)),

  http.get('*/api/operations/announcements/history', ({ request }) => {
    const params = new URL(request.url).searchParams
    const limit = toNonNegativeInt(params.get('limit'), HISTORY_DEFAULT_LIMIT)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    if (limit < 1 || limit > HISTORY_MAX_LIMIT) {
      return requestValidationError(['query', 'limit'], '指定できる範囲を超えています', 'less_than_equal')
    }

    return HttpResponse.json({
      // total は切り出し前の件数
      total: historyRows.length,
      limit,
      offset,
      histories: historyRows.slice(offset, offset + limit),
    })
  }),

  http.put('*/api/operations/announcements', async ({ request }) => {
    const body = (await request.json().catch(() => null)) ?? {}

    const enabledFlag = body['表示フラグ']
    if (enabledFlag !== 0 && enabledFlag !== 1) {
      return requestValidationError(['body', '表示フラグ'], '0 または 1 を指定してください', 'int_parsing')
    }

    // 部分更新。本文を送らなければ現在値を保つ（明示の null はクリア）
    const rawMessage = '本文' in body ? body['本文'] : announcementRow['本文']
    if (typeof rawMessage === 'string' && rawMessage.length > MESSAGE_MAX_LENGTH) {
      return requestValidationError(['body', '本文'], MESSAGES.tooLong, 'string_too_long')
    }
    // 空文字・空白だけは「本文なし」として持つ（表示中の判定と履歴の「—」に効く）
    const message = typeof rawMessage === 'string' && rawMessage.trim() ? rawMessage : null

    if (enabledFlag === 1 && !message) {
      return detailError(400, MESSAGES.required)
    }

    // 楽観的ロック。取得してから保存するまでに他の担当者が更新していれば弾く
    if (!isSameTimestamp(body['更新日時'] ?? null, announcementRow['更新日時'])) {
      return detailError(409, MESSAGES.conflict)
    }

    const before = { 表示フラグ: announcementRow['表示フラグ'], 本文: announcementRow['本文'] }
    const after = { 表示フラグ: enabledFlag, 本文: message }

    // 変更が無ければ履歴を残さず現在値を返す（description の約束）
    if (before.表示フラグ === after.表示フラグ && before.本文 === after.本文) {
      return HttpResponse.json({
        success: true,
        announcement: announcementRow,
        message: MESSAGES.unchanged,
      })
    }

    const operation = operationOf(before, after)
    const operator = request.headers.get('X-User-Code') || '006'
    const operatedAt = nowIsoTimestamp()

    announcementRow = {
      ...announcementRow,
      ...after,
      表示中: after.表示フラグ === 1 && Boolean(after.本文),
      // 画面から更新したので 1 が立つ（システム連携ではない）
      ユーザー操作フラグ: 1,
      更新日時: operatedAt,
      更新者: operator,
    }

    historyRows = [
      {
        ID: Math.max(0, ...historyRows.map((row) => row.ID)) + 1,
        お知らせID: announcementRow.ID,
        操作区分: operation,
        操作区分名: OPERATION_LABELS[operation],
        操作者: operator,
        // 仕様どおり object で積む（フィクスチャと同じ形）
        変更前データ: before,
        変更後データ: after,
        差分データ: diffOf(before, after),
        操作日時: operatedAt,
      },
      ...historyRows,
    ]

    return HttpResponse.json({
      success: true,
      announcement: announcementRow,
      message: MESSAGES[operation],
    })
  }),
]

/** 表示 OFF→ON は SHOW、ON→OFF は HIDE、表示フラグが同じで本文だけ変われば UPDATE */
function operationOf(before, after) {
  if (before.表示フラグ === 0 && after.表示フラグ === 1) return 'SHOW'
  if (before.表示フラグ === 1 && after.表示フラグ === 0) return 'HIDE'
  return 'UPDATE'
}

/** 変わった項目だけを { 変更前, 変更後 } で持つ（フィクスチャと同じ形） */
function diffOf(before, after) {
  return Object.fromEntries(
    Object.keys(after)
      .filter((key) => before[key] !== after[key])
      .map((key) => [key, { 変更前: before[key], 変更後: after[key] }]),
  )
}
