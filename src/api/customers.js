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
 * 一覧の取得・事前検証・登録・更新を持つ。**削除は実装しない**（2026-09-28 決定。
 * 実 API に DELETE はあるが画面から使わない）。CSV 入出力は別途。
 * 応答の行は `CustomerItem` スキーマ（日本語キー）。
 *
 * **顧客検索画面（サイドメニューの /customers/search）もこの fetchCustomers を使う**
 * （2026-09-28 決定。注文画面用の旧 `GET /customers` は使わない）。
 *
 * 登録・更新で送る項目は下の CUSTOMER_FIELDS が正（CustomerRequest の入力項目）。
 * **項目はこれから増える**（2026-09-28 時点で最終形の 3 分の 1 程度）。足すときは
 * CUSTOMER_FIELDS に 1 行、画面の src/utils/customerFields.js に 1 項目、フィクスチャに 1 項目を足す。
 */

/*
 * 登録・更新・事前検証で往復する項目の対応表（アプリ内モデルのキー ↔ 実 API のキー）。
 *
 * kind は実 API の型。**同じ 0/1 でも型がキーごとに違う**ので、ここで持つ。
 *   string  … 文字列（書類受入の 0/1、区分コード、名前など）
 *   integer … 整数（口座番号、金額、取引停止区分の 0/1）
 *   number  … 小数を許す数値（外貨預り金）
 * createOnly は登録にだけ載る項目（更新の CustomerUpdateRequest に無い）。
 *
 * 画面（src/utils/customerFields.js）は実 API のキーを知らないので、この表を見ない。
 */
const CUSTOMER_FIELDS = [
  { key: 'accountNumber', apiKey: '口座番号', kind: 'integer', createOnly: true },
  { key: 'branchCode', apiKey: '部店コード', kind: 'string' },
  { key: 'handlerCode', apiKey: '扱者コード', kind: 'string' },
  { key: 'corporateType', apiKey: '法人区分', kind: 'string' },
  { key: 'customerName', apiKey: '顧客名', kind: 'string' },
  { key: 'customerNameKana', apiKey: '顧客名カナ', kind: 'string' },
  { key: 'birthDate', apiKey: '生年月日', kind: 'string' },
  { key: 'complianceRank', apiKey: 'コンプラランク', kind: 'string' },
  { key: 'investmentPolicy', apiKey: '投資方針', kind: 'string' },
  { key: 'vwapDocument', apiKey: 'VWAP書類受入', kind: 'string' },
  { key: 'riskDocument', apiKey: 'リスク外株書類受入', kind: 'string' },
  { key: 'foreignConsent', apiKey: '外国証券同意書受入', kind: 'string' },
  { key: 'totalAssets', apiKey: '総預り資産', kind: 'integer' },
  { key: 'nisaContract', apiKey: 'NISA契約', kind: 'string' },
  // 一覧の「成長投資枠」列はこの値。名前は一覧側に合わせて growthQuota のまま
  { key: 'growthQuota', apiKey: 'NISA買付可能額_当年', kind: 'integer' },
  { key: 'growthQuotaNext', apiKey: 'NISA買付可能額_翌年', kind: 'integer' },
  { key: 'cashJpy', apiKey: '円貨預り金', kind: 'integer' },
  { key: 'cashUsd', apiKey: '外貨預り金', kind: 'number' },
  { key: 'suspendAll', apiKey: '取引停止区分_全取引', kind: 'integer' },
  { key: 'suspendEquityTrade', apiKey: '取引停止区分_エクイティ商品取引_売買', kind: 'integer' },
  { key: 'suspendRiskTrade', apiKey: '取引停止区分_リスク商品取引_売買', kind: 'integer' },
  { key: 'suspendEquityBuy', apiKey: '取引停止区分_エクイティ商品取引_買', kind: 'integer' },
  { key: 'suspendRiskBuy', apiKey: '取引停止区分_リスク商品取引_買', kind: 'integer' },
  { key: 'specificAccountType', apiKey: '特定口座区分', kind: 'string' },
  { key: 'accountType', apiKey: '口座区分', kind: 'string' },
  { key: 'accidentAccountType', apiKey: '事故処理口座区分', kind: 'string' },
]

