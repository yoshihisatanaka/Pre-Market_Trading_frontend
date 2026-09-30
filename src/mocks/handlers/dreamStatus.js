import { http, HttpResponse } from 'msw'
import {
  TRANSITIONS,
  dreamOrders,
  dreamStatusCodes,
  withDerivedDreamFields,
} from '../fixtures/dreamStatus'
import {
  detailError,
  isSameTimestamp,
  nowIsoTimestamp,
  requestValidationError,
  toNonNegativeInt,
} from './_shared'

/** 登録日の書式。実 API と同じく YYYYMMDD と YYYY-MM-DD の両方を受ける */
const DATE_PATTERN = /^\d{4}-?\d{2}-?\d{2}$/

/** 取消フェーズの Dream状況コードの接頭辞（C0 / C2 などは Dream取消状況 を書き換える） */
const CANCEL_PREFIX = 'C'

/*
 * STS変更で書き換わるので、フィクスチャを写した行を持つ。
 * 単体テストは resetMockState()（vitest.setup.js の afterEach）で、E2E はページを開き直すたびに戻る。
 */
let rows = cloneRows()

function cloneRows() {
  return dreamOrders.map((row) => ({ ...row }))
}

/** モックの可変状態をフィクスチャの内容に戻す */
export function resetDreamStatusState() {
  rows = cloneRows()
}

