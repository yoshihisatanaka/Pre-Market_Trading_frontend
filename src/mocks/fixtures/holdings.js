import { SPECIFIC_DEPOSIT_NAMES } from './codes'
import { customers } from './customers'
import { symbols } from './symbols'

/*
 * 預り残高（実 API `GET /holdings`）のモックのレスポンス実体。
 * ここに書くのは「バックエンドが返す生の形」（`HoldingItem`）であり、アプリ内モデルではない。
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 *
 * 顧客と銘柄は顧客マスタ・銘柄マスタのフィクスチャから引く（顧客詳細で開いた顧客の預りが出るように、
 * 口座番号・顧客名・銘柄コード・銘柄名を同じ出どころにする）。
 *
 * 金額は HoldingItem の説明の式で組み立てる。冒頭の FX_RATE は為替（1 ドル 150 円。注文照会の
 * fixtures/orderInquiry.js の適用為替レートと同じ）。
 *   評価額_USD = 前日終値 × 数量（小数第 2 位で丸め）
 *   評価額_JPY = 前日終値 × 数量 × 為替（円未満を四捨五入）
 *   取得金額   = 平均取得単価（円）× 数量
 *   評価損益   = 評価額_JPY − 取得金額
 *   評価損益率 = 評価損益 ÷ 取得金額（小数第 2 位までの % 表記。説明の式は符号が逆に見えるので、
 *               損益と符号が揃う形で置く。docs/api/requests.md #33）
 *
 * 画面で確かめたい条件を必ず 1 件は含める（口座 1230001 の山田 太郎にまとめてある）。
 *   - 評価益・評価損・損益 0 の 3 通り（損益の色分け）
 *   - 特定預り区分 1 特定 / 0 非特定 / 6 成長投資枠
 *   - 売却不可区分 1（売りボタンが押せない）
 *   - CA 発生中（警告の帯と行の印）
 * 口座 1230002 は 1 銘柄だけ、1230006 は CA の無い 2 銘柄、ほかの顧客は保有なし（空の状態）。
 */

/** 為替（円 / ドル） */
export const HOLDINGS_FX_RATE = 150

function findCustomer(accountNo) {
  const customer = customers.find((row) => row.口座番号 === accountNo)
  if (!customer) throw new Error(`fixtures/holdings: 口座番号 ${accountNo} が顧客マスタに無い`)
  return customer
}

function findSymbol(ticker) {
  const symbol = symbols.find((row) => row.Ticker === ticker)
  if (!symbol) throw new Error(`fixtures/holdings: Ticker ${ticker} が銘柄マスタに無い`)
  return symbol
}

/** 1 明細の HoldingItem を組み立てる */
function holding({
  accountNo,
  ticker,
  quantity,
  deposit,
  averageCost,
  sellProhibited = false,
  ca = null,
}) {
  const customer = findCustomer(accountNo)
  const symbol = findSymbol(ticker)
  const close = symbol.前日終値
  const valueJpy = Math.round(close * quantity * HOLDINGS_FX_RATE)
  const cost = averageCost * quantity
  const profitLoss = valueJpy - cost

  return {
    部店コード: customer.部店コード,
    口座番号: customer.口座番号,
    顧客名: customer.顧客名,
    顧客名カナ: customer.顧客名カナ,
    銘柄コード: symbol.銘柄コード,
    ティッカー: symbol.Ticker,
    銘柄名: symbol.銘柄名,
    数量: quantity,
    預り売買区分: deposit,
    預り売買区分名: SPECIFIC_DEPOSIT_NAMES[deposit] ?? null,
    評価額_USD: Math.round(close * quantity * 100) / 100,
    評価額_JPY: valueJpy,
    平均取得単価: averageCost,
    取得金額: cost,
    評価損益: profitLoss,
    評価損益率: `${((profitLoss / cost) * 100).toFixed(2)}%`,
    売却不可区分: sellProhibited ? 1 : 0,
    CA: ca,
  }
}

export const holdings = [
  // 山田 太郎（部店 123）。評価益
  holding({ accountNo: 1230001, ticker: 'AAPL', quantity: 100, deposit: '1', averageCost: 30_000 }),
  // 評価損。売却不可（売りボタンが押せない）
  holding({
    accountNo: 1230001,
    ticker: 'MSFT',
    quantity: 50,
    deposit: '1',
    averageCost: 66_000,
    sellProhibited: true,
  }),
  // 成長投資枠
  holding({ accountNo: 1230001, ticker: 'NVDA', quantity: 200, deposit: '6', averageCost: 16_000 }),
  // 非特定。損益 0。CA 発生中
  holding({
    accountNo: 1230001,
    ticker: 'TSLA',
    quantity: 30,
    deposit: '0',
    averageCost: 37_347,
    ca: '株式分割(1 : 3)',
  }),
  // 佐藤 花子（部店 123）。1 銘柄だけ・評価損
  holding({ accountNo: 1230002, ticker: 'AMZN', quantity: 40, deposit: '1', averageCost: 36_000 }),
  // 渡辺 良子（部店 123）。CA の無い 2 銘柄
  holding({
    accountNo: 1230006,
    ticker: 'GOOGL',
    quantity: 300,
    deposit: '1',
    averageCost: 25_000,
  }),
  holding({ accountNo: 1230006, ticker: 'AAPL', quantity: 500, deposit: '6', averageCost: 32_000 }),
  // 別の部店（234）の顧客。部店での絞り込みを確かめる
  holding({ accountNo: 2340001, ticker: 'AAPL', quantity: 10, deposit: '1', averageCost: 33_000 }),
]
