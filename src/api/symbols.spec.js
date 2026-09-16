import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { createSymbol, fetchSymbols, validateSymbol } from './symbols'

/*
 * API 層のテスト。ここだけが「バックエンドの形」を知ってよい層なので、
 * **送り出すリクエストそのもの** を docs/api/openapi.json の宣言と突き合わせる。
 *
 * ストア・画面のテストはモックが返す結果を見ているので、モックとサーバの理解がずれていても
 * 気づけない。この層でクエリ名・値の型・応答のキーを固定しておくと、ずれが 1 か所で見つかる。
 *
 * シナリオ: docs/unit/api-symbols.md
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
    http.get('*/api/masters/symbols', ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams }
      return HttpResponse.json(body, { status })
    }),
  )
}

/**
 * POST の本文まで記録して、指定の本文を返すハンドラを立てる。
 * 一覧の `record` と分けてあるのは、GET には読める本文が無いため
 * （読もうとすると空文字で例外になる）。
 *
 * @param {string} path `*` 始まりのパス
 * @param {unknown} body 返す本文
 * @param {number} [status]
 */
function recordPost(path, body, status = 200) {
  server.use(
    http.post(path, async ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams, body: await request.json() }
      return HttpResponse.json(body, { status })
    }),
  )
}

/** 必須 3 項目だけを埋めた入力（登録・事前検証のテストの土台） */
const minimalInput = { symbolCode: 'S900', ticker: 'ZZZZ', name: 'テスト銘柄' }

