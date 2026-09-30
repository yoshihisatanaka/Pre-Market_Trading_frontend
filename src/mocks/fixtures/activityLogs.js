import { activityLogTargets } from './activityLogTargets'

/*
 * モックのレスポンス実体（GET /operations/activity-logs）。
 * ここに書くのは「バックエンドが返す生の形」（openapi.json の ActivityLogItem）であり、
 * アプリ内モデルではない。
 *
 * 各行の末尾 5 項目（操作者名 / 実行者区分 / 対象機能 / 操作内容 / 結果）は画面モックが出していた項目で、
 * **契約提案**としてここに書いた（docs/api/requests.md #1）。うち 4 項目は 2026-09-30 の取り込みで
 * 仕様に入り、**仕様に無いのは 結果 だけ**になった。src/api/activityLogs.js はまだどれも読まない
 * （画面にも出さない）。契約テスト（src/api/contract.spec.js）は KNOWN_GAPS で 結果 だけを
 * 許しているので、仕様に入った日に CON-07 が落ちて気づける。
 *
 * ページャーの動作確認には 1 ページ（50 件）を超えるデータが要るので、
 * 対象種別・操作区分を一通り含む 16 件に、古い日付の顧客マスタ更新を 40 件足して 56 件にしてある。
 *
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 */

/** 契約提案の操作者名・実行者区分。操作者コード → 表示名。一括処理（操作者 null）は「システム」 */
const OPERATORS = {
  '001': { name: '山田 太郎', role: 'IFA' },
  '002': { name: '鈴木 花子', role: 'IFA' },
  '003': { name: '佐藤 一郎', role: '営業員' },
  '005': { name: '高橋 管理', role: '管理者' },
  '006': { name: '伊藤 責任者', role: '管理責任者' },
}
const SYSTEM_OPERATOR = { name: 'システム', role: 'システム' }

/** 契約提案の操作内容の動詞 */
const OPERATION_VERBS = { CREATE: '登録', UPDATE: '更新', DELETE: '削除', BATCH: '一括取込' }

/**
 * 対象種別・操作区分を一通り含む 16 件。操作日時の降順。
 * before / after は変更前後のレコード（登録は before が、削除は after が無い）。
 */
