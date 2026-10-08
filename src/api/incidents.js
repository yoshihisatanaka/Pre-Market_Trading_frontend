import { apiClient } from './client'

/*
 * 障害管理（発注停止 / 再開）。
 *
 * エンドポイントは /operations/order-suspensions 配下（docs/api/openapi.json のタグ OrderSuspensions）。
 * ファイル名が incidents なのは画面の呼称に合わせたため（sliceCriteria.js → /masters/hard-limits と同じ）。
 * キーは日本語のまま返るので、その差はこの層だけで吸収し、外へは camelCase のアプリ内モデルで返す。
 *
 * 停止の単位は「停止対象」。ALL:全体 / 注文ルートコード（0:みずほ 1:IB（自己取引を含む） 2:VWAP）。
 * OTC はルート単位では止められず、全体停止のみ。全体停止はルート単位の停止に優先する。
 */

const SUSPENSIONS_PATH = '/operations/order-suspensions'

/**
 * 停止対象ごとの停止状態を取得する。
 *
 * 実 API は必ず 200 + SuspensionStatusResponse を返すが、本文なしで来ても落ちないよう
 * null を返す防御は残す（fetchSliceCriteria と同じ）。画面はこれを「空」として出す。
 */
export async function fetchSuspensionStatus() {
  const { data } = await apiClient.get(SUSPENSIONS_PATH)
  return data ? toSuspensionStatus(data) : null
}

/**
 * 停止・再開の操作履歴を取得する（最新順はサーバが並べて返す）。
 *
 * ページャーを持つ表なので、配列ではなく `{ items, total }` を返す。
 * limit（1〜200）は呼び出し側が決める。件数はフロントが管理する（stores/incidents.js の
 * INCIDENT_HISTORY_PAGE_SIZE）。エンベロープの limit / offset は呼び出し側が知っているので運ばない。
 *
 * @param {{ limit?: number, offset?: number }} [params]
 * @returns {Promise<{ items: object[], total: number }>}
 */
export async function fetchSuspensionHistories({ limit, offset = 0 } = {}) {
  const { data } = await apiClient.get(`${SUSPENSIONS_PATH}/history`, {
    // 値が undefined のパラメータは axios が送らない
    params: { limit, offset },
  })
  return {
    items: (data?.histories ?? []).map(toSuspensionHistory),
    total: data?.total ?? 0,
  }
}

/**
 * 発注を停止する。
 *
 * 実行者 は送らない（未指定時は認証情報から解決される。apiClient が X-User-Code を載せている）。
 * 応答の target は**操作した 1 対象の操作後の状態**だけで、総合フラグも履歴も含まない。
 *
 * @param {{ target: string, reason: string, updatedAt: string|null }} params
 *   updatedAt は楽観的ロックの合札（取得時の 更新日時）。null なら照合されない
 */
export async function suspendOrders({ target, reason, updatedAt }) {
  const { data } = await apiClient.post(`${SUSPENSIONS_PATH}/suspend`, {
    停止対象: target,
    停止理由: reason,
    更新日時: updatedAt ?? null,
  })
  return toSuspensionAction(data)
}

/**
 * 発注を再開する。ResumeRequest に停止理由は無い（直前の停止理由はサーバが保持する）。
 * 実行者 を送らない理由と応答の中身は suspendOrders と同じ。
 *
 * @param {{ target: string, updatedAt: string|null }} params
 */
export async function resumeOrders({ target, updatedAt }) {
  const { data } = await apiClient.post(`${SUSPENSIONS_PATH}/resume`, {
    停止対象: target,
    更新日時: updatedAt ?? null,
  })
  return toSuspensionAction(data)
}

// バックエンドのキーは日本語。ここでだけ生の形を知る
function toSuspensionAction(raw) {
  return {
    success: raw?.success === true,
    target: raw?.target ? toSuspensionTarget(raw.target) : null,
    // 成功時の文言はサーバが決める（画面で組み立てない）
    message: raw?.message ?? '',
  }
}

function toSuspensionStatus(raw) {
  return {
    // いずれかの対象が停止中
    suspended: raw['発注停止中'] === true,
    // 全体（ALL）が停止中
    allSuspended: raw['全体停止中'] === true,
    suspendedTargets: raw['停止中の対象'] ?? [],
    // ALL が先頭（サーバが保証する並び）。並べ替えない
    targets: (raw.targets ?? []).map(toSuspensionTarget),
  }
}

function toSuspensionTarget(raw) {
  return {
    id: raw['ID'],
    target: raw['停止対象'],
    targetName: raw['停止対象名'] ?? '',
    // 発注停止フラグ（1 / 0）は同じことの別表現なので運ばない
    suspended: raw['発注停止中'] === true,
    // 再開後も直前の理由を保持する（通常運用の行にも残っている）
    reason: raw['停止理由'] ?? null,
    suspendedAt: raw['停止日時'] ?? null,
    suspendedBy: raw['停止者'] ?? null,
    resumedAt: raw['再開日時'] ?? null,
    resumedBy: raw['再開者'] ?? null,
    // 楽観的ロックの合札。停止・再開のときにそのまま送り返す
    updatedAt: raw['更新日時'] ?? null,
    updatedBy: raw['更新者'] ?? null,
  }
}

function toSuspensionHistory(raw) {
  return {
    id: raw['ID'],
    target: raw['停止対象'],
    targetName: raw['停止対象名'] ?? '',
    // SUSPEND:発注停止 / RESUME:発注再開
    operation: raw['操作区分'],
    operationName: raw['操作区分名'] ?? '',
    operator: raw['操作者'] ?? '',
    // 操作者の氏名は仕様に無い（docs/api/requests.md #48 で依頼中）。フィクスチャの契約提案を先に読む
    operatorName: raw['操作者名'] ?? '',
    /*
     * 停止理由は履歴の独立した項目に無く、変更後データ（object。中身のキーは description にだけある）
     * の中にしかない。読めなければ null に落とす
     */
    reason: raw['変更後データ']?.['停止理由'] ?? null,
    operatedAt: raw['操作日時'] ?? '',
  }
}
