/*
 * モックのレスポンス実体。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 *
 * ただし他のフィクスチャと違い、**これは実 API の形ではない**。
 * docs/api/openapi.json の `GET /operations/activity-logs` が返す ActivityLogItem が持つのは
 * 対象種別 / 対象種別名 / 履歴ID / 対象ID / 対象キー / 操作区分(CREATE,UPDATE,DELETE,BATCH) /
 * 操作者(コードのみ) / 操作日時 / 変更前データ / 変更後データ / 差分 / 変更項目 だけで、
 * 画面モックが出している 操作区分（業務操作 等）・操作者名・実行者区分・対象機能・操作内容・
 * 内容・結果 に当たる項目が無い。
 *
 * 今回は画面モック
 * （https://uspreorder-vmbhej3k.manus.space/operations/activity-logs）の見た目を正として
 * 実装しているので、ここはそのモックが描いている内容から起こした**暫定の契約**。
 * 実 API と繋ぎ込むときは、この形と src/api/activityLogs.js の変換を仕様側と決め直す。
 *
 * ページャーの動作確認には 1 ページ（50 件）を超えるデータが要るので、
 * モックから採った 19 件に古い日付の注文受付を 37 件足して 56 件にしてある。
 *
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 */

/**
 * 実行者区分（実体）と検索条件の実行者区分（sales / management）の対応。
 *
 * 検索セレクトの value は 2 つだが、行が持つ役割は 5 つあるので 1 対 1 にならない。
 * 「システム」はどちらにも属さない（sales でも management でも絞り込まれない）。
 * モックのサーバ側の都合なので、この対応表はフロントの utils ではなくモック側に置く。
 */
export const ACTOR_GROUP_ROLES = {
  sales: ['営業員', 'IFA'],
  management: ['管理者', '管理責任者'],
}

/**
 * 画面モックの 18 行そのまま ＋ 結果=失敗 の 1 行。操作日時の降順。
 * 失敗の行はモックに 1 件も無いが、赤いバッジを実物で確認できないと出し分けを検証できないので
 * 先頭に 1 件だけ足してある（モック由来ではない唯一の行）。
 */
const MOCK_ROWS = [
  {
    at: '2026-09-16T10:40:00',
    category: '業務操作',
    actorName: '佐藤 一郎',
    actorRole: '営業員',
    actorCode: '003',
    feature: '注文',
    action: '注文受付',
    targetLabel: '注文 #29：AMZN／300002',
    targetKey: '注文#29',
    after: '買 500株／成行',
    note: '買付余力が不足しています',
    result: '失敗',
  },
  {
    at: '2026-09-16T10:35:00',
    category: '業務操作',
    actorName: '佐藤 一郎',
    actorRole: '営業員',
    actorCode: '003',
    feature: '注文',
    action: '注文受付',
    targetLabel: '注文 #28：TSLA／300002',
    targetKey: '注文#28',
    after: '売 12株／指値',
    note: '売 12株／指値',
  },
  {
    at: '2026-09-16T10:22:00',
    category: '業務操作',
    actorName: '鈴木 花子',
    actorRole: 'IFA',
    actorCode: '002',
    feature: '注文',
    action: '注文受付',
    targetLabel: '注文 #27：MSFT／200001',
    targetKey: '注文#27',
    after: '買 35株／成行',
    note: '買 35株／成行',
  },
  {
    at: '2026-09-16T10:10:00',
    category: '業務操作',
    actorName: '山田 太郎',
    actorRole: 'IFA',
    actorCode: '001',
    feature: '注文',
    action: '注文受付',
    targetLabel: '注文 #26：AAPL／300001',
    targetKey: '注文#26',
    after: '売 20株／指値',
    note: '売 20株／指値',
  },
  {
    at: '2026-09-16T09:45:00',
    category: '業務操作',
    actorName: '佐藤 一郎',
    actorRole: '営業員',
    actorCode: '003',
    feature: '注文',
    action: '注文受付',
    targetLabel: '注文 #25：GOOGL／300002',
    targetKey: '注文#25',
    after: '買 15株／指値',
    note: '買 15株／指値',
  },
  {
    at: '2026-09-16T09:35:00',
    category: '業務操作',
    actorName: '鈴木 花子',
    actorRole: 'IFA',
    actorCode: '002',
    feature: '注文',
    action: '注文受付',
    targetLabel: '注文 #24：NVDA／200001',
    targetKey: '注文#24',
    after: '売 30株／指値',
    note: '売 30株／指値',
  },
  {
    at: '2026-09-08T10:10:00',
    category: '業務操作',
    actorName: '伊藤 責任者',
    actorRole: '管理責任者',
    actorCode: '006',
    feature: '注文',
    action: '注文受付',
    targetLabel: '注文 #1001：AAPL／123456',
    targetKey: '注文#1001',
    after: '買 10,000株／成行／自動分割 3件',
    note: '買 10,000株／成行／自動分割 3件',
  },
  {
    at: '2026-09-04T09:45:00',
    category: '業務操作',
    actorName: '佐藤 一郎',
    actorRole: '営業員',
    actorCode: '003',
    feature: '注文',
    action: '注文受付',
    targetLabel: '注文 #6：AMZN／300003',
    targetKey: '注文#6',
    after: '買 40株／指値',
    note: '買 40株／指値',
  },
  {
    at: '2026-08-27T09:10:00',
    category: 'マスタ更新',
    actorName: '高橋 管理',
    actorRole: '管理者',
    actorCode: '005',
    feature: '残高マスタ',
    action: '残高マスタ',
    targetLabel: '中村 凪／MSFT',
    targetKey: '123-123456／MSFT',
    // 変更前がある唯一の行。ここだけ「変更前 → 変更後」の両方が埋まる
    before: '保有数量：80株',
    after: '保有数量：100株',
    note: '既存銘柄に加算：加算 20株',
    targetCount: 1,
  },
  ...[
    { date: '2026-07-31', time: '09:00:00', rate: '150.25' },
    { date: '2026-07-30', time: '09:05:00', rate: '149.90' },
    { date: '2026-07-29', time: '09:02:00', rate: '151.10' },
    { date: '2026-07-28', time: '09:00:00', rate: '148.75' },
    { date: '2026-07-25', time: '09:01:00', rate: '149.30' },
  ].map(({ date, time, rate }) => ({
    at: `${date}T${time}`,
    category: 'マスタ更新',
    // 取込バッチなので操作者コードを持たない（副行は「システム」だけになる）
    actorName: 'システム取込',
    actorRole: 'システム',
    actorCode: '',
    feature: '為替マスタ',
    action: '為替レートを更新',
    targetLabel: '為替マスタ：USD/JPY',
    targetKey: 'USD/JPY',
    after: rate,
    note: `適用日 ${date}／${rate}`,
  })),
  {
    at: '2026-07-14T09:15:00',
    category: '業務操作',
    actorName: 'システム',
    actorRole: 'システム',
    actorCode: '222',
    feature: '注文',
    action: '注文受付',
    targetLabel: '注文 #5：NVDA／300001',
    targetKey: '注文#5',
    after: '買 25株／指値',
    note: '買 25株／指値',
  },
  {
    at: '2026-07-13T13:00:00',
    category: '業務操作',
    actorName: 'システム',
    actorRole: 'システム',
    actorCode: '222',
    feature: '注文',
    action: '注文受付',
    targetLabel: '注文 #3：META／300001',
    targetKey: '注文#3',
    after: '売 100株／成行',
    note: '売 100株／成行',
  },
  {
    at: '2026-07-13T11:45:00',
    category: '業務操作',
    actorName: 'システム',
    actorRole: 'システム',
    actorCode: '111',
    feature: '注文',
    action: '注文受付',
    targetLabel: '注文 #2：MSFT／123456',
    targetKey: '注文#2',
    after: '買 50株／指値',
    note: '買 50株／指値',
  },
  {
    at: '2026-07-13T10:42:00',
    category: '業務操作',
    actorName: 'システム',
    actorRole: 'システム',
    actorCode: '111',
    feature: '注文',
    // 操作内容の絞り込みを検証できるよう、注文訂正はモックと同じく 1 件だけ
    action: '注文訂正',
    targetLabel: '注文 #4：AAPL／123456',
    targetKey: '注文#4',
    after: '売 90株／指値',
    note: '売 90株／指値',
  },
  {
    at: '2026-07-13T10:30:00',
    category: '業務操作',
    actorName: 'システム',
    actorRole: 'システム',
    actorCode: '111',
    feature: '注文',
    action: '注文受付',
    targetLabel: '注文 #1：AAPL／123456',
    targetKey: '注文#1',
    after: '売 100株／指値',
    note: '売 100株／指値',
  },
]

