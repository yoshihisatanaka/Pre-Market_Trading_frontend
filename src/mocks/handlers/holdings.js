import { http, HttpResponse } from 'msw'
import { holdings } from '../fixtures/holdings'
import { toNonNegativeInt } from './_shared'

/**
 * 預り残高の検索が 1 ページで返す件数の既定値（`/holdings` の limit は 1〜200・既定 50）。
 */
const HOLDINGS_DEFAULT_LIMIT = 50

export const holdingHandlers = [
  /*
   * 預り残高の検索（読むだけ。状態を持たないので reset は無い）。
   * 一致のしかたは `GET /holdings` の説明どおり:
   *   部店コード・口座番号・特定預り区分 … 完全一致
   *   顧客名（顧客名・顧客名カナ）・銘柄名 … 部分一致
   *   symbol（銘柄コードまたはティッカー）・ticker（ティッカー）… 完全一致
   * 並びは仕様に書かれていないので、フィクスチャの順（口座ごと）のまま返す。
   */
  http.get('*/api/holdings', ({ request }) => {
    const params = new URL(request.url).searchParams
    const branchCode = (params.get('branch_code') ?? '').trim()
    const accountNo = (params.get('account_no') ?? '').trim()
    const customerName = (params.get('customer_name') ?? '').trim()
    const symbol = (params.get('symbol') ?? '').trim()
    const ticker = (params.get('ticker') ?? '').trim()
    const symbolName = (params.get('symbol_name') ?? '').trim()
    const specificDeposit = (params.get('specific_deposit') ?? '').trim()
    const limit = toNonNegativeInt(params.get('limit'), HOLDINGS_DEFAULT_LIMIT)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    const filtered = holdings.filter(
      (row) =>
        (!branchCode || row.部店コード === branchCode) &&
        (!accountNo || String(row.口座番号) === accountNo) &&
        (!customerName ||
          (row.顧客名 ?? '').includes(customerName) ||
          (row.顧客名カナ ?? '').includes(customerName)) &&
        (!symbol || row.銘柄コード === symbol || row.ティッカー === symbol) &&
        (!ticker || row.ティッカー === ticker) &&
        (!symbolName || (row.銘柄名 ?? '').includes(symbolName)) &&
        (!specificDeposit || row.預り売買区分 === specificDeposit),
    )

    return HttpResponse.json({
      // total は絞り込み後・ページ切り出し前の件数
      total: filtered.length,
      limit,
      offset,
      holdings: filtered.slice(offset, offset + limit),
    })
  }),
]
