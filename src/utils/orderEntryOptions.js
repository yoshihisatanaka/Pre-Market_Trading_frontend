/*
 * 新規注文（外株注文入力）の選択肢。
 *
 * 表示名はモックリポジトリの現行版（premarket-order-202609 の order_input.html）、値は
 * OrderRequest の enum のコード。openapi.json の enum は値だけで意味を持たない
 * （src/utils/apiEnums.js の *_VALUES）ので、**コードと表示名の対応はこのファイルだけが持つ。**
 * 対応の出典は GET /orders/csv-spec の allowed_values（写しは src/mocks/fixtures/orderCsv.js）。
 * 各値が enum に含まれることは orderEntryOptions.spec.js が突き合わせる。
 *
 * モックは画面の表示名そのもの（'買' / '成行' / '円決' …）を送っていたが、実 API はコードを受ける。
 * 画面が持つのはコードで、表示名はここから引く。
 */

/** 売買区分（SideEnum）。1 が売り・3 が買い（CalculationRequest.売買区分 の description と同じ向き） */
export const SIDE = Object.freeze({ BUY: '3', SELL: '1' })

/** tone は BaseSegmentedControl の配色（買い=赤 / 売り=青） */
export const SIDE_OPTIONS = [
  { value: SIDE.BUY, label: '買い', tone: 'buy' },
  { value: SIDE.SELL, label: '売り', tone: 'sell' },
]

/** 確認・完了の読み上げで使う短い表記（モックの「買（委託）」「買注文」） */
export const SIDE_SHORT_LABELS = Object.freeze({ [SIDE.BUY]: '買', [SIDE.SELL]: '売' })

/** 指成区分（OrderTypeEnum） */
export const ORDER_TYPE = Object.freeze({ MARKET: 'MO', LIMIT: 'LO' })

export const ORDER_TYPE_OPTIONS = [
  { value: ORDER_TYPE.MARKET, label: '成行' },
  { value: ORDER_TYPE.LIMIT, label: '指値' },
]

/**
 * 市場区分 → 発注範囲（ExecutionScopeEnum）。
 * 並びは画面モックのとおり（始まる時間帯の順）で、**コードの順とは違う**（04 が 03 より前に来る）。
 * 「＋」は全角（モックの表記）。
 */
export const EXECUTION_SCOPE_OPTIONS = [
  // '01'（プレ）と '05'（レギュラー＋アフター）は 2026-10-02 の取り込みで enum から外れた
  { value: '02', label: 'プレ＋レギュラー' },
  { value: '04', label: 'プレ＋レギュラー＋アフター' },
  { value: '03', label: 'レギュラー' },
  { value: '06', label: 'アフター' },
]

/** 決済通貨区分（SettlementCurrencyEnum） */
export const SETTLEMENT_CURRENCY_OPTIONS = [
  { value: '0', label: '円決' },
  { value: '1', label: '外決' },
]

/**
 * 預り売買区分（DepositCategoryEnum）。画面は 3 つだけを出す（NISA・継続管理勘定は出さない）。
 *
 * 「一般」は csv-spec の「1: 非特定」。**0 / 1 の向きは csv-spec に従う**（0 特定 / 1 非特定）。
 * 残高マスタの 特定預り区分（SPECIFIC_DEPOSIT）は逆向き（0 非特定 / 1 特定）で、同じ意味の
 * 区分なのか別物なのかをバックエンドに問い合わせている（docs/api/requests.md #24）。
 */
export const DEPOSIT_CATEGORY = Object.freeze({ SPECIFIC: '0', GENERAL: '1', GROWTH: '6' })

export const DEPOSIT_CATEGORY_OPTIONS = [
  { value: DEPOSIT_CATEGORY.SPECIFIC, label: '特定' },
  { value: DEPOSIT_CATEGORY.GENERAL, label: '一般' },
  { value: DEPOSIT_CATEGORY.GROWTH, label: '成長投資枠' },
]

/** 勧誘区分（SolicitationEnum） */
export const SOLICITATION = Object.freeze({ SOLICITED: '1', NOT_SOLICITED: '2' })

export const SOLICITATION_OPTIONS = [
  { value: SOLICITATION.SOLICITED, label: '勧誘あり' },
  { value: SOLICITATION.NOT_SOLICITED, label: '勧誘なし' },
]

/** 受注方法（OrderMethodEnum）。並びはモックのとおり（電話他が先頭で既定） */
export const ORDER_METHOD_OPTIONS = [
  { value: '3', label: '電話他' },
  { value: '1', label: '店頭' },
  { value: '2', label: '訪問' },
]

/** 資金性格（FundNatureEnum） */
export const FUND_NATURE_OPTIONS = [
  { value: '1', label: '余裕資金' },
  { value: '2', label: 'その他' },
]

/** 注文チャネル（OrderChannelEnum）。HT（ネット）は店頭の入力画面では選ばせない（モックも 2 つ） */
export const ORDER_CHANNEL_OPTIONS = [
  { value: 'EGY', label: '営業店' },
  { value: 'CC', label: 'コール' },
]

/** 金銭受渡方法（CashDeliveryEnum） */
export const CASH_DELIVERY_OPTIONS = [
  { value: '000', label: '当社' },
  { value: '100', label: '他機関' },
  { value: '200', label: '国外' },
]

/**
 * 注文種別 → VWAP区分（integer。enum の宣言が無い。csv-spec は 0: 非対象 / 1: 対象）。
 * 画面では文字列で持ち、送るときに api 層が integer に直す。
 */
export const VWAP = Object.freeze({ NORMAL: '0', VWAP: '1' })

/**
 * 注文種別の名前。**入力欄の選択肢はコードマスタ `VWAP区分`（依頼中の契約提案）から来る**
 * （components/orders/OrderEntryForm.vue）。ここは確認・完了の読み上げ（utils/orderEntryForm.js）用の写し
 */
export const VWAP_OPTIONS = [
  { value: VWAP.NORMAL, label: '通常' },
  { value: VWAP.VWAP, label: 'VWAP' },
]

/** 取引（TransactionTypeEnum）。この画面は委託だけを受ける（モックも hidden で「委託」固定） */
export const TRANSACTION_TYPE_CONSIGNMENT = '100'

/**
 * 証券受渡方法（SecuritiesDeliveryEnum）。画面に欄は無く、モックの送信値（他社保管）で固定する。
 * モックは初期値だけ「当社保管」を持っていて食い違う。既定値はバックエンドに問い合わせている
 * （docs/api/requests.md #24）。
 */
export const SECURITIES_DELIVERY_OTHER = '500'

/** 入力画面の既定値（モックの初期表示） */
export const ORDER_FORM_DEFAULTS = Object.freeze({
  executionScope: '03',
  orderType: ORDER_TYPE.MARKET,
  settlementCurrency: '0',
  depositCategory: DEPOSIT_CATEGORY.SPECIFIC,
  solicitation: SOLICITATION.SOLICITED,
  orderMethod: '3',
  fundNature: '1',
  orderChannel: 'EGY',
  cashDelivery: '000',
  vwap: VWAP.NORMAL,
})

/**
 * コードを表示名に変換する。
 *
 * @param {{ value: string, label: string }[]} options 上の *_OPTIONS のどれか
 * @param {string} value コード
 * @returns {string} 表示名。未知の値・空値は '—'
 */
export function optionLabel(options, value) {
  return options.find((option) => option.value === value)?.label ?? '—'
}
