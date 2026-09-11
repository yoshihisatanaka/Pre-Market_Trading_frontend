import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { corporateActions } from '@/mocks/fixtures/ca'
import { CA_PAGE_SIZE, useCaStore } from './ca'

/*
 * 既定の MSW ハンドラ（実 API と同じ絞り込み・並び順）に当てる。
 * 期待値はフィクスチャと表示件数から導き、56 / 50 のような数値を直接書かない。
 *
 * シナリオ: docs/unit/stores-ca.md
 */

const PAGE_SIZE = CA_PAGE_SIZE
const TOTAL = corporateActions.length

/**
 * フィクスチャを実 API と同じ順（効力発生日の降順、同じなら ID の降順）に並べる。
 * フィクスチャ自体は生成順のまま置かれているので、期待値はここで作る。
 */
const sortKey = (ca) => ca.効力発生日 ?? ca.権利付最終日 ?? 99999999
const sorted = [...corporateActions].sort((a, b) => sortKey(b) - sortKey(a) || b.ID - a.ID)
const expectedIds = sorted.map((ca) => String(ca.ID))

// 絞り込みに使う値もフィクスチャから導く（'AAPL' や '110' を直接書かない）
const TICKER = sorted[0].Ticker
const tickerIds = sorted.filter((ca) => ca.Ticker === TICKER).map((ca) => String(ca.ID))
const CA_TYPE = sorted[0].CA種別
const caTypeIds = sorted.filter((ca) => ca.CA種別 === CA_TYPE).map((ca) => String(ca.ID))

// フィクスチャのどの銘柄コード・Ticker にも当たらない文字列
const NO_MATCH = 'ZZZZ'

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 一覧を 500 にする差し替え */
function failList() {
  server.use(
    http.get('*/api/ca', () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
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
    http.get('*/api/ca', async ({ request }) => {
      const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0)
      await delay(waitFor(offset))
      return HttpResponse.json({
        total: TOTAL,
        limit: PAGE_SIZE,
        offset,
        ca_list: sorted.slice(offset, offset + PAGE_SIZE),
      })
    }),
  )
}

describe('stores/ca', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[CAS-01] 既定の読み込みで 1 ページ目が並び順どおりに入る', async () => {
    const store = useCaStore()

    await store.load()

    expect(store.total).toBe(TOTAL)
    expect(store.offset).toBe(0)
    expect(store.limit).toBe(PAGE_SIZE)
    expect(store.items.map((item) => item.id)).toEqual(expectedIds.slice(0, PAGE_SIZE))
  })

  it('[CAS-02] offset を渡すとその位置から読み込む', async () => {
    const store = useCaStore()

    await store.load({ offset: PAGE_SIZE })

    expect(store.offset).toBe(PAGE_SIZE)
    expect(store.items.map((item) => item.id)).toEqual(expectedIds.slice(PAGE_SIZE))
    // 全件がちょうど 1 ページに収まっていたら、このシナリオは意味を失う
    expect(store.items.length).toBeGreaterThan(0)
  })

  it('[CAS-03] 銘柄コードで絞り込む', async () => {
    const store = useCaStore()

    await store.load({ stockCode: TICKER })

    expect(store.stockCode).toBe(TICKER)
    expect(store.total).toBe(tickerIds.length)
    expect(store.items.map((item) => item.id)).toEqual(tickerIds)
  })

  it('[CAS-04] CA種別で絞り込む', async () => {
    const store = useCaStore()

    await store.load({ caType: CA_TYPE })

    expect(store.caType).toBe(CA_TYPE)
    expect(store.items.map((item) => item.id)).toEqual(caTypeIds)
  })

  it('[CAS-05] 該当が無いときは空とみなす', async () => {
    const store = useCaStore()

    await store.load({ stockCode: NO_MATCH })

    expect(store.items).toEqual([])
    expect(store.total).toBe(0)
    expect(store.isEmpty).toBe(true)
  })

  it('[CAS-06] 取得に失敗したときは error に入り、空状態にはしない', async () => {
    failList()
    const store = useCaStore()

    await store.load()

    expect(store.error?.message).toBe(ERROR_MESSAGE)
    expect(store.items).toEqual([])
    // 空とエラーは別の状態として出し分ける
    expect(store.isEmpty).toBe(false)
  })

  it('[CAS-07] 取得中は loading が立つ', async () => {
    slowList(() => 10)
    const store = useCaStore()

    const pending = store.load()
    expect(store.loading).toBe(true)

    await pending
    expect(store.loading).toBe(false)
  })

  it('[CAS-08] reload は条件とページ位置を保ったまま読み直す', async () => {
    const store = useCaStore()
    await store.load({ offset: 0, stockCode: TICKER })

    await store.reload()

    expect(store.stockCode).toBe(TICKER)
    expect(store.items.map((item) => item.id)).toEqual(tickerIds)
  })

  it('[CAS-09] 読むだけの一覧なので登録・更新・削除を公開しない', () => {
    const store = useCaStore()

    expect(store.create).toBeUndefined()
    expect(store.update).toBeUndefined()
    expect(store.remove).toBeUndefined()
    expect(store.creating).toBeUndefined()
    expect(store.deleting).toBeUndefined()
  })

  it('[CAS-10] 古い応答が新しい結果を上書きしない', async () => {
    // 先に投げる 2 ページ目を遅く、後から投げる 1 ページ目を速く返す
    slowList((offset) => (offset === 0 ? 10 : 60))
    const store = useCaStore()

    const stale = store.load({ offset: PAGE_SIZE })
    const latest = store.load({ offset: 0 })
    await Promise.all([stale, latest])

    expect(store.items.map((item) => item.id)).toEqual(expectedIds.slice(0, PAGE_SIZE))
  })
})
