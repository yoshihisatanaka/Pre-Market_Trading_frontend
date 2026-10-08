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
  symbolNotFound: 'ティッカーが見つかりません。取扱銘柄を確認してください。',
  prohibited: '売り、買いともに禁止銘柄です。',
  growthOnBuy: '買付時に「成長投資枠」を選択することはできません。',
  vwapNotTarget: 'この銘柄は現在、VWAP対象外です。通常注文で入力してください。',
  tradingSuspended: 'この顧客は取引停止状態です。',
  complianceRank: (rank) =>
    `顧客のコンプライアンスランクが「${rank}」です。注文内容を確認してください。`,
  largeTrade: (amount) =>
    `約定金額（約${amount.toLocaleString('en-US')}円）が5,000万円を超過しています。大口取引として確認が必要です。`,
}

/**
 * 受付直後の状況（OrderCreateResponse の 処理状況 / 処理状況名 / Dream登録状況 / Dream登録状況名。
 * docs/api/requests.md #52）。通常は 000 未発注 ＋ Dream 0 未登録（画面モックの「Dream登録待ち」）、
 * VWAP・自己取引は Dream 8 登録対象外。名称はコードマスタの 処理状況 / Dream登録状況 と同じ。
 */
export const acceptedStatus = {
  処理状況: '000',
  処理状況名: '未発注',
  Dream登録状況: '0',
  Dream登録状況名: '未登録',
}

export const acceptedVwapStatus = {
  ...acceptedStatus,
  Dream登録状況: '8',
  Dream登録状況名: '登録対象外',
}

/** 受け付けなかったときの状況（注文が作られないので 4 項目とも null） */
export const rejectedStatus = {
  処理状況: null,
  処理状況名: null,
  Dream登録状況: null,
  Dream登録状況名: null,
}

/** OrderValidationResponse の見本（契約テスト用。合格 / 不合格 / 警告あり） */
export const orderValidationExamples = [
  { valid: true, errors: [], warnings: [], details: null },
  { valid: false, errors: [orderMessages.symbolNotFound], warnings: [], details: null },
  { valid: true, errors: [], warnings: [orderMessages.complianceRank('A')], details: null },
]

/** OrderCreateResponse の見本（契約テスト用。受付 / VWAP の受付 / 拒否） */
export const orderCreateExamples = [
  {
    success: true,
    order_id: FIRST_ORDER_ID,
    message: orderMessages.created,
    errors: [],
    warnings: [],
    ...acceptedStatus,
  },
  {
    success: true,
    order_id: FIRST_ORDER_ID + 1,
    message: orderMessages.created,
    errors: [],
    warnings: [],
    ...acceptedVwapStatus,
  },
  {
    success: false,
    order_id: null,
    message: orderMessages.rejected,
    errors: [orderMessages.prohibited],
    warnings: [],
    ...rejectedStatus,
  },
]
