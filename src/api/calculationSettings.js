import { apiClient } from './client'

/*
 * 仮計算マスタ（仮計算に使う為替スプレッド・料率・税率。DB に 1 行だけの設定）。
 *
 * エンドポイントは /masters/calculation-settings（GET / PUT）。バックエンドの形を知ってよいのは
 * この層だけで、吸収している差は次のとおり:
 *   - プロパティ名が日本語（為替スプレッド / 現地手数料率_bp / 取引所税率 …）
 *   - PUT の応答は `{ success, calculation_setting, message }` で包まれる。
 *     message は「仮計算マスタを変更しました。」か、差分が無いときの「変更はありません。」
 *
 * 単位は API のまま持つ（取引所税率は比率 0.0000206、現地手数料率は bp で 15 = 0.15%）。
 * 画面は % で見せるが、その換算は表示側の関心なのでここでは変換しない（src/api/sliceCriteria.js と同じ）。
 *
 * 履歴（GET /masters/calculation-settings/history）は画面モックに導線が無いので関数を置いていない。
 */

/**
 * @typedef {{ id: number, fxSpread: number, localCommissionBp: number, exchangeTaxRate: number,
 *   consumptionTaxRate: number, capitalGainsIncomeTaxRate: number,
 *   capitalGainsResidentTaxRate: number, nisaFxMarkupRate: number, note: string | null,
 *   updatedAt: string | null, updatedBy: string | null }} CalculationSettings
 */

/**
 * 現在の仮計算マスタを取得する。
 *
 * 実 API は必ず 200 + CalculationSettingItem を返す（未初期化なら 500）ので空にはならないが、
 * 本文なしで来ても落ちないよう null を返す防御は残す。画面はこれを「未設定」として 4 状態のひとつに出す。
 *
 * @returns {Promise<CalculationSettings | null>}
 */
export async function fetchCalculationSettings() {
  const { data } = await apiClient.get('/masters/calculation-settings')
  return data ? toCalculationSettings(data) : null
}

/**
 * 仮計算マスタを更新する。
 *
 * CalculationSettingUpdateRequest は部分更新で、送らなかった項目はサーバ側で現在値が保たれる。
 * 画面に出す 4 項目と楽観的ロックの更新日時だけを送り、消費税率・譲渡益税率・備考には触れない。
 *
 * @param {{ exchangeTaxRate: number, localCommissionBp: number, fxSpread: number,
 *   nisaFxMarkupRate: number, updatedAt: string | null }} params
 * @returns {Promise<{ settings: CalculationSettings, message: string }>}
 */
export async function updateCalculationSettings({
  exchangeTaxRate,
  localCommissionBp,
  fxSpread,
  nisaFxMarkupRate,
  updatedAt,
}) {
  const { data } = await apiClient.put('/masters/calculation-settings', {
    取引所税率: exchangeTaxRate,
    現地手数料率_bp: localCommissionBp,
    為替スプレッド: fxSpread,
    NISA為替上乗せ率: nisaFxMarkupRate,
    // 楽観的ロック用。他の担当者が先に更新していれば 409 で弾かれる
    更新日時: updatedAt,
  })
  return {
    settings: toCalculationSettings(data.calculation_setting),
    message: data.message ?? '',
  }
}

// バックエンドのキーは日本語。ここでだけ生の形を知る
function toCalculationSettings(raw) {
  return {
    id: raw['ID'],
    fxSpread: raw['為替スプレッド'],
    localCommissionBp: raw['現地手数料率_bp'],
    exchangeTaxRate: raw['取引所税率'],
    consumptionTaxRate: raw['消費税率'],
    capitalGainsIncomeTaxRate: raw['譲渡益所得税率'],
    capitalGainsResidentTaxRate: raw['譲渡益住民税率'],
    nisaFxMarkupRate: raw['NISA為替上乗せ率'],
    note: raw['備考'] ?? null,
    updatedAt: raw['更新日時'] ?? null,
    updatedBy: raw['更新者'] ?? null,
  }
}