/** 'YYYYMMDD' / 'YYYY-MM-DD' → 'YYYY-MM-DD'。空は null（条件なし） */
function normalizeDate(value) {
  const text = (value ?? '').trim()
  if (!text) return null
  const digits = text.replaceAll('-', '')
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

/** 統合コードの絞り込み。擬似コード ERROR は登録失敗・取消失敗の両方に当たる */
function matchesStatus(row, code) {
  if (!code) return true
  if (code === 'ERROR') return row.Dream状況 === '9' || row.Dream状況 === 'C9'
  return row.Dream状況 === code
}

/** 任意の文字列項目。前後の空白を落とし、空は null（実 API の normalize_text） */
function normalizeText(value) {
  const text = String(value ?? '').trim()
  return text || null
}

/**
 * 遷移先に応じて書き換える項目（実 API の `_resolve_update_arguments`）。
 *   登録フェーズ（0 / 2 / 8） … Dream登録状況。2 なら登録日時と受注番号も入れる
 *   取消フェーズ（C0 / C2）   … Dream取消状況。C2 なら取消日時を入れ、処理状況を 034（取消済）へ進める
 * C0 は取消状況が 0 に戻るので、統合コードは登録状況（通常は 2 登録済）の表示に戻る。
 */
function changedFields(target, receiptNumber, now) {
  if (target.startsWith(CANCEL_PREFIX)) {
    const cancel = target.slice(CANCEL_PREFIX.length)
    return cancel === '2'
      ? { Dream取消状況: cancel, Dream取消日時: now, 処理状況: '034' }
      : { Dream取消状況: cancel }
  }
  return target === '2'
    ? {
        Dream登録状況: target,
        Dream登録日時: now,
        ...(receiptNumber ? { 受注番号: receiptNumber } : {}),
      }
    : { Dream登録状況: target }
}

export const dreamStatusHandlers = [
  // 検索のプルダウン用のコード一覧。パスが一覧の下にあるので、一覧より先に置く
  http.get('*/api/orders/dream-status/statuses', () =>
    HttpResponse.json({ statuses: dreamStatusCodes }),
  ),

  /*
   * Dream 連携の対象注文の一覧。
   *
   * **クエリ名は英語**（`branch_code` / `account_no` / `symbol` / `dream_status` / `start_date` /
   * `end_date` / `receipt_number`）。レスポンスのキーは日本語。
   * 部店・口座番号・受注番号は完全一致、`symbol` は銘柄コードか Ticker の完全一致
   * （実 API は大文字に寄せてから m_銘柄情報 に紐づけて引く）。
   * 登録日は**注文の作成日**で絞る（画面の「登録日時」列＝Dream完了日時 ではない）。
   * 並びは作成日時の新しい順（実 API の既定 `sort=desc`）。
   */
  http.get('*/api/orders/dream-status', ({ request }) => {
    const params = new URL(request.url).searchParams
    const branchCode = (params.get('branch_code') ?? '').trim()
    const accountNo = params.get('account_no')
    const symbol = (params.get('symbol') ?? '').trim().toUpperCase()
    const status = (params.get('dream_status') ?? '').trim().toUpperCase()
    const receiptNumber = (params.get('receipt_number') ?? '').trim()
    const limit = toNonNegativeInt(params.get('limit'), 50)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    for (const name of ['start_date', 'end_date']) {
      const value = (params.get(name) ?? '').trim()
      if (value && !DATE_PATTERN.test(value)) {
        return detailError(
          400,
          `${name} は YYYYMMDD または YYYY-MM-DD 形式で指定してください: ${value}`,
        )
      }
    }
    const startDate = normalizeDate(params.get('start_date'))
    const endDate = normalizeDate(params.get('end_date'))

    const filtered = rows
      .filter((row) => {
        const createdDate = (row.作成日時 ?? '').slice(0, 10)
        return (
          (!branchCode || row.部店 === branchCode) &&
          (!accountNo || row.口座番号 === Number(accountNo)) &&
          (!symbol || row.銘柄コード.toUpperCase() === symbol || row.Ticker === symbol) &&
          matchesStatus(row, status) &&
          (!startDate || createdDate >= startDate) &&
          (!endDate || createdDate <= endDate) &&
          (!receiptNumber || row.受注番号 === receiptNumber)
        )
      })
      .sort((a, b) => b.作成日時.localeCompare(a.作成日時))

    return HttpResponse.json({
      // total は絞り込み後・ページ切り出し前の件数
      total: filtered.length,
      limit,
      offset,
      orders: filtered.slice(offset, offset + limit),
    })
  }),

  /*
   * STS変更（Dream状況の手動変更）。拒否の順序は実 API（`change_dream_status`）に合わせる。
   *   422 … 本文のスキーマ（pydantic）。変更後状況 / 更新日時 が無い
   *   404 … 注文が無い
   *   400 … いまの状況が 9 / C9 以外、遷移先が許されていない、登録済（2）へ変えるのに受注番号が無い、
   *         更新日時が空
   *   409 … 楽観的ロックの競合（更新日時が取得時と違う）
   */
  http.put('*/api/orders/dream-status/:orderId', async ({ request, params }) => {
    const body = await request.json().catch(() => null)

    for (const name of ['変更後状況', '更新日時']) {
      if (typeof body?.[name] !== 'string') {
        return requestValidationError(['body', name], 'Field required', 'missing')
      }
    }

    const target = normalizeText(body.変更後状況)?.toUpperCase() ?? null
    if (!target) return detailError(400, '変更後状況を指定してください。')

    const orderId = Number(params.orderId)
    const index = rows.findIndex((row) => row.ID === orderId)
    if (index === -1) return detailError(404, `注文ID ${params.orderId} が見つかりません。`)

    const current = rows[index]
    const allowed = (TRANSITIONS[current.Dream状況] ?? []).map((transition) => transition.コード)
    if (allowed.length === 0) {
      return detailError(
        400,
        `Dream状況が「${current.Dream状況名}」(${current.Dream状況}) の注文はSTS変更できません。` +
          '登録失敗(9)・取消失敗(C9)の注文のみ変更可能です。',
      )
    }
    if (!allowed.includes(target)) {
      return detailError(
        400,
        `Dream状況 ${current.Dream状況} から ${target} へは変更できません。` +
          `（変更可能: ${allowed.join(', ')}）`,
      )
    }

    const receiptNumber = normalizeText(body.受注番号)
    if (target === '2' && !(receiptNumber || current.受注番号)) {
      return detailError(
        400,
        '登録済へ変更する場合は、Dream側で採番された受注番号を指定してください。',
      )
    }

    if (!normalizeText(body.更新日時)) {
      return detailError(400, '更新日時（楽観ロック用）を指定してください。')
    }
    if (!isSameTimestamp(body.更新日時, current.更新日時)) {
      return detailError(
        409,
        '他のユーザーによって更新されています。最新の情報を取得してからやり直してください。' +
          `(取得時: ${body.更新日時}, 最新: ${current.更新日時})`,
      )
    }

    const now = nowIsoTimestamp()
    const updated = withDerivedDreamFields({
      ...current,
      ...changedFields(target, receiptNumber, now),
      更新日時: now,
    })
    rows[index] = updated

    const label = TRANSITIONS[current.Dream状況].find((transition) => transition.コード === target)
    return HttpResponse.json({
      success: true,
      order: updated,
      message: `注文ID ${orderId} のDream状況を「${label.名称}」へ変更しました。`,
    })
  }),
]
