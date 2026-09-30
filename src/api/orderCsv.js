import { apiClient } from './client'

/*
 * CSV一括注文（`/orders/csv-spec` ほか）。
 *
 * IFA 向けに、注文を CSV ファイルでまとめて受け付ける。流れは
 *   テンプレートDL → CSV を選んで事前検証（プレビュー）→ 全行が正常なら一括受付
 * の 3 段で、API もこの順に `GET /orders/csv-template` → `POST /orders/validate-csv` →
 * `POST /orders/bulk-create` がある。取込み画面の「CSVフォーマット」表は `GET /orders/csv-spec` で埋める。
 * 列の定義（全 22 列の列名・必須・説明・例）はバックエンドが持っていて、画面は写しを持たない。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次のとおり:
 *   - snake_case（total_columns / row_number / all_valid / order_ids …）
 *   - 列の仕様の例（example）の型が列ごとに違う（'A0001' / 1000113 / 150.0）。アプリ内は文字列に揃える
 *   - 条件付きの必須（condition）は無ければ null。アプリ内は空文字
 *   - 事前検証の行（`rows[].data`）は CSV の列名そのもの（日本語キー 22 列）。アプリ内は camelCase の注文にする
 *   - 一括受付の `OrderRequest` は `作成者` が必須だが、事前検証の行には入っていない。ここで足して送る
 *     （サーバは受け取った値を操作者コードで上書きする。値に意味は無いが、無いと 422 になる）
 *   - テンプレートは UTF-8 の BOM 付き。text で読むとブラウザが BOM を落とし、Excel で開くと文字化けする。
 *     Blob のまま受け取って、そのまま保存させる
 */

/**
 * CSV の 1 列ぶんの仕様。
 *
 * @typedef {{
 *   index: number, name: string, required: boolean,
 *   description: string, example: string, condition: string,
 * }} OrderCsvColumn
 *   name は CSV のヘッダー行に書く列名そのもの（「部店」「口座番号」…）。
 *   condition は「指成区分がLO（指値）の場合は必須」のような、ほかの列の値で決まる必須。
 */

/**
 * CSV の 1 行ぶんの注文（アプリ内モデル）。事前検証の応答から作り、一括受付でそのまま送り返す。
 *
 * @typedef {{
 *   branchCode: string, accountNumber: number|null, symbol: string, side: 'buy'|'sell'|'',
 *   quantity: number|null, orderType: string, limitPrice: number|null,
 *   settlementCurrency: string, securitiesDelivery: string, depositCategory: string,
 *   transactionType: string, solicitation: string, orderMethod: string, fundNature: string,
 *   cashDelivery: string, expiryDate: string, orderChannel: string,
 *   orderDate: string, orderTime: string, receiver: string, vwap: boolean, marketScope: string,
 * }} CsvOrder
 *   区分はコードのまま持つ（orderType は 'LO' / 'MO'、marketScope は '01'〜'06' …）。
 *   送り返すときに崩さないため、side と vwap のほかは値を加工しない。
 *   accountNumber / quantity はサーバが数値に直したもの（直せなかった行は 0 が来る）。
 *   expiryDate / orderDate は 'YYYYMMDD'、orderTime は 'HHMMSS' か 'HH:MM'（CSV に書かれたまま）。
 */

/**
 * 事前検証の 1 行ぶんの結果。
 *
 * @typedef {{
 *   rowNumber: number|null, valid: boolean, errors: string[], warnings: string[],
 *   customerName: string, stockName: string, order: CsvOrder,
 * }} CsvOrderRow
 *   rowNumber は CSV の行番号（ヘッダーが 1 行目なので、データは 2 から）。
 *   customerName / stockName はサーバが口座・銘柄から引いた名前（引けなければ空）。
 *   stockName は details（検証の詳細）の中にあり、値の変換に失敗した行は検証が走らないので空になる。
 *   customerName は行の `customer_name`（2026-09-30 の取り込みで仕様に入った。docs/api/requests.md #27）。
 */

