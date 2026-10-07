import { activityLogTargets } from './activityLogTargets'
import { users } from './users'

/*
 * モックのレスポンス実体（GET /operations/activity-logs）。
 * ここに書くのは「バックエンドが返す生の形」（openapi.json の ActivityLogItem）であり、
 * アプリ内モデルではない。
 *
 * 操作者名 / 実行者区分 / 対象機能 / 操作内容 は画面モックが出していた項目で、2026-09-30 の取り込みで
 * 仕様に入った。区分 / 区分名 と対象種別 orders（注文の受付・訂正・取消）は 2026-10-06 の回答
 * （docs/api/requests.md #38）。画面モックにあった 結果 は「追加しない」回答（#1 ③）なので書かない。
 *
 * ページャーの動作確認には 1 ページ（50 件）を超えるデータが要るので、
 * 対象種別・操作区分を一通り含む 24 件に、古い日付の顧客マスタ更新を 40 件足して 64 件にしてある。
 * 業務操作（注文）・運用管理（発注停止 / お知らせ）の行は画面の「操作区分」の絞り込みと
 * バッジの色分けの確認用。
 *
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 */

/**
 * 操作者コード → 氏名・実行者区分（ロール名）。fixtures/users.js（m_操作者）から引く
 * （実 API も m_操作者 から解決する）。一括処理（操作者 null）は「システム」
 */
const OPERATORS = Object.fromEntries(
  users.map((user) => [user.操作者コード, { name: user.氏名, role: user.ロール名 }]),
)
// 操作者がマスタに無い行。実 API は 操作者名 を「システム」、実行者区分 を null で返す（2026-10-05 実測）
const SYSTEM_OPERATOR = { name: 'システム', role: null }

/** 操作内容の動詞（実 API の 操作内容 は「<対象機能>を<動詞>」。動詞は /codes の 操作区分 の名称） */
const OPERATION_VERBS = {
  CREATE: '登録',
  UPDATE: '更新',
  DELETE: '削除',
  BATCH: '一括処理',
  SUSPEND: '停止',
  RESUME: '再開',
  SHOW: '表示',
  HIDE: '非表示',
  VWAP_BULK: 'VWAP対象一括更新',
}

/**
 * 対象種別・操作区分を一通り含む 24 件。操作日時の降順。
 * before / after は変更前後のレコード（登録は before が、削除は after が無い）。
 * 注文（orders）の行は変更前後のレコードを持たず（両方 null）、変更の中身は text（操作内容）に入る。
 * 操作区分は 受付 → CREATE / 訂正 → UPDATE / 取消 → DELETE（#38 ①の回答）。
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
    // 業務操作（注文の訂正）。画面の「操作区分」で 業務操作 を選ぶと残る行
    type: 'orders',
    targetId: '101',
    targetKey: '101',
    operation: 'UPDATE',
    operator: '003',
    at: '2026-09-16T10:15:00',
    before: null,
    after: null,
    text: '注文訂正 注文ID 101 口座 1230001 AAPL 買 数量 100→80 指値 230.50→229.00',
  },
  {
    type: 'orders',
    targetId: '101',
    targetKey: '101',
    operation: 'CREATE',
    operator: '003',
    at: '2026-09-16T10:10:00',
    before: null,
    after: null,
    text: '注文受付 注文ID 101 口座 1230001 AAPL 買 100株 指値 230.50',
  },
  {
    // 運用管理（発注停止の再開）。画面の「操作区分」で 運用管理 を選ぶと残る行
    type: 'order-suspensions',
    targetId: '1',
    targetKey: 'ALL',
    operation: 'RESUME',
    operator: '006',
    at: '2026-09-16T09:50:00',
    before: { 停止対象: 'ALL', 発注停止フラグ: 1, 停止理由: 'IB 接続障害' },
    after: { 停止対象: 'ALL', 発注停止フラグ: 0, 停止理由: 'IB 接続障害' },
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
    type: 'order-suspensions',
    targetId: '1',
    targetKey: 'ALL',
    operation: 'SUSPEND',
    operator: '006',
    at: '2026-09-16T08:30:00',
    before: { 停止対象: 'ALL', 発注停止フラグ: 0, 停止理由: null },
    after: { 停止対象: 'ALL', 発注停止フラグ: 1, 停止理由: 'IB 接続障害' },
  },
  {
    type: 'announcements',
    targetId: '1',
    targetKey: '1',
    operation: 'HIDE',
    operator: '005',
    at: '2026-09-16T07:00:00',
    before: { ID: 1, 表示フラグ: 1, 本文: '9月15日 06:00〜07:00 に計画メンテナンスを行います。' },
    after: { ID: 1, 表示フラグ: 0, 本文: '9月15日 06:00〜07:00 に計画メンテナンスを行います。' },
  },
  {
    type: 'announcements',
    targetId: '1',
    targetKey: '1',
    operation: 'SHOW',
    operator: '005',
    at: '2026-09-15T18:00:00',
    before: { ID: 1, 表示フラグ: 0, 本文: '' },
    after: { ID: 1, 表示フラグ: 1, 本文: '9月15日 06:00〜07:00 に計画メンテナンスを行います。' },
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
    type: 'orders',
    targetId: '102',
    targetKey: '102',
    operation: 'DELETE',
    operator: '001',
    at: '2026-09-15T10:00:00',
    before: null,
    after: null,
    text: '注文取消 注文ID 102 口座 1230002 MSFT 売 20株 成行',
  },
  {
    // VWAP 対象の一括更新。1 件のレコードに紐づかないので対象ID / 対象キーを持たない
    type: 'symbols',
    targetId: null,
    targetKey: null,
    operation: 'VWAP_BULK',
    operator: '005',
    at: '2026-09-15T09:00:00',
    before: { VWAP対象区分: '0' },
    after: { VWAP対象区分: '1' },
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
  const target = activityLogTargets.find((item) => item.対象種別 === row.type)
  const typeName = target?.対象種別名
  const operator = OPERATORS[row.operator] ?? SYSTEM_OPERATOR
  const diff = toDiff(row.before, row.after)

  return {
    対象種別: row.type,
    対象種別名: typeName ?? row.type,
    区分: target?.区分 ?? 'master',
    区分名: target?.区分名 ?? 'マスタ更新',
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
    操作者名: operator.name,
    実行者区分: operator.role,
    対象機能: typeName ?? row.type,
    // 注文の行は注文イベントの内容文をそのまま返す（仕様の 操作内容 の説明）
    操作内容: row.text ?? `${typeName ?? row.type}を${OPERATION_VERBS[row.operation]}`,
  }
}

/** 操作ログの全行。操作日時の降順（実 API の既定 sort=desc と同じ） */
export const activityLogs = ALL_ROWS.map(toActivityLogItem)
