import {
  ACCIDENT_ACCOUNT_TYPE,
  ACCOUNT_TYPE,
  CORPORATE_TYPE,
  NISA_CONTRACT,
  SPECIFIC_ACCOUNT_TYPE,
} from './apiEnums'

/**
 * 顧客マスタの登録・編集フォームの項目定義（画面側の正）。
 *
 * **項目はこれから増える**（2026-09-28 時点で最終形の 3 分の 1 程度）。
 * 1 項目 = 下の CUSTOMER_FIELD_GROUPS の 1 オブジェクトにしてあり、足すときは次の 3 か所に 1 つずつ足す
 * （画面のテンプレートは書き足さない。CustomerFormFields がこの表から入力欄を組み立てる）。
 *   1. ここ（ラベル・入力の種類・必須・範囲）
 *   2. src/api/customers.js の CUSTOMER_FIELDS（実 API のキーと型）
 *   3. src/mocks/fixtures/customers.js（CustomerItem の生の形）
 * key は 2 と同じにする。この表は実 API のキー（日本語）を知らない（レイヤ規約）。
 *
 * 必須（required）は実 API の CustomerRequest の required に合わせる（18 項目）。
 * 範囲（min / max）も CustomerRequest の宣言の写し。最終判断はサーバの事前検証が行うので、
 * ここでの検査は「明らかな入力漏れ・書式違いで往復しない」ためのもの。
 *
 * 1 項目の形:
 *   key          … アプリ内モデルのキー（api 層の CUSTOMER_FIELDS と同じ）
 *   testid       … data-testid の末尾（{prefix}-{testid}）。grep で当たれるようリテラルで書く
 *   label        … 画面の見出し
 *   control      … 'text' | 'integer' | 'decimal' | 'select'
 *   required     … 必須か
 *   options      … select の選択肢（固定。区分の意味が spec の description にあるもの）
 *   codes        … select の選択肢をコードマスタ（GET /codes）から引くときの名前
 *   initial      … 新規追加で開いたときの値（未指定は ''）。区分は実 API の既定から始める
 *   lockedOnEdit … 編集で読み取り専用にする（業務キー。CustomerUpdateRequest に無い）
 *   min / max    … 数値の範囲。pattern / patternMessage … 文字列の書式
 */

/** 書類の受入区分。CustomerItem の description「(0: 未受入, 1: 受入済)」 */
const DOCUMENT_OPTIONS = [
  { value: '0', label: '未受入' },
  { value: '1', label: '受入済' },
]

/** 取引停止区分。CustomerItem の description「(0: 通常, 1: 停止)」 */
const SUSPENSION_OPTIONS = [
  { value: '0', label: '通常' },
  { value: '1', label: '停止' },
]

const NISA_CONTRACT_OPTIONS = [
  { value: NISA_CONTRACT.NONE, label: '未契約' },
  { value: NISA_CONTRACT.CONTRACTED, label: '契約' },
  { value: NISA_CONTRACT.TERMINATED, label: '解約済' },
]

const SPECIFIC_ACCOUNT_OPTIONS = [
  { value: SPECIFIC_ACCOUNT_TYPE.UNREGISTERED, label: '未登録' },
  { value: SPECIFIC_ACCOUNT_TYPE.WITH_WITHHOLDING, label: '源泉あり' },
  { value: SPECIFIC_ACCOUNT_TYPE.WITHOUT_WITHHOLDING, label: '源泉なし' },
  { value: SPECIFIC_ACCOUNT_TYPE.NON_SPECIFIC, label: '非特定' },
]

const ACCIDENT_ACCOUNT_OPTIONS = [
  { value: ACCIDENT_ACCOUNT_TYPE.NORMAL, label: '通常' },
  { value: ACCIDENT_ACCOUNT_TYPE.ACCIDENT, label: '事故処理' },
]

