import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { symbols } from '@/mocks/fixtures/symbols'
import { SYMBOLS_PAGE_SIZE, useSymbolsStore } from './symbols'

/*
 * 既定の MSW ハンドラ（実 API と同じ絞り込み・並び順）に当てる。
 * 期待値はフィクスチャと表示件数から導き、56 / 50 / 'AAPL' のような値を直接書かない。
 *
 * シナリオ: docs/unit/stores-symbols.md
 */

const PAGE_SIZE = SYMBOLS_PAGE_SIZE
const TOTAL = symbols.length

/** 実 API と同じ並び（銘柄コードの昇順）。フィクスチャは生成順のまま置かれている */
const sorted = [...symbols].sort((a, b) => a.銘柄コード.localeCompare(b.銘柄コード))
const codesOf = (rows) => rows.map((symbol) => symbol.銘柄コード)
const allCodes = codesOf(sorted)

/** 実 API と同じ規則（銘柄コードか Ticker への部分一致・大文字小文字を区別しない） */
const matchesCode = (symbol, keyword) =>
  symbol.銘柄コード.toUpperCase().includes(keyword.toUpperCase()) ||
  symbol.Ticker.toUpperCase().includes(keyword.toUpperCase())

/** フィクスチャに現れる区分コードを、件数の昇順で並べる */
function valuesByCount(key) {
  const counts = new Map()
  for (const symbol of sorted) {
    counts.set(symbol[key], (counts.get(symbol[key]) ?? 0) + 1)
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
      codes: codesOf(sorted.filter((symbol) => symbol[fixtureKey] === value)),
    }
  })

  return candidates.sort((a, b) => b.codes.length - a.codes.length)[0]
}

// 絞り込みに使う値もフィクスチャから導く
const TICKER = sorted[0].Ticker
const tickerCodes = codesOf(sorted.filter((symbol) => matchesCode(symbol, TICKER)))

const REGULATION = rarestValue('規制情報')
const regulationCodes = codesOf(sorted.filter((symbol) => symbol.規制情報 === REGULATION))

// reload は「2 ページ目に居るまま読み直す」ことを見たいので、2 ページ目ができる条件を使う
const PAGED = widestFilter()

// AND の組み合わせは実在する行から取る（存在しない組み合わせだと 0 件になって意味を失う）
const ORDER_ROUTE = sorted[0].注文ルート
const VWAP_TARGET = sorted[0].VWAP対象区分
const bothCodes = codesOf(
  sorted.filter(
    (symbol) => symbol.注文ルート === ORDER_ROUTE && symbol.VWAP対象区分 === VWAP_TARGET,
  ),
)

