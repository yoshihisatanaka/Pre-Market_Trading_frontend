import { http, HttpResponse } from 'msw'
import { dreamOrders, dreamStatusCodes } from '../fixtures/dreamStatus'
import { detailError, toNonNegativeInt } from './_shared'

/** 登録日の書式。実 API と同じく YYYYMMDD と YYYY-MM-DD の両方を受ける */
const DATE_PATTERN = /^\d{4}-?\d{2}-?\d{2}$/

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
   *
   * STS変更（`PUT /orders/dream-status/{order_id}`）はまだモックしない。画面が送信を繋いでいないため。
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

    const filtered = dreamOrders
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
]