const BASE_ROWS = [
  {
    type: 'symbols',
    targetId: 'AAPL',
    targetKey: 'AAPL',
    operation: 'UPDATE',
    operator: '005',
    at: '2026-09-16T10:40:00',
    before: { 銘柄コード: 'AAPL', 銘柄名: 'アップル', 規制区分: '0', 発注経路: '1' },
    after: { 銘柄コード: 'AAPL', 銘柄名: 'アップル', 規制区分: '1', 発注経路: '1' },
  },
  {
    type: 'customers',
    targetId: '1230001',
    targetKey: '1230001',
    operation: 'UPDATE',
    operator: '003',
    at: '2026-09-16T10:22:00',
    before: { 口座番号: '1230001', 顧客名: '山本 健一', 取引制限区分: '0' },
    after: { 口座番号: '1230001', 顧客名: '山本 健一', 取引制限区分: '1' },
  },
  {
    type: 'fx',
    targetId: '2026-09-16',
    targetKey: '2026-09-16',
    operation: 'BATCH',
    operator: null,
    at: '2026-09-16T09:05:00',
    before: { 適用日: '2026-09-16', 為替レート: 147.85 },
    after: { 適用日: '2026-09-16', 為替レート: 148.2 },
  },
  {
    type: 'balance_adjustments',
    targetId: '41',
    targetKey: '1230002',
    operation: 'CREATE',
    operator: '002',
    at: '2026-09-15T17:30:00',
    before: null,
    after: { 部店コード: '123', 口座番号: '1230002', 銘柄コード: 'MSFT', 残高: 35 },
  },
  {
    type: 'ca',
    targetId: '17',
    targetKey: 'NVDA',
    operation: 'UPDATE',
    operator: '005',
    at: '2026-09-15T16:10:00',
    before: { 銘柄コード: 'NVDA', CA区分: '110', 権利落日: '2026-10-01', 分割比率: '1:4' },
    after: { 銘柄コード: 'NVDA', CA区分: '110', 権利落日: '2026-10-08', 分割比率: '1:4' },
  },
  {
    type: 'symbols',
    targetId: 'PLTR',
    targetKey: 'PLTR',
    operation: 'CREATE',
    operator: '005',
    at: '2026-09-15T11:00:00',
    before: null,
    after: { 銘柄コード: 'PLTR', 銘柄名: 'パランティア', 規制区分: '0', 発注経路: '1' },
  },
  {
    type: 'customers',
    targetId: '1230009',
    targetKey: '1230009',
    operation: 'DELETE',
    operator: '006',
    at: '2026-09-14T15:45:00',
    before: { 口座番号: '1230009', 顧客名: '中村 美咲', 取引制限区分: '0' },
    after: null,
  },
  {
    type: 'market_holidays',
    targetId: '2026-11-26',
    targetKey: '2026-11-26',
    operation: 'CREATE',
    operator: '005',
    at: '2026-09-14T10:20:00',
    before: null,
    after: { 休場日: '2026-11-26', 休場理由: 'Thanksgiving Day', 休場区分: '0' },
  },
  {
    // 年次の一括登録。1 件のレコードに紐づかないので対象ID / 対象キーを持たない（'—' の表示確認用）
    type: 'market_holidays',
    targetId: null,
    targetKey: null,
    operation: 'BATCH',
    operator: null,
    at: '2026-09-12T09:00:00',
    before: null,
    after: { 休場日: '2027-01-01', 休場理由: "New Year's Day", 休場区分: '0' },
  },
  {
    type: 'balance_adjustments',
    targetId: '41',
    targetKey: '1230002',
    operation: 'UPDATE',
    operator: '002',
    at: '2026-09-11T14:30:00',
    before: { 部店コード: '123', 口座番号: '1230002', 銘柄コード: 'MSFT', 残高: 35 },
    after: { 部店コード: '123', 口座番号: '1230002', 銘柄コード: 'MSFT', 残高: 50 },
  },
  {
    type: 'symbols',
    targetId: 'TWTR',
    targetKey: 'TWTR',
    operation: 'DELETE',
    operator: '005',
    at: '2026-09-11T13:00:00',
    before: { 銘柄コード: 'TWTR', 銘柄名: 'ツイッター', 規制区分: '1', 発注経路: '1' },
    after: null,
  },
  {
    type: 'fx',
    targetId: '2026-09-10',
    targetKey: '2026-09-10',
    operation: 'BATCH',
    operator: null,
    at: '2026-09-10T09:05:00',
    before: { 適用日: '2026-09-10', 為替レート: 146.9 },
    after: { 適用日: '2026-09-10', 為替レート: 147.35 },
  },
  {
    type: 'customers',
    targetId: '1230010',
    targetKey: '1230010',
    operation: 'CREATE',
    operator: '001',
    at: '2026-09-09T18:00:00',
    before: null,
    after: { 口座番号: '1230010', 顧客名: '小林 直人', 取引制限区分: '0' },
  },
  {
    type: 'ca',
    targetId: '16',
    targetKey: 'AAPL',
    operation: 'CREATE',
    operator: '005',
    at: '2026-09-08T10:15:00',
    before: null,
    after: { 銘柄コード: 'AAPL', CA区分: '120', 権利落日: '2026-11-10', 分割比率: null },
  },
  {
    // 複数項目が同時に変わった行（差分の表が 2 行になることの確認用）
    type: 'customers',
    targetId: '1230003',
    targetKey: '1230003',
    operation: 'UPDATE',
    operator: '001',
    at: '2026-09-05T12:00:00',
    before: { 口座番号: '1230003', 顧客名: '加藤 陽子', 電話番号: '03-1111-2222', 住所: '東京都港区' },
    after: { 口座番号: '1230003', 顧客名: '加藤 陽子', 電話番号: '03-3333-4444', 住所: '東京都品川区' },
  },
  {
    type: 'fx',
    targetId: '2026-09-01',
    targetKey: '2026-09-01',
    operation: 'BATCH',
    operator: null,
    at: '2026-09-01T09:05:00',
    before: { 適用日: '2026-09-01', 為替レート: 145.5 },
    after: { 適用日: '2026-09-01', 為替レート: 146.1 },
  },
]

