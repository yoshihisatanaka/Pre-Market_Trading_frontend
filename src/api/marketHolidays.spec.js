import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import {
  createMarketHoliday,
  deleteMarketHoliday,
  fetchMarketHolidays,
  validateMarketHoliday,
} from './marketHolidays'

/*
 * API 層のテスト。ここだけが「バックエンドの形」を知ってよい層なので、
 * **送り出すリクエストそのもの** を docs/api/openapi.json の宣言と突き合わせる。
 *
 * ストア・画面のテストはモックが返す結果を見ているので、モックとサーバの理解がずれていても
 * 気づけない。この層でクエリ名・値の型・本文のキーを固定しておくと、ずれが 1 か所で見つかる。
 *
 * シナリオ: docs/unit/api-market-holidays.md
 */

/** 最後に届いたリクエストを覚えておくための入れ物 */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

/**
 * リクエストを記録して、指定の本文を返すハンドラを立てる。
 *
 * @param {'get'|'post'|'delete'} method
 * @param {string} path `*` 始まりのパス
 * @param {unknown} body 返す本文
 * @param {number} [status]
 */
function record(method, path, body, status = 200) {
  server.use(
    http[method](path, async ({ request }) => {
      const url = new URL(request.url)
      lastRequest = {
        url,
        params: url.searchParams,
        headers: request.headers,
        // GET / DELETE は本文が無いので読まない（読むと空文字で例外になる）
        body: method === 'post' ? await request.json() : null,
      }
      return HttpResponse.json(body, { status })
    }),
  )
}

/** HolidayItem 1 件（openapi.json の必須項目をひととおり埋めたもの） */
const holidayItem = {
  休場日: 20261225,
  休場区分: '0',
  休場区分名: '終日休場',
  休場理由: 'Christmas Day',
  取消区分: 0,
  ユーザー操作フラグ: 0,
  作成日時: '2026-08-10T14:16:42',
  作成者: '702',
  更新日時: '2026-08-10T14:16:43',
  更新者: '702',
  取消日時: null,
  取消者: null,
}

const listBody = (holidays) => ({ total: holidays.length, limit: 50, offset: 0, holidays })

