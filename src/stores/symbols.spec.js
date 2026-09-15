import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { stocks } from '@/mocks/fixtures/stocks'
import { STOCKS_PAGE_SIZE, useStocksStore } from './stocks'

/*
 * 既定の MSW ハンドラ（実 API と同じ絞り込み・並び順）に当てる。
 * 期待値はフィクスチャと表示件数から導き、56 / 50 / 'AAPL' のような値を直接書かない。
 *
 * シナリオ: docs/unit/stores-stocks.md
 */

const PAGE_SIZE = STOCKS_PAGE_SIZE
const TOTAL = stocks.length

/** 実 API と同じ並び（銘柄コードの昇順）。フィクスチャは生成順のまま置かれている */
const sorted = [...stocks].sort((a, b) => a.銘柄コード.localeCompare(b.銘柄コード))
const codesOf = (rows) => rows.map((stock) => stock.銘柄コード)
const allCodes = codesOf(sorted)

/** 実 API と同じ規則（銘柄コードか Ticker への部分一致・大文字小文字を区別しない） */
const matchesCode = (stock, keyword) =>
  stock.銘柄コード.toUpperCase().includes(keyword.toUpperCase()) ||
  stock.Ticker.toUpperCase().includes(keyword.toUpperCase())

/** フィクスチャに現れる区分コードを、件数の昇順で並べる */
function valuesByCount(key) {
  const counts = new Map()
  for (const stock of sorted) {
    counts.set(stock[key], (counts.get(stock[key]) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => a[1] - b[1]).map(([value]) => value)
}

/** 最も少ない区分コード。1 ページに収まるので、絞り込み結果を全件そのまま比べられる */
const rarestValue = (key) => valuesByCount(key)[0]

/**
 * 「絞り込んでもなお 2 ページ目が残る」条件を、フィクスチャから 1 つ選ぶ。
 * 3 つの区分のうち、最も多くの行が当たる組み合わせを取る。
 *
 * @returns {{ filter: object, codes: string[] }} load に渡す条件と、当たる銘柄コード
 */
function widestFilter() {
  // [load に渡す名前, フィクスチャのキー]
  const keys = [
    ['regulation', '規制情報'],
    ['orderRoute', '注文ルート'],
    ['vwapTarget', 'VWAP対象区分'],
  ]

  const candidates = keys.map(([filterKey, fixtureKey]) => {
    const value = valuesByCount(fixtureKey).at(-1)
    return {
      filter: { [filterKey]: value },
      codes: codesOf(sorted.filter((stock) => stock[fixtureKey] === value)),
    }
  })

  return candidates.sort((a, b) => b.codes.length - a.codes.length)[0]
}

// 絞り込みに使う値もフィクスチャから導く
const TICKER = sorted[0].Ticker
const tickerCodes = codesOf(sorted.filter((stock) => matchesCode(stock, TICKER)))

const REGULATION = rarestValue('規制情報')
const regulationCodes = codesOf(sorted.filter((stock) => stock.規制情報 === REGULATION))

// reload は「2 ページ目に居るまま読み直す」ことを見たいので、2 ページ目ができる条件を使う
const PAGED = widestFilter()

// AND の組み合わせは実在する行から取る（存在しない組み合わせだと 0 件になって意味を失う）
const ORDER_ROUTE = sorted[0].注文ルート
const VWAP_TARGET = sorted[0].VWAP対象区分
const bothCodes = codesOf(
  sorted.filter(
    (stock) => stock.注文ルート === ORDER_ROUTE && stock.VWAP対象区分 === VWAP_TARGET,
  ),
)

// フィクスチャのどの銘柄コード・Ticker にも当たらない文字列
const NO_MATCH = 'ZZZZ'

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 一覧を 500 にする差し替え */
function failList() {
  server.use(
    http.get('*/api/stocks', () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
  )
}

/**
 * 一覧の応答を遅らせる差し替え。
 * offset ごとに待ち時間を変えられるので、「先に投げたほうが遅く返る」状況を作れる。
 *
 * @param {(offset: number) => number} waitFor offset に対する待ち時間（ミリ秒）
 */
function slowList(waitFor) {
  server.use(
    http.get('*/api/stocks', async ({ request }) => {
      const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0)
      await delay(waitFor(offset))
      return HttpResponse.json({
        total: TOTAL,
        limit: PAGE_SIZE,
        offset,
        stocks: sorted.slice(offset, offset + PAGE_SIZE),
      })
    }),
  )
}

const codes = (store) => store.items.map((item) => item.stockCode)

describe('stores/stocks', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[STS-01] 既定の読み込みで 1 ページ目が並び順どおりに入る', async () => {
    const store = useStocksStore()

    await store.load()

    expect(store.total).toBe(TOTAL)
    expect(store.offset).toBe(0)
    expect(store.limit).toBe(PAGE_SIZE)
    expect(codes(store)).toEqual(allCodes.slice(0, PAGE_SIZE))
  })

  it('[STS-02] offset を渡すとその位置から読み込む', async () => {
    const store = useStocksStore()

    await store.load({ offset: PAGE_SIZE })

    expect(store.offset).toBe(PAGE_SIZE)
    expect(codes(store)).toEqual(allCodes.slice(PAGE_SIZE))
    // 全件がちょうど 1 ページに収まっていたら、このシナリオは意味を失う
    expect(store.items.length).toBeGreaterThan(0)
  })

  it('[STS-03] 銘柄コード・ティッカーコードで絞り込む', async () => {
    const store = useStocksStore()

    await store.load({ stockCode: TICKER })

    expect(store.stockCode).toBe(TICKER)
    expect(store.total).toBe(tickerCodes.length)
    expect(codes(store)).toEqual(tickerCodes)
  })

  it('[STS-04] 取引可否（規制情報）で絞り込む', async () => {
    const store = useStocksStore()

    await store.load({ regulation: REGULATION })

    expect(store.regulation).toBe(REGULATION)
    expect(store.total).toBe(regulationCodes.length)
    expect(codes(store)).toEqual(regulationCodes.slice(0, PAGE_SIZE))
  })

  it('[STS-05] 預託先区分と VWAP対象区分は AND で絞り込む', async () => {
    const store = useStocksStore()

    await store.load({ orderRoute: ORDER_ROUTE, vwapTarget: VWAP_TARGET })

    // 全件が残るなら「AND で絞れた」ことにならない
    expect(bothCodes.length).toBeGreaterThan(0)
    expect(bothCodes.length).toBeLessThan(TOTAL)
    expect(store.orderRoute).toBe(ORDER_ROUTE)
    expect(store.vwapTarget).toBe(VWAP_TARGET)
    expect(store.total).toBe(bothCodes.length)
    expect(codes(store)).toEqual(bothCodes.slice(0, PAGE_SIZE))
  })

  it('[STS-06] 該当が無いときは空とみなす', async () => {
    const store = useStocksStore()

    await store.load({ stockCode: NO_MATCH })

    expect(store.items).toEqual([])
    expect(store.total).toBe(0)
    expect(store.isEmpty).toBe(true)
  })

  it('[STS-07] 取得に失敗したときは error に入り、空状態にはしない', async () => {
    failList()
    const store = useStocksStore()

    await store.load()

    expect(store.error?.message).toBe(ERROR_MESSAGE)
    expect(store.items).toEqual([])
    // 空とエラーは別の状態として出し分ける
    expect(store.isEmpty).toBe(false)
  })

  it('[STS-08] 取得中は loading が立つ', async () => {
    slowList(() => 10)
    const store = useStocksStore()

    const pending = store.load()
    expect(store.loading).toBe(true)

    await pending
    expect(store.loading).toBe(false)
  })

  it('[STS-09] reload は条件とページ位置を保ったまま読み直す', async () => {
    const store = useStocksStore()
    // 2 ページ目が残る条件でないと、このシナリオは意味を失う
    expect(PAGED.codes.length).toBeGreaterThan(PAGE_SIZE)
    await store.load({ offset: PAGE_SIZE, ...PAGED.filter })

    await store.reload()

    expect(store.offset).toBe(PAGE_SIZE)
    for (const [key, value] of Object.entries(PAGED.filter)) {
      expect(store[key]).toBe(value)
    }
    expect(codes(store)).toEqual(PAGED.codes.slice(PAGE_SIZE))
  })

  it('[STS-10] 読むだけの一覧なので登録・更新・削除を公開しない', () => {
    const store = useStocksStore()

    expect(store.create).toBeUndefined()
    expect(store.update).toBeUndefined()
    expect(store.remove).toBeUndefined()
    expect(store.creating).toBeUndefined()
    expect(store.deleting).toBeUndefined()
  })

  it('[STS-11] 古い応答が新しい結果を上書きしない', async () => {
    // 先に投げる 2 ページ目を遅く、後から投げる 1 ページ目を速く返す
    slowList((offset) => (offset === 0 ? 10 : 60))
    const store = useStocksStore()

    const stale = store.load({ offset: PAGE_SIZE })
    const latest = store.load({ offset: 0 })
    await Promise.all([stale, latest])

    expect(codes(store)).toEqual(allCodes.slice(0, PAGE_SIZE))
  })
})
