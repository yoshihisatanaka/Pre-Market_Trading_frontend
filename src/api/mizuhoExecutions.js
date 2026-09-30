import { SIDE_VALUES } from '@/utils/apiEnums'
import { apiClient } from './client'
import { EXECUTIONS_CSV_FILENAME } from './executions'
import { toFileDownload } from './fileDownload'

/*
 * みずほ注文締の約定一覧（実 API `GET /executions` を 預託先＝みずほ で絞ったもの）。
 *
 * 約定照会（`/executions`）と同じエンドポイントを、注文ルート `0`（みずほ）に固定して読む。
 * 約定照会の api 層ができたら、そちらの取得関数に route を渡す形へ寄せてこのファイルは畳む
 * （いまは並行して作っているので、ファイルを分けて衝突を避けている）。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次の 5 点。
 *   - プロパティ名が日本語（約定単価 / 約定日時 / 処理状況 …）。一覧の配列名は `executions`
 *   - 約定ID・注文ID・口座番号は integer。アプリ内は文字列（行キーと表示で使う）
 *   - 売買区分はコード（1:売 / 3:買）。アプリ内は 'buy' / 'sell'
 *   - 出来状況は 処理状況コード（010:一部出来 / 011:全部出来 / 032・034:取消済）。
 *     アプリ内は画面モックの 3 区分（'filled' / 'partial' / 'canceled_filled'）。
 *     約定の行は必ず出来を持つので、取消済の行はそのまま「取消済（出来有）」になる
 *   - 件数カードの集計が `summary`（ExecutionSummary）で同梱される
 *
 * CSV 出力は約定照会と同じ `GET /executions/export-csv` を、一覧と同じ条件（route=0 固定）で読む。
 *
 * 成熟度 A（パス・クエリ・レスポンスのスキーマが openapi.json にある。CSV 出力は B）。
 * ただし画面モックの次の 2 項目は仕様に無い:
 *   - 約定金額（円）… ExecutionItem は 約定代金（USD）しか返さない
 *   - 件数カードの「一部出来」… ExecutionSummary に一部出来の件数が無い
 */

/** 注文ルート（預託先）のみずほ。`/masters/symbols` の預託先区分と同じコード */
const MIZUHO_ROUTE = '0'

/** 売買区分コード → アプリ内の向き。SideEnum（1:売 / 3:買） */
const SIDE_BY_CODE = { 3: 'buy', 1: 'sell' }

/** 処理状況コード → 出来状況の区分（画面モックの 全部出来 / 一部出来 / 取消済（出来有）） */
const FILL_STATUS_BY_CODE = {
  '011': 'filled',
  '010': 'partial',
  '032': 'canceled_filled',
  '034': 'canceled_filled',
}

/**
 * 出来状況の区分 → クエリに載せる 処理状況コード。
 *
 * TODO(処理実装): 「取消済（出来有）」に当たるコードが 1 つに決まらない
 *   （取消済は 032 / 034 の 2 つで、`status` は 1 コードしか受け取らない）。
 *   バックエンドに確認するまで送らない（その区分を選んでも絞り込まれない）。
 */
const STATUS_QUERY_BY_FILL_STATUS = {
  filled: '011',
  partial: '010',
}

/**
 * 1 件のアプリ内モデル（このファイルの JSDoc で使う）
 *
 * @typedef {{
 *   id: string,
 *   orderId: string,
 *   accountNumber: string,
 *   customerName: string,
 *   symbol: string,
 *   side: 'buy'|'sell'|'',
 *   quantity: number|null,
 *   executedQuantity: number|null,
 *   executedPrice: number|null,
 *   executedAt: string|null,
 *   fillStatus: 'filled'|'partial'|'canceled_filled'|'',
 *   statusName: string,
 *   routeName: string,
 * }} MizuhoExecution
 *   id は約定ID（integer を文字列にしたもの）で、一覧の行キーになる。
 *   quantity は元注文の数量、executedQuantity はこの約定の数量。
 *   symbol はティッカー（受注時点のスナップショット）で、欠けていれば銘柄コード。
 *   fillStatus が空のときは、画面は statusName（サーバの名称）をそのまま出す
 */

/**
 * @typedef {{ executionCount: number, buyCount: number, sellCount: number }} MizuhoExecutionSummary
 *   同じ検索条件での集計（ページに依らない）。件数カードに出す 3 つだけを運ぶ
 */

