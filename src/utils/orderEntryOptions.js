/*
 * 新規注文（外株注文入力）の選択肢のうち、**画面が決めること**（コードの並び・選べる値の絞り込み・
 * 配色や見出し）と、欄の無い固定値。
 *
 * 値は OrderRequest の enum のコード。**表示名はコードマスタ（GET /codes）から引く**
 * （stores/codes.js の optionsFor / pickOptions / labelFor）。カテゴリ名は各定数の JSDoc に書く。
 * 各コードが enum に含まれ、コードマスタに名称があることは orderEntryOptions.spec.js が突き合わせる。
 *
 * 並び（コード順と違うもの）は画面モック（premarket-order-202609 の order_input.html）のとおりで、
 * フロントで固定する（docs/api/requests.md #42 の回答）。絞り込み（NISA・ネットを出さない）も
 * 画面モックに合わせたもので、サーバの定義は #73 で問い合わせ中。
 */

/** 売買区分（SideEnum / コードマスタ `売買区分`）。1 が売り・3 が買い（CalculationRequest.売買区分 の description と同じ向き） */
export const SIDE = Object.freeze({ BUY: '3', SELL: '1' })

/** 売買区分の並び（買いが先頭。コード順の逆） */
export const SIDE_CODES = [SIDE.BUY, SIDE.SELL]

/** 売買区分の配色。tone は BaseSegmentedControl の配色（買い=赤 / 売り=青）。decorateOptions に渡す */
export const SIDE_EXTRAS = Object.freeze({
  [SIDE.BUY]: { tone: 'buy' },
  [SIDE.SELL]: { tone: 'sell' },
})

/** 指成区分（OrderTypeEnum / コードマスタ `指成区分`） */
export const ORDER_TYPE = Object.freeze({ MARKET: 'MO', LIMIT: 'LO' })

/** 指成区分の並び（画面モックのとおり 成行 → 指値。コード順の逆） */
export const ORDER_TYPE_CODES = [ORDER_TYPE.MARKET, ORDER_TYPE.LIMIT]

const PHASE1_GROUP = 'Ph.1（受付対象）'
const PHASE2_GROUP = 'Ph.2（将来対応）'
const PHASE2_NOTE = '（Ph.2予定）'

/**
 * 注文区分 → 発注範囲（ExecutionScopeEnum / コードマスタ `発注範囲`）。
 * 新規注文の画面モックは 2026-09-30 版で「市場区分」を「注文区分」に改めた（注文照会などの一覧は「市場区分」のまま）。
 * '01'（プレ）と '05'（レギュラー＋アフター）は 2026-10-02 の取り込みで enum から外れた。
 */
export const ORDER_ENTRY_EXECUTION_SCOPE_CODES = ['02', '03', '04', '06']

/**
 * 入力欄の注文区分の見出しと選択可否。
 * フェーズ 1 で受け付けるのは 02 / 03 だけで、アフターを含む 04 / 06 は「Ph.2（将来対応）」の見出しの下に
 * **見せるが選べない**（業務回答 2026-10-08。サーバの事前検証も弾く。docs/api/requests.md #50 ②）。
 * フェーズ 2 でアフターに対応したら、disabled と labelSuffix を外して見出しを移す。
 */
export const ORDER_ENTRY_EXECUTION_SCOPE_EXTRAS = Object.freeze({
  '02': { group: PHASE1_GROUP },
  '03': { group: PHASE1_GROUP },
  '04': { group: PHASE2_GROUP, disabled: true, labelSuffix: PHASE2_NOTE },
  '06': { group: PHASE2_GROUP, disabled: true, labelSuffix: PHASE2_NOTE },
})

/**
 * 指値しか受け付けない注文区分。02（プレ＋レギュラー）の成行はサーバの事前検証でも弾かれるので、
 * 画面で先に止める（docs/api/requests.md #50 ④。業務合意は照会中）
 */
export const LIMIT_ONLY_EXECUTION_SCOPES = ['02']

/*
 * 決済通貨区分（SettlementCurrencyEnum）・勧誘区分（SolicitationEnum）・資金性格（FundNatureEnum）は
 * 並びも絞り込みもコードマスタのまま（`決済通貨区分` / `勧誘区分` / `資金性格`）なので、ここには持たない。
 */

