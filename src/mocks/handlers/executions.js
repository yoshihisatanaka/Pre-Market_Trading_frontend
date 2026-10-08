import { http, HttpResponse } from 'msw'
import { executions } from '../fixtures/executions'
import { toNonNegativeInt, toStatusList } from './_shared'

/*
 * 約定照会。クエリ名と応答の形は openapi.json の `GET /executions`（ExecutionListResponse）と
 * `GET /executions/export-csv` に合わせてある。
 *
 * 書き換える操作が無いので可変状態は持たない（resetMockState の対象外）。
 */

/** `/executions` は limit（1〜200・既定 50）を受け取る。これはクエリが無いときに使う値 */
const EXECUTIONS_DEFAULT_LIMIT = 50

/** CSV 出力の上限件数（仕様の説明「上限10,000件」） */
const EXPORT_LIMIT = 10000

/*
 * CSV の列（生データのキー, 見出し）。バックエンドの CSV_COLUMNS
 * （Pre-Market_Trading の app/services/execution_service.py）と同じ並び・同じ見出し。
 */
const CSV_COLUMNS = [
  ['約定日時', '約定日時'],
  ['ID', '約定ID'],
  ['注文ID', '注文ID'],
  ['受注番号', '受注番号'],
  ['部店', '部店'],
  ['部店名', '部店名'],
  ['口座番号', '口座番号'],
  ['顧客名', '顧客名'],
  ['銘柄コード', '銘柄コード'],
  ['Ticker', 'Ticker'],
  ['銘柄名', '銘柄名'],
  ['売買区分', '売買区分'],
  ['売買区分名', '売買区分名'],
  ['注文ルート', '注文ルート'],
  ['注文ルート名', '預託先'],
  ['処理状況', '処理状況'],
  ['処理状況名', '処理状況名'],
  ['注文数量', '注文数量'],
  ['伝票注文ID', '伝票注文ID'],
  ['伝票受注番号', '伝票受注番号'],
  ['指値単価', '指値単価'],
  ['約定数量', '約定数量'],
  ['約定単価', '約定単価'],
  ['約定代金', '約定代金(USD)'],
  ['手数料', '手数料'],
  ['手数料通貨', '手数料通貨'],
  ['決済通貨区分', '決済通貨区分'],
  ['OrderID', 'OrderID'],
  ['ExecID', 'ExecID'],
]

/** CSV の保存名（バックエンドが Content-Disposition に付ける名前と同じ） */
const CSV_FILENAME = 'executions.csv'

export const executionHandlers = [
  http.get('*/api/executions', ({ request }) => {
    const params = new URL(request.url).searchParams
    const sort = params.get('sort') === 'asc' ? 'asc' : 'desc'
    const limit = toNonNegativeInt(params.get('limit'), EXECUTIONS_DEFAULT_LIMIT)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    const sorted = sortByExecutedAt(filterExecutions(params), sort)

    return HttpResponse.json({
      // total と summary は絞り込み後・ページ切り出し前の件数
      total: sorted.length,
      limit,
      offset,
      summary: summarize(sorted),
      executions: sorted.slice(offset, offset + limit),
    })
  }),

  // 一覧と同じ条件の全件（上限つき・約定日時の昇順）を UTF-8 BOM 付きの CSV で返す
  http.get('*/api/executions/export-csv', ({ request }) => {
    const params = new URL(request.url).searchParams
    return toExecutionsCsvResponse(sortByExecutedAt(filterExecutions(params), 'asc'))
  }),
]

/**
 * `export-csv` の応答（上限件数で切り、UTF-8 BOM 付きの CSV にする）。
 * みずほ注文締のモック（handlers/mizuhoExecutions.js）も同じ書式で返すので公開する。
 *
 * @param {object[]} rows 生の ExecutionItem。並べ替えは呼び出し側で済ませておく
 */
