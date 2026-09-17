import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { customers } from '@/mocks/fixtures/customers'
import { fetchCustomers } from './customers'

/*
 * API 層のテスト。ここだけが「バックエンドの形」を知ってよい層なので、
 * **送り出すリクエストそのもの** を検証する。
 *
 * ストア・画面のテストはモックが返す結果を見ているので、モックとサーバの理解がずれていても
 * 気づけない。この層でクエリ名・値の型・応答のキーを固定しておくと、
 * ずれが 1 か所で見つかる。
 *
 * シナリオ: docs/unit/api-customers.md
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
    http.get('*/api/masters/customers', ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams }
      return HttpResponse.json(body, { status })
    }),
  )
}

/**
 * CustomerItem 1 件。フィクスチャの先頭行をそのまま使う
 * （項目の取りこぼしが起きないよう、期待値の材料も同じ行から取る）。
 */
const customerItem = customers[0]

const listBody = (rows) => ({ total: rows.length, limit: 50, offset: 0, customers: rows })

describe('api/customers', () => {
  it('[CUA-01] 引数なしの一覧取得は limit と offset だけを送る', async () => {
    record(listBody([]))

    await fetchCustomers()

    expect(lastRequest.url.pathname).toBe('/api/masters/customers')
    expect(lastRequest.params.get('limit')).toBe('50')
    expect(lastRequest.params.get('offset')).toBe('0')
    // ページングの 2 つだけ。絞り込みは条件が無ければ送らない
    expect([...lastRequest.params.keys()]).toEqual(['limit', 'offset'])
    expect(lastRequest.params.has('include_deleted')).toBe(false)
  })

  it('[CUA-02] 絞り込み条件は英語の snake_case で送る', async () => {
    record(listBody([]))

    await fetchCustomers({
      branchCode: customerItem.部店コード,
      handlerCode: customerItem.扱者コード,
      customerName: customerItem.顧客名,
    })

    expect(lastRequest.params.get('branch_code')).toBe(customerItem.部店コード)
    expect(lastRequest.params.get('customer_name')).toBe(customerItem.顧客名)
    // handler_code は /masters/customers に無いクエリ。いまはモックだけが解釈する
    expect(lastRequest.params.get('handler_code')).toBe(customerItem.扱者コード)
  })

  it('[CUA-03] 空文字の条件はクエリに載せない', async () => {
    record(listBody([]))

    await fetchCustomers({
      branchCode: '',
      handlerCode: '',
      accountNumber: '',
      customerName: '',
      restriction: '',
      accountType: '',
      corporateType: '',
    })

    expect([...lastRequest.params.keys()]).toEqual(['limit', 'offset'])
  })

  it('[CUA-04] 数字だけの口座番号は integer として送る', async () => {
    record(listBody([]))

    await fetchCustomers({ accountNumber: String(customerItem.口座番号) })

    expect(lastRequest.params.get('account_no')).toBe(String(customerItem.口座番号))
  })

  it('[CUA-05] 数字以外を含む口座番号は送らない', async () => {
    for (const input of ['123-0001', 'abc', ' ', '12 34']) {
      record(listBody([]))

      await fetchCustomers({ accountNumber: input })

      // 文字列のまま送ると実 API が 422 で弾き、理由が画面に出ない
      expect(lastRequest.params.has('account_no')).toBe(false)
    }
  })

  it('[CUA-06] limit と offset をそのまま送る', async () => {
    record(listBody([]))

    await fetchCustomers({ limit: 20, offset: 50 })

    expect(lastRequest.params.get('limit')).toBe('20')
    expect(lastRequest.params.get('offset')).toBe('50')
  })

  it('[CUA-07] openapi に無い区分系の条件も英語のクエリ名で送る', async () => {
    record(listBody([]))

    await fetchCustomers({ restriction: '1', accountType: '2', corporateType: '1' })

    // サーバに追加を依頼したい綴りで送る（いまはモックだけが解釈する）
    expect(lastRequest.params.get('restriction')).toBe('1')
    expect(lastRequest.params.get('account_type')).toBe('2')
    expect(lastRequest.params.get('corporate_type')).toBe('1')
  })

  it('[CUA-08] CustomerItem をアプリ内モデルに変換する', async () => {
    record(listBody([customerItem]))

    const { items, total } = await fetchCustomers()

    expect(total).toBe(1)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      // 主キー。integer の ID を文字列にして運ぶ（行キーと URL で使う）
      id: String(customerItem.ID),
      // 口座番号は主キーではないが、一意な業務コードとして文字列で運ぶ
      accountNumber: String(customerItem.口座番号),
      branchCode: customerItem.部店コード,
      branchName: customerItem.部店名,
      handlerCode: customerItem.扱者コード,
      handlerName: customerItem.扱者名,
      customerName: customerItem.顧客名,
      customerNameKana: customerItem.顧客名カナ,
      age: customerItem.年齢,
      restrictionName: customerItem.取引停止区分_全取引名,
      investmentPolicyName: customerItem.投資方針名,
      complianceRankName: customerItem.コンプラランク名,
      accountTypeName: customerItem.口座区分名,
      corporateTypeName: customerItem.法人区分名,
    })
    expect(typeof items[0].accountNumber).toBe('string')
  })

  it('[CUA-09] 取引停止区分とユーザー操作フラグは boolean になる', async () => {
    record(
      listBody([
        { ...customerItem, 口座番号: 1, 取引停止区分_全取引: 1, ユーザー操作フラグ: 1 },
        { ...customerItem, 口座番号: 2, 取引停止区分_全取引: 0, ユーザー操作フラグ: 0 },
      ]),
    )

    const { items } = await fetchCustomers()

    expect(items.map((item) => item.tradingSuspended)).toEqual([true, false])
    expect(items.map((item) => item.userModified)).toEqual([true, false])
  })

  it('[CUA-10] 事故処理口座区分は文字列の 1 のときだけ立つ', async () => {
    record(
      listBody([
        { ...customerItem, 口座番号: 1, 事故処理口座区分: '1' },
        { ...customerItem, 口座番号: 2, 事故処理口座区分: '0' },
        // 取引停止区分と違いこのキーは文字列。integer の 1 では立たない
        { ...customerItem, 口座番号: 3, 事故処理口座区分: 1 },
      ]),
    )

    const { items } = await fetchCustomers()

    expect(items.map((item) => item.accidentAccount)).toEqual([true, false, false])
  })

  it('[CUA-11] 金額は数値のまま運び、0 を null に潰さない', async () => {
    record(
      listBody([
        {
          ...customerItem,
          円貨預り金: 3500000,
          外貨預り金: 0,
          NISA買付可能額_当年: null,
        },
      ]),
    )

    const { items } = await fetchCustomers()

    expect(items[0]).toMatchObject({
      cashJpy: 3500000,
      // 残高 0 と「値が無い」は意味が違う
      cashUsd: 0,
      growthQuota: null,
    })
  })

  it('[CUA-12] null の文字列項目は空文字に寄せる', async () => {
    record(
      listBody([
        {
          ...customerItem,
          部店名: null,
          扱者名: null,
          顧客名カナ: null,
          年齢: null,
          取引停止区分_全取引名: null,
          投資方針名: null,
          コンプラランク名: null,
          口座区分名: null,
          法人区分名: null,
        },
      ]),
    )

    const { items } = await fetchCustomers()

    expect(items[0]).toMatchObject({
      branchName: '',
      handlerName: '',
      customerNameKana: '',
      age: '',
      restrictionName: '',
      investmentPolicyName: '',
      complianceRankName: '',
      accountTypeName: '',
      corporateTypeName: '',
    })
  })

  it('[CUA-13] customers を持たない応答でも空の一覧として扱う', async () => {
    record({ total: 0 })

    const { items, total } = await fetchCustomers()

    expect(items).toEqual([])
    expect(total).toBe(0)
  })

  it('[CUA-14] サーバエラーは例外になる', async () => {
    record({ detail: 'サーバーでエラーが発生しました。' }, 500)

    await expect(fetchCustomers()).rejects.toBeTruthy()
  })

  /*
   * 実 API が ID を返し始めるまでの穴を見張るテスト。口座番号へフォールバックすると
   * 「動いているように見える」まま実 API で行のキーが壊れるので、空文字のまま出す。
   */
  it('[CUA-15] 応答に ID が無いとき id は空文字のまま（口座番号へフォールバックしない）', async () => {
    const { ID: _id, ...withoutId } = customerItem
    record(listBody([withoutId]))

    const { items } = await fetchCustomers()

    expect(items[0].id).toBe('')
    // 口座番号は主キーではなくなったが、業務上の値としてそのまま出る
    expect(items[0].accountNumber).toBe(String(customerItem.口座番号))
  })
})
