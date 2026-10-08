import { customers } from './customers'
import { symbols } from './symbols'

/*
 * モックのレスポンス実体（約定照会）。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 * docs/api/openapi.json の ExecutionItem に合わせてある
 * （プロパティ名は日本語、ID・注文ID・口座番号・数量は integer、単価・代金は number）。
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 *
 * 口座・顧客名・部店は fixtures/customers.js、銘柄は fixtures/symbols.js の先頭 8 件から引く
 * （同じ口座番号・銘柄コードが画面をまたいで同じ名前で出るようにする）。
 *
 * ページャーの動作確認には 1 ページ（50 件）を超えるデータが要るので 56 件作る。混ぜてあるもの:
 *   - 売買区分 … '3' 買 と '1' 売（2 : 1）
 *   - 注文ルート … '1' IB と '0' みずほ（3 : 1）
 *   - 処理状況 … '011' 全部出来 / '010' 一部出来 / '032'・'034' 取消済（出来有）。
 *     全部出来以外は約定数量が注文数量の半分。取消済 4 件のうち 1 件（最初の 1 件）だけが 032
 *   - 約定代金_JPY … 約定代金 × EXECUTION_FX_RATE（円未満四捨五入）。最後の 1 件だけ為替未登録の null
 *   - 約定日時 … 2026-09-24〜28 の 5 日に散らす。ID が大きいほど新しい
 *
 * 処理状況名はサーバが付ける表示項目。取消済（034）の名前がサーバで「取消済」なのか
 * 「取消済（出来有）」なのかは仕様に無いので、ここでは処理状況コードの名前（取消済）を置く。
 */

/** 約定のある銘柄。銘柄マスタの先頭 8 件 */
const TRADED_SYMBOLS = symbols.slice(0, 8)

const SIDE_NAMES = { 1: '売', 3: '買' }
const ROUTE_NAMES = { 0: 'みずほ証券', 1: 'IB証券' }
const STATUS_NAMES = { '010': '一部出来', '011': '全部出来', '032': '取消済', '034': '取消済' }

/** 有効な約定の件数 */
const EXECUTION_COUNT = 56

/** 約定代金_JPY（円貨の概算）に使う USD/JPY。実 API は直近の USD レートを掛ける */
export const EXECUTION_FX_RATE = 150

/** 1 日に並べる件数（56 件を 5 日に散らす） */
const EXECUTIONS_PER_DAY = 12

/** 0 始まりの連番から、処理状況を決める（全部出来が大半、一部出来と取消済を少し混ぜる） */
function statusOf(index) {
  if (index % 7 === 3) return '010'
  // 取消済の最初の 1 件（index 5）は 032（取消済・出来有）。034 だけで絞ると拾えない行
  if (index === 5) return '032'
  if (index % 11 === 5) return '034'
  return '011'
}

/** 0 始まりの連番から、約定日時（'YYYY-MM-DDTHH:MM:SS'）を作る */
function executedAtOf(index) {
  const day = 24 + Math.floor(index / EXECUTIONS_PER_DAY)
  const minutes = 30 + (index % EXECUTIONS_PER_DAY) * 25
  const hh = String(9 + Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return `2026-09-${day}T${hh}:${mm}:00`
}

/** 1 件を組み立てる */
function toExecutionItem(index) {
  const id = index + 1
  const customer = customers[index % customers.length]
  const symbol = TRADED_SYMBOLS[index % TRADED_SYMBOLS.length]
  const side = index % 3 === 2 ? '1' : '3'
  const route = index % 4 === 3 ? '0' : '1'
  const status = statusOf(index)

  // 注文数量は 10 の倍数なので、半分にしても整数のまま
  const orderQuantity = ((index % 5) + 1) * 10
  const quantity = status === '011' ? orderQuantity : orderQuantity / 2

  // 約定単価は前日終値の ±0.4% の範囲に散らす（小数第 4 位まで。モックの表示桁と同じ）
  const basePrice = symbol.前日終値 ?? 100
  const price = Math.round(basePrice * (1 + ((index % 9) - 4) / 1000) * 10000) / 10000
  const amount = Math.round(quantity * price * 100) / 100
  const executedAt = executedAtOf(index)

  return {
    ID: id,
    注文ID: 1000 + id,
    受注番号: `A${String(260900 + id).padStart(8, '0')}`,
    伝票注文ID: null,
    伝票受注番号: null,
    部店: customer.部店コード,
    部店名: customer.部店名,
    口座番号: customer.口座番号,
    顧客名: customer.顧客名,
    銘柄コード: symbol.銘柄コード,
    Ticker: symbol.Ticker,
    銘柄名: symbol.銘柄名,
    売買区分: side,
    売買区分名: SIDE_NAMES[side],
    注文ルート: route,
    注文ルート名: ROUTE_NAMES[route],
    処理状況: status,
    処理状況名: STATUS_NAMES[status],
    注文数量: orderQuantity,
    // 成行の注文は指値単価を持たない（5 件に 1 件）
    指値単価: index % 5 === 4 ? null : Math.round(basePrice * 1.01 * 100) / 100,
    // IB 側の発注 ID と約定 ID。みずほの注文は持たない
    OrderID: route === '1' ? `IB${String(880000 + id)}` : null,
    ExecID: route === '1' ? `0000e0d5.${String(id).padStart(6, '0')}.01.01` : null,
    約定数量: quantity,
    約定単価: price,
    約定代金: amount,
    約定代金_JPY: index === EXECUTION_COUNT - 1 ? null : Math.round(amount * EXECUTION_FX_RATE),
    約定日時: executedAt,
    手数料: Math.round(amount * 0.00495 * 100) / 100,
    手数料通貨: 'USD',
    作成日時: executedAt,
  }
}

/**
 * 約定の行。56 件。
 * 並べ替えは読み出し側（ハンドラ）が実 API と同じ規則（約定日時の降順）で行うので、
 * ここでは生成順（約定日時の昇順）のまま置く。
 */
export const executions = Array.from({ length: EXECUTION_COUNT }, (_, index) =>
  toExecutionItem(index),
)
