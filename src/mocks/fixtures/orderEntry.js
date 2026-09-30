/*
 * モックのレスポンス実体（新規注文の事前検証・登録）。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 * docs/api/openapi.json の OrderValidationResponse / OrderCreateResponse に合わせてある
 * （この 2 つだけ応答のキーが英語の snake_case）。
 *
 * 検証の中身（どの条件で errors / warnings を返すか）は src/mocks/handlers/orderEntry.js が持つ。
 * ここに置くのは文言と、契約テストに渡す応答の見本。文言はモックリポジトリの
 * validators/order_validator.py と compliance/flocon_check.py の原文。
 */

/** 最初に採番する注文 ID（モックリポジトリの mock_data/orders.py と同じ） */
export const FIRST_ORDER_ID = 1005

/** 大口取引の警告を出す概算額（円）。概算は 数量 × 単価 × 150 円（モックのフロコン判定と同じ固定レート） */
export const LARGE_TRADE_THRESHOLD_JPY = 50_000_000
export const FLOCON_FX_RATE = 150

/** コンプライアンスランクの警告を出すランク */
export const CAUTION_COMPLIANCE_RANKS = ['A', 'B', 'Y', 'Z']

export const orderMessages = {
  created: '注文を受け付けました。',
  rejected: '注文を登録できませんでした。',
  unacknowledgedWarnings:
    '確認が必要な警告があります。内容を確認のうえ、強制区分を指定して再度送信してください。',
  customerNotFound: '口座が見つかりません。部店と口座番号を確認してください。',
  symbolNotFound: '銘柄コードが見つかりません。ユニバース銘柄を確認してください。',
  prohibited: '売り、買いともに禁止銘柄です。',
  growthOnBuy: '買付時に「成長投資枠」を選択することはできません。',
  vwapNotTarget: 'この銘柄は現在、VWAP対象外です。通常注文で入力してください。',
  tradingSuspended: 'この顧客は取引停止状態です。',
  complianceRank: (rank) =>
    `顧客のコンプライアンスランクが「${rank}」です。注文内容を確認してください。`,
  largeTrade: (amount) =>
    `約定金額（約${amount.toLocaleString('en-US')}円）が5,000万円を超過しています。大口取引として確認が必要です。`,
}

/** OrderValidationResponse の見本（契約テスト用。合格 / 不合格 / 警告あり） */
export const orderValidationExamples = [
  { valid: true, errors: [], warnings: [], details: null },
  { valid: false, errors: [orderMessages.symbolNotFound], warnings: [], details: null },
  { valid: true, errors: [], warnings: [orderMessages.complianceRank('A')], details: null },
]

/** OrderCreateResponse の見本（契約テスト用。受付 / 拒否） */
export const orderCreateExamples = [
  {
    success: true,
    order_id: FIRST_ORDER_ID,
    message: orderMessages.created,
    errors: [],
    warnings: [],
  },
  {
    success: false,
    order_id: null,
    message: orderMessages.rejected,
    errors: [orderMessages.prohibited],
    warnings: [],
  },
]