export function toExecutionsCsvResponse(rows) {
  return new HttpResponse(toCsv(rows.slice(0, EXPORT_LIMIT)), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename=${CSV_FILENAME}`,
    },
  })
}

/** 検索条件（一覧と CSV 出力で共通のクエリ）に合う行を返す */
function filterExecutions(params) {
  const branchCode = params.get('branch_code') ?? ''
  const accountNo = toNonNegativeInt(params.get('account_no'), 0)
  const symbol = (params.get('symbol') ?? '').trim().toUpperCase()
  const side = params.get('side') ?? ''
  const route = params.get('route') ?? ''
  // 処理状況はカンマ区切りで複数指定できる（GET /orders と同じ。例: 032,034）
  const statuses = toStatusList(params.get('status'))
  // 仕様は YYYY-MM-DD と YYYYMMDD の両方を受けるので、比較の前にハイフン付きへ揃える
  const dateFrom = toIsoDate(params.get('start_date') ?? '')
  const dateTo = toIsoDate(params.get('end_date') ?? '')

  // 約定日時は 'YYYY-MM-DDTHH:MM:SS' なので、日付部分の文字列比較がそのまま日付の大小になる
  return executions.filter((row) => {
    const date = (row.約定日時 ?? '').slice(0, 10)

    return (
      // 部店コードは完全一致（仕様の説明どおり）
      (!branchCode || row.部店 === branchCode) &&
      (!accountNo || row.口座番号 === accountNo) &&
      // 銘柄コードまたは Ticker のどちらかに一致すればよい
      (!symbol ||
        row.銘柄コード.toUpperCase() === symbol ||
        (row.Ticker ?? '').toUpperCase() === symbol) &&
      (!side || row.売買区分 === side) &&
      // 預託先はコード値・名称のどちらでも指定できる（仕様の説明どおり）
      (!route || row.注文ルート === route || row.注文ルート名 === route) &&
      (statuses.length === 0 || statuses.includes(row.処理状況)) &&
      (!dateFrom || date >= dateFrom) &&
      (!dateTo || date <= dateTo)
    )
  })
}

/** 約定日時の並び。同じ日時なら ID で並べて順序を安定させる */
function sortByExecutedAt(rows, sort) {
  const direction = sort === 'asc' ? 1 : -1
  return [...rows].sort(
    (a, b) => direction * (a.約定日時.localeCompare(b.約定日時) || a.ID - b.ID),
  )
}

/** ExecutionSummary（同じ検索条件での集計）を組み立てる */
function summarize(rows) {
  const sum = (pick) => rows.reduce((total, row) => total + (pick(row) ?? 0), 0)

  return {
    件数: rows.length,
    注文件数: new Set(rows.map((row) => row.注文ID)).size,
    売件数: rows.filter((row) => row.売買区分 === '1').length,
    買件数: rows.filter((row) => row.売買区分 === '3').length,
    // 一部出来（処理状況 010）の注文の件数。約定の行数ではなく注文 ID で数える（仕様の説明どおり）
    一部出来件数: new Set(rows.filter((row) => row.処理状況 === '010').map((row) => row.注文ID))
      .size,
    約定数量合計: sum((row) => row.約定数量),
    // 浮動小数の足し算の誤差をセント単位で丸める
    約定代金合計_USD: Math.round(sum((row) => row.約定代金) * 100) / 100,
    手数料合計_USD: Math.round(sum((row) => row.手数料) * 100) / 100,
  }
}

/*
 * CSV の本文。バックエンド（Python の csv.writer）と同じ書式:
 * 先頭に BOM、改行は CRLF、`,` `"` 改行を含む値だけ `"` で囲む、null は空欄。
 * アプリ側の utils/csv.js は使わない（サーバの代わりなので、画面のコードと独立に置く）。
 */
function toCsv(rows) {
  const line = (cells) => cells.map(toCsvCell).join(',') + '\r\n'
  return (
    '﻿' +
    line(CSV_COLUMNS.map(([, header]) => header)) +
    rows.map((row) => line(CSV_COLUMNS.map(([key]) => row[key]))).join('')
  )
}

function toCsvCell(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** `20260916` → `2026-09-16`。それ以外はそのまま返す */
function toIsoDate(value) {
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
    : value
}
