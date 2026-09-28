import { apiClient } from './client'

/*
 * 約定照会（実 API `GET /executions`。成熟度 A）。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次の 5 点。
 *   - 主キーが integer の `ID`（約定ID）。アプリ内は文字列の `id`（src/api/symbols.js と同じ扱い）。
 *     読むだけの一覧なのでパスキーは無い
 *   - レスポンスのプロパティ名が日本語（注文ID / 口座番号 / 約定数量 …）。集計 `summary` も日本語キー
 *   - 検索クエリ名は英語（`branch_code` / `symbol` / `side` / `status` / `route` / `start_date` / `end_date`）
 *   - 売買区分は '1'（売）/ '3'（買）。アプリ内は 'sell' / 'buy'（openapi.json の `side` の説明どおり）
 *   - 口座番号は integer。アプリ内は文字列（src/api/customers.js と同じ）
 *
 * 画面モック（execution_management.html）との差で、この層が埋めていないもの:
 *   - 約定金額（円）: ExecutionItem は USD の `約定代金` しか返さない。円貨の項目は持たない
 *   - 一部出来の件数: ExecutionSummary に無い（件数 / 注文件数 / 売件数 / 買件数 / 数量 / 代金 / 手数料のみ）
 *
 * いまは一覧の取得だけを持つ。CSV 出力（`GET /executions/export-csv`）は別途。
 */

/**
 * 1 件のアプリ内モデル（このファイルの JSDoc で使う）
 *
 * @typedef {{
 *   id: string,
 *   orderId: string,
 *   branchCode: string,
 *   branchName: string,
 *   accountNumber: string,
 *   customerName: string,
 *   symbolCode: string,
 *   ticker: string,
 *   symbolName: string,
 *   side: 'buy'|'sell'|'',
 *   route: string,
 *   routeName: string,
 *   status: string,
 *   statusName: string,
 *   orderQuantity: number|null,
 *   quantity: number|null,
 *   price: number|null,
 *   amountUsd: number|null,
 *   executedAt: string,
 * }} Execution
 *   id は約定ID、orderId は注文ID（どちらも実 API の integer を文字列にしたもの）。
 *   status は処理状況コード（010 一部出来 / 011 全部出来 / 032・034 取消済 …）で、名前は statusName。
 *   数値は null のまま通す（整形は utils/format.js が null を '—' にする）。
 *   executedAt は ISO の日時文字列。未約定の行は無いが nullable なので空文字に寄せる
 */

/**
 * 検索条件に合う約定の集計（件数カード用。ExecutionSummary）
 *
 * @typedef {{
 *   count: number,
 *   orderCount: number,
 *   buyCount: number,
 *   sellCount: number,
 *   totalQuantity: number,
 *   totalAmountUsd: number,
 *   totalFeeUsd: number,
 * }} ExecutionSummary
 */

/** 売買区分のコード → アプリ内の向き（openapi.json の `side` の説明: 1:売 / 3:買） */
const SIDES = { 1: 'sell', 3: 'buy' }

/** アプリ内の向き → 売買区分のコード（検索条件を送るとき） */
const SIDE_CODES = { buy: '3', sell: '1' }

/**
 * 約定の一覧を取得する。
 *
 * ページャーを持つ一覧なので `{ items, total }` に加えて、同じ条件での集計 `summary` を返す
 * （実 API が一覧と一緒に返すので、件数カードのために別の API を呼ばない）。
 *
 * @param {{
 *   limit?: number,
 *   offset?: number,
 *   branchCode?: string,
 *   symbol?: string,
 *   side?: string,
 *   status?: string,
 *   dateFrom?: string,
 *   dateTo?: string,
 *   route?: string,
 * }} [params]
 *   limit は 1..200（実 API の既定は 50）。symbol は銘柄コードまたは Ticker。
 *   side は 'buy' / 'sell'（それ以外は送らない）。status / route はコード値。
 *   dateFrom / dateTo は YYYY-MM-DD。空文字は「条件なし」としてリクエストに載せない
 * @returns {Promise<{ items: Execution[], total: number, summary: ExecutionSummary }>}
 */
export async function fetchExecutions({
  limit = 50,
  offset = 0,
  branchCode = '',
  symbol = '',
  side = '',
  status = '',
  dateFrom = '',
  dateTo = '',
  route = '',
} = {}) {
  const { data } = await apiClient.get('/executions', {
    // クエリ名を知ってよいのはこの層だけ。値が undefined のパラメータは axios が送らない
    params: {
      limit,
      offset,
      branch_code: branchCode || undefined,
      symbol: symbol || undefined,
      side: SIDE_CODES[side],
      status: status || undefined,
      start_date: dateFrom || undefined,
      end_date: dateTo || undefined,
      route: route || undefined,
    },
  })

  return {
    items: (data?.executions ?? []).map(toExecution),
    total: data?.total ?? 0,
    summary: toSummary(data?.summary),
  }
}

/** ExecutionItem → アプリ内モデル */
function toExecution(raw) {
  return {
    // 欠けていたら空文字のまま外へ出す（行のキーが壊れていることをテストで検知させる）
    id: String(raw?.ID ?? ''),
    orderId: String(raw?.注文ID ?? ''),
    branchCode: raw?.部店 ?? '',
    branchName: raw?.部店名 ?? '',
    accountNumber: String(raw?.口座番号 ?? ''),
    // nullable な文字列は空文字に寄せて、画面が null を出さないようにする
    customerName: raw?.顧客名 ?? '',
    symbolCode: raw?.銘柄コード ?? '',
    ticker: raw?.Ticker ?? '',
    symbolName: raw?.銘柄名 ?? '',
    // 知らないコードは空にする。'1' / '3' 以外を片方に丸めると買いと売りを取り違える
    side: SIDES[raw?.売買区分] ?? '',
    route: raw?.注文ルート ?? '',
    routeName: raw?.注文ルート名 ?? '',
    status: raw?.処理状況 ?? '',
    statusName: raw?.処理状況名 ?? '',
    orderQuantity: toNumberOrNull(raw?.注文数量),
    quantity: toNumberOrNull(raw?.約定数量),
    price: toNumberOrNull(raw?.約定単価),
    amountUsd: toNumberOrNull(raw?.約定代金),
    executedAt: raw?.約定日時 ?? '',
  }
}

/** ExecutionSummary → アプリ内モデル。欠けた項目は 0（件数と合計なので「無い」は 0 件と同じ） */
function toSummary(raw) {
  return {
    count: raw?.件数 ?? 0,
    orderCount: raw?.注文件数 ?? 0,
    buyCount: raw?.買件数 ?? 0,
    sellCount: raw?.売件数 ?? 0,
    totalQuantity: raw?.約定数量合計 ?? 0,
    totalAmountUsd: raw?.約定代金合計_USD ?? 0,
    totalFeeUsd: raw?.手数料合計_USD ?? 0,
  }
}

/** 数値に寄せる。数値にならないもの（null / undefined / 文字列）は null */
function toNumberOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}