describe('api/marketHolidays', () => {
  it('[MHA-01] 条件なしのときは limit / offset だけを送る', async () => {
    record('get', '*/api/holidays', listBody([]))

    await fetchMarketHolidays()

    expect(lastRequest.url.pathname).toBe('/api/holidays')
    expect(lastRequest.params.get('limit')).toBe('50')
    expect(lastRequest.params.get('offset')).toBe('0')
    // 空の条件はキーごと送らない（サーバ側で「空文字での絞り込み」にしないため）
    expect(lastRequest.params.has('start_date')).toBe(false)
    expect(lastRequest.params.has('end_date')).toBe(false)
    expect(lastRequest.params.has('holiday_type')).toBe(false)
  })

  it('[MHA-02] 日付の絞り込みは start_date / end_date に YYYYMMDD の整数で載る', async () => {
    record('get', '*/api/holidays', listBody([]))

    await fetchMarketHolidays({ dateFrom: '2026-01-01', dateTo: '2026-12-31' })

    expect(lastRequest.params.get('start_date')).toBe('20260101')
    expect(lastRequest.params.get('end_date')).toBe('20261231')
    // 旧仕様のクエリ名で送っていないこと
    expect(lastRequest.params.has('date_from')).toBe(false)
    expect(lastRequest.params.has('date_to')).toBe(false)
  })

  it('[MHA-03] 休場区分の絞り込みは holiday_type にコードのまま載る', async () => {
    record('get', '*/api/holidays', listBody([]))

    await fetchMarketHolidays({ holidayType: '1' })

    expect(lastRequest.params.get('holiday_type')).toBe('1')

    // 空文字は「条件なし」。キーごと送らない
    await fetchMarketHolidays({ holidayType: '' })
    expect(lastRequest.params.has('holiday_type')).toBe(false)
  })

  it('[MHA-04] HolidayItem がアプリ内モデルに変換される', async () => {
    record('get', '*/api/holidays', listBody([holidayItem]))

    const { items, total } = await fetchMarketHolidays()

    expect(total).toBe(1)
    expect(items).toEqual([
      { id: '20261225', date: '2026-12-25', reason: 'Christmas Day', holidayType: '0' },
    ])
  })

  it('[MHA-05] 休場理由が null の行は空文字になる', async () => {
    record('get', '*/api/holidays', listBody([{ ...holidayItem, 休場理由: null }]))

    const { items } = await fetchMarketHolidays()

    expect(items[0].reason).toBe('')
  })

  it('[MHA-06] 事前検証は日本語キーの本文を送る', async () => {
    record('post', '*/api/holidays/validate', { valid: true, errors: [], warnings: [] })

    await validateMarketHoliday({ date: '2026-12-25', reason: 'Christmas Day', holidayType: '0' })

    expect(lastRequest.url.pathname).toBe('/api/holidays/validate')
    expect(lastRequest.body).toEqual({
      休場日: 20261225,
      休場区分: '0',
      休場理由: 'Christmas Day',
    })
  })

  it('[MHA-07] 事前検証の valid / errors / warnings をそのまま返す', async () => {
    record('post', '*/api/holidays/validate', {
      valid: false,
      errors: ['休場日 20261225 は既に登録されています'],
      warnings: ['この日付は以前登録され削除されています。再度有効にします'],
      details: null,
    })

    const result = await validateMarketHoliday({
      date: '2026-12-25',
      reason: 'Christmas Day',
      holidayType: '0',
    })

    expect(result).toEqual({
      valid: false,
      errors: ['休場日 20261225 は既に登録されています'],
      warnings: ['この日付は以前登録され削除されています。再度有効にします'],
    })
  })

  it('[MHA-08] errors / warnings が無い応答でも空配列になる', async () => {
    // openapi.json では valid だけが required。errors / warnings は既定値も無い
    record('post', '*/api/holidays/validate', { valid: true })

    const result = await validateMarketHoliday({
      date: '2026-12-25',
      reason: 'Christmas Day',
      holidayType: '0',
    })

    expect(result).toEqual({ valid: true, errors: [], warnings: [] })
  })

  it('[MHA-09] 登録は日本語キーの本文を送り、応答の holiday を変換して返す', async () => {
    record('post', '*/api/holidays', { success: true, holiday: holidayItem, message: 'ok' }, 201)

    const created = await createMarketHoliday({
      date: '2026-12-25',
      reason: 'Christmas Day',
      holidayType: '0',
    })

    expect(lastRequest.url.pathname).toBe('/api/holidays')
    expect(lastRequest.body).toEqual({
      休場日: 20261225,
      休場区分: '0',
      休場理由: 'Christmas Day',
    })
    expect(created).toEqual({
      id: '20261225',
      date: '2026-12-25',
      reason: 'Christmas Day',
      holidayType: '0',
    })
  })

  it('[MHA-10] 削除は休場日をパスに置き、渡した id を返す', async () => {
    record('delete', '*/api/holidays/:holidayDate', {
      success: true,
      holiday: { ...holidayItem, 取消区分: 1 },
      message: 'ok',
    })

    const deleted = await deleteMarketHoliday('20261225')

    expect(lastRequest.url.pathname).toBe('/api/holidays/20261225')
    expect(deleted).toBe('20261225')
  })

  it('[MHA-11] 更新系には X-User-Code ヘッダが載る', async () => {
    record('post', '*/api/holidays', { success: true, holiday: holidayItem, message: 'ok' }, 201)

    await createMarketHoliday({ date: '2026-12-25', reason: 'Christmas Day', holidayType: '0' })

    // 値は運用で決まる（テストでは vitest.config.js が固定している）。載っていることを見る
    expect(lastRequest.headers.get('X-User-Code')).toBeTruthy()
  })
})
