import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { balanceAdjustments } from '@/mocks/fixtures/balanceAdjustments'
import {
  createBalanceAdjustment,
  fetchBalanceAdjustments,
  updateBalanceAdjustment,
  updateBalanceSellProhibited,
} from './balanceAdjustments'

/*
 * API 層のテスト。ここだけが「バックエンドの形」を知ってよい層なので、
 * **送り出すリクエストそのもの** と、応答からアプリ内モデルへの変換を固定する。
 *
 * 画面・ストアのテストはモックが返す結果を見ているので、モックとサーバの理解がずれていても
 * 気づけない。この層でクエリ名・値の型・本文のキーを固定しておくと、ずれが 1 か所で見つかる。
 */

/** 最後に届いたリクエストを覚えておくための入れ物 */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

/** 本文を持つメソッド（GET / DELETE は読むと空文字で例外になる） */
const METHODS_WITH_BODY = new Set(['post', 'put'])

/**
 * リクエストを記録して、指定の本文を返すハンドラを立てる。
 *
 * @param {'get'|'post'|'put'} method
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
        body: METHODS_WITH_BODY.has(method) ? await request.json() : null,
      }
      return HttpResponse.json(body, { status })
    }),
  )
}

const LIST_PATH = '*/api/masters/balance-adjustments'

/** 既定ハンドラと同じ並び（口座番号 → 銘柄コード の昇順）。フィクスチャは生成順のまま */
const sorted = [...balanceAdjustments].sort(
  (a, b) => a.口座番号 - b.口座番号 || a.銘柄コード.localeCompare(b.銘柄コード),
)

/** BalanceAdjustmentItem 1 件の見本。フィクスチャの行をそのまま使う（値を直接書かない） */
const ITEM = balanceAdjustments[0]

/** 一覧の応答の形 */
const listBody = (balances) => ({ total: balances.length, limit: 50, offset: 0, balances })

/** 応答 1 件だけを返させて、変換後の 1 件を取り出す */
async function fetchOne(raw) {
  record('get', LIST_PATH, listBody([raw]))
  const { items } = await fetchBalanceAdjustments()
  return items[0]
}

