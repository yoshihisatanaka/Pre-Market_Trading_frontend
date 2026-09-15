import { apiClient } from './client'

/*
 * ハードリミット（注文の自動分割を決める 3 つの上限）。
 *
 * エンドポイントは /masters/hard-limits。レスポンスのキーは日本語のまま返る（docs/api/openapi.json）。
 * その差はこの層だけで吸収し、外へは camelCase のアプリ内モデルで返す。
 *
 * バックエンドの内部呼称は「スライス注文設定」で、パスは 2 度変わっている。
 * 2026-09-11 に /slice-settings から /hard-limits へ、2026-09-15 の取り込みで
 * マスタ系がまとめて /masters/ 配下へ移り /masters/hard-limits になった。
 * スキーマ名（SliceSettingResponse / SliceSettingUpdateRequest）と 409 の文言には
 * 旧称が残っているので、混乱しないこと。
 *
 * 市場関与率は比率（0.05 = 5%）。% への換算は表示側の関心なので、ここでは変換しない。
 */

/**
 * 現在のハードリミットを取得する。
 *
 * 実 API は必ず 200 + SliceSettingResponse を返す（ID 以下 6 項目が required）ので
 * 空にはならないが、本文なしで来ても落ちないよう null を返す防御は残す。
 * 画面はこれを「未設定」として 4 状態のひとつに出す。
 */
export async function fetchHardLimits() {
  const { data } = await apiClient.get('/masters/hard-limits')
  return data ? toHardLimits(data) : null
}

/** ハードリミットを更新する。応答は更新後の設定 */
export async function updateHardLimits({
  participationRate,
  maxQuantity,
  maxAmount,
  sliceEnabled,
  note,
  updatedAt,
}) {
  const { data } = await apiClient.put('/masters/hard-limits', {
    市場関与率: participationRate,
    大口数量閾値: maxQuantity,
    大口金額閾値: maxAmount,
    /*
     * どちらも画面に出さない項目。SliceSettingUpdateRequest では optional だが、
     * 省略すると実 API はサーバ側の既定に落とす（実測: スライス有効フラグは 1 に、
     * 備考は NULL になる）。取得した現在値をそのまま送り返して保持する。
     */
    スライス有効フラグ: sliceEnabled ? 1 : 0,
    備考: note,
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
    // 画面に出さないので '' に丸めない。更新時にそのまま送り返すため NULL は NULL のまま持つ
    note: raw['備考'] ?? null,
    updatedAt: raw['更新日時'] ?? null,
    updatedBy: raw['更新者'] ?? null,
  }
}
