import { http, HttpResponse } from 'msw'
import { stalledOrderErrors, stalledWorkingOrders } from '../fixtures/stalledOrders'
import { detailError, requestValidationError } from './_shared'

/*
 * 滞留注文抽出。バックエンド未実装なので形ごと仮置き（fixtures/stalledOrders.js の冒頭を参照）。
 * 1 回の検索で「注文エラー」と「注文中」の 2 本を同時に返す（画面が一覧を 2 つ並べるため）。
 * 実 API が来たらこのハンドラを消すだけで本物へ切り替わる。
 *
 * コンファメーション CSV の取込で行が「注文エラー → 注文中」へ移ったり一覧から消えたりするので、
 * 2 本とも可変の状態として持つ（テスト間では resetStalledOrderState で戻す）。
 */

let orderErrorRows = cloneRows(stalledOrderErrors)
let workingOrderRows = cloneRows(stalledWorkingOrders)

function cloneRows(rows) {
  return rows.map((row) => ({ ...row }))
}

/** モックの可変状態をフィクスチャの内容に戻す */
export function resetStalledOrderState() {
  orderErrorRows = cloneRows(stalledOrderErrors)
  workingOrderRows = cloneRows(stalledWorkingOrders)
}

export const stalledOrderHandlers = [
  http.get('*/api/operations/stalled-orders', ({ request }) => {
    const params = new URL(request.url).searchParams
    const branchCode = (params.get('branch_code') ?? '').trim()
    const accountNumber = (params.get('account_no') ?? '').trim()
    const symbol = (params.get('symbol') ?? '').trim().toUpperCase()

    const matches = (order) =>
      (!branchCode || order.部店 === branchCode) &&
      (!accountNumber || String(order.口座番号).includes(accountNumber)) &&
      (!symbol || order.銘柄コード.toUpperCase().includes(symbol))

    // 並びはサーバの責務。行は受注日時の新しい順に保ってあるので、絞り込むだけでよい
    return HttpResponse.json({
      注文エラー: orderErrorRows.filter(matches),
      注文中: workingOrderRows.filter(matches),
    })
  }),

  /*
   * コンファメーション CSV の取込。2026-10-07 の取り込みで仕様に入った（パス・項目名 file・
   * 応答 CsvImportResponse とも提案のとおり）。ただし一覧がまだこのファイルの GET（モック）で、
   * 取込はその一覧を書き換えるので、整合のため残している。一覧は GET /orders の 2 回呼びに
   * 切り替える方針（docs/api/requests.md の #1 ①）で、**切り替えた日にこのファイルごと消す。**
   *
   *   422 … file が無い（FastAPI の UploadFile 必須の検証）
   *   400 … 空ファイル / ヘッダが違う / データ行が無い
   *   200 … 行ごとの不備は errors に積む。1 行でも不備があれば 1 行も反映しない
   *
   * CSV は素朴に `,` で割るだけにしてある（クォート付きの値は扱わない）。本物の解釈は
   * バックエンドの責務で、ここは画面の 3 通りの結果（成功 / 行エラー / 失敗）を出せれば足りる。
   */
  http.post('*/api/operations/stalled-orders/confirmation-import', async ({ request }) => {
    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!file || typeof file === 'string') {
      return requestValidationError(['body', 'file'], 'Field required', 'missing')
    }

    // BOM の有無はどちらも受ける（画面のサンプルは BOM 付き、手で作った CSV は付かないことがある）
    const raw = await file.text()
    const text = raw.startsWith(BOM) ? raw.slice(1) : raw
    if (!text.trim()) return detailError(400, 'ファイルが空です。')

    const [headerLine, ...lines] = text.split(/\r?\n/)
    if (headerLine.trim() !== CONFIRMATION_HEADER.join(',')) {
      return detailError(
        400,
        `ヘッダが違います。1 行目を ${CONFIRMATION_HEADER.join(',')} にしてください。`,
      )
    }

    // 行番号はヘッダを 1 行目として数える（CsvImportErrorItem.line_number の定義）。空行は数えるが読まない
    const records = lines.flatMap((line, index) =>
      line.trim() ? [{ lineNumber: index + 2, rowData: toRowData(line) }] : [],
    )
    if (records.length === 0) return detailError(400, 'データ行がありません。')

    // 検査は反映前の一覧に対して全行ぶん済ませる（1 行でも不備があれば 1 行も反映しない）
    const seenOrderIds = new Set()
    const errors = records
      .map(({ lineNumber, rowData }) => {
        const problems = rowProblems(rowData, seenOrderIds)
        seenOrderIds.add(rowData.order_id)
        return { line_number: lineNumber, errors: problems, row_data: rowData }
      })
      .filter((item) => item.errors.length > 0)

    if (errors.length > 0) {
      return HttpResponse.json({
        success: false,
        total_count: records.length,
        success_count: 0,
        error_count: errors.length,
        errors,
        message: `${errors.length} 行にエラーがあるため、取り込みませんでした。CSV を直して取り込み直してください。`,
      })
    }

    const counts = records.reduce(
      (acc, { rowData }) => {
        acc[applyConfirmation(rowData)] += 1
        return acc
      },
      { closed: 0, working: 0 },
    )

    return HttpResponse.json({
      success: true,
      total_count: records.length,
      success_count: records.length,
      error_count: 0,
      errors: [],
      message: `コンファメーションを ${records.length} 件取り込みました（約定・取消で除外 ${counts.closed} 件 / 注文中 ${counts.working} 件）。`,
    })
  }),
]