/* ページャーを動かすための水増し。2026-08-31 から 1 日ずつ遡って 40 件の顧客マスタ更新 */
const FILLER_OPERATORS = ['001', '002', '003']

const FILLER_ROWS = Array.from({ length: 40 }, (_, index) => {
  const accountNumber = String(1230100 + index)
  const date = new Date(Date.UTC(2026, 7, 31) - index * 24 * 60 * 60 * 1000)
  const record = { 口座番号: accountNumber, 顧客名: `顧客 ${index + 1}`, 取引制限区分: '0' }

  return {
    type: 'customers',
    targetId: accountNumber,
    targetKey: accountNumber,
    operation: 'UPDATE',
    operator: FILLER_OPERATORS[index % FILLER_OPERATORS.length],
    at: `${date.toISOString().slice(0, 10)}T09:30:00`,
    before: record,
    after: { ...record, 取引制限区分: '1' },
  }
})

const ALL_ROWS = [...BASE_ROWS, ...FILLER_ROWS]

/**
 * 履歴ID は履歴テーブルごとの連番（仕様: 履歴テーブル内の履歴ID）。対象種別ごとに古い行から 1, 2, … と振る。
 * 別の対象種別で同じ履歴ID が出るのが実 API と同じ形（一覧の行キーを 履歴ID だけにすると重複する）。
 */
const HISTORY_IDS = (() => {
  const counters = {}
  return [...ALL_ROWS]
    .reverse()
    .map((row) => {
      counters[row.type] = (counters[row.type] ?? 0) + 1
      return counters[row.type]
    })
    .reverse()
})()

/** 変更前後のレコードから、値が変わった項目の差分を作る（登録・削除は全項目が差分になる） */
function toDiff(before, after) {
  const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
  return Object.fromEntries(
    fields
      .filter((field) => before?.[field] !== after?.[field])
      .map((field) => [field, { before: before?.[field] ?? null, after: after?.[field] ?? null }]),
  )
}

function toActivityLogItem(row, index) {
  const typeName = activityLogTargets.find((target) => target.対象種別 === row.type)?.対象種別名
  const operator = OPERATORS[row.operator] ?? SYSTEM_OPERATOR
  const diff = toDiff(row.before, row.after)

  return {
    対象種別: row.type,
    対象種別名: typeName ?? row.type,
    履歴ID: HISTORY_IDS[index],
    対象ID: row.targetId,
    対象キー: row.targetKey,
    操作区分: row.operation,
    操作者: row.operator,
    操作日時: row.at,
    変更前データ: row.before,
    変更後データ: row.after,
    差分: diff,
    変更項目: Object.keys(diff),
    // ---- ここから下は契約提案（docs/api/requests.md #1）。2026-09-30 に 結果 以外は仕様に入った ----
    操作者名: operator.name,
    実行者区分: operator.role,
    対象機能: typeName ?? row.type,
    操作内容: `${typeName ?? row.type}を${OPERATION_VERBS[row.operation]}`,
    // 結果 だけはまだ仕様に無い
    結果: '成功',
  }
}

/** 操作ログの全行。操作日時の降順（実 API の既定 sort=desc と同じ） */
export const activityLogs = ALL_ROWS.map(toActivityLogItem)