/**
 * 事前検証の結果。
 *
 * @typedef {{
 *   totalCount: number, validCount: number, invalidCount: number,
 *   allValid: boolean, hasError: boolean, rows: CsvOrderRow[],
 * }} CsvOrderValidation
 *   allValid は 1 行以上あって全行が正常のときだけ true（0 行の CSV は allValid も hasError も false）。
 */

/** 売買区分（SideEnum）→ アプリ内の向き。src/api/orderInquiry.js と同じ対応 */
const SIDES = { 1: 'sell', 3: 'buy' }
const SIDE_CODES = { sell: '1', buy: '3' }

/** Content-Disposition が読めなかったときのテンプレートのファイル名（実 API が付ける名前と同じ） */
const TEMPLATE_FILENAME = 'bulk_orders_template.csv'

/**
 * CSV一括注文のヘッダー仕様（全列）を取得する。
 *
 * @returns {Promise<OrderCsvColumn[]>} CSV の列の並び（index の昇順）
 */
export async function fetchOrderCsvSpec() {
  const { data } = await apiClient.get('/orders/csv-spec')
  return (data?.columns ?? []).map(toOrderCsvColumn).sort((a, b) => a.index - b.index)
}

function toOrderCsvColumn(raw) {
  return {
    index: raw?.index ?? 0,
    name: raw?.name ?? '',
    // 必須は true のときだけ必須にする。欠けた値を必須に倒すと、表の赤字が実際の検証とずれる
    required: raw?.required === true,
    description: raw?.description ?? '',
    // 例は列の型のまま来る。表に出すだけなので文字列に寄せる（null / undefined は空）
    example: raw?.example == null ? '' : String(raw.example),
    condition: raw?.condition ?? '',
  }
}

/**
 * CSV の入力用テンプレート（ヘッダー 22 列＋サンプル 3 行）を取得する。
 *
 * 失敗時の本文も Blob で来るので、ErrorResponse の detail は読めない
 * （画面には client.js が status から決める既定の文言が出る）。
 *
 * @returns {Promise<{ blob: Blob, filename: string }>}
 *   filename はサーバが Content-Disposition で付けた名前（読めなければ bulk_orders_template.csv）
 */
export async function fetchOrderCsvTemplate() {
  const response = await apiClient.get('/orders/csv-template', { responseType: 'blob' })
  return {
    blob: response.data,
    filename: filenameFrom(response.headers?.['content-disposition']),
  }
}

/** `attachment; filename="bulk_orders_template.csv"` からファイル名を取り出す（引用符は有っても無くてもよい） */
function filenameFrom(disposition) {
  const match = /filename="?([^";]+)"?/i.exec(disposition ?? '')
  return match ? match[1].trim() : TEMPLATE_FILENAME
}

/**
 * 注文 CSV を事前検証する（DB には登録しない）。
 *
 * 行ごとの不備は 200 の中の rows[].errors で返り、例外にならない。
 * ファイルそのものの不備（ヘッダーの列が足りない・読めない）は 400、file 欠落は 422 で ApiError になる。
 *
 * @param {File} file 注文 CSV（UTF-8 / Shift-JIS。文字コードの判定はサーバが行う）
 * @returns {Promise<CsvOrderValidation>}
 */
