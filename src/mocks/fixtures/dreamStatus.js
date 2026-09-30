import { branches } from './codes'

/*
 * Dream登録状況（`/orders/dream-status`）のモックのレスポンス実体。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 * docs/api/openapi.json の DreamOrderItem / DreamStatusCodeItem に合わせてある
 * （プロパティ名は日本語、ID と口座番号と数量は integer、日時は ISO の文字列か null）。
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 *
 * コードと名前はバックエンドのコードマスタ（`app/config/codes.json`）と、
 * STS変更の遷移定義（`app/services/dream_status_service.py`）の写し:
 *   Dream状況  … 0 未登録 / 1 登録中 / 2 登録済 / 8 登録対象外 / 9 登録失敗 /
 *               C1 取消中 / C2 取消済 / C9 取消失敗（Dream取消状況が 0 以外なら取消フェーズを優先）
 *   STS変更    … 9 → 0 / 2 / 8、C9 → C0 / C2 だけ。それ以外の行は STS変更可 false・変更可能状況 []
 *   売買区分   … '1' 売 / '3' 買
 *
 * ページャーの動作確認には 1 ページ（50 件）を超えるデータが要る。
 * 画面で確かめたい状況を 1 件ずつ並べた 8 件（FEATURED。一覧の既定の並び＝作成日時の新しい順で
 * 1 ページ目の先頭に来る）に、48 件を機械生成して足して 56 件にしてある。
 * FEATURED の先頭 3 件は画面モック（dream_registration_status.html）のサンプル
 * （登録待ち / 登録済み / 登録エラー）と同じ顧客・銘柄・受付番号・エラー文言にしてある。
 */

/** Dream状況（統合コード）→ 名前 */
const STATUS_NAMES = {
  0: '未登録',
  1: '登録中',
  2: '登録済',
  8: '登録対象外',
  9: '登録失敗',
  C1: '取消中',
  C2: '取消済',
  C9: '取消失敗',
}

const REGISTRATION_NAMES = { 0: '未登録', 1: '登録中', 2: '登録済', 8: '登録対象外', 9: '登録失敗' }
const CANCEL_NAMES = { 0: '取消対象外', 1: '取消中', 2: '取消済', 9: '取消失敗' }

/**
 * STS変更で選べる遷移先（名前は画面のプルダウンにそのまま出る説明付きの文言）。
 * STS変更のハンドラも、遷移の可否と処理結果のメッセージにこれを使う。
 */
export const TRANSITIONS = {
  9: [
    { コード: '0', 名称: '未登録（Dream再送待ちへ戻す）' },
    { コード: '2', 名称: '登録済（Dream側で手入力済のため消し込む）' },
    { コード: '8', 名称: '登録対象外（Dream連携の対象から外す）' },
  ],
  C9: [
    { コード: 'C0', 名称: '取消対象（Dream取消の再送待ちへ戻す）' },
    { コード: 'C2', 名称: '取消済（Dream側で手入力済のため消し込む）' },
  ],
}

/** 処理状況（注文そのものの状態）。行の Dream状況 に見合うものを選んで持たせる */
const PROCESS_NAMES = {
  '000': '未発注',
  '003': '注文中',
  '011': '全部出来',
  '030': '未取消',
  '033': 'Dream取消中',
  '034': '取消済',
  101: 'Dream発注失敗',
  133: 'Dream取消失敗',
}

const SIDE_NAMES = { 1: '売', 3: '買' }

const SYMBOLS = {
  AAPL: { code: 'S001', name: 'アップル' },
  MSFT: { code: 'S002', name: 'マイクロソフト' },
  GOOGL: { code: 'S003', name: 'アルファベット' },
  AMZN: { code: 'S004', name: 'アマゾン' },
  NVDA: { code: 'S005', name: 'エヌビディア' },
  TSLA: { code: 'S006', name: 'テスラ' },
  META: { code: 'S007', name: 'メタ' },
  JPM: { code: 'S008', name: 'JPモルガン' },
}

const branchName = (code) => branches.find((branch) => branch.code === code)?.name ?? null

/**
 * 登録状況・取消状況・各日時・処理状況から、導出する項目（統合コード・名前・STS変更可・
 * 変更可能状況・完了日時）を埋め直した行を返す。規則はバックエンドの `enrich_dream_order` と同じ。
 * STS変更のハンドラも、状況を書き換えた行をこれに通す（導出を 2 か所に書かない）。
 */
