import { http, HttpResponse } from 'msw'
import { stalledOrderErrors, stalledWorkingOrders } from '../fixtures/stalledOrders'

/*
 * 滞留注文抽出。バックエンド未実装なので形ごと仮置き（fixtures/stalledOrders.js の冒頭を参照）。
 * 1 回の検索で「注文エラー」と「注文中」の 2 本を同時に返す（画面が一覧を 2 つ並べるため）。
 * 一覧は GET /orders の 2 回呼びに切り替える方針（docs/api/requests.md の #1 ①）で、
 * 切り替えた日にこのファイルごと消す。
 *
 * コンファメーション CSV の取込（POST /operations/stalled-orders/confirmation-import）は
 * 2026-10-07 の取り込みで提案どおり仕様に入ったので、ハンドラを消して実 API へ素通しさせている
 * （CLAUDE.md の「API が実装されたらハンドラを削除する」）。そのためブラウザの MSW では取込は
 * 実 API に届き、ここの一覧（モック）には反映されない。単体テストと E2E は取込の応答を
 * server.use() / mockApi() で個別に差し込む。
 */
export const stalledOrderHandlers = [
  http.get('*/api/operations/stalled-orders', ({ request }) => {
    const params = new URL(request.url).searchParams
    const branchCode = (params.get('branch_code') ?? '').trim()
    const accountNumber = (params.get('account_no') ?? '').trim()
    const symbol = (params.get('symbol') ?? '').trim().toUpperCase()

    const matches = (order) =>
      (!branchCode || order.部店 === branchCode) &&
      (!accountNumber || String(order.口座番号).includes(accountNumber)) &&
      (!symbol || order.銘柄コード.toUpperCase().includes(symbol))

    // 並びはサーバの責務。フィクスチャは受注日時の新しい順に並べてあるので、絞り込むだけでよい
    return HttpResponse.json({
      注文エラー: stalledOrderErrors.filter(matches),
      注文中: stalledWorkingOrders.filter(matches),
    })
  }),
]
