import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import {
  createCorporateAction,
  deleteCorporateAction,
  fetchCorporateActions,
  updateCorporateAction,
  validateCorporateAction,
} from './ca'

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
    http.get('*/api/masters/ca', ({ request }) => {
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

/** PUT の本文まで記録して、指定の本文を返すハンドラを立てる（`recordPost` の PUT 版） */
function recordPut(path, body, status = 200) {
  server.use(
    http.put(path, async ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams, body: await request.json() }
      return HttpResponse.json(body, { status })
    }),
  )
}

/**
 * CAItem 1 件（openapi.json の項目をひととおり埋めたもの）。
 * `ステータス` だけは openapi に無い仮の項目（src/api/ca.js のファイル冒頭コメント参照）。
 */
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
  ステータス: '2',
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

    expect(lastRequest.url.pathname).toBe('/api/masters/ca')
    expect(lastRequest.params.get('limit')).toBe('50')
    expect(lastRequest.params.get('offset')).toBe('0')
    // 条件なしのときは送らない（実 API 側の既定に任せる）
    expect(lastRequest.params.has('symbol')).toBe(false)
    expect(lastRequest.params.has('ca_type')).toBe(false)
    expect(lastRequest.params.has('include_deleted')).toBe(false)
  })

  it('[CAA-02] 絞り込み条件は symbol / ca_type という名前で送る', async () => {
    record(listBody([]))

    await fetchCorporateActions({ stockCode: 'AAPL', caType: '110' })

    // 銘柄は `symbol`。2026-09-16 の仕様取り込みで stock_code から改名された
    expect(lastRequest.params.get('symbol')).toBe('AAPL')
    expect(lastRequest.params.get('ca_type')).toBe('110')
    // 旧名で送っていないこと（残っていても FastAPI は無視するので気づけない）
    expect(lastRequest.params.has('stock_code')).toBe(false)
  })

  it('[CAA-03] 空文字の条件はクエリに載せない', async () => {
    record(listBody([]))

    await fetchCorporateActions({ stockCode: '', caType: '' })

    expect(lastRequest.params.has('symbol')).toBe(false)
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
        // 分母・分子は編集フォームへ戻すための生の数値（比率は表示用の文字列）
        denominator: 1,
        numerator: 2,
        ratio: '1:2',
        note: '1:2 株式分割',
        status: '2',
        userModified: false,
        // 更新日時 が null の行。undefined ではなく空文字に寄せる
        updatedAt: '',
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

  it('[CAA-11] 登録は日本語キー・integer の日付で送り、応答の ca を変換して返す', async () => {
    recordPost('*/api/masters/ca', { success: true, ca: caItem, message: 'CAを登録しました' }, 201)

    const created = await createCorporateAction({
      stockCode: 'A0001',
      caType: '120',
      exRightsDate: '2026-04-28',
      effectiveDate: '2026-04-30',
      paymentDate: '',
      denominator: 1,
      numerator: 2,
      note: 'メモ',
      status: '2',
    })

    expect(lastRequest.url.pathname).toBe('/api/masters/ca')
    expect(lastRequest.body).toEqual({
      銘柄コード: 'A0001',
      CA種別: '120',
      // 日付は integer の YYYYMMDD。空文字の支払日は「未設定」なので null
      権利付最終日: 20260428,
      効力発生日: 20260430,
      支払日: null,
      分母: 1,
      分子: 2,
      備考: 'メモ',
      ステータス: '2',
    })
    // Ticker は送らない（実 API が銘柄マスタから補完する）
    expect(lastRequest.body).not.toHaveProperty('Ticker')
    // 応答は CAItem なので、一覧と同じアプリ内モデルに変換されて返る
    expect(created).toMatchObject({ id: String(caItem.ID), stockCode: caItem.銘柄コード, ratio: '1:2' })
  })

  it('[CAA-12] 未設定の項目はキーを省かず null で送る', async () => {
    recordPost('*/api/masters/ca', { success: true, ca: caItem, message: 'ok' }, 201)

    await createCorporateAction({ stockCode: 'A0001', caType: '120', paymentDate: '' })

    /*
     * CARequest はレコード全体を差し替える形なので、キーを落とすと
     * 「変えない」と「空にする」が区別できない（クエリパラメータとは扱いが逆）
     */
    expect(lastRequest.body).toEqual({
      銘柄コード: 'A0001',
      CA種別: '120',
      権利付最終日: null,
      効力発生日: null,
      支払日: null,
      分母: null,
      分子: null,
      備考: null,
      ステータス: null,
    })
    for (const key of [
      '権利付最終日',
      '効力発生日',
      '支払日',
      '分母',
      '分子',
      '備考',
      'ステータス',
    ]) {
      expect(Object.hasOwn(lastRequest.body, key)).toBe(true)
    }
  })

  it('[CAA-13] 新規の事前検証はクエリを付けず CARequest の本文だけを送る', async () => {
    recordPost('*/api/masters/ca/validate', { valid: true, errors: [], warnings: [], details: null })

    await validateCorporateAction({ stockCode: 'A0001', caType: '120' })

    expect(lastRequest.url.pathname).toBe('/api/masters/ca/validate')
    // 既定が新規検証なので、何も付けない
    expect(lastRequest.url.search).toBe('')
    expect(lastRequest.body).toMatchObject({ 銘柄コード: 'A0001', CA種別: '120' })
  })

  it('[CAA-14] 編集からの事前検証は ca_id と is_update=true をクエリに載せる', async () => {
    recordPost('*/api/masters/ca/validate', { valid: true, errors: [], warnings: [], details: null })

    await validateCorporateAction({ id: '7', stockCode: 'A0001', caType: '120' })

    // 実 API は検証対象を本文ではなくクエリの ca_id（integer 宣言）で受ける
    expect(lastRequest.params.get('ca_id')).toBe('7')
    expect(lastRequest.params.get('is_update')).toBe('true')
    // id は本文には出さない（CARequest に ID という項目は無い）
    expect(lastRequest.body).not.toHaveProperty('ID')
    expect(lastRequest.body).not.toHaveProperty('id')
  })

  it('[CAA-15] 事前検証の不合格は例外にせず valid / errors を返す', async () => {
    const errors = ['銘柄コード(ZZZZ)は銘柄マスタに存在しません']
    recordPost('*/api/masters/ca/validate', { valid: false, errors, warnings: [], details: null })

    const result = await validateCorporateAction({ stockCode: 'ZZZZ', caType: '120' })

    // 不合格は通信・サーバ障害と区別する（呼び出し側が validationErrors に入れる）
    expect(result).toEqual({ valid: false, errors })
  })

  it('[CAA-16] 応答の warnings は受け取らない', async () => {
    recordPost('*/api/masters/ca/validate', {
      valid: true,
      errors: [],
      warnings: ['確認してください'],
      details: null,
    })

    const result = await validateCorporateAction({ stockCode: 'A0001', caType: '120' })

    // CA では警告を扱わない（返すと「追加を押しても何も起きない」経路に入る）
    expect(result).toEqual({ valid: true, errors: [] })
    expect(result).not.toHaveProperty('warnings')
  })

  it('[CAA-17] 文字列で渡された分母・分子は number にして送る', async () => {
    recordPost('*/api/masters/ca', { success: true, ca: caItem, message: 'ok' }, 201)

    // 画面の type="number" は値を文字列で持つので、この層で数値に直す
    await createCorporateAction({
      stockCode: 'A0001',
      caType: '120',
      denominator: '1',
      numerator: '2.5',
    })

    expect(lastRequest.body.分母).toBe(1)
    expect(lastRequest.body.分子).toBe(2.5)
  })

  it('[CAA-18] 登録が 400 のときはサーバの detail を持つ例外になる', async () => {
    const detail = '銘柄コード(ZZZZ)は銘柄マスタに存在しません'
    recordPost('*/api/masters/ca', { detail }, 400)

    await expect(
      createCorporateAction({ stockCode: 'ZZZZ', caType: '120' }),
    ).rejects.toMatchObject({ status: 400, message: detail })
  })

  it('[CAA-19] 更新は PUT /masters/ca/{id} に CARequest の形で送る', async () => {
    recordPut('*/api/masters/ca/:caId', { success: true, ca: caItem, message: 'ok' })

    const updated = await updateCorporateAction({
      id: '7',
      stockCode: 'A0030',
      caType: '120',
      exRightsDate: '2026-04-28',
      effectiveDate: '2026-04-30',
      paymentDate: '',
      denominator: 1,
      numerator: 2,
      note: '1:2 株式分割',
      status: '3',
    })

    expect(lastRequest.url.pathname).toBe('/api/masters/ca/7')
    expect(lastRequest.body).toMatchObject({
      銘柄コード: 'A0030',
      CA種別: '120',
      権利付最終日: 20260428,
      効力発生日: 20260430,
      // 空にした日付は「未設定」として null で明示する（キーごと省かない）
      支払日: null,
      分母: 1,
      分子: 2,
      備考: '1:2 株式分割',
      ステータス: '3',
    })
    // 応答は CAResponse。1 件は ca というキーに入る
    expect(updated.id).toBe(String(caItem.ID))
  })

  it('[CAA-20] 楽観的ロックの合札は書式を変えずに送り返す', async () => {
    recordPut('*/api/masters/ca/:caId', { success: true, ca: caItem, message: 'ok' })
    // CAItem が返すのは ISO の date-time。CARequest の説明は半角空白形式だが整形しない
    const updatedAt = '2026-08-20T09:30:00'

    await updateCorporateAction({ id: '7', stockCode: 'A0030', caType: '120', updatedAt })

    expect(lastRequest.body.更新日時).toBe(updatedAt)
  })

  it('[CAA-21] 合札が無いときは 更新日時 のキーごと送らない', async () => {
    recordPut('*/api/masters/ca/:caId', { success: true, ca: caItem, message: 'ok' })

    // 登録直後の行は実 API 側の更新日時が未設定で、照合する相手が無い
    await updateCorporateAction({ id: '7', stockCode: 'A0030', caType: '120', updatedAt: '' })

    expect(Object.hasOwn(lastRequest.body, '更新日時')).toBe(false)
  })

  it('[CAA-22] 事前検証には 更新日時 を送らない', async () => {
    recordPost('*/api/masters/ca/validate', { valid: true, errors: [], warnings: [], details: null })

    // 編集の payload をそのまま渡しても、事前検証の本文には載らない
    await validateCorporateAction({
      id: '7',
      stockCode: 'A0030',
      caType: '120',
      updatedAt: '2026-08-20T09:30:00',
    })

    expect(Object.hasOwn(lastRequest.body, '更新日時')).toBe(false)
    expect(lastRequest.params.get('ca_id')).toBe('7')
    expect(lastRequest.params.get('is_update')).toBe('true')
  })

  it('[CAA-23] 更新が 409 のときはサーバの detail を持つ例外になる', async () => {
    const detail = '他のユーザーによってCAデータが更新されています。'
    recordPut('*/api/masters/ca/:caId', { detail }, 409)

    await expect(
      updateCorporateAction({ id: '7', stockCode: 'A0030', caType: '120', updatedAt: 'old' }),
    ).rejects.toMatchObject({ status: 409, message: detail })
  })

  it('[CAA-24] 削除は DELETE /masters/ca/{id} を叩き、削除した id を返す', async () => {
    server.use(
      http.delete('*/api/masters/ca/:caId', async ({ request }) => {
        const url = new URL(request.url)
        lastRequest = { url, params: url.searchParams, body: await request.text() }
        return HttpResponse.json({ success: true, ca: caItem, message: 'ok' })
      }),
    )

    const deleted = await deleteCorporateAction('7')

    expect(lastRequest.url.pathname).toBe('/api/masters/ca/7')
    // DELETE は本文を取らない（実 API 側も CARequest を受けない）
    expect(lastRequest.body).toBe('')
    // 応答の CAResponse は使わず、呼び出し側が成否を判定できる値を返す
    expect(deleted).toBe('7')
  })

  it('[CAA-25] 削除が 404 のときはサーバの detail を持つ例外になる', async () => {
    const detail = '指定されたCAが存在しないか、既に削除されています'
    server.use(
      http.delete('*/api/masters/ca/:caId', () => HttpResponse.json({ detail }, { status: 404 })),
    )

    await expect(deleteCorporateAction('999')).rejects.toMatchObject({ status: 404, message: detail })
  })

  it('[CAA-26] ステータスの絞り込みは status という名前で送る', async () => {
    record(listBody([]))

    await fetchCorporateActions({ status: '2' })

    // 実 API にはまだ無いクエリ（モックだけが解釈する）。名前と値だけをここで固定する
    expect(lastRequest.params.get('status')).toBe('2')
  })

  it('[CAA-27] 空文字のステータスはクエリに載せない', async () => {
    record(listBody([]))

    await fetchCorporateActions({ status: '' })

    expect(lastRequest.params.has('status')).toBe(false)
  })

  it('[CAA-28] ステータスを持つ CAItem はコード値がそのまま入る', async () => {
    record(listBody([{ ...caItem, ステータス: '3' }]))

    const { items } = await fetchCorporateActions()

    // 表示名は付いてこない（画面がコードマスタから引く）
    expect(items[0].status).toBe('3')
  })

  it('[CAA-29] ステータスを持たない CAItem では空文字になる', async () => {
    // 実 API 相当（CAItem にこの項目は無い）。項目ごと欠けた応答を作る
    const withoutStatus = { ...caItem }
    delete withoutStatus.ステータス
    record(listBody([withoutStatus]))

    const { items } = await fetchCorporateActions()

    // 他の空値と同じ扱い（画面は '—' を出す）
    expect(items[0].status).toBe('')
  })

  it('[CAA-30] 未選択のステータスは null で送る', async () => {
    recordPost('*/api/masters/ca', { success: true, ca: caItem, message: 'ok' }, 201)

    await createCorporateAction({ stockCode: 'A0001', caType: '120', status: '' })

    // 備考と同じく、キーごと省かず null で「未設定」を明示する
    expect(lastRequest.body.ステータス).toBeNull()
    expect(Object.hasOwn(lastRequest.body, 'ステータス')).toBe(true)
  })
})
