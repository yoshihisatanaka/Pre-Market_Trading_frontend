import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { holdings } from '@/mocks/fixtures/holdings'
import { fetchHoldings } from './holdings'

/*
 * API 層のテスト。送り出すリクエストそのものと、HoldingItem → アプリ内モデルの変換を固定する。
 * 入力と期待値はフィクスチャの先頭行から導く。
 */

/** 最後に届いたリクエスト */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

/** リクエストを記録して、指定の本文を返すハンドラを立てる */
function record(body, status = 200) {
  server.use(
    http.get('*/api/holdings', ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams }
      return HttpResponse.json(body, { status })
    }),
  )
}

const holdingItem = holdings[0]

const listBody = (rows) => ({ total: rows.length, limit: 50, offset: 0, holdings: rows })

/** 1 行だけを返させて、変換後の 1 件を得る */
async function convert(row) {
  record(listBody([row]))
  const { items } = await fetchHoldings()
  return items[0]
}

// シナリオ: docs/unit/api-holdings.md
describe('api/holdings', () => {
  it('[HLA-01] 引数なしの検索は limit と offset だけを送る', async () => {
    record(listBody([]))

    await fetchHoldings()

    expect(lastRequest.url.pathname).toBe('/api/holdings')
    expect(lastRequest.params.get('limit')).toBe('50')
    expect(lastRequest.params.get('offset')).toBe('0')
    expect([...lastRequest.params.keys()]).toEqual(['limit', 'offset'])
  })

  it('[HLA-02] 絞り込み条件は英語の snake_case で送る', async () => {
    record(listBody([]))

    await fetchHoldings({
      branchCode: holdingItem.部店コード,
      customerName: holdingItem.顧客名,
      symbol: holdingItem.ティッカー,
      symbolName: holdingItem.銘柄名,
      specificDeposit: holdingItem.預り売買区分,
    })

    expect(lastRequest.params.get('branch_code')).toBe(holdingItem.部店コード)
    expect(lastRequest.params.get('customer_name')).toBe(holdingItem.顧客名)
    expect(lastRequest.params.get('symbol')).toBe(holdingItem.ティッカー)
    expect(lastRequest.params.get('symbol_name')).toBe(holdingItem.銘柄名)
    expect(lastRequest.params.get('specific_deposit')).toBe(holdingItem.預り売買区分)
  })

  it('[HLA-03] 空文字の条件はクエリに載せない', async () => {
    record(listBody([]))

    await fetchHoldings({
      branchCode: '',
      accountNumber: '',
      customerName: '',
      symbol: '',
      symbolName: '',
      specificDeposit: '',
    })

    expect([...lastRequest.params.keys()]).toEqual(['limit', 'offset'])
  })

  it('[HLA-04] 口座番号は数字だけのときにだけ integer として送る', async () => {
    record(listBody([]))
    await fetchHoldings({ accountNumber: String(holdingItem.口座番号) })
    expect(lastRequest.params.get('account_no')).toBe(String(holdingItem.口座番号))

    for (const input of ['123-0001', 'abc', ' ']) {
      record(listBody([]))
      await fetchHoldings({ accountNumber: input })
      // 文字列のまま送ると実 API が 422 で弾く
      expect(lastRequest.params.has('account_no'), input).toBe(false)
    }
  })

  it('[HLA-05] limit と offset をそのまま送る', async () => {
    record(listBody([]))

    await fetchHoldings({ limit: 200, offset: 50 })

    expect(lastRequest.params.get('limit')).toBe('200')
    expect(lastRequest.params.get('offset')).toBe('50')
  })

  it('[HLA-06] HoldingItem をアプリ内モデルに変換し、行キーを 3 項目から作る', async () => {
    const TOTAL = 999
    record({ total: TOTAL, limit: 50, offset: 0, holdings: [holdingItem] })

    const { items, total } = await fetchHoldings()

    expect(total).toBe(TOTAL)
    expect(items[0]).toMatchObject({
      id: `${holdingItem.口座番号}:${holdingItem.銘柄コード}:${holdingItem.預り売買区分}`,
      branchCode: holdingItem.部店コード,
      accountNumber: String(holdingItem.口座番号),
      customerName: holdingItem.顧客名,
      customerNameKana: holdingItem.顧客名カナ,
      symbolCode: holdingItem.銘柄コード,
      ticker: holdingItem.ティッカー,
      symbolName: holdingItem.銘柄名,
      quantity: holdingItem.数量,
      specificDeposit: holdingItem.預り売買区分,
      specificDepositName: holdingItem.預り売買区分名,
      valueUsd: holdingItem.評価額_USD,
      valueJpy: holdingItem.評価額_JPY,
      averageCost: holdingItem.平均取得単価,
      costJpy: holdingItem.取得金額,
      profitLossJpy: holdingItem.評価損益,
    })
    expect(typeof items[0].accountNumber).toBe('string')
  })

  it('[HLA-07] 参考単価と参考為替を評価額から戻す', async () => {
    const item = await convert(holdingItem)

    expect(item.referencePrice).toBeCloseTo(holdingItem.評価額_USD / holdingItem.数量, 10)
    expect(item.referenceFxRate).toBeCloseTo(holdingItem.評価額_JPY / holdingItem.評価額_USD, 10)
  })

  it('[HLA-08] 割れないときの参考単価・参考為替は null', async () => {
    const zeroQuantity = await convert({ ...holdingItem, 数量: 0 })
    expect(zeroQuantity.referencePrice).toBeNull()

    const noUsd = await convert({ ...holdingItem, 評価額_USD: null })
    expect(noUsd.referencePrice).toBeNull()
    expect(noUsd.referenceFxRate).toBeNull()

    const zeroUsd = await convert({ ...holdingItem, 評価額_USD: 0 })
    expect(zeroUsd.referenceFxRate).toBeNull()
  })

  it('[HLA-09] 評価損益率の % 表記を数値に直し、読めない値は null にする', async () => {
    const cases = [
      ['12.34%', 12.34],
      ['-5%', -5],
      ['+3.2%', 3.2],
      [' 1,234.5 % ', 1234.5],
      [7.5, 7.5],
      ['abc', null],
      ['', null],
      [null, null],
    ]
    record(listBody(cases.map(([rate]) => ({ ...holdingItem, 評価損益率: rate }))))

    const { items } = await fetchHoldings()

    expect(items.map((item) => item.profitLossRate)).toEqual(cases.map(([, expected]) => expected))
  })

  it('[HLA-10] 売却不可区分は 1 のときだけ立つ', async () => {
    record(
      listBody([
        { ...holdingItem, 売却不可区分: 1 },
        { ...holdingItem, 売却不可区分: 0 },
        { ...holdingItem, 売却不可区分: null },
      ]),
    )

    const { items } = await fetchHoldings()

    expect(items.map((item) => item.sellProhibited)).toEqual([true, false, false])
  })

  it('[HLA-11] CA と文字列項目の null は空文字に寄せる', async () => {
    const CA = '株式分割(1 : 2)'
    record(
      listBody([
        { ...holdingItem, CA: null, 顧客名カナ: null, ティッカー: null, 預り売買区分名: null },
        { ...holdingItem, CA },
      ]),
    )

    const { items } = await fetchHoldings()

    expect(items[0]).toMatchObject({
      corporateAction: '',
      customerNameKana: '',
      ticker: '',
      specificDepositName: '',
    })
    expect(items[1].corporateAction).toBe(CA)
  })

  it('[HLA-12] holdings を持たない応答でも空の一覧として扱う', async () => {
    record({ total: 0 })

    const { items, total } = await fetchHoldings()

    expect(items).toEqual([])
    expect(total).toBe(0)
  })

  it('[HLA-13] サーバエラーは例外になる', async () => {
    record({ detail: 'サーバーでエラーが発生しました。' }, 500)

    await expect(fetchHoldings()).rejects.toBeTruthy()
  })
})
