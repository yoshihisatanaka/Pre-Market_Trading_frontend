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
 * 金額は HoldingItem の説明の式で組み立てる（docs/api/requests.md #36 の回答で確定）。冒頭の
 * HOLDINGS_FX_RATE は 適用為替レート（1 ドル 150 円。注文照会の fixtures/orderInquiry.js と同じ）。
 *   評価額_USD = 前日終値 × 数量（小数第 2 位で丸め）
 *   評価額_JPY = 前日終値 × 数量 × 為替（円未満を四捨五入）
 *   取得金額   = 平均取得単価（USD）× 数量 × 為替（円未満を四捨五入）
 *   評価損益   = 評価額_JPY − 取得金額
 *   評価損益率 = (評価額_JPY ÷ 取得金額) − 1（小数第 2 位までの % 表記。'+12.34%' / '-5.20%' の形）
 *
 * 預り売買区分 は名前に反して残高の**特定預り区分**のコード（0 一般 / 1 特定 / 6 成長投資枠。
 * 注文の 預り売買区分 とは 0 / 1 が逆）。名前はコードマスタの 特定預り区分 から引く。
 * ID は行 ID（m_残高情報.ID。配列の並び順に 1 から振る）、口座ID は顧客マスタの ID。
 * 売却可能株数 は既定で数量と同じ（当日の売注文なし）。
 *
 * 画面で確かめたい条件を必ず 1 件は含める（口座 1230001 の山田 太郎にまとめてある）。
 *   - 評価益・評価損・損益 0 の 3 通り（損益の色分け）
 *   - 特定預り区分 1 特定 / 0 一般 / 6 成長投資枠
 *   - 売却不可区分 1（売りボタンが押せない）
 *   - 売却可能株数が数量より少ない（当日の売注文がある。「売り」で引き継ぐ数量が数量と違う）
 *   - CA 発生中（警告の帯と行の印）
 * 口座 1230002 は 1 銘柄だけ、1230006 は CA の無い 2 銘柄、部店 123 のほかの顧客は保有なし（空の状態）。
 *
 * 預り検索（顧客をまたいで引く）のページャーの確かめに 1 ページ（50 件）を超える件数が要るので、
 * 部店 345 / 456 の顧客 28 人に 2 銘柄ずつ（56 件）を機械生成して足し、全体を 64 件にしてある
 * （下の BULK_*。顧客詳細のテストが使う部店 123 の顧客には足さない）。
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

/** 評価損益率の % 表記。0 以上に + を付ける（'+12.34%' / '-5.20%'） */
function percentText(ratio) {
  const text = (ratio * 100).toFixed(2)
  return `${ratio >= 0 ? '+' : ''}${text}%`
}

/**
 * 1 明細の HoldingItem を組み立てる（ID は配列にしてから振る）。
 * averageCost は平均取得単価（USD）、sellable は売却可能株数（省略時は数量と同じ）。
 */
function holding({
  accountNo,
  ticker,
  quantity,
  deposit,
  averageCost,
  sellable = quantity,
  sellProhibited = false,
  ca = null,
}) {
  const customer = findCustomer(accountNo)
  const symbol = findSymbol(ticker)
  const close = symbol.前日終値
  const valueJpy = Math.round(close * quantity * HOLDINGS_FX_RATE)
  const cost = Math.round(averageCost * quantity * HOLDINGS_FX_RATE)
  const profitLoss = valueJpy - cost

  return {
    口座ID: customer.ID,
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
    前日終値: close,
    適用為替レート: HOLDINGS_FX_RATE,
    評価額_USD: Math.round(close * quantity * 100) / 100,
    評価額_JPY: valueJpy,
    平均取得単価: averageCost,
    取得金額: cost,
    評価損益: profitLoss,
    評価損益率: percentText(valueJpy / cost - 1),
    売却可能株数: sellable,
    売却不可区分: sellProhibited ? 1 : 0,
    CA: ca,
  }
}

/** 機械生成の明細を持たせる部店と、順に割り当てる銘柄（前日終値のある銘柄だけ） */
const BULK_BRANCHES = ['345', '456']
const BULK_TICKERS = ['META', 'JPM', 'V', 'AAPL', 'MSFT', 'GOOGL', 'AMZN']

/**
 * 機械生成の明細。1 顧客に隣り合う 2 銘柄を、特定預り・CA なし・売却可で持たせる。
 * 平均取得単価は前日終値から 1 銘柄目は 10% 安く（評価益）、2 銘柄目は 10% 高く（評価損）置く。
 */
const bulkHoldings = customers
  .filter((customer) => BULK_BRANCHES.includes(customer.部店コード))
  .flatMap((customer, index) =>
    [0, 1].map((shift) => {
      const ticker = BULK_TICKERS[(index + shift) % BULK_TICKERS.length]
      const close = findSymbol(ticker).前日終値
      return holding({
        accountNo: customer.口座番号,
        ticker,
        quantity: 10 * (index + 1),
        deposit: '1',
        averageCost: Math.round(close * (shift === 0 ? 0.9 : 1.1) * 100) / 100,
      })
    }),
  )

export const holdings = [
  // 山田 太郎（部店 123）。評価益。当日の売注文が 20 株あり、売却可能株数は 80
  holding({
    accountNo: 1230001,
    ticker: 'AAPL',
    quantity: 100,
    deposit: '1',
    averageCost: 200,
    sellable: 80,
  }),
  // 評価損。売却不可（売りボタンが押せない）
  holding({
    accountNo: 1230001,
    ticker: 'MSFT',
    quantity: 50,
    deposit: '1',
    averageCost: 440,
    sellProhibited: true,
  }),
  // 成長投資枠
  holding({ accountNo: 1230001, ticker: 'NVDA', quantity: 200, deposit: '6', averageCost: 107 }),
  // 一般。損益 0（平均取得単価 = 前日終値）。CA 発生中
  holding({
    accountNo: 1230001,
    ticker: 'TSLA',
    quantity: 30,
    deposit: '0',
    averageCost: findSymbol('TSLA').前日終値,
    ca: '株式分割(1 : 3)',
  }),
  // 佐藤 花子（部店 123）。1 銘柄だけ・評価損
  holding({ accountNo: 1230002, ticker: 'AMZN', quantity: 40, deposit: '1', averageCost: 240 }),
  // 渡辺 良子（部店 123）。CA の無い 2 銘柄
  holding({
    accountNo: 1230006,
    ticker: 'GOOGL',
    quantity: 300,
    deposit: '1',
    averageCost: 167,
  }),
  holding({ accountNo: 1230006, ticker: 'AAPL', quantity: 500, deposit: '6', averageCost: 213 }),
  // 別の部店（234）の顧客。部店での絞り込みを確かめる
  holding({ accountNo: 2340001, ticker: 'AAPL', quantity: 10, deposit: '1', averageCost: 220 }),
  ...bulkHoldings,
].map((row, index) => ({ ID: index + 1, ...row }))