export const CUSTOMER_FIELD_GROUPS = [
  {
    label: '基本情報',
    fields: [
      {
        key: 'accountNumber',
        testid: 'account-number',
        label: '口座番号',
        control: 'integer',
        required: true,
        min: 1,
        lockedOnEdit: true,
      },
      {
        key: 'branchCode',
        testid: 'branch-code',
        label: '部店',
        control: 'select',
        required: true,
        codes: '部店',
      },
      {
        key: 'handlerCode',
        testid: 'handler-code',
        label: '扱者',
        control: 'select',
        required: true,
        codes: '扱者',
      },
      {
        key: 'corporateType',
        testid: 'corporate-type',
        label: '個人／法人',
        control: 'select',
        required: true,
        codes: '法人区分',
        initial: CORPORATE_TYPE.INDIVIDUAL,
      },
      {
        key: 'customerName',
        testid: 'customer-name',
        label: '顧客名',
        control: 'text',
        required: true,
      },
      {
        key: 'customerNameKana',
        testid: 'customer-name-kana',
        label: '顧客名カナ',
        control: 'text',
        required: true,
      },
      {
        key: 'birthDate',
        testid: 'birth-date',
        label: '生年月日',
        control: 'text',
        hint: '個人は YYYYMMDD、法人は 0',
        pattern: /^(\d{8}|0)$/,
        patternMessage: 'YYYYMMDD の 8 桁（法人は 0）で入力してください。',
      },
      {
        key: 'accountType',
        testid: 'account-type',
        label: '口座区分',
        control: 'select',
        codes: '口座区分',
        initial: ACCOUNT_TYPE.GENERAL,
      },
      {
        key: 'accidentAccountType',
        testid: 'accident-account-type',
        label: '事故処理口座区分',
        control: 'select',
        options: ACCIDENT_ACCOUNT_OPTIONS,
        initial: ACCIDENT_ACCOUNT_TYPE.NORMAL,
      },
    ],
  },
  {
    label: '投資属性・書類',
    fields: [
      {
        key: 'complianceRank',
        testid: 'compliance-rank',
        label: 'コンプラランク',
        control: 'select',
        required: true,
        codes: 'コンプラランク',
      },
      {
        key: 'investmentPolicy',
        testid: 'investment-policy',
        label: '投資方針',
        control: 'select',
        codes: '投資方針',
      },
      {
        key: 'specificAccountType',
        testid: 'specific-account-type',
        label: '特定口座区分',
        control: 'select',
        required: true,
        options: SPECIFIC_ACCOUNT_OPTIONS,
        initial: SPECIFIC_ACCOUNT_TYPE.UNREGISTERED,
      },
      {
        key: 'vwapDocument',
        testid: 'vwap-document',
        label: 'VWAP書類',
        control: 'select',
        required: true,
        options: DOCUMENT_OPTIONS,
        initial: '0',
      },
      {
        key: 'riskDocument',
        testid: 'risk-document',
        label: 'リスク外株書類',
        control: 'select',
        required: true,
        options: DOCUMENT_OPTIONS,
        initial: '0',
      },
      {
        key: 'foreignConsent',
        testid: 'foreign-consent',
        label: '外国証券同意書',
        control: 'select',
        required: true,
        options: DOCUMENT_OPTIONS,
        initial: '0',
      },
    ],
  },
  {
    label: '預り資産・NISA',
    fields: [
      {
        key: 'totalAssets',
        testid: 'total-assets',
        label: '総預り資産（円）',
        control: 'integer',
        required: true,
        min: 0,
        max: 1000000000,
      },
      {
        key: 'cashJpy',
        testid: 'cash-jpy',
        label: '円貨預り金（円）',
        control: 'integer',
        min: 0,
        max: 100000000,
      },
      {
        key: 'cashUsd',
        testid: 'cash-usd',
        label: 'USD預り金（ドル）',
        control: 'decimal',
        min: 0,
        max: 1000000,
      },
      {
        key: 'nisaContract',
        testid: 'nisa-contract',
        label: 'NISA契約',
        control: 'select',
        required: true,
        options: NISA_CONTRACT_OPTIONS,
        initial: NISA_CONTRACT.NONE,
      },
      {
        key: 'growthQuota',
        testid: 'growth-quota',
        label: 'NISA買付可能額 当年（円）',
        control: 'integer',
        min: 0,
        max: 2400000,
      },
      {
        key: 'growthQuotaNext',
        testid: 'growth-quota-next',
        label: 'NISA買付可能額 翌年（円）',
        control: 'integer',
        min: 0,
        max: 2400000,
      },
    ],
  },
  {
    label: '取引停止',
    fields: [
      {
        key: 'suspendAll',
        testid: 'suspend-all',
        label: '全取引',
        control: 'select',
        required: true,
        options: SUSPENSION_OPTIONS,
        initial: '0',
      },
      {
        key: 'suspendEquityTrade',
        testid: 'suspend-equity-trade',
        label: 'エクイティ商品 売買',
        control: 'select',
        required: true,
        options: SUSPENSION_OPTIONS,
        initial: '0',
      },
      {
        key: 'suspendRiskTrade',
        testid: 'suspend-risk-trade',
        label: 'リスク商品 売買',
        control: 'select',
        required: true,
        options: SUSPENSION_OPTIONS,
        initial: '0',
      },
      {
        key: 'suspendEquityBuy',
        testid: 'suspend-equity-buy',
        label: 'エクイティ商品 買',
        control: 'select',
        required: true,
        options: SUSPENSION_OPTIONS,
        initial: '0',
      },
      {
        key: 'suspendRiskBuy',
        testid: 'suspend-risk-buy',
        label: 'リスク商品 買',
        control: 'select',
        required: true,
        options: SUSPENSION_OPTIONS,
        initial: '0',
      },
    ],
  },
]

