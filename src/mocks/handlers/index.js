import { http, HttpResponse } from 'msw'
import { orderListResponse } from '../fixtures/orders'
import { marketHolidays } from '../fixtures/marketHolidays'
import { blockedDates } from '../fixtures/blockedDates'

/*
 * モックハンドラの集約。
 *
 * ルール:
 *  - パスは `* + baseURL` で始める（`*` で origin の違いを吸収し、ブラウザ/Node 双方で一致させる）
 *  - バックエンドで実装された API は、このリストから削除する。
 *    未定義のリクエストは実 API へ素通しされるため、削除するだけで本物に切り替わる。
 */

/*
 * 登録系のモックは「追加したものが一覧に出る」ところまで再現したいので、
 * フィクスチャの写しを書き換え可能な状態として持つ。
 * フィクスチャ自体（fixtures/marketHolidays.js）は生の形のまま触らない。
 * テスト間で持ち越さないよう、単体テストは vitest.setup.js の afterEach で resetMockState() を呼ぶ。
 */
let marketHolidayRows = [...marketHolidays]
let blockedDateRows = [...blockedDates]

/*
 * バックエンドが受け付ける海外休場区分コード。
 * src/utils/marketHolidayTypes.js と同じ値だが、モックは「バックエンド側の検証」を模すものなので
 * アプリ内のコードには依存させず、ここに独立して持つ。
 */
const HOLIDAY_TYPE_CODES = ['0', '1']

/** モックの可変状態をフィクスチャの内容に戻す */
export function resetMockState() {
  marketHolidayRows = [...marketHolidays]
  blockedDateRows = [...blockedDates]
}

