/*
 * 仮計算マスタ。GET /masters/calculation-settings が返す生の形。
 * キーは openapi.json の CalculationSettingItem のまま日本語。
 *
 * 画面に出す 4 項目は画面モック（/masters/provisional-calculation）の初期値に合わせる
 * （取引所税 0.002000% / スプレッド 0.5000 円/USD / 現地手数料率 0.100000% / NISA 5.0000%）。
 * API の単位に直すと 取引所税率 0.00002（比率）・現地手数料率_bp 10（bp）になる。
 * 画面に出さない 3 項目はバックエンドの既定値（db/migrate_calculation_setting.py）。
 */
export const calculationSetting = {
  ID: 1,
  為替スプレッド: 0.5,
  現地手数料率_bp: 10,
  // 比率で持つ（0.00002 = 0.002%）
  取引所税率: 0.00002,
  消費税率: 0.1,
  譲渡益所得税率: 0.15315,
  譲渡益住民税率: 0.05,
  NISA為替上乗せ率: 5,
  // 画面に出さない項目。保存のたびに消えていないことをテストで守りたいので non-null にしておく
  備考: '初期設定',
  ユーザー操作フラグ: 0,
  作成日時: '2026-09-29T09:00:00',
  作成者: 'BATCH',
  更新日時: '2026-09-29T09:00:00',
  更新者: 'BATCH',
}
