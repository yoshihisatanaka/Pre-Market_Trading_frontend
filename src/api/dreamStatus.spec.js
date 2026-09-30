import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { TRANSITIONS, dreamOrders, dreamStatusCodes } from '@/mocks/fixtures/dreamStatus'
import { ApiError } from './client'
import { changeDreamStatus, fetchDreamOrders, fetchDreamStatusCodes } from './dreamStatus'

/*
 * API 層のテスト。ここだけが「バックエンドの形」を知ってよい層なので、
 * **送り出すリクエストそのもの** と **受け取った生データの変換** を検証する。
 *
 * クエリ名は英語、レスポンスのキーは日本語。両者は対応しないので、
 * 送る側と受ける側をそれぞれ別のテストで固定する。
 */

const LIST_PATH = '*/api/orders/dream-status'
const STATUSES_PATH = '*/api/orders/dream-status/statuses'
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 最後に届いた一覧のリクエスト */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

/** 一覧のリクエストを記録して、指定の本文を返す */
function record(body, status = 200) {
  server.use(
    http.get(LIST_PATH, ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams }
      return HttpResponse.json(body, { status })
    }),
  )
}

const listBody = (rows) => ({ total: rows.length, limit: 50, offset: 0, orders: rows })

const CHANGE_PATH = '*/api/orders/dream-status/:orderId'

/** 最後に届いた STS変更のリクエスト */
let lastPut = null

afterEach(() => {
  lastPut = null
})

/** STS変更のリクエストを記録して、行をそのまま返す（本文の形だけを見るため） */
function recordPut(row) {
  server.use(
    http.put(CHANGE_PATH, async ({ request }) => {
      lastPut = { url: new URL(request.url), body: await request.json() }
      return HttpResponse.json({ success: true, order: row, message: '' })
    }),
  )
}

// フィクスチャから、観点ごとの代表行を取る
const changeable = dreamOrders.find((row) => row.STS変更可 === true && row.受注番号 === null)
const locked = dreamOrders.find((row) => row.STS変更可 === false && row.受注番号 !== null)
const sellRow = dreamOrders.find((row) => row.売買区分 === '1')
const buyRow = dreamOrders.find((row) => row.売買区分 === '3')