// シナリオ: docs/unit/api-balance-adjustments.md
describe('api/balanceAdjustments', () => {
  describe('fetchBalanceAdjustments: 応答の入れ物', () => {
    it('[BLA-01] 既定モックで { items, total } が返り、各件が camelCase のアプリ内モデルになる', async () => {
      /*
       * 送った limit だけを覗き、応答は既定ハンドラに任せる（何も返さないと次のハンドラへ落ちる）。
       * api 層は stores を import できないので、ページサイズは送出値から取る
       */
      let sentLimit = null
      server.use(
        http.get(LIST_PATH, ({ request }) => {
          sentLimit = Number(new URL(request.url).searchParams.get('limit'))
        }),
      )

      const { items, total } = await fetchBalanceAdjustments()

      expect(total).toBe(balanceAdjustments.length)
      expect(items).toHaveLength(Math.min(sentLimit, balanceAdjustments.length))

      const head = sorted[0]
      expect(items[0]).toEqual({
        id: String(head.ID),
        branchCode: head.部店コード,
        accountNumber: String(head.口座番号),
        symbolCode: head.銘柄コード,
        specificDeposit: head.特定預り区分,
        specificDepositName: head.特定預り区分名,
        initialBalance: head.初期残高,
        balance: head.残高,
        handlerCode: head.扱者コード,
        handlerName: head.扱者名,
        customerName: head.顧客名,
        customerNameKana: head.顧客名カナ,
        ticker: head.Ticker,
        symbolName: head.銘柄名,
        sellProhibited: head.売却不可区分 === 1,
        userModified: head.ユーザー操作フラグ === 1,
        updatedAt: head.更新日時 ?? '',
        updatedBy: head.更新者 ?? '',
      })
    })

    it('[BLA-02] 応答の配列名 balances が items に読み替えられる', async () => {
      const raws = balanceAdjustments.slice(0, 2)
      record('get', LIST_PATH, listBody(raws))

      const result = await fetchBalanceAdjustments()

      expect(result.items.map((item) => item.id)).toEqual(raws.map((raw) => String(raw.ID)))
      expect(result.total).toBe(raws.length)
      // 生の配列名はアプリ内モデルに漏らさない
      expect(result).not.toHaveProperty('balances')
    })

    it('[BLA-03] 応答に balances が無くても例外にせず、items は空配列・total は 0', async () => {
      record('get', LIST_PATH, {})

      const result = await fetchBalanceAdjustments()

      expect(result).toEqual({ items: [], total: 0 })
    })
  })

  describe('fetchBalanceAdjustments: クエリ', () => {
    it('[BLA-04] 検索条件は branch_code / account_no / customer_name / symbol / symbol_name で送る', async () => {
      record('get', LIST_PATH, listBody([]))

      await fetchBalanceAdjustments({
        branchCode: ITEM.部店コード,
        accountNumber: String(ITEM.口座番号),
        customerName: ITEM.顧客名,
        ticker: ITEM.Ticker,
        symbolName: ITEM.銘柄名,
      })

      expect(lastRequest.url.pathname).toBe('/api/masters/balance-adjustments')
      expect(lastRequest.params.get('branch_code')).toBe(ITEM.部店コード)
      expect(lastRequest.params.get('account_no')).toBe(String(ITEM.口座番号))
      expect(lastRequest.params.get('customer_name')).toBe(ITEM.顧客名)
      expect(lastRequest.params.get('symbol')).toBe(ITEM.Ticker)
      // 実 API に無いクエリだが、綴りを決めて送る（モックだけが解釈する）
      expect(lastRequest.params.get('symbol_name')).toBe(ITEM.銘柄名)
      // アプリ内モデルの名前では送っていないこと
      for (const key of ['branchCode', 'accountNumber', 'customerName', 'ticker', 'symbolName']) {
        expect(lastRequest.params.has(key)).toBe(false)
      }
    })

    it('[BLA-05] 空文字の条件はクエリに載らず、limit / offset だけが載る', async () => {
      record('get', LIST_PATH, listBody([]))

      await fetchBalanceAdjustments({ branchCode: '', ticker: '' })

      expect([...lastRequest.params.keys()].sort()).toEqual(['limit', 'offset'])
    })

    it('[BLA-06] 口座番号に数字以外が混ざるときは account_no を送らない', async () => {
      record('get', LIST_PATH, listBody([]))

      await fetchBalanceAdjustments({ accountNumber: '12a' })

      expect(lastRequest.params.has('account_no')).toBe(false)
    })
  })

  describe('fetchBalanceAdjustments: 1 件の変換', () => {
    it('[BLA-07] integer の ID は文字列の id になる', async () => {
      const item = await fetchOne(ITEM)

      expect(typeof ITEM.ID).toBe('number')
      expect(item.id).toBe(String(ITEM.ID))
    })

    it('[BLA-08] integer の口座番号は文字列の accountNumber になる', async () => {
      const item = await fetchOne(ITEM)

      expect(typeof ITEM.口座番号).toBe('number')
      expect(item.accountNumber).toBe(String(ITEM.口座番号))
    })

    it('[BLA-09] nullable な項目が null のときは空文字に寄る', async () => {
      const item = await fetchOne({
        ...ITEM,
        部店コード: null,
        特定預り区分名: null,
        預り区分名: null,
        扱者コード: null,
        扱者名: null,
        顧客名: null,
        顧客名カナ: null,
        Ticker: null,
        銘柄名: null,
        更新日時: null,
        更新者: null,
      })

      expect(item).toMatchObject({
        branchCode: '',
        specificDepositName: '',
        handlerCode: '',
        handlerName: '',
        customerName: '',
        customerNameKana: '',
        ticker: '',
        symbolName: '',
        updatedAt: '',
        updatedBy: '',
      })
    })

    it('[BLA-10] 初期残高の null / 0 はそのまま運ぶ（0 を null に潰さない）', async () => {
      expect((await fetchOne({ ...ITEM, 初期残高: null })).initialBalance).toBeNull()
      expect((await fetchOne({ ...ITEM, 初期残高: 0 })).initialBalance).toBe(0)
    })

    it('[BLA-11] 特定預り区分名が無く預り区分名だけあるときは、その値を使う', async () => {
      const { 特定預り区分名: name, ...withoutName } = ITEM

      const item = await fetchOne({ ...withoutName, 預り区分名: name })

      expect(item.specificDepositName).toBe(name)
    })

    it('[BLA-12] ユーザー操作フラグの 1 / 0 は userModified の true / false になる', async () => {
      expect((await fetchOne({ ...ITEM, ユーザー操作フラグ: 1 })).userModified).toBe(true)
      expect((await fetchOne({ ...ITEM, ユーザー操作フラグ: 0 })).userModified).toBe(false)
    })
  })

  describe('createBalanceAdjustment: 新規保有の登録', () => {
    /** 登録する 1 件の入力。フィクスチャの行から取る（値を直接書かない） */
    const PARAMS = {
      branchCode: ITEM.部店コード,
      accountNumber: String(ITEM.口座番号),
      symbolCode: ITEM.銘柄コード,
      specificDeposit: ITEM.特定預り区分,
      balance: ITEM.残高,
    }
    /** サーバが採番して返す 1 件。手で足した保有なので初期残高は持たない */
    const CREATED = {
      ...ITEM,
      ID: Math.max(...balanceAdjustments.map((raw) => raw.ID)) + 1,
      初期残高: null,
    }
    const createdBody = { success: true, balance: CREATED, message: '残高を登録しました' }

    it('[BLA-13] 本文が { 部店コード, 口座番号, 銘柄コード, 特定預り区分, 残高 } になり、口座番号は integer', async () => {
      record('post', LIST_PATH, createdBody, 201)

      await createBalanceAdjustment(PARAMS)

      expect(lastRequest.url.pathname).toBe('/api/masters/balance-adjustments')
      expect(lastRequest.body).toEqual({
        部店コード: ITEM.部店コード,
        口座番号: ITEM.口座番号,
        銘柄コード: ITEM.銘柄コード,
        特定預り区分: ITEM.特定預り区分,
        残高: ITEM.残高,
      })
      expect(typeof lastRequest.body.口座番号).toBe('number')
    })

    it('[BLA-14] 部店コードが空文字のときは本文に 部店コード の項目ごと載らない', async () => {
      record('post', LIST_PATH, createdBody, 201)

      await createBalanceAdjustment({ ...PARAMS, branchCode: '' })

      expect(lastRequest.body).not.toHaveProperty('部店コード')
      expect(lastRequest.body).toHaveProperty('口座番号', ITEM.口座番号)
    })

    it('[BLA-15] 登録が成功すると応答の balance を変換した 1 件が返る', async () => {
      record('post', LIST_PATH, createdBody, 201)

      const created = await createBalanceAdjustment(PARAMS)

      expect(created).toMatchObject({
        id: String(CREATED.ID),
        branchCode: CREATED.部店コード,
        accountNumber: String(CREATED.口座番号),
        symbolCode: CREATED.銘柄コード,
        specificDeposit: CREATED.特定預り区分,
        initialBalance: null,
        balance: CREATED.残高,
        ticker: CREATED.Ticker,
        symbolName: CREATED.銘柄名,
      })
      // 応答の入れ物（success / balance / message）はアプリ内モデルに漏らさない
      expect(created).not.toHaveProperty('success')
    })
  })

  describe('updateBalanceAdjustment: 数量の補正', () => {
    const UPDATE_PATH = '*/api/masters/balance-adjustments/:id'
    /** 合札を送ることを見たいので、更新日時を持つ行を使う（値を直接書かない） */
    const UPDATED = balanceAdjustments.find((raw) => raw.更新日時)
    /** 補正後の絶対値。補正前から導く */
    const NEXT_BALANCE = UPDATED.残高 + 1

    it('[BLA-16] PUT /masters/balance-adjustments/{id} に { 残高, 更新日時 } だけを送る', async () => {
      record('put', UPDATE_PATH, { success: true, balance: { ...UPDATED, 残高: NEXT_BALANCE } })

      const updated = await updateBalanceAdjustment({
        id: String(UPDATED.ID),
        balance: NEXT_BALANCE,
        updatedAt: UPDATED.更新日時,
      })

      expect(lastRequest.url.pathname).toBe(`/api/masters/balance-adjustments/${UPDATED.ID}`)
      // 部分更新なので、渡した項目以外（口座番号・銘柄コード・売却不可区分 …）は載らない
      expect(lastRequest.body).toEqual({ 残高: NEXT_BALANCE, 更新日時: UPDATED.更新日時 })
      expect(updated.balance).toBe(NEXT_BALANCE)
    })

    it('[BLA-17] updatedAt が空文字のときは本文に 更新日時 を載せない', async () => {
      record('put', UPDATE_PATH, { success: true, balance: UPDATED })

      await updateBalanceAdjustment({ id: String(UPDATED.ID), balance: NEXT_BALANCE, updatedAt: '' })

      expect(lastRequest.body).toEqual({ 残高: NEXT_BALANCE })
      expect(lastRequest.body).not.toHaveProperty('更新日時')
    })

    it('[BLA-18] 409 のときは例外になり、message にサーバの理由が入る', async () => {
      const reason = '他のユーザーによって残高データが更新されています。'
      record('put', UPDATE_PATH, { detail: reason }, 409)

      await expect(
        updateBalanceAdjustment({
          id: String(UPDATED.ID),
          balance: NEXT_BALANCE,
          updatedAt: UPDATED.更新日時,
        }),
      ).rejects.toMatchObject({ message: reason, status: 409 })
    })
  })

  describe('売却不可区分', () => {
    const UPDATE_PATH = '*/api/masters/balance-adjustments/:id'
    const SELL_PATH = '*/api/masters/balance-adjustments/:id/sell-prohibited'
    /** 売却不可の行と売却可の行をフィクスチャから探す（値を直接書かない） */
    const PROHIBITED = balanceAdjustments.find((raw) => raw.売却不可区分 === 1)
    const SELLABLE = balanceAdjustments.find((raw) => raw.売却不可区分 === 0)

    it('[BLA-19] 応答の 売却不可区分 1 / 0 / 未定義は sellProhibited の true / false / false になる', async () => {
      const withoutFlag = Object.fromEntries(
        Object.entries(SELLABLE).filter(([key]) => key !== '売却不可区分'),
      )

      expect((await fetchOne(PROHIBITED)).sellProhibited).toBe(true)
      expect((await fetchOne(SELLABLE)).sellProhibited).toBe(false)
      // 仕様の既定は 0 なので、欠けていれば売却可
      expect(withoutFlag).not.toHaveProperty('売却不可区分')
      expect((await fetchOne(withoutFlag)).sellProhibited).toBe(false)
    })

    it('[BLA-20] updateBalanceSellProhibited は専用の口に { 売却不可区分: 1 } だけを送り、残高を送らない', async () => {
      record('put', SELL_PATH, { success: true, balance: { ...SELLABLE, 売却不可区分: 1 } })

      const updated = await updateBalanceSellProhibited({
        id: String(SELLABLE.ID),
        sellProhibited: true,
      })

      expect(lastRequest.url.pathname).toBe(
        `/api/masters/balance-adjustments/${SELLABLE.ID}/sell-prohibited`,
      )
      expect(lastRequest.body).toEqual({ 売却不可区分: 1 })
      expect(lastRequest.body).not.toHaveProperty('残高')
      expect(updated.sellProhibited).toBe(true)
    })

    it('[BLA-22] sellProhibited が false なら 売却不可区分 0 を送り、updatedAt は 更新日時 として添える', async () => {
      record('put', SELL_PATH, { success: true, balance: { ...PROHIBITED, 売却不可区分: 0 } })

      // 合札は画面が取得時の値をそのまま渡すもの。ここでは操作の入力値として置く
      const updatedAt = '2026-09-25T09:00:00'
      const updated = await updateBalanceSellProhibited({
        id: String(PROHIBITED.ID),
        sellProhibited: false,
        updatedAt,
      })

      expect(lastRequest.body).toEqual({ 売却不可区分: 0, 更新日時: updatedAt })
      expect(updated.sellProhibited).toBe(false)
    })

    it('[BLA-21] balance だけを渡すと本文に 売却不可区分 が載らない', async () => {
      record('put', UPDATE_PATH, { success: true, balance: SELLABLE })

      await updateBalanceAdjustment({ id: String(SELLABLE.ID), balance: SELLABLE.残高 + 1 })

      expect(lastRequest.body).toHaveProperty('残高', SELLABLE.残高 + 1)
      expect(lastRequest.body).not.toHaveProperty('売却不可区分')
    })
  })
})