export const handlers = [
  http.get('*/api/orders', () => HttpResponse.json(orderListResponse)),

  // 海外休場日マスタ。API 仕様は未確定なので limit / offset + total の一般的な形で受ける
  http.get('*/api/market-holidays', ({ request }) => {
    const params = new URL(request.url).searchParams
    const dateFrom = params.get('date_from') ?? ''
    const dateTo = params.get('date_to') ?? ''
    const holidayType = params.get('holiday_type') ?? ''
    const limit = toNonNegativeInt(params.get('limit'), 50)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    // 'YYYY-MM-DD' は固定長なので、文字列比較がそのまま日付の大小になる
    const filtered = marketHolidayRows.filter(
      (holiday) =>
        (!dateFrom || holiday.date >= dateFrom) &&
        (!dateTo || holiday.date <= dateTo) &&
        (!holidayType || holiday.holiday_type === holidayType),
    )

    return HttpResponse.json({
      items: filtered.slice(offset, offset + limit),
      // total は絞り込み後・ページ切り出し前の件数
      total: filtered.length,
    })
  }),

  // 海外休場日の新規追加。エラーは client.js が ApiError へ正規化できる形（message / code）で返す
  http.post('*/api/market-holidays', async ({ request }) => {
    const body = await request.json().catch(() => null)
    const date = typeof body?.date === 'string' ? body.date.trim() : ''
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
    const holidayType = typeof body?.holiday_type === 'string' ? body.holiday_type : ''

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return HttpResponse.json(
        { message: '日付は YYYY-MM-DD 形式で入力してください。', code: 'invalid_date' },
        { status: 400 },
      )
    }
    if (!HOLIDAY_TYPE_CODES.includes(holidayType)) {
      return HttpResponse.json(
        { message: '休場区分を選択してください。', code: 'invalid_holiday_type' },
        { status: 400 },
      )
    }
    if (!reason) {
      return HttpResponse.json(
        { message: '休場理由を入力してください。', code: 'invalid_reason' },
        { status: 400 },
      )
    }
    if (marketHolidayRows.some((holiday) => holiday.date === date)) {
      return HttpResponse.json(
        { message: 'その日付の海外休場日はすでに登録されています。', code: 'duplicate_date' },
        { status: 409 },
      )
    }

    const created = {
      id: `mhd_${date.replaceAll('-', '')}`,
      date,
      reason,
      holiday_type: holidayType,
    }
    // 一覧は日付の昇順を前提にしているので、追加後も並びを保つ
    marketHolidayRows = [...marketHolidayRows, created].sort((a, b) => a.date.localeCompare(b.date))

    return HttpResponse.json(created, { status: 201 })
  }),

  // 海外休場日の削除。成功時は本文を返さない（204）
  http.delete('*/api/market-holidays/:id', ({ params }) => {
    const id = String(params.id)

    if (!marketHolidayRows.some((holiday) => holiday.id === id)) {
      return HttpResponse.json(
        { message: '対象の海外休場日が見つかりません。', code: 'not_found' },
        { status: 404 },
      )
    }

    marketHolidayRows = marketHolidayRows.filter((holiday) => holiday.id !== id)

    return new HttpResponse(null, { status: 204 })
  }),

  // 受注不可日マスタ。API 仕様は未確定なので limit / offset + total の一般的な形で受ける。
  // 削除 / 編集は別コミットで足すので、いまは参照と追加だけ
  http.get('*/api/blocked-dates', ({ request }) => {
    const params = new URL(request.url).searchParams
    const dateFrom = params.get('date_from') ?? ''
    const dateTo = params.get('date_to') ?? ''
    const limit = toNonNegativeInt(params.get('limit'), 50)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    // 'YYYY-MM-DD' は固定長なので、文字列比較がそのまま日付の大小になる
    const filtered = blockedDateRows.filter(
      (blocked) => (!dateFrom || blocked.date >= dateFrom) && (!dateTo || blocked.date <= dateTo),
    )

    return HttpResponse.json({
      items: filtered.slice(offset, offset + limit),
      // total は絞り込み後・ページ切り出し前の件数
      total: filtered.length,
    })
  }),

  /*
   * 受注不可日の事前検証。実仕様（Validate Blackout Date Endpoint）に倣い、
   * 入力が不正でも HTTP は 200 で返し、可否は valid / errors で表す。
   * warnings はフロントが今回扱わないので空配列で返す。
   */
  http.post('*/api/blocked-dates/validate', async ({ request }) => {
    const body = await request.json().catch(() => null)
    const date = typeof body?.date === 'string' ? body.date.trim() : ''
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''

    const errors = []
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push('日付は YYYY-MM-DD 形式で入力してください。')
    } else if (blockedDateRows.some((blocked) => blocked.date === date)) {
      errors.push('その日付の受注不可日はすでに登録されています。')
    }
    if (!reason) {
      errors.push('理由を入力してください。')
    }

    return HttpResponse.json({ valid: errors.length === 0, errors, warnings: [], details: null })
  }),

  // 受注不可日の新規追加。事前検証を通った入力が来る前提だが、
  // サーバ側の防御として同じ検証を行う。エラーは client.js が ApiError へ
  // 正規化できる形（message / code）で返す
  http.post('*/api/blocked-dates', async ({ request }) => {
    const body = await request.json().catch(() => null)
    const date = typeof body?.date === 'string' ? body.date.trim() : ''
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return HttpResponse.json(
        { message: '日付は YYYY-MM-DD 形式で入力してください。', code: 'invalid_date' },
        { status: 400 },
      )
    }
    if (!reason) {
      return HttpResponse.json(
        { message: '理由を入力してください。', code: 'invalid_reason' },
        { status: 400 },
      )
    }
    if (blockedDateRows.some((blocked) => blocked.date === date)) {
      return HttpResponse.json(
        { message: 'その日付の受注不可日はすでに登録されています。', code: 'duplicate_date' },
        { status: 409 },
      )
    }

    // 対象市場はリクエストに無い（実仕様の BlackoutDateRequest に該当項目が無い）ので、
    // 「サーバが既定値を決める」という想定でモック側が埋める
    const created = {
      id: `bkd_${date.replaceAll('-', '')}`,
      date,
      market: '全市場',
      reason,
    }
    // 一覧は日付の昇順を前提にしているので、追加後も並びを保つ
    blockedDateRows = [...blockedDateRows, created].sort((a, b) => a.date.localeCompare(b.date))

    return HttpResponse.json(created, { status: 201 })
  }),
]

function toNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}
