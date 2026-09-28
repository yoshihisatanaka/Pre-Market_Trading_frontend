import { buildCsv } from './csv'

/*
 * 滞留注文抽出の CSV 3 種（別システム発注 CSV・そのサンプル・コンファメーション CSV のサンプル）。
 *
 * どれもサーバを通さずフロントで組み立てる（docs/api/requests.md #1 で依頼から外した）。
 * 列・値・ファイル名は公開モック（https://uspreorder-vmbhej3k.manus.space/operations/stalled-orders）が
 * 返す実物から採取した（2026-09-28）。「別システム」は TWS（Interactive Brokers の発注ツール）と読んでいる
 * （docs/screens/stalled-orders.md）。
 */

/** 注文エラーを別システム発注 CSV として出力するときのファイル名 */
export const TWS_ORDER_CSV_FILENAME = 'tws_stalled_orders.csv'

/** 別システム発注 CSV のサンプルのファイル名 */
export const TWS_ORDER_SAMPLE_CSV_FILENAME = 'tws_upload_sample.csv'

/** コンファメーション CSV のサンプルのファイル名 */
export const CONFIRMATION_SAMPLE_CSV_FILENAME = 'tws_confirmation_sample.csv'

const TWS_ORDER_HEADER = [
  'order_id',
  'account_number',
  'symbol',
  'action',
  'quantity',
  'order_type',
  'limit_price',
  'time_in_force',
  'market_category',
]

const CONFIRMATION_HEADER = [
  'order_id',
  'confirmation_ref',
  'confirmation_status',
  'filled_quantity',
  'average_price',
  'confirmed_at',
  'message',
]

/** 売買の向き → action。知らない向きは空欄にする（買いに丸めると売りと取り違える） */
const ACTIONS = { buy: 'BUY', sell: 'SELL' }

/** 指成区分（OrderTypeEnum）→ order_type。知らない区分は空欄にする */
const ORDER_TYPES = { MO: 'MKT', LO: 'LMT' }

/** 執行条件。モックの出力は全行 DAY（当日限り）で、画面にも選ぶ欄が無い */
const TIME_IN_FORCE = 'DAY'

/*
 * サンプルはモックの 1 行をそのまま持つ（出力と違って指値が 4 桁の 214.2500 なのも実物のとおり）。
 * 値を文字列で持つのは、数値にすると桁が落ちて実物と変わるため。
 */
const TWS_ORDER_SAMPLE_ROWS = [
  ['6', '300003', 'AMZN', 'BUY', '40', 'LMT', '214.2500', 'DAY', 'プレ＋レギュラー'],
]

const CONFIRMATION_SAMPLE_ROWS = [
  ['6', 'TWS-20260904-0006', 'CANCELLED', '0', '0', '2026-09-04 10:15:00', 'TWSで取消確認'],
]

/**
 * 滞留注文を別システム発注 CSV にする。行の並びは渡した順のまま（画面の一覧と同じ）。
 *
 * @param {import('@/api/stalledOrders').StalledOrder[]} orders
 * @returns {string} BOM 付き・CRLF 区切りの CSV 本文
 */
export function buildTwsOrderCsv(orders) {
  return buildCsv(TWS_ORDER_HEADER, orders.map(toTwsOrderRow))
}

/** 別システム発注 CSV のサンプル（1 行） */
export function buildTwsOrderSampleCsv() {
  return buildCsv(TWS_ORDER_HEADER, TWS_ORDER_SAMPLE_ROWS)
}

/** コンファメーション CSV のサンプル（1 行） */
export function buildConfirmationSampleCsv() {
  return buildCsv(CONFIRMATION_HEADER, CONFIRMATION_SAMPLE_ROWS)
}

function toTwsOrderRow(order) {
  const orderType = ORDER_TYPES[order.orderType] ?? ''

  return [
    order.id,
    order.accountNumber,
    order.symbol,
    ACTIONS[order.side] ?? '',
    order.quantity,
    orderType,
    // 成行は価格を持たない（空欄）。指値は数値をそのまま（228.5 を 228.50 に整えない）
    orderType === 'MKT' ? null : order.limitPrice,
    TIME_IN_FORCE,
    order.marketCategoryName,
  ]
}
