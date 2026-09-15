import { ACCIDENT_ACCOUNT_TYPE } from '@/utils/apiEnums'
import { apiClient } from './client'

/*
 * 顧客マスタ（実 API `/masters/customers`。m_口座情報 の検索）。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次の 5 点。
 *   - プロパティ名が日本語（口座番号 / 部店コード / 円貨預り金 …）
 *   - クエリ名は英語の snake_case（branch_code / account_no / customer_name）
 *   - 口座番号は integer で、クエリ名も `account_no`。アプリ内は文字列
 *     （一覧の行キーと URL で使う）
 *   - フラグが 0 / 1（取引停止区分_全取引・事故処理口座区分・ユーザー操作フラグ）。
 *     アプリ内は boolean。**型はキーごとに違う**（前者は integer、後者は文字列）
 *   - 一覧の配列名が `customers`
 *
 * 2026-09-15 の OpenAPI 取り込みで、このマスタ一覧は `/customers` から
 * **新設の `/masters/customers`** へ移った。あわせてクエリ名が日本語から英語になり、
 * `limit`（1〜200・既定 50）を送れるようになった。
 *
 * **`handler_code`（扱者コード）は `/masters/customers` に無い。**
 * 旧 `/customers`（注文画面用の顧客検索）には今もあるが、マスタ一覧には移されなかった。
 * 取引停止区分・口座区分・法人区分と同じく、いまは MSW のモックだけが解釈する条件で、
 * 実 API に当てるとこの 4 つでは絞り込まれない。仕様追加を依頼する対象。
 *
 * いまは一覧の取得だけを持つ。登録・更新・削除、CSV 入出力は別途。
 * 応答の行は `CustomerItem` スキーマ（日本語キー）。
 */

/**
 * 1 件のアプリ内モデル（このファイルの JSDoc で使う）
 *
 * @typedef {{
 *   accountNumber: string,
 *   branchCode: string,
 *   branchName: string,
 *   handlerCode: string,
 *   handlerName: string,
 *   customerName: string,
 *   customerNameKana: string,
 *   age: string,
 *   tradingSuspended: boolean,
 *   restrictionName: string,
 *   investmentPolicyName: string,
 *   complianceRankName: string,
 *   accountTypeName: string,
 *   accidentAccount: boolean,
 *   corporateTypeName: string,
 *   cashJpy: number|null,
 *   cashUsd: number|null,
 *   growthQuota: number|null,
 *   userModified: boolean,
 * }} Customer
 *   accountNumber は実 API の 口座番号（integer）を文字列にしたもので、一覧の行キーになる。
 *   金額 3 種は数値のまま返す（桁区切りと単位の付与は画面の仕事）。null は「値が無い」。
 *   userModified は ユーザー操作フラグ=1（手動操作された行）。一覧で色を付ける印になる
 */

/**
 * 顧客の一覧を取得する。
 *
 * ページャーを持つ一覧なので、配列ではなく `{ items, total }` を返す。
 *
 * 削除済みの行は含めない。実 API の include_deleted は既定 false なので送らない。
 *
 * `limit` は 1〜200 で既定 50。ページャーの表示件数は
 * stores/customers.js の CUSTOMERS_PAGE_SIZE が決め、その値がここへ渡ってくる。
 *
 * @param {{
 *   limit?: number,
 *   offset?: number,
 *   branchCode?: string,
 *   handlerCode?: string,
 *   accountNumber?: string,
 *   customerName?: string,
 *   restriction?: string,
 *   accountType?: string,
 *   corporateType?: string,
 * }} [params]
 *   customerName は顧客名・顧客名カナの両方に効く（実 API 側の仕様）。
 *   空文字は「条件なし」としてリクエストに載せない。
 *   handlerCode / restriction / accountType / corporateType は実 API では無視される
 *   （`/masters/customers` に対応するクエリが無い。モックだけが解釈する）
 * @returns {Promise<{ items: Customer[], total: number }>} 口座番号の昇順
 */