/**
 * 預り売買区分（DepositCategoryEnum / コードマスタ `預り売買区分`）。画面は 3 つだけを出す（NISA・継続管理勘定は出さない）。
 *
 * **0 / 1 の向きはコードマスタに従う**（0 特定 / 1 一般）。
 * 残高マスタの 特定預り区分（SPECIFIC_DEPOSIT）は逆向き（0 一般 / 1 特定）で、同じ意味の
 * 区分なのか別物なのかをバックエンドに問い合わせている（docs/api/requests.md #24）。
 *
 * 選ばなくてもよい（未選択なら送らず、サーバが口座の特定口座区分から決める。#24 ④の回答）。
 * 新規入力は未選択から始め、法人の口座では欄ごと出さない（画面モックの 2026-10-02 版）。
 */
export const DEPOSIT_CATEGORY = Object.freeze({ SPECIFIC: '0', GENERAL: '1', GROWTH: '6' })

export const DEPOSIT_CATEGORY_CODES = [
  DEPOSIT_CATEGORY.SPECIFIC,
  DEPOSIT_CATEGORY.GENERAL,
  DEPOSIT_CATEGORY.GROWTH,
]

/** 勧誘区分（SolicitationEnum） */
export const SOLICITATION = Object.freeze({ SOLICITED: '1', NOT_SOLICITED: '2' })

/** 受注方法（OrderMethodEnum / コードマスタ `受注方法`）。並びはモックのとおり（電話他が先頭で既定） */
export const ORDER_METHOD_CODES = ['3', '1', '2']

/** 注文チャネル（OrderChannelEnum / コードマスタ `注文チャネル`）。HT（ネット）は店頭の入力画面では選ばせない（モックも 2 つ） */
export const ORDER_CHANNEL_CODES = ['EGY', 'CC']

/**
 * 金銭受渡方法（CashDeliveryEnum）。画面に欄は無く、当社（000）で固定する
 * （画面モックの 2026-09-30 版で入力欄と確認画面の行が外れ、保存値は当社固定になった）。
 * OrderRequest では必須で既定値が無いので、省かずに送る。
 */
export const CASH_DELIVERY_DEFAULT = '000'

/**
 * 注文種別 → VWAP区分（integer。enum の宣言が無い。コードマスタ `VWAP区分` は 0: 通常 / 1: VWAP）。
 * 画面では文字列で持ち、送るときに api 層が integer に直す。
 */
export const VWAP = Object.freeze({ NORMAL: '0', VWAP: '1' })

/** 取引（TransactionTypeEnum）。この画面は委託だけを受ける（モックも hidden で「委託」固定） */
export const TRANSACTION_TYPE_CONSIGNMENT = '100'

/**
 * 証券受渡方法（SecuritiesDeliveryEnum）。画面に欄は無く、既定値（当社保管）で固定する。
 * OrderRequest の既定値と同じ（2026-10-06 回答。モックの初期値が正で、送信値の 500 は誤り。
 * docs/api/requests.md #24 ⑤）。
 */
export const SECURITIES_DELIVERY_DEFAULT = '100'

/** 受注者の最大文字数（OrderRequest.受注者 は必須・1〜4 文字。docs/api/requests.md #24 ③） */
export const ORDER_PERSON_MAX_LENGTH = 4

/**
 * 入力画面の既定値（モックの初期表示）。空文字は未選択。
 * 画面モックの 2026-09-30 版で「指値・外決・勧誘あり・余裕資金等・委託」に揃った（価格と決済通貨が変わった）。
 */
export const ORDER_FORM_DEFAULTS = Object.freeze({
  executionScope: '03',
  orderType: ORDER_TYPE.LIMIT,
  settlementCurrency: '1',
  depositCategory: '',
  solicitation: SOLICITATION.SOLICITED,
  orderMethod: '3',
  fundNature: '1',
  orderChannel: 'EGY',
  vwap: VWAP.NORMAL,
})

/**
 * コードマスタの選択肢に、画面が決める飾り（tone / group / disabled / note など）を足す。
 * extras の labelSuffix だけは足さずに表示名の後ろへつなぐ（「アフター（Ph.2予定）」）。
 *
 * @param {{ value: string, label: string }[]} options stores/codes.js の pickOptions / optionsFor の戻り値
 * @param {Record<string, object>} extras コード → 足す項目（SIDE_EXTRAS など）
 * @returns {object[]}
 */
export function decorateOptions(options, extras) {
  return options.map((option) => {
    const { labelSuffix = '', ...extra } = extras[option.value] ?? {}
    return { ...option, ...extra, label: `${option.label}${labelSuffix}` }
  })
}
