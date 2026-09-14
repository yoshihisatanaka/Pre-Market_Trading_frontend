import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { fetchStocks } from './stocks'

/*
 * API 層のテスト。ここだけが「バックエンドの形」を知ってよい層なので、
 * **送り出すリクエストそのもの** を docs/api/openapi.json の宣言と突き合わせる。
 *
 * ストア・画面のテストはモックが返す結果を見ているので、モックとサーバの理解がずれていても
 * 気づけない。この層でクエリ名・値の型・応答のキーを固定しておくと、ずれが 1 か所で見つかる。
 *
 * シナリオ: docs/unit/api-stocks.md
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
    http.get('*/api/stocks', ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams }
      return HttpResponse.json(body, { status })
    }),
  )
}

/** StockItem 1 件（openapi.json の項目をひととおり埋めたもの） */
const stockItem = {
  銘柄コード: 'S001',
  Ticker: 'AAPL',
  銘柄名: 'アップル',
  銘柄名_英字: 'Apple Inc.',
  市場名: 'NASDAQ',
  規制情報: '0',
  規制情報名: '取引可',
  注文ルート: '1',
  注文ルート名: 'IB証券',
  VWAP対象区分: '1',
  VWAP対象区分名: '対象',
  Pre区分: 1,
  備考: '',
  前日終値: 227.16,
  前日出来高: 43_820_000,
  平均出来高: 50_000_000,
  取消区分: 0,
  ユーザー操作フラグ: 0,
  作成日時: '2026-08-10T10:00:00',
  作成者: 'SYSTEM',
  更新日時: null,
  更新者: null,
}

const listBody = (stocks) => ({
  total: stocks.length,
  limit: 50,
  offset: 0,
  stocks,
})

describe('api/stocks', () => {
  it('[STA-01] 引数なしの一覧取得は offset だけを送る', async () => {
    record(listBody([]))

    await fetchStocks()

    expect(lastRequest.url.pathname).toBe('/api/stocks')
    expect(lastRequest.params.get('offset')).toBe('0')
    // 条件なしのときは送らない（実 API 側の既定に任せる）
    expect(lastRequest.params.has('銘柄コード')).toBe(false)
    expect(lastRequest.params.has('規制情報')).toBe(false)
    expect(lastRequest.params.has('注文ルート')).toBe(false)
    expect(lastRequest.params.has('VWAP対象区分')).toBe(false)
    expect(lastRequest.params.has('include_deleted')).toBe(false)
  })

  it('[STA-02] limit を渡しても送らない（実 API が持たないパラメータ）', async () => {
    record(listBody([]))

    await fetchStocks({ limit: 20 })

    expect(lastRequest.params.has('limit')).toBe(false)
  })

  it('[STA-03] 絞り込み条件は日本語のクエリ名で送る', async () => {
    record(listBody([]))

    await fetchStocks({
      stockCode: 'AAPL',
      regulation: '0',
      orderRoute: '1',
      vwapTarget: '1',
    })

    expect(lastRequest.params.get('銘柄コード')).toBe('AAPL')
    expect(lastRequest.params.get('規制情報')).toBe('0')
    expect(lastRequest.params.get('注文ルート')).toBe('1')
    expect(lastRequest.params.get('VWAP対象区分')).toBe('1')
  })

  it('[STA-04] 空文字の条件はクエリに載せない', async () => {
    record(listBody([]))

    await fetchStocks({ stockCode: '', regulation: '', orderRoute: '', vwapTarget: '' })

    expect(lastRequest.params.has('銘柄コード')).toBe(false)
    expect(lastRequest.params.has('規制情報')).toBe(false)
    expect(lastRequest.params.has('注文ルート')).toBe(false)
    expect(lastRequest.params.has('VWAP対象区分')).toBe(false)
  })

  it('[STA-05] offset は渡した値をそのまま送る', async () => {
    record(listBody([]))

    await fetchStocks({ offset: 50 })

    expect(lastRequest.params.get('offset')).toBe('50')
  })

  it('[STA-06] StockItem をアプリ内モデルに変換する', async () => {
    record(listBody([stockItem]))

    const { items, total } = await fetchStocks()

    expect(total).toBe(1)
    expect(items).toEqual([
      {
        stockCode: 'S001',
        ticker: 'AAPL',
        name: 'アップル',
        nameEn: 'Apple Inc.',
        marketName: 'NASDAQ',
        regulation: '0',
        regulationName: '取引可',
        orderRoute: '1',
        orderRouteName: 'IB証券',
        vwapTarget: '1',
        vwapTargetName: '対象',
        note: '',
        previousClose: 227.16,
        previousVolume: 43_820_000,
        averageVolume: 50_000_000,
        userModified: false,
      },
    ])
  })

  it('[STA-07] null の文字列項目は空文字に寄せる', async () => {
    record(
      listBody([
        {
          ...stockItem,
          Ticker: null,
          銘柄名: null,
          銘柄名_英字: null,
          市場名: null,
          規制情報名: null,
          注文ルート名: null,
          VWAP対象区分名: null,
          備考: null,
        },
      ]),
    )

    const { items } = await fetchStocks()

    expect(items[0]).toMatchObject({
      ticker: '',
      name: '',
      nameEn: '',
      marketName: '',
      regulationName: '',
      orderRouteName: '',
      vwapTargetName: '',
      note: '',
    })
  })

  it('[STA-08] 相場の 3 項目は null のまま通す', async () => {
    record(listBody([{ ...stockItem, 前日終値: null, 前日出来高: null, 平均出来高: null }]))

    const { items } = await fetchStocks()

    // 空文字や 0 に寄せると「未取得」の意味が消える
    expect(items[0]).toMatchObject({
      previousClose: null,
      previousVolume: null,
      averageVolume: null,
    })
  })

  it('[STA-09] 相場の 0 は 0 のまま通す（未取得と混ぜない）', async () => {
    record(listBody([{ ...stockItem, 前日終値: 0, 前日出来高: 0, 平均出来高: 0 }]))

    const { items } = await fetchStocks()

    expect(items[0]).toMatchObject({ previousClose: 0, previousVolume: 0, averageVolume: 0 })
  })

  it('[STA-10] ユーザー操作フラグは boolean になる', async () => {
    record(
      listBody([
        { ...stockItem, 銘柄コード: 'S001', ユーザー操作フラグ: 1 },
        { ...stockItem, 銘柄コード: 'S002', ユーザー操作フラグ: 0 },
      ]),
    )

    const { items } = await fetchStocks()

    expect(items.map((item) => item.userModified)).toEqual([true, false])
  })

  it('[STA-11] stocks を持たない応答でも空の一覧として扱う', async () => {
    record({ total: 0, limit: 50, offset: 0 })

    const { items, total } = await fetchStocks()

    expect(items).toEqual([])
    expect(total).toBe(0)
  })

  it('[STA-12] サーバエラーは例外になる', async () => {
    record({ detail: 'サーバーでエラーが発生しました。' }, 500)

    await expect(fetchStocks()).rejects.toBeTruthy()
  })
})