export async function validateOrderCsv(file) {
  const body = new FormData()
  body.append('file', file)

  const { data } = await apiClient.post('/orders/validate-csv', body, {
    // client.js の既定は application/json。multipart を明示すれば、境界付きの Content-Type はブラウザが付け直す
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return toValidation(data)
}

/** CsvOrderValidateResponse → CsvOrderValidation */
function toValidation(raw) {
  return {
    totalCount: toCount(raw?.total_count),
    validCount: toCount(raw?.valid_count),
    invalidCount: toCount(raw?.invalid_count),
    allValid: raw?.all_valid === true,
    hasError: raw?.has_error === true,
    rows: (raw?.rows ?? []).map(toCsvOrderRow),
  }
}

/** CsvOrderRowResult → CsvOrderRow */
function toCsvOrderRow(raw) {
  return {
    rowNumber: Number.isInteger(raw?.row_number) ? raw.row_number : null,
    // 正常は true のときだけ。欠けた値を正常に倒すと、NG の行を受付へ回してしまう
    valid: raw?.valid === true,
    errors: raw?.errors ?? [],
    warnings: raw?.warnings ?? [],
    customerName: raw?.customer_name ?? '',
    stockName: raw?.details?.stock_name ?? '',
    order: toCsvOrder(raw?.data),
  }
}

/** CsvOrderRowResult.data（CSV の列名のキー）→ CsvOrder */
function toCsvOrder(raw) {
  return {
    branchCode: raw?.部店 ?? '',
    accountNumber: raw?.口座番号 ?? null,
    symbol: raw?.銘柄コード ?? '',
    // 知らないコードは空にする。'1'/'3' 以外を片方に丸めると買いと売りを取り違える
    side: SIDES[raw?.売買区分] ?? '',
    quantity: raw?.数量 ?? null,
    orderType: raw?.指成区分 ?? '',
    // 成行は値を持たないので null のまま通す（0 に寄せると「0 ドルの指値」と見分けられない）
    limitPrice: raw?.指値単価 ?? null,
    settlementCurrency: raw?.決済通貨区分 ?? '',
    securitiesDelivery: raw?.証券受渡方法 ?? '',
    depositCategory: raw?.預り売買区分 ?? '',
    transactionType: raw?.取引 ?? '',
    solicitation: raw?.勧誘区分 ?? '',
    orderMethod: raw?.受注方法 ?? '',
    fundNature: raw?.資金性格 ?? '',
    cashDelivery: raw?.金銭受渡方法 ?? '',
    expiryDate: raw?.有効期限 ?? '',
    orderChannel: raw?.注文チャネル ?? '',
    orderDate: raw?.受注日 ?? '',
    orderTime: raw?.受注時刻 ?? '',
    receiver: raw?.受注者 ?? '',
    vwap: raw?.VWAP区分 === 1,
    marketScope: raw?.発注範囲 ?? '',
  }
}

/**
 * 事前検証を通った注文をまとめて受け付ける。
 *
 * サーバは全行を検証し直し、1 行でも不備があれば 1 件も登録しない（400）。
 * その文言の「N行目」は送った orders の 1 始まりの位置で、CSV の行番号ではない。
 *
 * @param {CsvOrder[]} orders 事前検証の行の order を CSV の並びのまま
 * @param {{ createdBy?: string }} [options] createdBy は操作者コード（`作成者`。サーバが上書きする）
 * @returns {Promise<{ totalOrders: number, orderIds: string[], message: string }>}
 *   orderIds は採番された注文 ID で、送った orders と同じ並び
 */
export async function bulkCreateOrders(orders, { createdBy = '' } = {}) {
  const { data } = await apiClient.post('/orders/bulk-create', {
    orders: orders.map((order) => toOrderRequest(order, createdBy)),
  })
  return {
    totalOrders: toCount(data?.total_orders),
    orderIds: (data?.order_ids ?? []).map(String),
    message: data?.message ?? '',
  }
}

/**
 * CsvOrder → OrderRequest。toCsvOrder の逆に `作成者` を足す。
 * 強制区分・元注文ID・メモは CSV に無いので送らない（サーバの既定に任せる）。
 */
function toOrderRequest(order, createdBy) {
  return {
    部店: order.branchCode,
    口座番号: order.accountNumber,
    銘柄コード: order.symbol,
    売買区分: SIDE_CODES[order.side] ?? '',
    数量: order.quantity,
    指成区分: order.orderType,
    指値単価: order.limitPrice,
    決済通貨区分: order.settlementCurrency,
    証券受渡方法: order.securitiesDelivery,
    預り売買区分: order.depositCategory,
    取引: order.transactionType,
    勧誘区分: order.solicitation,
    受注方法: order.orderMethod,
    資金性格: order.fundNature,
    金銭受渡方法: order.cashDelivery,
    有効期限: order.expiryDate,
    注文チャネル: order.orderChannel,
    受注日: order.orderDate,
    受注時刻: order.orderTime,
    受注者: order.receiver,
    VWAP区分: order.vwap ? 1 : 0,
    発注範囲: order.marketScope,
    作成者: createdBy,
  }
}

function toCount(value) {
  return Number.isInteger(value) ? value : 0
}