/**
 * 1 件のアプリ内モデル（このファイルの JSDoc で使う）
 *
 * @typedef {{
 *   id: string,
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
 *   updatedAt: string,
 * } & Record<string, string|number|null>} Customer
 *   id が主キー（実 API の integer な ID を文字列にしたもの。src/api/ca.js と同じ扱い）で、
 *   一覧の行キーになる。accountNumber は実 API の 口座番号（integer）を文字列にしたもので、
 *   主キーではなく行を人が識別する一意な業務コード。
 *   金額 3 種は数値のまま返す（桁区切りと単位の付与は画面の仕事）。null は「値が無い」。
 *   userModified は ユーザー操作フラグ=1（手動操作された行）。一覧で色を付ける印になる。
 *   updatedAt は編集の楽観的ロックで送り返す合札。
 *   ほかに CUSTOMER_FIELDS の各 key を持つ（編集フォームの初期値。文字列は ''、数値は null に寄せる）
 */

/**
 * 登録・更新・事前検証の入力（編集フォームの値）。
 * キーは CUSTOMER_FIELDS の key。入力欄は値を文字列で持つので、数値もここでは文字列でよい
 * （数値への変換はこの層が行う）。
 *
 * @typedef {Record<string, string|number|null>} CustomerInput
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

/**
 * 顧客の入力内容を事前検証する（DB には登録・更新しない）。
 *
 * 部店・扱者・コード値の実在、口座番号の重複（新規）や存在（変更）、NISA と預り金の整合は
 * サーバだけが判断できる。登録・更新の前にこれを呼び、不合格ならそこへ進まない。
 * 不合格は例外にしない（`{ valid: false, errors }` を返す）。通信・サーバ障害だけが throw される。
 *
 * 変更検証の対象はクエリの `account_id`（行 ID）で指す（src/api/symbols.js の symbol_id と同じ形）。
 * `is_update` は編集からの呼び出しか（= id を持つか）だけで決まる。
 *
 * warnings は「登録できるが確認したいこと」。登録側だけが扱う（useCrudList の約束）。
 *
 * @param {CustomerInput & { id?: string }} input id は編集のときだけ渡す
 * @returns {Promise<{ valid: boolean, errors: string[], warnings: string[] }>}
 */
export async function validateCustomer({ id = '', ...input }) {
  const { data } = await apiClient.post(
    '/masters/customers/validate',
    // 事前検証は楽観的ロックの照合をしないので 更新日時 は載せない。口座番号 は必須
    toCustomerRequest(input, { forUpdate: false }),
    id ? { params: { account_id: Number(id), is_update: true } } : undefined,
  )

  return {
    valid: Boolean(data?.valid),
    // errors / warnings は default_factory 付きだが、実 API 以外（プロキシのエラー等）に備える
    errors: Array.isArray(data?.errors) ? data.errors : [],
    warnings: Array.isArray(data?.warnings) ? data.warnings : [],
  }
}

/**
 * 顧客を 1 件登録する。ID はサーバが採番する。
 * 論理削除済みの同じ口座番号があれば、実 API はそれを再有効化する（新規行は増えない）。
 *
 * @param {CustomerInput} input
 * @returns {Promise<Customer>} 登録された 1 件
 */
export async function createCustomer(input) {
  const { data } = await apiClient.post(
    '/masters/customers',
    toCustomerRequest(input, { forUpdate: false }),
  )
  return toCustomer(data?.account)
}

