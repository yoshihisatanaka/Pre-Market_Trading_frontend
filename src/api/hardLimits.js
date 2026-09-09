import { apiClient } from './client'

/*
 * ハードリミット（注文の自動分割を決める 3 つの上限）。
 *
 * 画面名は「ハードリミットマスタ」だが、バックエンドの呼称は「スライス注文設定」で
 * エンドポイントは /slice-settings、レスポンスのキーも日本語のまま返る（docs/api/openapi.json）。
 * その差はこの層だけで吸収し、外へは camelCase のアプリ内モデルで返す。
 *
 * 市場関与率は比率（0.05 = 5%）。% への換算は表示側の関心なので、ここでは変換しない。
 */

/** 現在のハードリミットを取得する。未設定なら null */
export async function fetchHardLimits() {
  const { data } = await apiClient.get('/slice-settings')
  return data ? toHardLimits(data) : null
}

/** ハードリミットを更新する。応答は更新後の設定 */
export async function updateHardLimits({
  participationRate,
  maxQuantity,
  maxAmount,
  sliceEnabled,
  updatedAt,
}) {
  const { data } = await apiClient.put('/slice-settings', {
    市場関与率: participationRate,
    大口数量閾値: maxQuantity,
    大口金額閾値: maxAmount,
    // 画面に出さない項目。省略するとサーバ側の既定（1）に落ちて勝手に有効化されるため、
    // 取得した現在値をそのまま送り返して保持する
    スライス有効フラグ: sliceEnabled ? 1 : 0,
    // 楽観的ロック用。他の担当者が先に更新していれば 409 で弾かれる
    更新日時: updatedAt,
  })
  return toHardLimits(data)
}

// バックエンドのキーは日本語。ここでだけ生の形を知る
function toHardLimits(raw) {
  return {
    id: raw['ID'],
    participationRate: raw['市場関与率'],
    maxQuantity: raw['大口数量閾値'],
    maxAmount: raw['大口金額閾値'],
    sliceEnabled: raw['スライス有効フラグ'] === 1,
    note: raw['備考'] ?? '',
    updatedAt: raw['更新日時'] ?? null,
    updatedBy: raw['更新者'] ?? null,
  }
}