/**
 * みずほの約定の検索条件（一覧と CSV 出力で共通）
 *
 * @typedef {{
 *   branchCode?: string,
 *   symbol?: string,
 *   side?: string,
 *   fillStatus?: string,
 *   dateFrom?: string,
 *   dateTo?: string,
 * }} MizuhoExecutionFilters
 *   side は売買区分コード（'1' / '3'）。知らない値は送らない。
 *   fillStatus は出来状況の区分（'filled' / 'partial' / 'canceled_filled'）。
 *   dateFrom / dateTo は YYYY-MM-DD（実 API はそのまま受け取る）。
 *   空文字は「条件なし」としてリクエストに載せない
 */

/**
 * みずほの約定一覧を取得する。
 *
 * ページャーを持つ一覧なので、`{ items, total }` に件数カードの集計 `summary` を添えて返す。
 * 並びは約定日時の新しい順（実 API の sort の既定 desc。送らない）。
 *
 * @param {{ limit?: number, offset?: number } & MizuhoExecutionFilters} [params]
 * @returns {Promise<{ items: MizuhoExecution[], total: number, summary: MizuhoExecutionSummary }>}
 */
export async function fetchMizuhoExecutions({ limit = 50, offset = 0, ...filters } = {}) {
  const { data } = await apiClient.get('/executions', {
    params: { limit, offset, ...toSearchParams(filters) },
  })

  return {
    items: (data?.executions ?? []).map(toMizuhoExecution),
    total: data?.total ?? 0,
    summary: toSummary(data?.summary),
  }
}

/**
 * 検索条件に合うみずほの約定を CSV ファイルとして取得する。
 *
 * 実 API は一覧と同じ条件の全件（上限 10,000 件・約定日時の昇順）を UTF-8 BOM 付きで返す。
 * 本文はバイト列のまま Blob にする（理由は src/api/executions.js の exportExecutionsCsv と同じ）。
 * ページ位置は無い（limit / offset は送らない）。
 *
 * @param {MizuhoExecutionFilters} [filters]
 * @returns {Promise<import('./fileDownload').FileDownload>}
 *   filename は応答の Content-Disposition から取る。取れなければ EXECUTIONS_CSV_FILENAME
 */
export async function exportMizuhoExecutionsCsv(filters = {}) {
  // arraybuffer にする理由は client.js の decodeBinaryBody（エラー本文を同期で読むため）
  const response = await apiClient.get('/executions/export-csv', {
    params: toSearchParams(filters),
    responseType: 'arraybuffer',
  })

  return toFileDownload(response, EXECUTIONS_CSV_FILENAME)
}

/** MizuhoExecutionFilters → 実 API のクエリ。値が undefined のパラメータは axios が送らない */
function toSearchParams({
  branchCode = '',
  symbol = '',
  side = '',
  fillStatus = '',
  dateFrom = '',
  dateTo = '',
} = {}) {
  // クエリ名を知ってよいのはこの層だけ
  return {
    route: MIZUHO_ROUTE,
    branch_code: branchCode || undefined,
    symbol: symbol.trim() || undefined,
    side: SIDE_VALUES.includes(side) ? side : undefined,
    status: STATUS_QUERY_BY_FILL_STATUS[fillStatus],
    start_date: dateFrom || undefined,
    end_date: dateTo || undefined,
  }
}

/** ExecutionItem → アプリ内モデル */
function toMizuhoExecution(raw) {
  return {
    id: String(raw?.ID ?? ''),
    orderId: String(raw?.注文ID ?? ''),
    accountNumber: String(raw?.口座番号 ?? ''),
    customerName: raw?.顧客名 ?? '',
    symbol: raw?.Ticker || raw?.銘柄コード || '',
    side: SIDE_BY_CODE[raw?.売買区分] ?? '',
    quantity: toNumber(raw?.注文数量),
    executedQuantity: toNumber(raw?.約定数量),
    executedPrice: toNumber(raw?.約定単価),
    executedAt: raw?.約定日時 ?? null,
    fillStatus: FILL_STATUS_BY_CODE[raw?.処理状況] ?? '',
    // 表示名はサーバが付けて返す。区分に当たらないコードのときだけ画面がこれを出す
    statusName: raw?.処理状況名 ?? '',
    routeName: raw?.注文ルート名 ?? '',
  }
}

/** ExecutionSummary → 件数カードの 3 つ。欠けていたら 0 件として扱う */
function toSummary(raw) {
  return {
    executionCount: raw?.件数 ?? 0,
    buyCount: raw?.買件数 ?? 0,
    sellCount: raw?.売件数 ?? 0,
  }
}

/** nullable な数値 → 数値または null（0 と「値が無い」を区別する） */
function toNumber(value) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null
}
