import { apiClient } from './client'

/*
 * 新規注文（外株注文入力）の事前検証と登録（実 API `POST /orders/validate` / `POST /orders`）。
 *
 * 成熟度 B。パスと本文（OrderRequest）・応答（OrderValidationResponse / OrderCreateResponse）は
 * 仕様にあるが、次は未確定で問い合わせている（docs/api/requests.md #24）。
 *   - 業務エラー（残高不足・売買規制・発注停止中など）を 200 の valid:false / success:false で返すのか、
 *     4xx で返すのか（仕様が宣言している応答は 200 と 422 だけ）
 *   - 強制区分 の値の体系（0 / 1 だけか）と、警告を強制区分付きの検証でどう返すか
 *   - 作成者・受注者 をフロントが埋めるのか、認証情報から解決されるのか
 *   - 預り売買区分 の 0 / 1 の向き（csv-spec と残高マスタの 特定預り区分 で逆）
 * どちらの返し方でも画面が止まらないよう、200 の不合格は例外にせず、4xx / 5xx は ApiError として
 * 呼び出し側（stores/orderEntry.js の useAsync）の error に入れる。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次のとおり。
 *   - プロパティ名が日本語（部店 / 口座番号 / 銘柄コード …）。応答だけは英語の snake_case
 *   - 口座番号・強制区分・VWAP区分 は integer。アプリ内は口座番号が文字列、2 つのフラグが boolean
 *   - 有効期限・受注日 は 'YYYYMMDD' の文字列。アプリ内は 'YYYY-MM-DD'
 *   - 指値単価 は成行のとき null（CSV 仕様は「省略か 0」。null は nullable の宣言どおり）
 */

/**
 * 送る注文 1 件（アプリ内モデル）。組み立ては src/utils/orderEntryForm.js の buildOrderInput。
 * 区分値はすべて OrderRequest の enum のコード（意味は src/utils/orderEntryOptions.js）。
 *
 * @typedef {{
 *   branchCode: string,
 *   accountNumber: string,
 *   symbolCode: string,
 *   side: string,
 *   quantity: number,
 *   orderType: string,
 *   limitPrice: number|null,
 *   executionScope: string,
 *   expiryDate: string,
 *   settlementCurrency: string,
 *   depositCategory: string,
 *   securitiesDelivery: string,
 *   transactionType: string,
 *   solicitation: string,
 *   orderMethod: string,
 *   fundNature: string,
 *   orderChannel: string,
 *   cashDelivery: string,
 *   vwap: boolean,
 *   orderDate: string,
 *   orderTime: string,
 *   orderPerson: string,
 *   forced: boolean,
 *   createdBy: string,
 * }} OrderInput
 *   expiryDate / orderDate は 'YYYY-MM-DD'、orderTime は 'HH:MM'
 */

/**
 * 注文の内容をサーバに検証させる（DB には書かない）。
 *
 * 実 API が見るのは入力・マスタ・コード値、保有残高と買付余力（強制区分を考慮）、注文ルート、
 * 発注可能日時。画面は必須と形式だけを先に弾き、残りはここに委ねる。
 *
 * errors と warnings は扱いが違う。
 *   errors   … 発注できない理由。画面は確認へ進まない
 *   warnings … 発注はできるが確認が要ること（モックのフロコン警告）。強制区分を付ければ進める
 * どちらも例外にはしない。通信・サーバ障害だけが throw される。
 *
 * @param {OrderInput} order
 * @returns {Promise<{ valid: boolean, errors: string[], warnings: string[] }>}
 */
export async function validateOrder(order) {
  const { data } = await apiClient.post('/orders/validate', toOrderRequest(order))

  return {
    valid: data?.valid === true,
    // errors / warnings は default_factory 付きだが、実 API 以外（プロキシのエラー等）に備える
    errors: toMessages(data?.errors),
    warnings: toMessages(data?.warnings),
  }
}

/**
 * 注文を 1 件登録する（処理状況 000 で d_注文 に入る）。注文 ID はサーバが採番する。
 *
 * 登録できなかった理由が 200 の success:false で返ったときも例外にしない（errors に理由が入る）。
 *
 * @param {OrderInput} order
 * @returns {Promise<{ success: boolean, orderId: string, message: string, errors: string[], warnings: string[] }>}
 *   orderId は integer の注文 ID を文字列にしたもの（採番されなければ ''）。
 *   message はサーバの文言（画面はそのまま出す。自前で組み立てない）
 */
export async function createOrder(order) {
  const { data } = await apiClient.post('/orders', toOrderRequest(order))

  return {
    success: data?.success === true,
    orderId: data?.order_id === null || data?.order_id === undefined ? '' : String(data.order_id),
    message: data?.message ?? '',
    errors: toMessages(data?.errors),
    warnings: toMessages(data?.warnings),
  }
}

function toMessages(value) {
  return Array.isArray(value) ? value : []
}

/** 'YYYY-MM-DD' → 'YYYYMMDD'（有効期限・受注日は文字列で送る） */
function toApiDate(isoDate) {
  return isoDate ? isoDate.replaceAll('-', '') : null
}

/**
 * アプリ内モデル → OrderRequest。
 *
 * 元注文ID と メモ は送らない（新規注文の画面には欄が無い。どちらも任意項目）。
 * 受注時刻 は 'HH:MM' のまま送る（CSV 仕様が「HHMMSS または HH:MM」を受けると書いている）。
 */
function toOrderRequest(order) {
  return {
    部店: order.branchCode,
    口座番号: Number(order.accountNumber),
    銘柄コード: order.symbolCode,
    売買区分: order.side,
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
    有効期限: toApiDate(order.expiryDate),
    注文チャネル: order.orderChannel,
    金銭受渡方法: order.cashDelivery,
    受注日: toApiDate(order.orderDate),
    受注時刻: order.orderTime,
    // 任意項目。空欄は null で送る（空文字の社員コードを作らない）
    受注者: order.orderPerson || null,
    強制区分: order.forced ? 1 : 0,
    発注範囲: order.executionScope,
    作成者: order.createdBy,
    VWAP区分: order.vwap ? 1 : 0,
  }
}