// フィクスチャのどの銘柄コード・Ticker にも当たらない文字列
const NO_MATCH = 'ZZZZ'

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 一覧を 500 にする差し替え */
function failList() {
  server.use(
    http.get('*/api/masters/symbols', () =>
      HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
    ),
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
    http.get('*/api/masters/symbols', async ({ request }) => {
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

/** 登録を 500 にする差し替え（事前検証は既定ハンドラのまま通す） */
function failCreate() {
  server.use(
    http.post('*/api/masters/symbols', () =>
      HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
    ),
  )
}

/** 更新を 500 にする差し替え（事前検証は既定ハンドラのまま通す） */
function failUpdate() {
  server.use(
    http.put('*/api/masters/symbols/:id', () =>
      HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
    ),
  )
}

/** 事前検証が「合格だが警告あり」を返す差し替え */
function warnOnValidate(message) {
  server.use(
    http.post('*/api/masters/symbols/validate', () =>
      HttpResponse.json({ valid: true, errors: [], warnings: [message], details: null }),
    ),
  )
}

// フィクスチャに無い銘柄コード（登録に使う）と、既にある銘柄コード（重複で弾かれる）
const NEW_SYMBOL = { symbolCode: 'S900', ticker: 'ZZZZ', name: 'テスト銘柄' }
const EXISTING_CODE = sorted[0].銘柄コード
const duplicateMessage = (code) => `銘柄コード(${code})は既に登録されています`

const codes = (store) => store.items.map((item) => item.symbolCode)

/*
 * 事前検証を落とすための値。コードマスタに無い注文ルートは既定ハンドラが
 * `注文ルート(9)はコードマスタに存在しません` で弾く。画面のセレクトは有効なコードしか
 * 出さないのでこの経路は通らないが、ストアから直に渡せば事前検証の不合格を再現できる。
 */
const UNKNOWN_ORDER_ROUTE = '9'
const unknownRouteMessage = `注文ルート(${UNKNOWN_ORDER_ROUTE})はコードマスタに存在しません`

/*
 * 合札を持つ行（ユーザー操作フラグ=1）。モックは「どちらかが null なら照合しない」ので、
 * 印の付いていない行に古い合札を送っても 409 にならない。
 */
const withTimestamp = (store) => store.items.find((item) => item.updatedAt)

describe('stores/symbols', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[STS-01] 既定の読み込みで 1 ページ目が並び順どおりに入る', async () => {
    const store = useSymbolsStore()

    await store.load()

    expect(store.total).toBe(TOTAL)
    expect(store.offset).toBe(0)
    expect(store.limit).toBe(PAGE_SIZE)
    expect(codes(store)).toEqual(allCodes.slice(0, PAGE_SIZE))
  })

  it('[STS-02] offset を渡すとその位置から読み込む', async () => {
    const store = useSymbolsStore()

    await store.load({ offset: PAGE_SIZE })

    expect(store.offset).toBe(PAGE_SIZE)
    expect(codes(store)).toEqual(allCodes.slice(PAGE_SIZE))
    // 全件がちょうど 1 ページに収まっていたら、このシナリオは意味を失う
    expect(store.items.length).toBeGreaterThan(0)
  })

  it('[STS-03] 銘柄コード・ティッカーコードで絞り込む', async () => {
    const store = useSymbolsStore()

    await store.load({ symbolCode: TICKER })

    expect(store.symbolCode).toBe(TICKER)
    expect(store.total).toBe(tickerCodes.length)
    expect(codes(store)).toEqual(tickerCodes)
  })

  it('[STS-04] 取引可否（規制情報）で絞り込む', async () => {
    const store = useSymbolsStore()

    await store.load({ regulation: REGULATION })

    expect(store.regulation).toBe(REGULATION)
    expect(store.total).toBe(regulationCodes.length)
    expect(codes(store)).toEqual(regulationCodes.slice(0, PAGE_SIZE))
  })

  it('[STS-05] 預託先区分と VWAP対象区分は AND で絞り込む', async () => {
    const store = useSymbolsStore()

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
    const store = useSymbolsStore()

    await store.load({ symbolCode: NO_MATCH })

    expect(store.items).toEqual([])
    expect(store.total).toBe(0)
    expect(store.isEmpty).toBe(true)
  })

  it('[STS-07] 取得に失敗したときは error に入り、空状態にはしない', async () => {
    failList()
    const store = useSymbolsStore()

    await store.load()

    expect(store.error?.message).toBe(ERROR_MESSAGE)
    expect(store.items).toEqual([])
    // 空とエラーは別の状態として出し分ける
    expect(store.isEmpty).toBe(false)
  })

  it('[STS-08] 取得中は loading が立つ', async () => {
    slowList(() => 10)
    const store = useSymbolsStore()

    const pending = store.load()
    expect(store.loading).toBe(true)

    await pending
    expect(store.loading).toBe(false)
  })

  it('[STS-09] reload は条件とページ位置を保ったまま読み直す', async () => {
    const store = useSymbolsStore()
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

  it('[STS-10] 登録と更新を公開し、削除はまだ公開しない', () => {
    const store = useSymbolsStore()

    expect(typeof store.create).toBe('function')
    expect(typeof store.clearCreateError).toBe('function')
    expect(store.creating).toBe(false)
    expect(store.createError).toBeNull()
    expect(store.validationErrors).toEqual([])

    expect(typeof store.update).toBe('function')
    expect(typeof store.clearUpdateError).toBe('function')
    expect(store.updating).toBe(false)
    expect(store.updateError).toBeNull()
    // 登録側と更新側で入れ物が分かれている（片方の理由がもう片方のモーダルに漏れない）
    expect(store.updateValidationErrors).toEqual([])

    // 配線していない操作は名前ごと出さない（呼べば「関数が無い」で落ちる）
    expect(store.remove).toBeUndefined()
    expect(store.deleting).toBeUndefined()
    expect(store.deleteError).toBeUndefined()
  })

  it('[STS-11] 古い応答が新しい結果を上書きしない', async () => {
    // 先に投げる 2 ページ目を遅く、後から投げる 1 ページ目を速く返す
    slowList((offset) => (offset === 0 ? 10 : 60))
    const store = useSymbolsStore()

    const stale = store.load({ offset: PAGE_SIZE })
    const latest = store.load({ offset: 0 })
    await Promise.all([stale, latest])

    expect(codes(store)).toEqual(allCodes.slice(0, PAGE_SIZE))
  })

  it('[STS-12] 登録に成功すると 1 件返り、一覧を読み直して件数が増える', async () => {
    const store = useSymbolsStore()
    await store.load()

    const created = await store.create(NEW_SYMBOL)

    expect(created.symbolCode).toBe(NEW_SYMBOL.symbolCode)
    expect(created.ticker).toBe(NEW_SYMBOL.ticker)
    expect(store.total).toBe(TOTAL + 1)
    expect(store.createError).toBeNull()
    expect(store.validationErrors).toEqual([])
  })

  it('[STS-13] 事前検証で弾かれたときは validationErrors に入り、登録しない', async () => {
    const store = useSymbolsStore()
    await store.load()

    const created = await store.create({ ...NEW_SYMBOL, symbolCode: EXISTING_CODE })

    expect(created).toBeNull()
    expect(store.validationErrors).toEqual([duplicateMessage(EXISTING_CODE)])
    // 通信は成功しているので、サーバ障害の枠には入れない
    expect(store.createError).toBeNull()
    expect(store.total).toBe(TOTAL)
  })

  it('[STS-14] 登録が失敗したときは createError に入る', async () => {
    failCreate()
    const store = useSymbolsStore()
    await store.load()

    const created = await store.create(NEW_SYMBOL)

    expect(created).toBeNull()
    expect(store.createError.message).toBe(ERROR_MESSAGE)
    // 事前検証は通っているので、こちらは空のまま
    expect(store.validationErrors).toEqual([])
    expect(store.total).toBe(TOTAL)
  })

  it('[STS-15] clearCreateError は前回の失敗をどちらの枠からも消す', async () => {
    failCreate()
    const store = useSymbolsStore()
    await store.create(NEW_SYMBOL)
    await store.create({ ...NEW_SYMBOL, symbolCode: EXISTING_CODE })

    store.clearCreateError()

    expect(store.createError).toBeNull()
    expect(store.validationErrors).toEqual([])
  })

  it('[STS-16] 登録後の読み直しで絞り込み条件が落ちない', async () => {
    const store = useSymbolsStore()
    await store.load({ regulation: REGULATION })

    await store.create({ ...NEW_SYMBOL, regulation: REGULATION })

    expect(store.regulation).toBe(REGULATION)
    expect(store.total).toBe(regulationCodes.length + 1)
    expect(store.items.every((item) => item.regulation === REGULATION)).toBe(true)
  })

  it('[STS-17] 事前検証が警告を返しても登録は止まらない', async () => {
    warnOnValidate('この銘柄コードは過去に取消されています')
    const store = useSymbolsStore()
    await store.load()

    const created = await store.create(NEW_SYMBOL)

    expect(created).not.toBeNull()
    expect(store.total).toBe(TOTAL + 1)
    // api 層が warnings を受け取らないので、確認待ちの経路には入らない
    expect(store.validationWarnings).toEqual([])
  })

  it('[STS-18] 更新に成功すると該当行だけが新しい内容になる', async () => {
    const store = useSymbolsStore()
    await store.load()
    const target = store.items[0]

    const updated = await store.update({ ...target, note: '直した備考' })

    expect(updated.note).toBe('直した備考')
    // 更新は行を増やさない。並びも銘柄コード順のままなので同じ位置に居る
    expect(store.total).toBe(TOTAL)
    expect(codes(store)).toEqual(allCodes.slice(0, PAGE_SIZE))
    expect(store.items[0].note).toBe('直した備考')
    expect(store.updateError).toBeNull()
    expect(store.updateValidationErrors).toEqual([])
  })

  it('[STS-19] 事前検証で弾かれたときは updateValidationErrors に入り、更新しない', async () => {
    const store = useSymbolsStore()
    await store.load()
    const target = store.items[0]

    const updated = await store.update({ ...target, orderRoute: UNKNOWN_ORDER_ROUTE })

    expect(updated).toBeNull()
    expect(store.updateValidationErrors).toEqual([unknownRouteMessage])
    // 通信は成功しているので、サーバ障害の枠には入れない
    expect(store.updateError).toBeNull()
    expect(store.items[0].orderRoute).toBe(target.orderRoute)
  })

  it('[STS-20] 古い合札を送ると updateError に競合の理由が入る', async () => {
    const store = useSymbolsStore()
    await store.load()
    const target = withTimestamp(store)
    const before = codes(store)

    const updated = await store.update({
      ...target,
      note: '直した備考',
      updatedAt: '2020-01-01T00:00:00',
    })

    expect(updated).toBeNull()
    expect(store.updateError.status).toBe(409)
    // 競合は事前検証の不合格ではない。枠が混ざっていないこと
    expect(store.updateValidationErrors).toEqual([])
    // 一覧は自動で読み直さない（読み直しても画面が握る合札は古いままで再度 409 になる）
    expect(codes(store)).toEqual(before)
  })

  it('[STS-21] 更新が失敗したときは updateError に入る', async () => {
    failUpdate()
    const store = useSymbolsStore()
    await store.load()

    const updated = await store.update({ ...store.items[0], note: '直した備考' })

    expect(updated).toBeNull()
    expect(store.updateError.message).toBe(ERROR_MESSAGE)
    // 事前検証は通っているので、こちらは空のまま
    expect(store.updateValidationErrors).toEqual([])
  })

  it('[STS-22] clearUpdateError は更新側だけを消し、登録側を残す', async () => {
    const store = useSymbolsStore()
    await store.load()

    /*
     * create / update は呼ぶたびに自分の枠を空にするので、1 回の実行では片方しか埋まらない。
     * 更新側の 2 枠は順に埋めて、最後に残るのが「事前検証の不合格」と「通信・サーバ障害」の
     * 両方であるようにする。
     */
    await store.update({ ...store.items[0], orderRoute: UNKNOWN_ORDER_ROUTE })
    expect(store.updateValidationErrors).toEqual([unknownRouteMessage])

    failUpdate()
    await store.update({ ...store.items[0], note: '直した備考' })
    expect(store.updateError.message).toBe(ERROR_MESSAGE)

    // 登録側にも理由を残しておく（消えてはいけないほう）
    await store.create({ ...NEW_SYMBOL, symbolCode: EXISTING_CODE })
    expect(store.validationErrors).toEqual([duplicateMessage(EXISTING_CODE)])

    store.clearUpdateError()

    expect(store.updateError).toBeNull()
    expect(store.updateValidationErrors).toEqual([])
    // 登録側は残る（枠を共用していたら、ここで消えてしまう）
    expect(store.validationErrors).toEqual([duplicateMessage(EXISTING_CODE)])
  })

  it('[STS-23] 絞り込みの圏外へ変えても条件は落ちず、件数が 1 減る', async () => {
    const store = useSymbolsStore()
    await store.load({ regulation: REGULATION })
    // フィクスチャに現れる規制情報のうち、いま絞り込んでいるものではないほう
    const other = valuesByCount('規制情報').find((value) => value !== REGULATION)

    await store.update({ ...store.items[0], regulation: other })

    expect(store.regulation).toBe(REGULATION)
    expect(store.total).toBe(regulationCodes.length - 1)
    expect(store.items.every((item) => item.regulation === REGULATION)).toBe(true)
  })
})