/**
 * 顧客を 1 件更新する。
 *
 * 実 API は部分更新（`CustomerUpdateRequest`）で、本文に含めた項目だけが変わる。
 * **フォームの全項目を明示して送る**（空欄は null で「クリア」を明示する。理由は toCustomerRequest）。
 *
 * **口座番号は送らない。** `CustomerUpdateRequest` に無い（業務キーは変更不可。画面も読み取り専用）。
 * パスキーは `/masters/customers/{account_id}`（integer の行 ID）。
 *
 * updatedAt は一覧取得時の更新日時をそのまま送り返す楽観的ロックの合札で、
 * サーバ側の現在値と違えば 409 で弾かれる。
 *
 * @param {CustomerInput & { id: string, updatedAt?: string }} input
 * @returns {Promise<Customer>} 更新後の 1 件
 */
export async function updateCustomer({ id, updatedAt = '', ...input }) {
  const { data } = await apiClient.put(`/masters/customers/${encodeURIComponent(id)}`, {
    ...toCustomerRequest(input, { forUpdate: true }),
    // 合札が無いときはキーごと送らない（実 API 側は未指定を「照合しない」と解釈する）
    ...(updatedAt ? { 更新日時: updatedAt } : {}),
  })
  return toCustomer(data?.account)
}

/**
 * アプリ内の入力 → CustomerRequest / CustomerValidateRequest / CustomerUpdateRequest。
 *
 * 空欄の送りかたが登録と更新で違う（空文字は送らない。数値項目に '' を送ると 422 になる）。
 *   登録・事前検証 … キーごと送らない。CustomerRequest の任意の数値（円貨預り金など）は
 *                    null を許さず既定 0 を持つので、省けばサーバの既定が入る
 *   更新           … null で明示する。部分更新なので、省くと「変えない」になり
 *                    フォームで消した値が残ってしまう（null だけが「クリア」）
 * 数値にならない入力は空欄と同じに扱う（画面の検査を抜けた値をサーバに 422 で弾かせない）。
 */
function toCustomerRequest(input, { forUpdate }) {
  const entries = CUSTOMER_FIELDS.filter((field) => !(forUpdate && field.createOnly))
    .map((field) => [field.apiKey, toApiValue(field.kind, input[field.key])])
    .filter(([, value]) => forUpdate || value !== null)
  return Object.fromEntries(entries)
}

function toApiValue(kind, value) {
  if (kind === 'string') {
    const text = String(value ?? '').trim()
    return text === '' ? null : text
  }

  if (value === null || value === undefined || String(value).trim() === '') return null
  const parsed = Number(String(value).trim())
  if (!Number.isFinite(parsed)) return null
  return kind === 'integer' && !Number.isInteger(parsed) ? null : parsed
}

/** CUSTOMER_FIELDS の各項目を CustomerItem から読む（文字列は ''、数値は null に寄せる） */
function toEditableFields(raw) {
  return Object.fromEntries(
    CUSTOMER_FIELDS.map((field) => [
      field.key,
      field.kind === 'string' ? (raw?.[field.apiKey] ?? '') : toAmount(raw?.[field.apiKey]),
    ]),
  )
}

/** CustomerItem → アプリ内モデル */
function toCustomer(raw) {
  return {
    // 編集フォームの初期値。下の個別の項目が同じキーを持つときはそちらが勝つ
    ...toEditableFields(raw),
    /*
     * 実 API の主キーは integer の ID。画面と URL では文字列として扱う（src/api/ca.js と同じ）。
     *
     * **口座番号へフォールバックしない。** ID は 2026-09-18 の取り込みで仕様に入ったので、
     * 欠けていたら空文字のまま外へ出して、行のキーが壊れていることをテストで検知させる。
     */
    id: String(raw?.ID ?? ''),
    // 主キーではなくなったが、行を人が識別する一意な業務コードとして残る
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
    /*
     * 楽観的ロックの合札。登録直後の行では null。照合はサーバが行うので素の文字列で持つ
     * （src/api/symbols.js と同じ扱い）
     */
    updatedAt: raw?.更新日時 ?? '',
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
