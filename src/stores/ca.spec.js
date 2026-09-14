import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { caStocks, corporateActions } from '@/mocks/fixtures/ca'
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

/*
 * 登録に使う値。銘柄コードはモックの銘柄マスタ（caStocks）に実在するものでなければ
 * 事前検証で弾かれるので、フィクスチャから採る。CA種別も既存の行と同じコードでよい
 * （CA には自然キーが無く、同じ銘柄・同じ種別の行が複数あっても正当）。
 */
const NEW_STOCK_CODE = caStocks[0].stockCode
const NEW_CA_TYPE = CA_TYPE

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 事前検証が銘柄マスタに無い銘柄コードへ返す理由（モックが実 API と同じ文言で返す） */
const unknownStockMessage = (stockCode) => `銘柄コード(${stockCode})は銘柄マスタに存在しません`

/** 一覧を 500 にする差し替え */
function failList() {
  server.use(
    http.get('*/api/ca', () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
  )
}

/** 登録（事前検証は既定のまま）を 500 にする差し替え */
function failCreate() {
  server.use(
    http.post('*/api/ca', () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
  )
}

/** 削除を 500 にする差し替え */
function failDelete() {
  server.use(
    http.delete('*/api/ca/:caId', () =>
      HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
    ),
  )
}

/** 更新（事前検証は既定のまま）を 409 にする差し替え */
function conflictOnUpdate(detail) {
  server.use(
    http.put('*/api/ca/:caId', () => HttpResponse.json({ detail }, { status: 409 })),
  )
}

/**
 * 事前検証が警告つきの合格を返す差し替え。
 * 実 API の CAValidationResponse は warnings を持つが、CA では使わない約束なので
 * 「返ってきても登録を止めない」ことを確かめるために使う。
 */
function warnOnValidate(message) {
  server.use(
    http.post('*/api/ca/validate', () =>
      HttpResponse.json({ valid: true, errors: [], warnings: [message], details: null }),
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

  it('[CAS-09] 登録・更新・削除の 3 系統をすべて公開する', () => {
    const store = useCaStore()

    expect(typeof store.create).toBe('function')
    expect(typeof store.clearCreateError).toBe('function')
    expect(store.creating).toBe(false)
    expect(store.validationErrors).toEqual([])

    expect(typeof store.update).toBe('function')
    expect(typeof store.clearUpdateError).toBe('function')
    expect(store.updating).toBe(false)
    expect(store.updateValidationErrors).toEqual([])

    expect(typeof store.remove).toBe('function')
    expect(typeof store.clearDeleteError).toBe('function')
    expect(store.deleting).toBe(false)
    expect(store.deleteError).toBeNull()
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

  it('[CAS-11] 登録に成功すると 1 件返り、一覧を読み直して件数が増える', async () => {
    const store = useCaStore()
    await store.load()

    const created = await store.create({ stockCode: NEW_STOCK_CODE, caType: NEW_CA_TYPE })

    expect(created.stockCode).toBe(NEW_STOCK_CODE)
    expect(created.caType).toBe(NEW_CA_TYPE)
    expect(store.total).toBe(TOTAL + 1)
    expect(store.createError).toBeNull()
    expect(store.validationErrors).toEqual([])
  })

  it('[CAS-12] 事前検証で弾かれたときは validationErrors に入り、登録しない', async () => {
    const store = useCaStore()
    await store.load()

    const created = await store.create({ stockCode: NO_MATCH, caType: NEW_CA_TYPE })

    expect(created).toBeNull()
    expect(store.validationErrors).toEqual([unknownStockMessage(NO_MATCH)])
    // 通信は成功しているので、サーバ障害の枠には入れない
    expect(store.createError).toBeNull()
    expect(store.total).toBe(TOTAL)
  })

  it('[CAS-13] 登録が失敗したときは createError に入る', async () => {
    failCreate()
    const store = useCaStore()
    await store.load()

    const created = await store.create({ stockCode: NEW_STOCK_CODE, caType: NEW_CA_TYPE })

    expect(created).toBeNull()
    expect(store.createError?.message).toBe(ERROR_MESSAGE)
    // 事前検証は通っているので、こちらは空のまま
    expect(store.validationErrors).toEqual([])
    expect(store.total).toBe(TOTAL)
  })

  it('[CAS-14] clearCreateError は前回の失敗をどちらの枠からも消す', async () => {
    failCreate()
    const store = useCaStore()
    await store.create({ stockCode: NEW_STOCK_CODE, caType: NEW_CA_TYPE })
    await store.create({ stockCode: NO_MATCH, caType: NEW_CA_TYPE })

    store.clearCreateError()

    expect(store.createError).toBeNull()
    expect(store.validationErrors).toEqual([])
  })

  it('[CAS-15] 登録後の読み直しで絞り込み条件が落ちない', async () => {
    const store = useCaStore()
    await store.load({ caType: CA_TYPE })

    await store.create({ stockCode: NEW_STOCK_CODE, caType: CA_TYPE })

    expect(store.caType).toBe(CA_TYPE)
    expect(store.total).toBe(caTypeIds.length + 1)
    expect(store.items.every((item) => item.caType === CA_TYPE)).toBe(true)
  })

  it('[CAS-16] 事前検証が警告を返しても登録は止まらない', async () => {
    warnOnValidate('この CA は既存の行と同じ日付です')
    const store = useCaStore()
    await store.load()

    const created = await store.create({ stockCode: NEW_STOCK_CODE, caType: NEW_CA_TYPE })

    expect(created).not.toBeNull()
    expect(store.total).toBe(TOTAL + 1)
    // api 層が warnings を受け取らないので、確認待ちの経路には入らない
    expect(store.validationWarnings).toEqual([])
  })

  it('[CAS-17] 更新に成功すると一覧の該当行が入れ替わる', async () => {
    const store = useCaStore()
    await store.load()
    const target = store.items[0]

    const updated = await store.update({
      ...target,
      note: '編集した備考',
      updatedAt: target.updatedAt,
    })

    expect(updated.note).toBe('編集した備考')
    expect(store.items[0].note).toBe('編集した備考')
    // 更新は行を増やさない
    expect(store.total).toBe(TOTAL)
    expect(store.updateError).toBeNull()
    expect(store.updateValidationErrors).toEqual([])
  })

  it('[CAS-18] 事前検証で弾かれたときは updateValidationErrors に入り、更新しない', async () => {
    const store = useCaStore()
    await store.load()
    const target = store.items[0]

    const updated = await store.update({ ...target, stockCode: NO_MATCH })

    expect(updated).toBeNull()
    expect(store.updateValidationErrors).toEqual([unknownStockMessage(NO_MATCH)])
    // 通信は成功しているので、サーバ障害の枠には入れない
    expect(store.updateError).toBeNull()
    expect(store.items[0].stockCode).toBe(target.stockCode)
  })

  it('[CAS-19] 楽観的ロックの競合は updateError に入る', async () => {
    const detail = '他のユーザーによってCAデータが更新されています。'
    conflictOnUpdate(detail)
    const store = useCaStore()
    await store.load()
    const target = store.items[0]

    const updated = await store.update({ ...target, note: '編集した備考' })

    expect(updated).toBeNull()
    // 事前検証の不合格ではなく通信・サーバ障害と同じ枠（画面は 409 を特別扱いしない）
    expect(store.updateError?.message).toBe(detail)
    expect(store.updateValidationErrors).toEqual([])
    // 競合しても一覧は自動で読み直さない（モーダルが握る合札は古いままなので意味が無い）
    expect(store.items[0].note).toBe(target.note)
  })

  it('[CAS-20] clearUpdateError は更新側だけを消し、登録側を消さない', async () => {
    failCreate()
    conflictOnUpdate('競合しました')
    const store = useCaStore()
    await store.load()
    await store.create({ stockCode: NEW_STOCK_CODE, caType: NEW_CA_TYPE })
    await store.update({ ...store.items[0], note: '編集した備考' })

    store.clearUpdateError()

    expect(store.updateError).toBeNull()
    expect(store.updateValidationErrors).toEqual([])
    // 片方を消しても、もう片方のモーダルの理由は残る（枠を共用していない）
    expect(store.createError?.message).toBe(ERROR_MESSAGE)
  })

  it('[CAS-21] 更新後の読み直しで絞り込み条件が落ちない', async () => {
    const store = useCaStore()
    await store.load({ caType: CA_TYPE })
    const target = store.items[0]
    // 絞り込みの圏外へ移す CA種別（フィクスチャに在る別のコードから採る）
    const otherType = sorted.find((ca) => ca.CA種別 !== CA_TYPE).CA種別

    await store.update({ ...target, caType: otherType })

    expect(store.caType).toBe(CA_TYPE)
    expect(store.total).toBe(caTypeIds.length - 1)
    expect(store.items.every((item) => item.caType === CA_TYPE)).toBe(true)
  })

  it('[CAS-22] 削除に成功すると一覧からその行が消える', async () => {
    const store = useCaStore()
    await store.load()
    const target = store.items[0]

    const deleted = await store.remove(target.id)

    expect(deleted).toBe(true)
    expect(store.total).toBe(TOTAL - 1)
    // 実 API は論理削除だが、一覧は取消済みを返さないので消えたように見える
    expect(store.items.map((item) => item.id)).not.toContain(target.id)
    expect(store.deleteError).toBeNull()
  })

  it('[CAS-23] 削除が失敗したときは deleteError に入り、一覧は変わらない', async () => {
    failDelete()
    const store = useCaStore()
    await store.load()
    const target = store.items[0]

    const deleted = await store.remove(target.id)

    expect(deleted).toBe(false)
    expect(store.deleteError?.message).toBe(ERROR_MESSAGE)
    expect(store.total).toBe(TOTAL)
    expect(store.items.map((item) => item.id)).toContain(target.id)
  })

  it('[CAS-24] clearDeleteError は前回の失敗を消す', async () => {
    failDelete()
    const store = useCaStore()
    await store.load()
    await store.remove(store.items[0].id)

    store.clearDeleteError()

    expect(store.deleteError).toBeNull()
  })
})
