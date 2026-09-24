import { http, HttpResponse } from 'msw'
import { stalledOrderErrors, stalledWorkingOrders } from '../fixtures/stalledOrders'

export const stalledOrderHandlers = [
  /*
   * 滞留注文抽出。バックエンド未実装なので形ごと仮置き（fixtures/stalledOrders.js の冒頭を参照）。
   * 1 回の検索で「注文エラー」と「注文中」の 2 本を同時に返す（画面が一覧を 2 つ並べるため）。
   * 実 API が来たらこのハンドラを消すだけで本物へ切り替わる。
   */
  http.get('*/api/operations/stalled-orders', ({ request }) => {
    const params = new URL(request.url).searchParams
    const branchCode = (params.get('branch_code') ?? '').trim()
    const accountNumber = (params.get('account_no') ?? '').trim()
    const symbol = (params.get('symbol') ?? '').trim().toUpperCase()

    const matches = (order) =>
      (!branchCode || order.部店 === branchCode) &&
      (!accountNumber || String(order.口座番号).includes(accountNumber)) &&
      (!symbol || order.銘柄コード.toUpperCase().includes(symbol))

    // 並びはサーバの責務。フィクスチャが既に受注日時の新しい順なので、絞り込むだけでよい
    return HttpResponse.json({
      order_errors: stalledOrderErrors.filter(matches),
      working_orders: stalledWorkingOrders.filter(matches),
    })
  }),
]
