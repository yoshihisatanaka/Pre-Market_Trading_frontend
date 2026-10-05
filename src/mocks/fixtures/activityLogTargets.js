/*
 * モックのレスポンス実体（GET /operations/activity-logs/targets）。
 * ここに書くのは「バックエンドが返す生の形」（openapi.json の ActivityLogTargetItem）であり、
 * アプリ内モデルではない。
 *
 * 対象種別コードは仕様の説明（customers, symbols, fx 等）と、src/mocks/fixtures/activityLogs.js が
 * 使う値に合わせてある。対象キー項目・履歴テーブルは画面が表示に使わないので、
 * 実 API の値と一字一句同じである必要はない（`d_口座情報履歴` だけは仕様の説明に出てくる名前）。
 *
 * 運用管理の 2 種（発注停止 / お知らせ）のコードだけは実 API の値（`order-suspensions` /
 * `announcements`。2026-10-05 実測）に揃えてある。画面の「操作区分」（マスタ更新 / 運用管理）は
 * このコードで決まる（src/utils/activityLogTypes.js の OPERATION_TARGET_TYPES）。
 *
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 */

export const activityLogTargets = [
  {
    対象種別: 'customers',
    対象種別名: '顧客マスタ',
    対象キー項目: '口座番号',
    履歴テーブル: 'd_口座情報履歴',
  },
  {
    対象種別: 'symbols',
    対象種別名: '銘柄マスタ',
    対象キー項目: '銘柄コード',
    履歴テーブル: 'm_銘柄情報履歴',
  },
  {
    対象種別: 'fx',
    対象種別名: '為替マスタ',
    対象キー項目: '適用日',
    履歴テーブル: 'm_為替レート履歴',
  },
  {
    対象種別: 'ca',
    対象種別名: 'CAマスタ',
    対象キー項目: '銘柄コード',
    履歴テーブル: 'm_CA情報履歴',
  },
  {
    対象種別: 'balance_adjustments',
    対象種別名: '残高マスタ',
    対象キー項目: '口座番号',
    履歴テーブル: 'd_残高調整履歴',
  },
  {
    対象種別: 'market_holidays',
    対象種別名: '海外休場日マスタ',
    対象キー項目: '休場日',
    履歴テーブル: 'm_海外休場日履歴',
  },
  {
    対象種別: 'order-suspensions',
    対象種別名: '発注停止',
    対象キー項目: '停止対象',
    履歴テーブル: 'd_発注停止履歴',
  },
  {
    対象種別: 'announcements',
    対象種別名: 'お知らせ',
    対象キー項目: 'ID',
    履歴テーブル: 'd_お知らせ履歴',
  },
]