export async function fetchCustomers({
  limit = 50,
  offset = 0,
  branchCode = '',
  handlerCode = '',
  accountNumber = '',
  customerName = '',
  restriction = '',
  accountType = '',
  corporateType = '',
} = {}) {
  const { data } = await apiClient.get('/masters/customers', {
    // クエリ名を知ってよいのはこの層だけ。値が undefined のパラメータは axios が送らない
    params: {
      limit,
      offset,
      branch_code: branchCode || undefined,
      account_no: toAccountNo(accountNumber),
      customer_name: customerName || undefined,
      /*
       * 以下 4 つは画面モックにある条件だが、`/masters/customers` のクエリには無い
       * （FastAPI は知らないクエリを無視するので送っても害は無く、モックだけが解釈する）。
       * 名前はサーバに追加を依頼したい綴りで書いておく。handler_code は
       * 旧 `/customers`（注文画面用の顧客検索）が実際に持っているクエリ名。
       * 追加されなければ検索カードから外す。
       */
      handler_code: handlerCode || undefined,
      restriction: restriction || undefined,
      account_type: accountType || undefined,
      corporate_type: corporateType || undefined,
    },
  })

  return {
    items: (data.customers ?? []).map(toCustomer),
    total: data.total ?? 0,
  }
}

/** CustomerItem → アプリ内モデル */
function toCustomer(raw) {
  return {
    // 実 API の 口座番号 は integer。画面と URL では文字列として扱う
    accountNumber: String(raw?.口座番号 ?? ''),
    // nullable な項目は空文字に寄せて、画面が null を出さないようにする
    branchCode: raw?.部店コード ?? '',
    branchName: raw?.部店名 ?? '',
    handlerCode: raw?.扱者コード ?? '',
    handlerName: raw?.扱者名 ?? '',
    customerName: raw?.顧客名 ?? '',
    customerNameKana: raw?.顧客名カナ ?? '',
    // 年齢は実 API でも文字列（法人は空）。計算には使わないのでそのまま運ぶ
    age: raw?.年齢 ?? '',
    /*
     * 0 / 1 の integer は、この層で boolean に直して外へ出す。
     * こちらは enum ではなく素の integer フラグなので、リテラルのまま比べる
     * （下の 事故処理口座区分 だけが定数参照になっているのは、そこに enum があるから）。
     */
    tradingSuspended: raw?.取引停止区分_全取引 === 1,
    // 表示名はサーバが付けて返す（コード → 名前の対応表をフロントに持たせない）
    restrictionName: raw?.取引停止区分_全取引名 ?? '',
    investmentPolicyName: raw?.投資方針名 ?? '',
    complianceRankName: raw?.コンプラランク名 ?? '',
    accountTypeName: raw?.口座区分名 ?? '',
    // 事故処理口座区分は文字列の '0' / '1'（取引停止区分と型が違う）。AccidentAccountTypeEnum
    accidentAccount: raw?.事故処理口座区分 === ACCIDENT_ACCOUNT_TYPE.ACCIDENT,
    corporateTypeName: raw?.法人区分名 ?? '',
    /*
     * 金額は数値のまま外へ出す（整形は画面）。nullable なので空文字ではなく null に寄せる。
     * 0 と「値が無い」は意味が違うので、0 を null に潰さないこと。
     */
    cashJpy: toAmount(raw?.円貨預り金),
    cashUsd: toAmount(raw?.外貨預り金),
    growthQuota: toAmount(raw?.NISA買付可能額_当年),
    userModified: raw?.ユーザー操作フラグ === 1,
  }
}

/**
 * 口座番号の検索条件 → クエリに載せる integer。
 * 実 API の 口座番号 は integer なので、数字だけの入力のときにだけ送る
 * （文字列のまま送ると 422 で弾かれ、検索できない理由が画面に出ない）。
 */
function toAccountNo(value) {
  const digits = String(value ?? '').trim()
  return /^\d+$/.test(digits) ? Number(digits) : undefined
}

/** nullable な金額 → 数値または null（数値でないものは値が無いものとして扱う） */
function toAmount(value) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null
}
