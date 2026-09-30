/*
 * モックのレスポンス実体（為替マスタの直近レート）。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 * docs/api/openapi.json の LatestFxResponse に合わせてある（プロパティ名は日本語、基準日は YYYYMMDD の integer）。
 *
 * レートはモックリポジトリの為替マスタの値（新規注文の確認画面の「USD/JPY 150.25」）。
 */

/** GET /masters/fx/latest?currency_code=USD */
export const latestUsdFxRate = {
  ID: 1,
  基準日: 20260929,
  通貨コード: 'USD',
  為替レート: 150.25,
}
