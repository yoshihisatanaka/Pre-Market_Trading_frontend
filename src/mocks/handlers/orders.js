import { http, HttpResponse } from 'msw'
import { orderListResponse } from '../fixtures/orders'
import { orderInquiryFxRate, orderInquiryRows } from '../fixtures/orderInquiry'
import { toNonNegativeInt } from './_shared'

/*
 * `GET /orders` は 2 つの画面が叩いている。
 *   - 注文一覧（`/`）… 縦串の参考実装。実仕様が来る前の仮の形 `items` を読む
 *   - 注文照会（`/orders/inquiry`）… 実仕様の `OrderListResponse`（`orders` / `total` …）を読む
 * 1 本のハンドラで両方の形を 1 つの応答に載せて返す（同じパスにハンドラを 2 本置くと先の 1 本しか効かない）。
 * 参考実装を退役させるときに `items` を外し、実 API に切り替えるときはこのハンドラごと消す。
 */
export const orderHandlers = [
  http.get('*/api/orders', ({ request }) => {
    const params = new URL(request.url).searchParams
    const branchCode = (params.get('branch_code') ?? '').trim()
    const accountNo = (params.get('account_no') ?? '').trim()
    const symbol = (params.get('symbol') ?? '').trim().toUpperCase()
    const status = (params.get('status') ?? '').trim()
    const limit = toNonNegativeInt(params.get('limit'), 50)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    // 部店・口座番号・処理状況は完全一致、銘柄は銘柄コードか Ticker の部分一致（大小文字を問わない）
    const matches = (row) =>
      (!branchCode || row.部店 === branchCode) &&
      (!accountNo || String(row.口座番号) === accountNo) &&
      (!symbol ||
        row.銘柄コード.toUpperCase().includes(symbol) ||
        (row.Ticker ?? '').toUpperCase().includes(symbol)) &&
      (!status || row.処理状況 === status)

    const sorted = [...orderInquiryRows.filter(matches)].sort((a, b) =>
      params.get('sort') === 'asc' ? a.ID - b.ID : b.ID - a.ID,
    )

    return HttpResponse.json({
      items: orderListResponse.items,
      total: sorted.length,
      limit,
      offset,
      適用為替レート: orderInquiryFxRate,
      為替基準日: 20260925,
      // 件数カード用の集計。注文照会の画面は使わないので省く（nullable）
      summary: null,
      orders: sorted.slice(offset, offset + limit),
    })
  }),
]