export function withDerivedDreamFields(row) {
  const registration = row.Dream登録状況
  const cancel = row.Dream取消状況
  const status = cancel === '0' ? registration : `C${cancel}`

  return {
    ...row,
    Dream状況: status,
    Dream状況名: STATUS_NAMES[status],
    STS変更可: status in TRANSITIONS,
    変更可能状況: TRANSITIONS[status] ?? [],
    // 画面の「登録日時」列。取消フェーズなら取消日時、登録フェーズなら登録日時
    Dream完了日時: cancel === '0' ? row.Dream登録日時 : row.Dream取消日時,
    Dream登録状況名: REGISTRATION_NAMES[registration],
    Dream取消状況名: CANCEL_NAMES[cancel],
    処理状況名: PROCESS_NAMES[row.処理状況],
  }
}

/** 1 行を組み立てる。導出する項目は withDerivedDreamFields が埋める（手で書くと行ごとに食い違うため） */
function dreamOrder({
  id,
  registration,
  cancel = '0',
  receiptNumber = null,
  registeredAt = null,
  canceledAt = null,
  error = null,
  branch,
  account,
  customer,
  ticker,
  side,
  quantity,
  process,
  createdAt,
}) {
  const symbol = SYMBOLS[ticker]

  // キーの並びは DreamOrderItem の宣言順。導出する項目は位置だけ取っておき、下で埋める
  return withDerivedDreamFields({
    Dream状況: null,
    Dream状況名: null,
    STS変更可: null,
    変更可能状況: null,
    受注番号: receiptNumber,
    ID: id,
    部店: branch,
    部店名: branchName(branch),
    口座番号: account,
    顧客名: customer,
    銘柄コード: symbol.code,
    Ticker: ticker,
    売買区分: side,
    売買区分名: SIDE_NAMES[side],
    数量: quantity,
    Dream完了日時: null,
    Dreamエラー内容: error,
    Dream登録状況: registration,
    Dream登録状況名: null,
    Dream取消状況: cancel,
    Dream取消状況名: null,
    Dream登録日時: registeredAt,
    Dream取消日時: canceledAt,
    エラー内容: null,
    銘柄名: symbol.name,
    処理状況: process,
    処理状況名: null,
    作成日時: createdAt,
    更新日時: createdAt,
  })
}

/**
 * 画面で確かめたい状況を 1 件ずつ。作成日時がいちばん新しいので、一覧の 1 ページ目の先頭に並ぶ。
 *   - 登録失敗 / 取消失敗 … 状況にエラー内容のポップアップ、STS変更にプルダウン
 *   - 登録失敗で受注番号なし … 「登録済」へ変えるときに受付番号の入力を求める
 *   - それ以外 … STS変更は「変更不可」
 */
const FEATURED = [
  {
    id: 56,
    registration: '9',
    error: 'Dream登録エラー：口座区分を確認してください（DRM-2104）',
    branch: '123',
    account: 300001,
    customer: '川田 健太',
    ticker: 'META',
    side: '1',
    quantity: 100,
    process: '101',
    createdAt: '2026-09-28T13:00:00',
  },
  {
    id: 55,
    registration: '2',
    receiptNumber: 'DR-20260928-0002',
    registeredAt: '2026-09-28T12:02:14',
    branch: '123',
    account: 123456,
    customer: '証券 太郎',
    ticker: 'MSFT',
    side: '3',
    quantity: 50,
    process: '003',
    createdAt: '2026-09-28T11:45:00',
  },
  {
    id: 54,
    registration: '0',
    branch: '123',
    account: 123456,
    customer: '証券 太郎',
    ticker: 'AAPL',
    side: '1',
    quantity: 100,
    process: '000',
    createdAt: '2026-09-28T10:30:00',
  },
  {
    id: 53,
    registration: '2',
    cancel: '9',
    receiptNumber: 'DR-20260927-0014',
    registeredAt: '2026-09-27T20:03:41',
    error: 'Dream取消エラー：対象の受注が見つかりません（DRM-3102）',
    branch: '234',
    account: 200001,
    customer: '加藤 誠',
    ticker: 'NVDA',
    side: '3',
    quantity: 25,
    process: '133',
    createdAt: '2026-09-28T10:12:00',
  },
  {
    id: 52,
    registration: '1',
    branch: '345',
    account: 300003,
    customer: '木村 浩二',
    ticker: 'AMZN',
    side: '3',
    quantity: 40,
    process: '000',
    createdAt: '2026-09-28T09:58:00',
  },
  {
    id: 51,
    registration: '8',
    branch: '456',
    account: 400002,
    customer: '森 由美',
    ticker: 'TSLA',
    side: '1',
    quantity: 10,
    process: '003',
    createdAt: '2026-09-28T09:41:00',
  },
  {
    id: 50,
    registration: '2',
    cancel: '1',
    receiptNumber: 'DR-20260927-0011',
    registeredAt: '2026-09-27T20:03:12',
    branch: '234',
    account: 200001,
    customer: '加藤 誠',
    ticker: 'GOOGL',
    side: '3',
    quantity: 30,
    process: '033',
    createdAt: '2026-09-28T09:30:00',
  },
  {
    id: 49,
    registration: '2',
    cancel: '2',
    receiptNumber: 'DR-20260927-0008',
    registeredAt: '2026-09-27T20:02:55',
    canceledAt: '2026-09-28T09:25:03',
    branch: '123',
    account: 300001,
    customer: '川田 健太',
    ticker: 'JPM',
    side: '1',
    quantity: 60,
    process: '034',
    createdAt: '2026-09-28T09:05:00',
  },
]