/* ここから取込のモック用ヘルパ */

const BOM = String.fromCharCode(0xfeff)

/** コンファメーション CSV のヘッダ（公開モックのサンプル実物から採取） */
const CONFIRMATION_HEADER = [
  'order_id',
  'confirmation_ref',
  'confirmation_status',
  'filled_quantity',
  'average_price',
  'confirmed_at',
  'message',
]

/*
 * confirmation_status の値（仕様の 4 値。処理状況は FILLED→011 / CANCELLED→034 /
 * WORKING→003 / PARTIALLY_FILLED→010）。注文中へ移すのは 003 になる WORKING だけで、
 * 一部約定（010）は注文エラーにも注文中（status=003）にも載らないので、約定・取消と同じく一覧から外す。
 */
const CLOSED_STATUSES = ['FILLED', 'CANCELLED', 'PARTIALLY_FILLED']
const WORKING_STATUSES = ['WORKING']

/** 注文中へ移した行に付ける値（fixtures/stalledOrders.js の注文中の行と同じ） */
const WORKING_STATE = {
  処理状況: '003',
  処理状況名: '注文中',
  確認状況: '別システムのコンファメーション取込済み・未約定',
}

/** 1 行をヘッダの列名で引ける形にする（CsvImportErrorItem.row_data） */
function toRowData(line) {
  const cells = line.split(',')
  return Object.fromEntries(
    CONFIRMATION_HEADER.map((column, index) => [column, (cells[index] ?? '').trim()]),
  )
}

function findStalledOrder(orderId) {
  const matches = (row) => String(row.ID) === orderId
  return orderErrorRows.find(matches) ?? workingOrderRows.find(matches) ?? null
}

/**
 * 1 行の不備。空なら反映できる。
 * 同じ注文の行が 2 回あると、どちらの結果を採るかが決まらないので 2 回目以降を不備にする。
 */
function rowProblems(rowData, seenOrderIds) {
  const problems = []
  if (!findStalledOrder(rowData.order_id)) {
    problems.push(`注文ID「${rowData.order_id}」は滞留注文にありません。`)
  } else if (seenOrderIds.has(rowData.order_id)) {
    problems.push(`注文ID「${rowData.order_id}」が同じファイルに 2 回以上あります。`)
  }
  const status = rowData.confirmation_status
  if (!CLOSED_STATUSES.includes(status) && !WORKING_STATUSES.includes(status)) {
    problems.push(`confirmation_status「${status}」は指定できません。`)
  }
  return problems
}

/**
 * 1 行を一覧へ反映する。約定（一部約定を含む）・取消は 2 本から外し、未約定は注文中へ移す。
 * @returns {'closed'|'working'} どちらに振り分けたか（応答の文言に使う）
 */
function applyConfirmation(rowData) {
  const order = findStalledOrder(rowData.order_id)
  orderErrorRows = orderErrorRows.filter((row) => row !== order)
  workingOrderRows = workingOrderRows.filter((row) => row !== order)

  if (CLOSED_STATUSES.includes(rowData.confirmation_status)) return 'closed'

  // 注文エラーの行は エラー内容 を持つが、注文中の行は持たない（代わりに 確認状況）
  const moved = { ...order, ...WORKING_STATE }
  delete moved.エラー内容
  workingOrderRows = [...workingOrderRows, moved].sort(byOrderedAtDesc)
  return 'working'
}

/** 受注日時の新しい順（同時刻は ID の大きい順） */
function byOrderedAtDesc(a, b) {
  const at = (row) => `${row.受注日}T${row.受注時刻}`
  return at(b).localeCompare(at(a)) || b.ID - a.ID
}