// シナリオ: docs/unit/api-dream-status.md
describe('api/dreamStatus', () => {
  it('[DSA-01] 既定モックで { items, total } を 1 ページぶん返す', async () => {
    const { items, total } = await fetchDreamOrders()

    expect(total).toBe(dreamOrders.length)
    // 既定の limit（50）を超えるフィクスチャでないと、このシナリオは意味を失う
    expect(dreamOrders.length).toBeGreaterThan(50)
    expect(items).toHaveLength(50)
  })

  it('[DSA-02] 引数なしの一覧取得は limit と offset だけを送る', async () => {
    record(listBody([]))

    await fetchDreamOrders()

    expect(lastRequest.url.pathname).toBe('/api/orders/dream-status')
    expect(lastRequest.params.get('limit')).toBe('50')
    expect(lastRequest.params.get('offset')).toBe('0')
    expect([...lastRequest.params.keys()]).toEqual(['limit', 'offset'])
  })

  it('[DSA-03] 絞り込み条件は英語のクエリ名で送る', async () => {
    record(listBody([]))
    const row = locked

    await fetchDreamOrders({
      branchCode: row.部店,
      accountNumber: String(row.口座番号),
      symbol: row.Ticker,
      status: row.Dream状況,
      dateFrom: row.作成日時.slice(0, 10),
      dateTo: row.作成日時.slice(0, 10),
      receiptNumber: row.受注番号,
    })

    expect(Object.fromEntries(lastRequest.params)).toEqual({
      limit: '50',
      offset: '0',
      branch_code: row.部店,
      account_no: String(row.口座番号),
      symbol: row.Ticker,
      dream_status: row.Dream状況,
      start_date: row.作成日時.slice(0, 10),
      end_date: row.作成日時.slice(0, 10),
      receipt_number: row.受注番号,
    })
  })

  it('[DSA-04] 空文字の条件はクエリに載せない', async () => {
    record(listBody([]))

    await fetchDreamOrders({
      branchCode: '',
      accountNumber: '',
      symbol: '',
      status: '',
      dateFrom: '',
      dateTo: '',
      receiptNumber: '',
    })

    expect([...lastRequest.params.keys()]).toEqual(['limit', 'offset'])
  })

  it('[DSA-05] 数字だけの口座番号は前後の空白を落として送る', async () => {
    record(listBody([]))
    const accountNumber = String(changeable.口座番号)

    await fetchDreamOrders({ accountNumber: ` ${accountNumber} ` })

    expect(lastRequest.params.get('account_no')).toBe(accountNumber)
  })

  it('[DSA-06] 数字以外を含む口座番号は送らない', async () => {
    for (const input of ['123-456', 'abc', '   ']) {
      record(listBody([]))

      await fetchDreamOrders({ accountNumber: input })

      // 文字列のまま送ると実 API が 422 で弾く
      expect(lastRequest.params.has('account_no')).toBe(false)
    }
  })

  it('[DSA-07] limit と offset をそのまま送る', async () => {
    record(listBody([]))

    await fetchDreamOrders({ limit: 20, offset: 40 })

    expect(lastRequest.params.get('limit')).toBe('20')
    expect(lastRequest.params.get('offset')).toBe('40')
  })

  it('[DSA-08] DreamOrderItem をアプリ内モデルに変換する', async () => {
    const raw = locked
    record(listBody([raw]))

    const { items, total } = await fetchDreamOrders()

    expect(total).toBe(1)
    expect(items[0]).toEqual({
      id: String(raw.ID),
      status: raw.Dream状況,
      statusName: raw.Dream状況名,
      canChangeStatus: false,
      statusTransitions: [],
      receiptNumber: raw.受注番号,
      errorMessage: '',
      completedAt: raw.Dream完了日時,
      branchCode: raw.部店,
      branchName: raw.部店名,
      accountNumber: String(raw.口座番号),
      customerName: raw.顧客名,
      symbolCode: raw.銘柄コード,
      ticker: raw.Ticker,
      symbolName: raw.銘柄名,
      side: raw.売買区分 === '1' ? 'sell' : 'buy',
      sideName: raw.売買区分名,
      quantity: raw.数量,
      createdAt: raw.作成日時,
      updatedAt: raw.更新日時,
    })
    expect(typeof items[0].id).toBe('string')
    expect(typeof items[0].accountNumber).toBe('string')
  })

  it('[DSA-09] STS変更できる行は遷移先を { code, name } で持ち、できない行は空配列', async () => {
    record(listBody([changeable, locked]))

    const { items } = await fetchDreamOrders()

    expect(items[0].canChangeStatus).toBe(true)
    expect(items[0].statusTransitions).toEqual(
      changeable.変更可能状況.map((transition) => ({
        code: transition.コード,
        name: transition.名称,
      })),
    )
    expect(items[0].statusTransitions.length).toBeGreaterThan(0)
    expect(items[0].errorMessage).toBe(changeable.Dreamエラー内容)

    expect(items[1].canChangeStatus).toBe(false)
    expect(items[1].statusTransitions).toEqual([])
  })

  it('[DSA-10] STS変更可は true のときだけ立つ', async () => {
    const { STS変更可: _flag, ...withoutFlag } = changeable
    record(
      listBody([
        { ...changeable, ID: 1, STS変更可: 1 },
        { ...changeable, ID: 2, STS変更可: 'true' },
        { ...withoutFlag, ID: 3 },
      ]),
    )

    const { items } = await fetchDreamOrders()

    expect(items.map((item) => item.canChangeStatus)).toEqual([false, false, false])
  })

  it('[DSA-11] 売買区分は 1 が売・3 が買で、未知のコードは空にする', async () => {
    record(listBody([sellRow, buyRow, { ...buyRow, ID: 999, 売買区分: '2' }]))

    const { items } = await fetchDreamOrders()

    expect(items.map((item) => item.side)).toEqual(['sell', 'buy', ''])
  })

  it('[DSA-12] null の項目は文字列なら空文字に寄せ、数量は null のまま運ぶ', async () => {
    record(
      listBody([
        {
          ...locked,
          Dream状況名: null,
          変更可能状況: null,
          受注番号: null,
          Dreamエラー内容: null,
          Dream完了日時: null,
          部店名: null,
          口座番号: null,
          顧客名: null,
          銘柄名: null,
          売買区分名: null,
          数量: null,
          更新日時: null,
        },
        { ...locked, ID: 999, 数量: 0 },
      ]),
    )

    const { items } = await fetchDreamOrders()

    expect(items[0]).toMatchObject({
      statusName: '',
      statusTransitions: [],
      receiptNumber: '',
      errorMessage: '',
      completedAt: '',
      branchName: '',
      accountNumber: '',
      customerName: '',
      symbolName: '',
      sideName: '',
      quantity: null,
      updatedAt: '',
    })
    // 数量 0 と「値が無い」は区別する
    expect(items[1].quantity).toBe(0)
  })

  it('[DSA-13] orders と total を持たない応答でも空の一覧として扱う', async () => {
    record({})

    const { items, total } = await fetchDreamOrders()

    expect(items).toEqual([])
    expect(total).toBe(0)
  })

  it('[DSA-14] 一覧のサーバエラーは detail を message に持つ例外になる', async () => {
    record({ detail: ERROR_MESSAGE }, 500)

    const error = await fetchDreamOrders().catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toBe(ERROR_MESSAGE)
  })

  it('[DSA-15] 状況コード一覧をサーバの並びのまま { code, name, group } で返す', async () => {
    const codes = await fetchDreamStatusCodes()

    expect(codes).toEqual(
      dreamStatusCodes.map((raw) => ({ code: raw.コード, name: raw.名称, group: raw.区分 })),
    )
    expect(codes.at(-1)).toMatchObject({ code: 'ERROR', group: '絞込' })
  })

  it('[DSA-16] statuses を持たない応答は空配列にする', async () => {
    server.use(http.get(STATUSES_PATH, () => HttpResponse.json({})))

    await expect(fetchDreamStatusCodes()).resolves.toEqual([])
  })

  it('[DSA-17] 状況コード一覧のサーバエラーは例外になる', async () => {
    server.use(
      http.get(STATUSES_PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
    )

    await expect(fetchDreamStatusCodes()).rejects.toBeInstanceOf(ApiError)
  })

  it('[DSA-18] STS変更は注文IDのパスに日本語キーの本文で PUT する', async () => {
    recordPut(changeable)
    const receiptNumber = 'DR-20260928-9999'
    const reason = 'Dream 側で手入力済み'

    await changeDreamStatus({
      id: String(changeable.ID),
      status: '2',
      receiptNumber: `  ${receiptNumber} `,
      reason: ` ${reason}  `,
      updatedAt: changeable.更新日時,
    })

    expect(lastPut.url.pathname).toBe(`/api/orders/dream-status/${changeable.ID}`)
    expect(lastPut.body).toEqual({
      変更後状況: '2',
      受注番号: receiptNumber,
      理由: reason,
      更新日時: changeable.更新日時,
    })
  })

  it('[DSA-19] 受注番号と理由は空・空白だけ・省略のどれでも null で送る', async () => {
    const base = { id: String(changeable.ID), status: '0', updatedAt: changeable.更新日時 }

    for (const extra of [{ receiptNumber: '', reason: '' }, { receiptNumber: '   ', reason: ' ' }, {}]) {
      recordPut(changeable)

      await changeDreamStatus({ ...base, ...extra })

      expect(lastPut.body).toHaveProperty('受注番号', null)
      expect(lastPut.body).toHaveProperty('理由', null)
    }
  })

  it('[DSA-20] 変更後の行をアプリ内モデルにし、サーバの処理結果を返す', async () => {
    const target = TRANSITIONS[changeable.Dream状況].find((t) => t.コード === '0')

    const { order, message } = await changeDreamStatus({
      id: String(changeable.ID),
      status: target.コード,
      updatedAt: changeable.更新日時,
    })

    expect(order).toMatchObject({
      id: String(changeable.ID),
      status: '0',
      statusName: dreamStatusCodes.find((status) => status.コード === '0').名称,
      canChangeStatus: false,
      statusTransitions: [],
    })
    expect(order.updatedAt).not.toBe('')
    expect(order.updatedAt).not.toBe(changeable.更新日時)
    expect(message).toBe(`注文ID ${changeable.ID} のDream状況を「${target.名称}」へ変更しました。`)
  })

  it('[DSA-21] 更新日時が食い違うと 409 の例外になり detail が message に入る', async () => {
    const stale = '2000-01-01T00:00:00'
    expect(stale).not.toBe(changeable.更新日時)

    const error = await changeDreamStatus({
      id: String(changeable.ID),
      status: '0',
      updatedAt: stale,
    }).catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(409)
    // モックの detail は取得時と最新の更新日時を含む。それが message に運ばれていること
    expect(error.message).toContain(stale)
    expect(error.message).toContain(changeable.更新日時)
  })
})
