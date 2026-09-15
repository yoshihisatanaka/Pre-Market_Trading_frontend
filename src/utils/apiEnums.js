/**
 * バックエンドの区分値（`docs/api/openapi.json` の `components.schemas.*Enum` の写し）。
 *
 * ここは**仕様の機械的な写し**で、フロントの判断は入れない。ラベルも持たない。
 * ラベルの出どころは従来どおり次の 3 つ。
 *   1. `GET /codes`（`src/stores/codes.js` の `optionsFor()`）。部店 / 扱者 / 口座区分 など
 *   2. `src/utils/{caTypes,marketHolidayTypes,stockTypes}.js`。データが 0 件でも
 *      検索セレクトを描く必要がある区分だけ、フロントにも対応表を持つ
 *   3. サーバが行ごとに付けて返す `*名` フィールド（`CA種別名` / `口座区分名` …）
 *
 * export は 2 系統に分かれる。**spec に意味が書かれているかどうかで形が変わる。**
 *   - 意味付きの凍結オブジェクト … 参照元フィールドの description に意味がある（7 種）
 *   - `*_VALUES` の凍結配列 … 値だけが定義されていて意味の記載が無い（14 種）
 * 意味が分からないものにフロントが名前を付けると、それは仕様ではなく推測になる。
 * 形で区別しておけば、参照側が誤って推測を事実として扱うことがない。
 * 意味が spec に載ったら `*_VALUES` から意味付きオブジェクトへ昇格させる。
 *
 * **`src/mocks/` からは import しない。** モックはバックエンド側の検証を模すものなので、
 * アプリ内のコードに依存させない（同じ定数を共有すると、モックとアプリが同時に間違えても
 * テストが緑のままになる）。`src/mocks/handlers/index.js` の `HOLIDAY_TYPE_CODES` と同じ方針。
 *
 * 値は数値ではなく文字列で扱う。実 API の値がゼロ埋めされた文字列であることに合わせるため。
 *
 * @see src/utils/apiEnums.spec.js openapi.json と突き合わせて、取り込み直しの差分を検知する
 */

/* ------------------------------------------------------------------ *
 * 意味が spec に書かれているもの（意味付きの凍結オブジェクト）
 * ------------------------------------------------------------------ */

/** 事故処理口座区分。`CustomerItem.事故処理口座区分` の「(0: 通常, 1: 事故処理)」に準拠 */
export const ACCIDENT_ACCOUNT_TYPE = Object.freeze({
  NORMAL: '0',
  ACCIDENT: '1',
})

/** 口座区分。`CustomerItem.口座区分` の「(0: 一般, 1: 自己, 2: 同業者)」に準拠 */
export const ACCOUNT_TYPE = Object.freeze({
  GENERAL: '0',
  PROPRIETARY: '1',
  PEER: '2',
})

/** 法人区分。`CustomerItem.法人区分` の「(0: 個人, 1: 法人)」に準拠 */
export const CORPORATE_TYPE = Object.freeze({
  INDIVIDUAL: '0',
  CORPORATE: '1',
})

/** 海外休場区分。`MarketHolidayItem.休場区分` の「(0: 終日休場, 1: 短縮取引)」に準拠 */
export const HOLIDAY_TYPE = Object.freeze({
  ALL_DAY: '0',
  SHORTENED: '1',
})

/** NISA契約区分。`CustomerItem.NISA契約` の「(0: 未契約, 1: 契約, 9: 解約済)」に準拠 */
export const NISA_CONTRACT = Object.freeze({
  NONE: '0',
  CONTRACTED: '1',
  TERMINATED: '9',
})

/** 特定口座区分。「(0: 未登録, 1: 源泉あり, 2: 源泉なし, 3: 非特定)」に準拠 */
export const SPECIFIC_ACCOUNT_TYPE = Object.freeze({
  UNREGISTERED: '0',
  WITH_WITHHOLDING: '1',
  WITHOUT_WITHHOLDING: '2',
  NON_SPECIFIC: '3',
})

/** 特定預り区分。「(0: 非特定, 1: 特定, 4: NISA, 6: 成長投資枠, 8: 継続管理勘定)」に準拠 */
export const SPECIFIC_DEPOSIT = Object.freeze({
  NON_SPECIFIC: '0',
  SPECIFIC: '1',
  NISA: '4',
  GROWTH_QUOTA: '6',
  CONTINUING_ACCOUNT: '8',
})

/* ------------------------------------------------------------------ *
 * 意味が spec に無いもの（値だけの凍結配列）
 *
 * 値の妥当性検査には使えるが、1 つ 1 つが何を指すかはここでは決めない。
 * 表示名が要るときは `GET /codes` かサーバが返す `*名` を使う。
 * ------------------------------------------------------------------ */

/** CA種別。`CATypeEnum`。表示名は `src/utils/caTypes.js`（codes.json 由来）が持つ */
export const CA_TYPE_VALUES = Object.freeze([
  '110',
  '112',
  '120',
  '121',
  '122',
  '123',
  '125',
  '130',
  '131',
  '140',
  '142',
  '220',
])

/** コンプラランク。`ComplianceRankEnum`。表示名は `GET /codes` の「コンプラランク」 */
export const COMPLIANCE_RANK_VALUES = Object.freeze([
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'X',
  'Y',
  'Z',
])

/** 売買区分。`SideEnum` */
export const SIDE_VALUES = Object.freeze(['1', '3'])

/** 指成区分。`OrderTypeEnum`（LO / MO という綴りから指値 / 成行と読めるが、spec に記載は無い） */
export const ORDER_TYPE_VALUES = Object.freeze(['LO', 'MO'])

/** 受注方法。`OrderMethodEnum` */
export const ORDER_METHOD_VALUES = Object.freeze(['1', '2', '3'])

/** 注文チャネル。`OrderChannelEnum` */
export const ORDER_CHANNEL_VALUES = Object.freeze(['EGY', 'CC', 'HT'])

/** 金銭受渡方法。`CashDeliveryEnum` */
export const CASH_DELIVERY_VALUES = Object.freeze(['000', '100', '200'])

/** 証券受渡方法。`SecuritiesDeliveryEnum` */
export const SECURITIES_DELIVERY_VALUES = Object.freeze(['100', '500'])

/** 決済通貨区分。`SettlementCurrencyEnum` */
export const SETTLEMENT_CURRENCY_VALUES = Object.freeze(['0', '1'])

/** 勧誘区分。`SolicitationEnum` */
export const SOLICITATION_VALUES = Object.freeze(['1', '2'])

/** 発注範囲。`ExecutionScopeEnum` */
export const EXECUTION_SCOPE_VALUES = Object.freeze(['01', '02', '03', '04', '05', '06'])

/** 資金性格。`FundNatureEnum` */
export const FUND_NATURE_VALUES = Object.freeze(['1', '2'])

/** 預り売買区分。`DepositCategoryEnum`（値の集合は `SpecificDepositEnum` と同じだが別の区分） */
export const DEPOSIT_CATEGORY_VALUES = Object.freeze(['0', '1', '4', '6', '8'])

/** 取引。`TransactionTypeEnum` */
export const TRANSACTION_TYPE_VALUES = Object.freeze(['100', '300', '900'])
