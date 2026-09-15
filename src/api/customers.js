import { ACCIDENT_ACCOUNT_TYPE } from '@/utils/apiEnums'
import { apiClient } from './client'

/*
 * 顧客マスタ（実 API `/customers`。m_口座情報 の検索）。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次の 5 点。
 *   - プロパティ名が日本語（口座番号 / 部店コード / 円貨預り金 …）
 *   - **クエリ名まで日本語**（部店コード / 扱者コード / 口座番号 / 顧客名）
 *   - 口座番号が integer。アプリ内は文字列（一覧の行キーと URL で使う）
 *   - フラグが 0 / 1（取引停止区分_全取引・事故処理口座区分・ユーザー操作フラグ）。
 *     アプリ内は boolean
 *   - 一覧は 1 ページ 50 件固定（`limit` クエリを持たない）
 *
 * いまは一覧の取得だけを持つ。登録・更新・削除、CSV 入出力は別途。
 *
 * 応答の行の中身は openapi 上まだ未定義（`customers: array<object>`）なので、同じ
 * m_口座情報 由来の **AccountItem スキーマ**の形を前提に変換している。
 * 実 API の形が確定したら直すのは toCustomer() だけで済む。
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
 * `limit` は受け取るが送らない。実 API の一覧は 1 ページ 50 件で固定されていて
 * `limit` というクエリを持たない。ページャーの表示件数は
 * stores/customers.js の CUSTOMERS_PAGE_SIZE 側で 50 に合わせてある。
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
 *   空文字は「条件なし」としてリクエストに載せない
 * @returns {Promise<{ items: Customer[], total: number }>} 口座番号の昇順
 */
export async function fetchCustomers({
  offset = 0,
  branchCode = '',
  handlerCode = '',
  accountNumber = '',
  customerName = '',
  restriction = '',
  accountType = '',
  corporateType = '',
} = {}) {
  const { data } = await apiClient.get('/customers', {
    // クエリ名が日本語であることを知ってよいのはこの層だけ。
    // 値が undefined のパラメータは axios が送らない
    params: {
      offset,
      部店コード: branchCode || undefined,
      扱者コード: handlerCode || undefined,
      口座番号: toAccountNo(accountNumber),
      顧客名: customerName || undefined,
      /*
       * 以下 3 つは画面モックにある条件だが、実 API のクエリには無い（openapi 上そもそも
       * 受け取らない）。いまはモックだけが解釈する。実 API に切り替えるときに
       * 仕様追加を依頼し、追加されなければ検索カードから外す。
       */
      取引停止区分_全取引: restriction || undefined,
      口座区分: accountType || undefined,
      法人区分: corporateType || undefined,
    },
  })

  return {
    items: (data.customers ?? []).map(toCustomer),
    total: data.total ?? 0,
  }
}

/** AccountItem → アプリ内モデル */
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
