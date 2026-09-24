import { apiClient } from './client'

/**
 * 操作ログ（GET /operations/activity-logs）と、その対象種別（GET /operations/activity-logs/targets）。
 *
 * **バックエンドのレスポンス形（日本語キー）を知ってよいのはこの層だけ。**
 * ここで camelCase のアプリ内モデルに変換してから外へ返す。
 *
 * 形は docs/api/openapi.json の ActivityLogItem / ActivityLogTargetItem を正とする。
 * 実 API の操作ログは「各マスタの履歴テーブルを UNION ALL で横断したもの」で、1 行が 1 回の
 * 登録・更新・削除・一括処理にあたる。変更前後のレコード JSON と項目別の差分を持つ。
 *
 * 画面モック（https://uspreorder-vmbhej3k.manus.space/operations/activity-logs）にある
 * 操作者名 / 実行者区分 / 対象機能 / 操作内容 / 結果 は仕様に無いので、ここでは扱わない。
 * 項目の追加はバックエンドに依頼中で（docs/api/requests.md #1）、提案する形は
 * src/mocks/fixtures/activityLogs.js に書いてある。仕様に入ったらここの変換に足す。
 */

/**
 * @typedef {object} ActivityLogTarget 操作ログの対象種別 1 件（アプリ内モデル）
 * @property {string} code 対象種別コード（customers / symbols …）。target_types に載せる値
 * @property {string} name 対象種別名（顧客マスタ …）。画面の表示用
 * @property {string} keyLabel 対象キーの項目名（口座番号 / 銘柄コード …）
 * @property {string} historyTable 参照元の履歴テーブル名
 */

/**
 * @typedef {object} ActivityLogDiff 項目別の差分 1 件
 * @property {string} field 項目名
 * @property {*} before 変更前の値。登録の行では null
 * @property {*} after 変更後の値。削除の行では null
 */

/**
 * @typedef {object} ActivityLog 操作ログ 1 件（アプリ内モデル）
 * @property {string} id 一覧の行キー。`対象種別:履歴ID`
 *   （履歴ID は履歴テーブルごとの連番なので、横断した一覧では単独で一意にならない）
 * @property {number} historyId 履歴ID（履歴テーブル内の ID）
 * @property {string} targetType 対象種別コード
 * @property {string} targetTypeName 対象種別名
 * @property {string} targetId 各マスタの個別履歴 API に渡すキー。無い行は空文字
 * @property {string} targetKey 対象レコードの識別キー（画面表示用）。無い行は空文字
 * @property {string} operation 操作区分（CREATE / UPDATE / DELETE / BATCH）
 * @property {string} operator 操作者コード。一括処理など、持たない行は空文字
 * @property {string} at 操作日時（ISO8601）。整形は utils/activityLogTypes.js の formatActivityAt
 * @property {Record<string, *>|null} before 変更前のレコード。登録の行では null
 * @property {Record<string, *>|null} after 変更後のレコード。削除の行では null
 * @property {ActivityLogDiff[]} diff 項目別の差分。仕様の順（変更項目の順）のまま
 * @property {string[]} changedFields 変更された項目名
 */

/**
 * 操作ログの対象種別を取得する（検索の「対象種別」プルダウン用）。
 *
 * @returns {Promise<ActivityLogTarget[]>} 仕様の並びのまま
 */
export async function fetchActivityLogTargets() {
  const { data } = await apiClient.get('/operations/activity-logs/targets')
  return (data?.targets ?? []).map(toActivityLogTarget)
}

/** ActivityLogTargetItem → ActivityLogTarget */
function toActivityLogTarget(raw) {
  return {
    code: raw?.対象種別 ?? '',
    name: raw?.対象種別名 ?? '',
    keyLabel: raw?.対象キー項目 ?? '',
    historyTable: raw?.履歴テーブル ?? '',
  }
}

/**
 * 操作ログを検索する。
 *
 * @param {object} [params]
 * @param {number} [params.limit] 取得件数（仕様は 1〜200）
 * @param {number} [params.offset] 取得開始位置
 * @param {string} [params.dateFrom] 期間（From）。YYYY-MM-DD
 * @param {string} [params.dateTo] 期間（To）。YYYY-MM-DD
 * @param {string} [params.operator] 操作者コード（完全一致）
 * @param {string} [params.operation] 操作区分（CREATE / UPDATE / DELETE / BATCH）
 * @param {string} [params.targetType] 対象種別コード。画面は 1 つだけ選ぶ
 * @param {string} [params.targetKey] 対象キー（部分一致）
 * @param {string} [params.sort] 操作日時の並び順（asc / desc）。空なら送らず、実 API の既定（desc）に任せる
 * @returns {Promise<{ items: ActivityLog[], total: number }>}
 */
export async function fetchActivityLogs({
  limit = 50,
  offset = 0,
  dateFrom = '',
  dateTo = '',
  operator = '',
  operation = '',
  targetType = '',
  targetKey = '',
  sort = '',
} = {}) {
  const { data } = await apiClient.get('/operations/activity-logs', {
    // クエリ名を知ってよいのはこの層だけ。値が undefined のパラメータは axios が送らない
    params: {
      limit,
      offset,
      start_date: dateFrom || undefined,
      end_date: dateTo || undefined,
      operator: operator || undefined,
      operation: operation || undefined,
      // 仕様はカンマ区切りで複数を受けるが、画面の選択は 1 つなのでそのまま載せる
      target_types: targetType || undefined,
      target_key: targetKey || undefined,
      sort: sort || undefined,
    },
  })

  return {
    items: (data?.activity_logs ?? []).map(toActivityLog),
    total: data?.total ?? 0,
  }
}

/** ActivityLogItem → ActivityLog */
function toActivityLog(raw) {
  const targetType = raw?.対象種別 ?? ''
  const historyId = raw?.履歴ID ?? 0

  return {
    id: `${targetType}:${historyId}`,
    historyId,
    targetType,
    targetTypeName: raw?.対象種別名 ?? '',
    // nullable な文字列は空文字に寄せる（画面が null と '' を区別しなくてよいように）
    targetId: raw?.対象ID ?? '',
    targetKey: raw?.対象キー ?? '',
    operation: raw?.操作区分 ?? '',
    operator: raw?.操作者 ?? '',
    at: raw?.操作日時 ?? '',
    // レコードは「無い」（登録前・削除後）と「空」が別物なので null を潰さない
    before: raw?.変更前データ ?? null,
    after: raw?.変更後データ ?? null,
    diff: toDiff(raw?.差分),
    changedFields: Array.isArray(raw?.変更項目) ? raw.変更項目 : [],
  }
}

/** 差分 `{ 項目名: { before, after } }` → ActivityLogDiff[] */
function toDiff(raw) {
  return Object.entries(raw ?? {}).map(([field, change]) => ({
    field,
    before: change?.before ?? null,
    after: change?.after ?? null,
  }))
}