/* ページャーを動かすための水増し。2026-07-10 から 1 日ずつ遡って 37 件 */
const FILLER_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META', 'GOOGL']
const FILLER_ACTORS = [
  { actorName: '山田 太郎', actorRole: 'IFA', actorCode: '001' },
  { actorName: '鈴木 花子', actorRole: 'IFA', actorCode: '002' },
  { actorName: '佐藤 一郎', actorRole: '営業員', actorCode: '003' },
]

const FILLER_ROWS = Array.from({ length: 37 }, (_, index) => {
  const symbol = FILLER_SYMBOLS[index % FILLER_SYMBOLS.length]
  const actor = FILLER_ACTORS[index % FILLER_ACTORS.length]
  const orderNumber = 900 - index
  const date = new Date(Date.UTC(2026, 6, 10) - index * 24 * 60 * 60 * 1000)

  return {
    at: `${date.toISOString().slice(0, 10)}T09:30:00`,
    category: '業務操作',
    ...actor,
    feature: '注文',
    action: '注文受付',
    targetLabel: `注文 #${orderNumber}：${symbol}／30000${(index % 3) + 1}`,
    targetKey: `注文#${orderNumber}`,
    after: `買 ${(index % 9) + 1}0株／指値`,
    note: `買 ${(index % 9) + 1}0株／指値`,
  }
})

const ALL_ROWS = [...MOCK_ROWS, ...FILLER_ROWS]

function toActivityLogItem(row, index) {
  return {
    // 新しい行ほど大きい ID になるよう、降順の並びから振る
    履歴ID: ALL_ROWS.length - index,
    操作日時: row.at,
    操作区分: row.category,
    操作者コード: row.actorCode ?? '',
    操作者名: row.actorName,
    実行者区分: row.actorRole,
    対象機能: row.feature,
    操作内容: row.action,
    対象表示名: row.targetLabel,
    対象キー: row.targetKey,
    変更前: row.before ?? null,
    変更後: row.after ?? null,
    内容: row.note ?? null,
    対象件数: row.targetCount ?? null,
    結果: row.result ?? '成功',
  }
}

/** 操作ログの全行。操作日時の降順（実 API の既定 sort=desc と同じ） */
export const activityLogs = ALL_ROWS.map(toActivityLogItem)