/** 機械生成する行の顧客（部店・口座番号・顧客名の組） */
const CUSTOMERS = [
  { branch: '123', account: 123456, customer: '証券 太郎' },
  { branch: '123', account: 300001, customer: '川田 健太' },
  { branch: '234', account: 200001, customer: '加藤 誠' },
  { branch: '345', account: 300003, customer: '木村 浩二' },
  { branch: '456', account: 400002, customer: '森 由美' },
  { branch: '234', account: 200007, customer: '石井 美咲' },
]

const TICKERS = Object.keys(SYMBOLS)

/**
 * 機械生成の 48 件（ID 1〜48）。前営業日までの注文で、大半は登録済み。
 * 6 件に 1 件は取消済みにし、1 件だけ 2 ページ目に登録失敗を混ぜる（ID 3）。
 */
const GENERATED = Array.from({ length: 48 }, (_, index) => {
  const id = index + 1
  const who = CUSTOMERS[index % CUSTOMERS.length]
  // 9/14 から 9/25 まで、1 日 4 件ずつ
  const day = String(14 + Math.floor(index / 4)).padStart(2, '0')
  const hour = String(9 + (index % 4) * 2).padStart(2, '0')
  const createdAt = `2026-09-${day}T${hour}:15:00`
  const registeredAt = `2026-09-${day}T20:0${index % 10}:00`
  const receiptNumber = `DR-202609${day}-${String(id).padStart(4, '0')}`
  const base = {
    id,
    ...who,
    ticker: TICKERS[index % TICKERS.length],
    side: index % 3 === 0 ? '1' : '3',
    quantity: 10 * ((index % 9) + 1),
    createdAt,
  }

  if (id === 3) {
    return dreamOrder({
      ...base,
      registration: '9',
      error: 'Dream登録エラー：部店コードが Dream に存在しません（DRM-1001）',
      process: '101',
    })
  }
  if (id % 6 === 0) {
    return dreamOrder({
      ...base,
      registration: '2',
      cancel: '2',
      receiptNumber,
      registeredAt,
      canceledAt: `2026-09-${day}T20:3${index % 10}:00`,
      process: '034',
    })
  }
  return dreamOrder({ ...base, registration: '2', receiptNumber, registeredAt, process: '011' })
})

/** 一覧の行（DreamOrderItem）。並びは ID の昇順（一覧の並べ替えはハンドラが行う） */
export const dreamOrders = [...GENERATED, ...[...FEATURED].reverse().map(dreamOrder)]

/**
 * 検索のプルダウン（DreamStatusCodeItem）。実 API はコードマスタの `Dream状況` の並びに、
 * 登録失敗・取消失敗をまとめて絞る擬似コード ERROR を末尾に足して返す。
 */
export const dreamStatusCodes = [
  ...Object.entries(STATUS_NAMES).map(([code, name]) => ({
    コード: code,
    名称: name,
    区分: code.startsWith('C') ? '取消' : '登録',
  })),
  { コード: 'ERROR', 名称: 'エラー（登録失敗・取消失敗）', 区分: '絞込' },
]
