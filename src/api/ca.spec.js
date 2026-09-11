import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { fetchCorporateActions } from './ca'

/*
 * API 層のテスト。ここだけが「バックエンドの形」を知ってよい層なので、
 * **送り出すリクエストそのもの** を docs/api/openapi.json の宣言と突き合わせる。
 *
 * ストア・画面のテストはモックが返す結果を見ているので、モックとサーバの理解がずれていても
 * 気づけない。この層でクエリ名・値の型・応答のキーを固定しておくと、ずれが 1 か所で見つかる。
 *
 * シナリオ: docs/unit/api-ca.md
 */

/** 最後に届いたリクエストを覚えておくための入れ物 */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

/**
 * リクエストを記録して、指定の本文を返すハンドラを立てる。
 *
 * @param {unknown} body 返す本文
 * @param {number} [status]
 */
function record(body, status = 200) {
  server.use(
    http.get('*/api/ca', ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams }
      return HttpResponse.json(body, { status })
    }),
  )
}

/** CAItem 1 件（openapi.json の項目をひととおり埋めたもの） */
const caItem = {
  ID: 1,
  銘柄コード: 'A0030',
  Ticker: 'AAPL',
  CA種別: '120',
  CA種別名: '株式分割',
  権利付最終日: 20260428,
  効力発生日: 20260430,
  支払日: 20260515,
  分母: 1,
  分子: 2,
  比率: '1:2',
  備考: '1:2 株式分割',
  取消区分: 0,
  ユーザー操作フラグ: 0,
  作成日時: '2026-08-10T10:00:00',
  作成者: 'SYSTEM',
  更新日時: null,
  更新者: null,
  取消日時: null,
  取消者: null,
}

const listBody = (caList) => ({
  total: caList.length,
  limit: 50,
  offset: 0,
  ca_list: caList,
})

describe('api/ca', () => {
  it('[CAA-01] 引数なしの一覧取得は limit と offset だけを送る', async () => {
    record(listBody([]))

    await fetchCorporateActions()

    expect(lastRequest.url.pathname).toBe('/api/ca')
    expect(lastRequest.params.get('limit')).toBe('50')
    expect(lastRequest.params.get('offset')).toBe('0')
    // 条件なしのときは送らない（実 API 側の既定に任せる）
    expect(lastRequest.params.has('stock_code')).toBe(false)
    expect(lastRequest.params.has('ca_type')).toBe(false)
    expect(lastRequest.params.has('include_deleted')).toBe(false)
  })

  it('[CAA-02] 絞り込み条件は stock_code / ca_type という名前で送る', async () => {
    record(listBody([]))

    await fetchCorporateActions({ stockCode: 'AAPL', caType: '110' })

    expect(lastRequest.params.get('stock_code')).toBe('AAPL')
    expect(lastRequest.params.get('ca_type')).toBe('110')
  })

  it('[CAA-03] 空文字の条件はクエリに載せない', async () => {
    record(listBody([]))

    await fetchCorporateActions({ stockCode: '', caType: '' })

    expect(lastRequest.params.has('stock_code')).toBe(false)
    expect(lastRequest.params.has('ca_type')).toBe(false)
  })

  it('[CAA-04] limit / offset は渡した値をそのまま送る', async () => {
    record(listBody([]))

    await fetchCorporateActions({ limit: 20, offset: 40 })

    expect(lastRequest.params.get('limit')).toBe('20')
    expect(lastRequest.params.get('offset')).toBe('40')
  })

  it('[CAA-05] CAItem をアプリ内モデルに変換する', async () => {
    record(listBody([caItem]))

    const { items, total } = await fetchCorporateActions()

    expect(total).toBe(1)
    expect(items).toEqual([
      {
        id: '1',
        stockCode: 'A0030',
        ticker: 'AAPL',
        caType: '120',
        caTypeName: '株式分割',
        exRightsDate: '2026-04-28',
        effectiveDate: '2026-04-30',
        paymentDate: '2026-05-15',
        ratio: '1:2',
        note: '1:2 株式分割',
        userModified: false,
      },
    ])
  })

  it('[CAA-06] null の項目は空文字に寄せる', async () => {
    record(listBody([{ ...caItem, Ticker: null, CA種別名: null, 比率: null, 備考: null }]))

    const { items } = await fetchCorporateActions()

    expect(items[0]).toMatchObject({ ticker: '', caTypeName: '', ratio: '', note: '' })
  })

  it('[CAA-07] null の日付は空文字になる', async () => {
    record(listBody([{ ...caItem, 権利付最終日: null, 効力発生日: null, 支払日: null }]))

    const { items } = await fetchCorporateActions()

    expect(items[0]).toMatchObject({ exRightsDate: '', effectiveDate: '', paymentDate: '' })
  })

  it('[CAA-08] ユーザー操作フラグは boolean になる', async () => {
    record(
      listBody([
        { ...caItem, ID: 1, ユーザー操作フラグ: 1 },
        { ...caItem, ID: 2, ユーザー操作フラグ: 0 },
      ]),
    )

    const { items } = await fetchCorporateActions()

    expect(items.map((item) => item.userModified)).toEqual([true, false])
  })

  it('[CAA-09] ca_list を持たない応答でも空の一覧として扱う', async () => {
    record({ total: 0, limit: 50, offset: 0 })

    const { items, total } = await fetchCorporateActions()

    expect(items).toEqual([])
    expect(total).toBe(0)
  })

  it('[CAA-10] サーバエラーは例外になる', async () => {
    record({ detail: 'サーバーでエラーが発生しました。' }, 500)

    await expect(fetchCorporateActions()).rejects.toBeTruthy()
  })
})
