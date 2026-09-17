import { apiClient } from './client'

/**
 * 操作ログ（GET /operations/activity-logs）。
 *
 * **バックエンドのレスポンス形（日本語キー）を知ってよいのはこの層だけ。**
 * ここで camelCase のアプリ内モデルに変換してから外へ返す。
 *
 * この画面は画面モック
 * （https://uspreorder-vmbhej3k.manus.space/operations/activity-logs）の見た目を正として
 * 実装しており、**いま変換している形は実 API の形ではない**。
 * docs/api/openapi.json の ActivityLogItem が持つのは
 * 対象種別 / 対象種別名 / 履歴ID / 対象ID / 対象キー / 操作区分(CREATE,UPDATE,DELETE,BATCH) /
 * 操作者(コードのみ) / 操作日時 / 変更前データ / 変更後データ / 差分 / 変更項目 だけで、
 * モックが出している 操作区分（業務操作 等）・操作者名・実行者区分・対象機能・操作内容・
 * 内容・結果 に当たる項目は無い。いまは src/mocks/handlers/index.js のモックが応えている。
 *
 * **実 API と繋ぎ込むときは、列とクエリの対応を仕様側と決め直すこと。**
 * 送るクエリのうち実 API と対応が付くのは date_from / date_to / operator / target_key の 4 つだけで、
 * 残りの 5 つ（category / feature / action / actor_group / result）はモック専用。
 */

/**
 * @typedef {object} ActivityLog 操作ログ 1 件（アプリ内モデル）
 * @property {number} id 履歴ID。一覧の行キー
 * @property {string} at 操作日時（ISO8601）。整形は utils/activityLogTypes.js の formatActivityAt
 * @property {string} category 操作区分（業務操作 / マスタ更新 / 運用管理）
 * @property {string} actorCode 操作者コード。取込バッチなど、持たない行は空文字
 * @property {string} actorName 操作者名
 * @property {string} actorRole 実行者区分（営業員 / IFA / 管理者 / 管理責任者 / システム）
 * @property {string} feature 対象機能（注文 / 残高マスタ / 為替マスタ）
 * @property {string} action 操作内容（注文受付 / 注文訂正 / 為替レートを更新 …）
 * @property {string} targetLabel 対象の表示名（注文 #28：TSLA／300002）
 * @property {string} targetKey 対象のキー（注文#28）
 * @property {string} before 変更前。無い場合は空文字（画面は '—' を出す）
 * @property {string} after 変更後。無い場合は空文字
 * @property {string} note 内容・理由
 * @property {number|null} targetCount 対象件数。無い行は null のまま
 * @property {string} result 結果（成功 / 失敗）
 */

/**
 * 操作ログを検索する。
 *
 * @param {object} [params]
 * @param {number} [params.limit] 取得件数
 * @param {number} [params.offset] 取得開始位置
 * @param {string} [params.dateFrom] 期間（From）。YYYY-MM-DD
 * @param {string} [params.dateTo] 期間（To）。YYYY-MM-DD
 * @param {string} [params.actorCode] 操作者コード
 * @param {string} [params.category] 操作区分
 * @param {string} [params.feature] 対象機能
 * @param {string} [params.action] 操作内容
 * @param {string} [params.actorGroup] 実行者区分（sales / management）
 * @param {string} [params.result] 結果
 * @param {string} [params.keyword] 対象ID・名称（部分一致）
 * @returns {Promise<{ items: ActivityLog[], total: number }>} 操作日時の降順
 */
export async function fetchActivityLogs({
  limit = 50,
  offset = 0,
  dateFrom = '',
  dateTo = '',
  actorCode = '',
  category = '',
  feature = '',
  action = '',
  actorGroup = '',
  result = '',
  keyword = '',
} = {}) {
  const { data } = await apiClient.get('/operations/activity-logs', {
    // クエリ名を知ってよいのはこの層だけ。値が undefined のパラメータは axios が送らない
    params: {
      limit,
      offset,
      // 実 API（openapi.json）と対応が付くのはここまでの 4 つ
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      operator: actorCode || undefined,
      target_key: keyword || undefined,
      // 以下はモック専用。実 API には対応するクエリが無い
      category: category || undefined,
      feature: feature || undefined,
      action: action || undefined,
      actor_group: actorGroup || undefined,
      result: result || undefined,
    },
  })

  return {
    items: (data.activity_logs ?? []).map(toActivityLog),
    total: data.total ?? 0,
  }
}

/** レスポンスの 1 件 → ActivityLog */
function toActivityLog(raw) {
  return {
    id: raw?.履歴ID ?? 0,
    at: raw?.操作日時 ?? '',
    category: raw?.操作区分 ?? '',
    actorCode: raw?.操作者コード ?? '',
    actorName: raw?.操作者名 ?? '',
    actorRole: raw?.実行者区分 ?? '',
    feature: raw?.対象機能 ?? '',
    action: raw?.操作内容 ?? '',
    targetLabel: raw?.対象表示名 ?? '',
    targetKey: raw?.対象キー ?? '',
    // nullable な文字列は空文字に寄せる（画面が null と '' を区別しなくてよいように）
    before: raw?.変更前 ?? '',
    after: raw?.変更後 ?? '',
    note: raw?.内容 ?? '',
    // 件数は「無い」と「0 件」が別物なので null を潰さない
    targetCount: raw?.対象件数 ?? null,
    result: raw?.結果 ?? '',
  }
}
