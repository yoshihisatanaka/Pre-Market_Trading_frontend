import { apiClient } from './client'

/*
 * 障害管理（IB送信制御 / 注文入力制御）。
 *
 * ⚠ このファイルの API 仕様はすべて仮置き。docs/api/openapi.json（2026-09-16 取り込み）の
 *   /operations 配下は activity-logs と activity-logs/targets の 2 本だけで、
 *   障害管理・発注停止のエンドポイントは **1 本も定義されていない**。
 *   形は既存の運用系 1 本（ActivityLogListResponse）の作法を借りた暫定で、
 *   エンベロープは英語 snake_case・明細の項目キーは日本語・区分は「コード + 〜名」の対にしてある。
 *   確定したらこのファイルと src/mocks/ の該当ハンドラだけを直す（stores / views は変えなくてよい）。
 *
 * バックエンドへの確認事項（未回答）:
 *   1. パスは /operations/incidents でよいか。運用状態と履歴を分けるか、1 本にまとめるか
 *   2. 「運用状態」（IB送信制御と注文入力制御を束ねた総合状態）はサーバが返すか、フロントが合成するか
 *      → いまはサーバが返す前提。「IB送信だけ制御中を何と呼ぶか」は業務判断なので、
 *        フロントで合成すると推測が src/utils/ に焼き付く
 *   3. 障害対応履歴は専用テーブルか、/operations/activity-logs への相乗りか
 *      （相乗りなら対象種別コードは何か。/operations/activity-logs/targets に現状は無い）
 *   4. 状態遷移（制御の実行・解除）の POST / PUT のパスと本文、および権限（誰が押せるか）
 *   5. 区分値は文字列コード + 「〜名」の対でよいか（マスタ系の 休場区分 と同じ作法を仮定した）
 */

/** 仮置きのパス。確定時の差分をここ 1 行に閉じ込める */
const INCIDENTS_PATH = '/operations/incidents'

/**
 * 現在の運用状態を取得する。
 *
 * 本文なしで来たら null を返す。画面はこれを「空」として 4 状態のひとつに出す
 * （fetchHardLimits と同じ防御。仮置きの相手はモックだけなので、防御はこの 1 点に絞る）。
 *
 * @returns {Promise<{ operationState: string, operationStateName: string,
 *   ibSendControl: string, ibSendControlName: string,
 *   orderEntryControl: string, orderEntryControlName: string,
 *   updatedAt: string|null, updatedBy: string|null } | null>}
 */
export async function fetchIncidentStatus() {
  const { data } = await apiClient.get(INCIDENTS_PATH)
  return data ? toIncidentStatus(data) : null
}

/**
 * 障害対応履歴を取得する。新しい順はサーバが並べて返す前提。
 *
 * この画面はページングしないので、エンベロープの total / limit / offset は捨てて配列だけ返す
 * （使わない値を運ぶと、使っていないものをテストで守る羽目になる）。
 *
 * @returns {Promise<Array<{ id: number, changedAt: string,
 *   stateBefore: string, stateBeforeName: string,
 *   stateAfter: string, stateAfterName: string,
 *   description: string, updatedBy: string|null }>>}
 */
export async function fetchIncidentHistories() {
  const { data } = await apiClient.get(`${INCIDENTS_PATH}/histories`)
  return (data?.histories ?? []).map(toIncidentHistory)
}

// バックエンドのキーは日本語。ここでだけ生の形を知る
function toIncidentStatus(raw) {
  return {
    // 0: 通常運用 / 1: 一部制御中 / 2: 停止中。見た目（色）の判定はコードで行う
    operationState: raw['運用状態'] ?? '',
    // 画面に出す文言はサーバの値をそのまま使う（呼称を frontend で決めない）
    operationStateName: raw['運用状態名'] ?? '',
    // 各制御は 0: 通常 / 1: 制御中
    ibSendControl: raw['IB送信制御'] ?? '',
    ibSendControlName: raw['IB送信制御名'] ?? '',
    orderEntryControl: raw['注文入力制御'] ?? '',
    orderEntryControlName: raw['注文入力制御名'] ?? '',
    updatedAt: raw['更新日時'] ?? null,
    updatedBy: raw['更新者'] ?? null,
  }
}

function toIncidentHistory(raw) {
  return {
    id: raw['ID'],
    changedAt: raw['変更日時'] ?? '',
    stateBefore: raw['変更前状態'] ?? '',
    stateBeforeName: raw['変更前状態名'] ?? '',
    stateAfter: raw['変更後状態'] ?? '',
    stateAfterName: raw['変更後状態名'] ?? '',
    description: raw['対応内容'] ?? '',
    updatedBy: raw['更新者'] ?? null,
  }
}
