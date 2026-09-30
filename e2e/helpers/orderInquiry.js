/**
 * 注文照会（/orders/inquiry）と、そこから入る訂正・取消の E2E で共用する道具。
 *
 * 期待値はフィクスチャ（src/mocks/fixtures/orderInquiry.js。バックエンドの生の形）から導く。
 * 画面の行は「元注文ごと」にまとめたものなので、生の行からまとまりを組み立てる関数もここに置く。
 * 規則は src/api/orderInquiry.js の groupOrders と同じ（api 層は import.meta.env を辿る
 * api/client.js に依存しており Playwright からは import できないので、規則をここに再掲する）:
 *   - まとまりの鍵は `元注文ID`（無ければ自分の ID）。並びはまとまりが最初に現れた位置（ID の降順）
 *   - 各まとまりの行は最新の版（ID が最大の非子注文）の内容を出す
 *   - 子注文（`注文種別` が 'SLICE_CHILD'）だけが当たったまとまりは、子注文を 1 件ずつ行にする
 */
import { orderInquiryRows } from '../../src/mocks/fixtures/orderInquiry'

export const INQUIRY_PATH = '/orders/inquiry'

const SLICE_CHILD = 'SLICE_CHILD'

/** 表の列の並び（src/components/orders/OrderInquiryTable.vue の COLUMNS と同じ） */
export const COLUMNS = [
  '注文ID',
  '部店',
  '口座番号',
  '顧客名',
  '銘柄',
  '売買',
  '数量',
  '指値／成行',
  '価格',
  '出来数量',
  '未出来残数量',
  '約定代金（USD）',
  '約定代金（円貨）',
  '市場区分',
  '出来状況',
  '送信日時',
  '受注日時',
  '操作',
]

/*
 * 発注範囲コード → 市場区分の名前。src/utils/orderTypes.js の MARKET_SCOPE_OPTIONS と同じ。
 * あのファイルは '@/utils/format' を import しており、Playwright はエイリアスを解決できないので再掲する。
 */
export const MARKET_SCOPE_LABELS = {
  '01': 'プレ',
  '02': 'プレ＋レギュラー',
  '03': 'レギュラー',
  '04': 'プレ＋レギュラー＋アフター',
  '05': 'レギュラー＋アフター',
  '06': 'アフター',
}

/** 売買区分コード → 一覧の表記（src/components/orders/OrderInquiryCells.vue と同じ） */
export const SIDE_LABELS = { 1: '売', 3: '買' }

/** 指成区分 → 一覧の表記 */
export const ORDER_TYPE_LABELS = { LO: '指値', MO: '成行' }

/** フィクスチャの 1 行を ID で引く */
export function fixtureRow(id) {
  const row = orderInquiryRows.find((candidate) => candidate.ID === id)
  if (!row) throw new Error(`フィクスチャに注文 #${id} がありません`)
  return row
}

const rootOf = (row) => row.元注文ID ?? row.ID
const isSlice = (row) => row.注文種別 === SLICE_CHILD

/**
 * 生の行（検索に当たったもの）から、画面に出る行の注文 ID（「注文ID」列の値）を並び順に返す。
 *
 * @param {object[]} rows 生の行
 * @returns {number[]}
 */
export function expectedRowIds(rows) {
  const sorted = [...rows].sort((a, b) => b.ID - a.ID)
  const roots = [...new Set(sorted.map(rootOf))]
  return roots.flatMap((root) => {
    const members = sorted.filter((row) => rootOf(row) === root)
    if (members.some((row) => !isSlice(row))) return [root]
    return members.map((row) => row.ID).sort((a, b) => a - b)
  })
}

/**
 * 元注文の最新の版（行が内容を出す版。訂正・取消の遷移先の ID）を返す。
 *
 * @param {number} rootId 元注文の ID
 * @returns {object} 生の行
 */
export function latestVersionOf(rootId) {
  const versions = orderInquiryRows.filter((row) => rootOf(row) === rootId && !isSlice(row))
  return versions.reduce((latest, row) => (row.ID > latest.ID ? row : latest))
}

/** 元注文の訂正前の版（古い順。先頭が原注文） */
export function historyOf(rootId) {
  const latest = latestVersionOf(rootId)
  return orderInquiryRows
    .filter((row) => rootOf(row) === rootId && !isSlice(row) && row.ID !== latest.ID)
    .sort((a, b) => a.ID - b.ID)
}

/** 元注文の子注文（ID の昇順） */
export function slicesOf(rootId) {
  return orderInquiryRows
    .filter((row) => rootOf(row) === rootId && isSlice(row))
    .sort((a, b) => a.ID - b.ID)
}

/** 表の元注文の行。data-testid は表にスコープを切って引く */
export function rowsOf(page) {
  return page.getByTestId('order-inquiry-table').getByTestId('order-inquiry-row')
}

/** 「注文ID」列が #id の行 */
export function rowOf(page, id) {
  return rowsOf(page).filter({ has: page.getByText(`#${id}`, { exact: true }) })
}

/** 行の中の、列名で指したセル */
export function cellOf(row, column) {
  const index = COLUMNS.indexOf(column)
  if (index < 0) throw new Error(`列「${column}」はありません`)
  return row.getByRole('cell').nth(index)
}