/** SymbolItem 1 件（openapi.json の項目をひととおり埋めたもの） */
const symbolItem = {
  // 主キー。SymbolItem に ID が載るのはバックエンド側の id 統一後（いまは先行して持つ）
  ID: 1,
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

describe('api/symbols', () => {
  it('[STA-01] 引数なしの一覧取得は limit と offset だけを送る', async () => {
    record(listBody([]))

    await fetchSymbols()

    expect(lastRequest.url.pathname).toBe('/api/masters/symbols')
    expect(lastRequest.params.get('limit')).toBe('50')
    expect(lastRequest.params.get('offset')).toBe('0')
    // 条件なしのときは送らない（実 API 側の既定に任せる）
    expect(lastRequest.params.has('symbol')).toBe(false)
    expect(lastRequest.params.has('restriction')).toBe(false)
    expect(lastRequest.params.has('route')).toBe(false)
    expect(lastRequest.params.has('vwap_target')).toBe(false)
    expect(lastRequest.params.has('include_deleted')).toBe(false)
  })

  it('[STA-02] limit は渡した値をそのまま送る', async () => {
    record(listBody([]))

    await fetchSymbols({ limit: 20 })

    expect(lastRequest.params.get('limit')).toBe('20')
  })

  it('[STA-03] 絞り込み条件は英語のクエリ名で送る', async () => {
    record(listBody([]))

    await fetchSymbols({
      symbolCode: 'AAPL',
      regulation: '0',
      orderRoute: '1',
      vwapTarget: '1',
    })

    // 送るのはレスポンスの日本語キーではなく、仕様どおりの英語のクエリ名
    expect(lastRequest.params.get('symbol')).toBe('AAPL')
    expect(lastRequest.params.get('restriction')).toBe('0')
    expect(lastRequest.params.get('route')).toBe('1')
    expect(lastRequest.params.get('vwap_target')).toBe('1')
    expect(lastRequest.params.has('銘柄コード')).toBe(false)
  })

  it('[STA-04] 空文字の条件はクエリに載せない', async () => {
    record(listBody([]))

    await fetchSymbols({ symbolCode: '', regulation: '', orderRoute: '', vwapTarget: '' })

    expect(lastRequest.params.has('symbol')).toBe(false)
    expect(lastRequest.params.has('restriction')).toBe(false)
    expect(lastRequest.params.has('route')).toBe(false)
    expect(lastRequest.params.has('vwap_target')).toBe(false)
  })

  it('[STA-05] offset は渡した値をそのまま送る', async () => {
    record(listBody([]))

    await fetchSymbols({ offset: 50 })

    expect(lastRequest.params.get('offset')).toBe('50')
  })

  it('[STA-06] SymbolItem をアプリ内モデルに変換する', async () => {
    record(listBody([symbolItem]))

    const { items, total } = await fetchSymbols()

    expect(total).toBe(1)
    expect(items).toEqual([
      {
        // 実 API の ID は integer。画面と URL では文字列として扱う
        id: '1',
        symbolCode: 'S001',
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
        // 更新日時 は楽観的ロックの合札。整形せず素の文字列で持ち、null は空文字に寄せる
        updatedAt: '',
      },
    ])

    // 更新日時を持つ行では、整形せずその文字列のまま合札として持つ
    record(listBody([{ ...symbolItem, 更新日時: '2026-08-20T09:30:00' }]))
    const withTimestamp = await fetchSymbols()
    expect(withTimestamp.items[0].updatedAt).toBe('2026-08-20T09:30:00')
  })

  it('[STA-07] null の文字列項目は空文字に寄せる', async () => {
    record(
      listBody([
        {
          ...symbolItem,
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

    const { items } = await fetchSymbols()

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
    record(listBody([{ ...symbolItem, 前日終値: null, 前日出来高: null, 平均出来高: null }]))

    const { items } = await fetchSymbols()

    // 空文字や 0 に寄せると「未取得」の意味が消える
    expect(items[0]).toMatchObject({
      previousClose: null,
      previousVolume: null,
      averageVolume: null,
    })
  })

  it('[STA-09] 相場の 0 は 0 のまま通す（未取得と混ぜない）', async () => {
    record(listBody([{ ...symbolItem, 前日終値: 0, 前日出来高: 0, 平均出来高: 0 }]))

    const { items } = await fetchSymbols()

    expect(items[0]).toMatchObject({ previousClose: 0, previousVolume: 0, averageVolume: 0 })
  })

  it('[STA-10] ユーザー操作フラグは boolean になる', async () => {
    record(
      listBody([
        { ...symbolItem, 銘柄コード: 'S001', ユーザー操作フラグ: 1 },
        { ...symbolItem, 銘柄コード: 'S002', ユーザー操作フラグ: 0 },
      ]),
    )

    const { items } = await fetchSymbols()

    expect(items.map((item) => item.userModified)).toEqual([true, false])
  })

  it('[STA-11] stocks を持たない応答でも空の一覧として扱う', async () => {
    record({ total: 0, limit: 50, offset: 0 })

    const { items, total } = await fetchSymbols()

    expect(items).toEqual([])
    expect(total).toBe(0)
  })

  it('[STA-12] サーバエラーは例外になる', async () => {
    record({ detail: 'サーバーでエラーが発生しました。' }, 500)

    await expect(fetchSymbols()).rejects.toBeTruthy()
  })

  it('[STA-13] 登録は日本語キーの本文を送り、応答の stock を変換して返す', async () => {
    recordPost(
      '*/api/masters/symbols',
      { success: true, stock: symbolItem, message: '銘柄を登録しました' },
      201,
    )

    const created = await createSymbol({
      ...minimalInput,
      nameEn: 'Test Inc.',
      regulation: '0',
      orderRoute: '1',
      vwapTarget: '1',
      previousClose: 12.5,
      averageVolume: 1000,
      note: 'メモ',
    })

    expect(lastRequest.url.pathname).toBe('/api/masters/symbols')
    expect(lastRequest.body).toEqual({
      銘柄コード: 'S900',
      Ticker: 'ZZZZ',
      銘柄名: 'テスト銘柄',
      銘柄名_英字: 'Test Inc.',
      規制情報: '0',
      注文ルート: '1',
      VWAP対象区分: '1',
      備考: 'メモ',
      前日終値: 12.5,
      平均出来高: 1000,
    })
    // 応答は SymbolItem なので、一覧と同じアプリ内モデルに変換されて返る
    expect(created).toMatchObject({ symbolCode: symbolItem.銘柄コード, ticker: symbolItem.Ticker })
  })

  it('[STA-14] 画面が持たない項目は本文に載せない', async () => {
    recordPost('*/api/masters/symbols', { success: true, stock: symbolItem, message: 'ok' }, 201)

    await createSymbol(minimalInput)

    /*
     * 市場名 / 前日出来高 / Pre区分 はフォームに無いので送らない。
     * 更新日時 は登録では持たない（楽観的ロックは更新のときだけ）。
     */
    for (const key of ['市場名', '前日出来高', 'Pre区分', '更新日時']) {
      expect(Object.hasOwn(lastRequest.body, key)).toBe(false)
    }
  })

  it('[STA-15] 数値 2 項目の空欄はキーを省かず null で送る', async () => {
    recordPost('*/api/masters/symbols', { success: true, stock: symbolItem, message: 'ok' }, 201)

    await createSymbol({ ...minimalInput, previousClose: '', averageVolume: '' })

    // SymbolRequest はレコード全体を差し替える形なので、キーを落とすと
    // 「変えない」と「空にする」が区別できない（クエリパラメータとは扱いが逆）
    expect(lastRequest.body).toMatchObject({ 前日終値: null, 平均出来高: null })
    for (const key of ['前日終値', '平均出来高']) {
      expect(Object.hasOwn(lastRequest.body, key)).toBe(true)
    }
  })

  it('[STA-16] 数値 2 項目は文字列で渡しても number で送る', async () => {
    recordPost('*/api/masters/symbols', { success: true, stock: symbolItem, message: 'ok' }, 201)

    // 入力欄は inputmode を指定しても値を文字列で持つ。数値に直すのはこの層の仕事
    await createSymbol({ ...minimalInput, previousClose: '12.5', averageVolume: '1000' })

    expect(lastRequest.body).toMatchObject({ 前日終値: 12.5, 平均出来高: 1000 })
  })

  it('[STA-17] 文字列の任意項目の空欄は null で送る', async () => {
    recordPost('*/api/masters/symbols', { success: true, stock: symbolItem, message: 'ok' }, 201)

    await createSymbol({ ...minimalInput, nameEn: '', regulation: '', note: '' })

    expect(lastRequest.body).toMatchObject({ 銘柄名_英字: null, 規制情報: null, 備考: null })
  })

  it('[STA-18] 注文ルートと VWAP対象区分の空欄だけは 0 に寄せる', async () => {
    recordPost('*/api/masters/symbols', { success: true, stock: symbolItem, message: 'ok' }, 201)

    await createSymbol({ ...minimalInput, orderRoute: '', vwapTarget: '' })

    // 注文ルートは型宣言が null を許さず、どちらも既定が '0'
    expect(lastRequest.body).toMatchObject({ 注文ルート: '0', VWAP対象区分: '0' })
  })

  it('[STA-19] 新規の事前検証はクエリを付けず SymbolRequest の本文だけを送る', async () => {
    recordPost('*/api/masters/symbols/validate', {
      valid: true,
      errors: [],
      warnings: [],
      details: null,
    })

    await validateSymbol(minimalInput)

    expect(lastRequest.url.pathname).toBe('/api/masters/symbols/validate')
    // 既定が新規検証なので、何も付けない
    expect(lastRequest.url.search).toBe('')
    expect(lastRequest.body).toMatchObject({
      銘柄コード: 'S900',
      Ticker: 'ZZZZ',
      銘柄名: 'テスト銘柄',
    })
  })

  it('[STA-20] 編集からの事前検証は id の有無で is_update=true を載せる', async () => {
    recordPost('*/api/masters/symbols/validate', { valid: true, errors: [] })

    await validateSymbol({ ...minimalInput, id: '42' })

    expect(lastRequest.params.get('is_update')).toBe('true')
    /*
     * 対象は本文の 銘柄コード から引かれる前提。CA の ca_id にあたるクエリは
     * /masters/symbols/validate の宣言（openapi.json）に存在しないので送らない。
     */
    expect(lastRequest.params.has('symbol_id')).toBe(false)
    // id は呼び出し側の都合。本文（SymbolRequest）には出さない
    expect(lastRequest.body).not.toHaveProperty('id')
    expect(lastRequest.body).not.toHaveProperty('ID')
  })

  it('[STA-21] 事前検証の不合格は例外にせず valid / errors を返す', async () => {
    recordPost('*/api/masters/symbols/validate', {
      valid: false,
      errors: ['銘柄コード(S001)は既に登録されています'],
      warnings: [],
      details: null,
    })

    // 不合格は通信・サーバ障害とは別物。throw すると呼び出し側が区別できない
    await expect(validateSymbol(minimalInput)).resolves.toEqual({
      valid: false,
      errors: ['銘柄コード(S001)は既に登録されています'],
    })
  })

  it('[STA-22] 事前検証の warnings は受け取らない', async () => {
    recordPost('*/api/masters/symbols/validate', {
      valid: true,
      errors: [],
      warnings: ['確認してください'],
      details: null,
    })

    const result = await validateSymbol(minimalInput)

    // 銘柄マスタに「登録できるが確認したいこと」は無い。返すと登録が 1 回で通らなくなる
    expect(result).toEqual({ valid: true, errors: [] })
    expect(result).not.toHaveProperty('warnings')
  })

  it('[STA-23] 登録の 400 は例外になり、サーバの detail が message に入る', async () => {
    recordPost('*/api/masters/symbols', { detail: '銘柄コード(S001)は既に登録されています' }, 400)

    await expect(createSymbol(minimalInput)).rejects.toMatchObject({
      message: '銘柄コード(S001)は既に登録されています',
    })
  })

  it('[STA-24] ID を持たない応答では id が空文字になる', async () => {
    const { ID: _id, ...withoutId } = symbolItem
    record(listBody([withoutId]))

    const { items } = await fetchSymbols()

    /*
     * 取り込み時点の openapi.json は SymbolItem に ID を持たない。
     * **銘柄コードへフォールバックしない**ことをここで固定する。値で取り繕うと、
     * 実 API が ID を返し始めるまで行のキーが壊れていることに気づけない。
     */
    expect(items[0].id).toBe('')
    expect(items[0].symbolCode).toBe('S001')
  })
})