/** グループを畳んだ全項目 */
export const CUSTOMER_FIELDS = CUSTOMER_FIELD_GROUPS.flatMap((group) => group.fields)

/** 新規追加で開くときのフォームの値 */
export function emptyCustomerForm() {
  return Object.fromEntries(CUSTOMER_FIELDS.map((field) => [field.key, field.initial ?? '']))
}

/**
 * 一覧の 1 行（アプリ内モデル）を編集フォームの値に開く。
 * 入力欄は文字列を持つので寄せる。null（値が無い）は空欄にする（0 とは区別する）。
 */
export function toCustomerForm(customer) {
  return Object.fromEntries(
    CUSTOMER_FIELDS.map((field) => {
      const value = customer?.[field.key]
      return [field.key, value === null || value === undefined ? '' : String(value)]
    }),
  )
}

/**
 * フォームの値を検査する。項目ごとのエラー文言を返す（問題が無い項目は ''）。
 *
 * 見るのは必須・数値の書式と範囲・文字列の書式だけ。実在（部店・扱者）や重複（口座番号）、
 * 項目どうしの整合（NISA 契約と買付可能額など）はサーバの事前検証が見る。
 *
 * @param {Record<string, string>} form
 * @returns {Record<string, string>}
 */
export function validateCustomerForm(form) {
  return Object.fromEntries(CUSTOMER_FIELDS.map((field) => [field.key, fieldError(field, form)]))
}

/** 検査結果に 1 件でもエラーがあるか */
export function hasCustomerFormErrors(errors) {
  return Object.values(errors).some(Boolean)
}

function fieldError(field, form) {
  const value = String(form?.[field.key] ?? '').trim()

  if (value === '') {
    if (!field.required) return ''
    return field.control === 'select'
      ? `${field.label}を選択してください。`
      : `${field.label}を入力してください。`
  }

  if (field.control === 'integer' || field.control === 'decimal') {
    const pattern = field.control === 'integer' ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/
    if (!pattern.test(value)) {
      return field.control === 'integer'
        ? `${field.label}は整数で入力してください。`
        : `${field.label}は数値で入力してください。`
    }
    const number = Number(value)
    if (field.min !== undefined && number < field.min) {
      return `${field.label}は ${field.min.toLocaleString('ja-JP')} 以上で入力してください。`
    }
    if (field.max !== undefined && number > field.max) {
      return `${field.label}は ${field.max.toLocaleString('ja-JP')} 以下で入力してください。`
    }
  }

  if (field.pattern && !field.pattern.test(value)) return field.patternMessage

  return ''
}
