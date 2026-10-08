import { apiClient } from './client'
import { toFileDownload } from './fileDownload'

/*
 * 約定照会（実 API `GET /executions`（成熟度 A）と `GET /executions/export-csv`（成熟度 B））。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次の 5 点。
 *   - 主キーが integer の `ID`（約定ID）。アプリ内は文字列の `id`（src/api/symbols.js と同じ扱い）。
 *     読むだけの一覧なのでパスキーは無い
 *   - レスポンスのプロパティ名が日本語（注文ID / 口座番号 / 約定数量 …）。集計 `summary` も日本語キー
 *   - 検索クエリ名は英語（`branch_code` / `symbol` / `side` / `status` / `route` / `start_date` / `end_date`）
 *   - 売買区分は '1'（売）/ '3'（買）。アプリ内は 'sell' / 'buy'（openapi.json の `side` の説明どおり）
 *   - 口座番号は integer。アプリ内は文字列（src/api/customers.js と同じ）
 *   - 出来状況の絞り込みはコードマスタ `約定出来状況` のコードで受け、取消済（034）だけは
 *     `032,034`（取消済の 2 コード）に広げて `status` に載せる（toStatusQuery。#22 ③）
 *
 * 件数カードの「一部出来」は ExecutionSummary の `一部出来件数`（処理状況 010 の**注文**の件数。
 * 約定の行数ではない）、円貨の約定金額は ExecutionItem の `約定代金_JPY`（約定代金 × 直近の USD
 * レートの概算。為替未登録なら null）から出す（docs/api/requests.md #22 ①②）。
 *
 * 預託先（注文ルート / 注文ルート名）は、預託先参照権限の無い操作者には null で返り、route の
 * 指定も無視される（#26）。null は空文字に寄せるので、画面が列を出していても壊れない。
 *
 * CSV 出力は一覧と同じ検索条件を受け、本文をファイルのまま（Blob）返す。
 * 列の並びと中身はバックエンドが決めるので、この層は変換しない。
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
 *   amountJpy: number|null,
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
 *   partialCount: number,
 *   totalQuantity: number,
 *   totalAmountUsd: number,
 *   totalFeeUsd: number,
 * }} ExecutionSummary
 *   partialCount は一部出来（処理状況 010）の注文の件数。count（約定の行数）とは単位が違う
 */

/** 売買区分のコード → アプリ内の向き（openapi.json の `side` の説明: 1:売 / 3:買） */
const SIDES = { 1: 'sell', 3: 'buy' }

/** アプリ内の向き → 売買区分のコード（検索条件を送るとき） */
const SIDE_CODES = { buy: '3', sell: '1' }

/** 応答にファイル名が無いときの保存名（バックエンドが Content-Disposition に付ける名前と同じ） */
export const EXECUTIONS_CSV_FILENAME = 'executions.csv'

/**
 * 出来状況の選択肢のコード → `status` に載せる処理状況コード（カンマ区切り）。
 * コードマスタ `約定出来状況` の取消済は 034 だけだが、取消済には 032（取消済・出来有）もあるので両方で絞る。
 * みずほ注文締（src/api/mizuhoExecutions.js）も同じ広げ方をする
 */
const STATUS_QUERY = { '034': '032,034' }

/** 出来状況のコード → `status` の値。空は送らない（undefined） */
export function toStatusQuery(status) {
  return status ? (STATUS_QUERY[status] ?? status) : undefined
}

/**
 * 約定の検索条件（一覧と CSV 出力で共通）
 *
 * @typedef {{
 *   branchCode?: string,
 *   symbol?: string,
 *   side?: string,
 *   status?: string,
 *   dateFrom?: string,
 *   dateTo?: string,
 *   route?: string,
 * }} ExecutionFilters
 *   symbol は銘柄コードまたは Ticker。side は 'buy' / 'sell'（それ以外は送らない）。
 *   status / route はコード値（status はコードマスタ `約定出来状況` のコード。送るときに toStatusQuery で広げる）。
 *   dateFrom / dateTo は YYYY-MM-DD。
 *   空文字は「条件なし」としてリクエストに載せない
 */

/**
 * 約定の一覧を取得する。
 *
 * ページャーを持つ一覧なので `{ items, total }` に加えて、同じ条件での集計 `summary` を返す
 * （実 API が一覧と一緒に返すので、件数カードのために別の API を呼ばない）。
 *
 * @param {{ limit?: number, offset?: number } & ExecutionFilters} [params]
 *   limit は 1..200（実 API の既定は 50）。検索条件は ExecutionFilters
 * @returns {Promise<{ items: Execution[], total: number, summary: ExecutionSummary }>}
 */
export async function fetchExecutions({ limit = 50, offset = 0, ...filters } = {}) {
  const { data } = await apiClient.get('/executions', {
    params: { limit, offset, ...toSearchParams(filters) },
  })

  return {
    items: (data?.executions ?? []).map(toExecution),
    total: data?.total ?? 0,
    summary: toSummary(data?.summary),
  }
}

/**
 * 検索条件に合う約定を CSV ファイルとして取得する。
 *
 * 実 API は一覧と同じ条件の全件（上限 10,000 件・約定日時の昇順）を UTF-8 BOM 付きで返す。
 * 本文は文字列にせずバイト列のまま Blob にする（文字列にすると BOM が落ち、Excel で日本語が化ける）。
 * ページ位置は無い（limit / offset は送らない）。
 *
 * @param {ExecutionFilters} [filters]
 * @returns {Promise<import('./fileDownload').FileDownload>}
 *   filename は応答の Content-Disposition から取る。取れなければ EXECUTIONS_CSV_FILENAME
 */
export async function exportExecutionsCsv(filters = {}) {
  // arraybuffer にする理由は client.js の decodeBinaryBody（エラー本文を同期で読むため）
  const response = await apiClient.get('/executions/export-csv', {
    params: toSearchParams(filters),
    responseType: 'arraybuffer',
  })

  return toFileDownload(response, EXECUTIONS_CSV_FILENAME)
}

/** ExecutionFilters → 実 API のクエリ。値が undefined のパラメータは axios が送らない */
function toSearchParams({
  branchCode = '',
  symbol = '',
  side = '',
  status = '',
  dateFrom = '',
  dateTo = '',
  route = '',
} = {}) {
  // クエリ名を知ってよいのはこの層だけ
  return {
    branch_code: branchCode || undefined,
    symbol: symbol || undefined,
    side: SIDE_CODES[side],
    status: toStatusQuery(status),
    start_date: dateFrom || undefined,
    end_date: dateTo || undefined,
    route: route || undefined,
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
    amountJpy: toNumberOrNull(raw?.約定代金_JPY),
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
    partialCount: raw?.一部出来件数 ?? 0,
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
