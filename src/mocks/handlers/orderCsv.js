import { http, HttpResponse } from 'msw'
import {
  BULK_ORDER_FIRST_ID,
  ORDER_CSV_TEMPLATE_FILENAME,
  orderCsvColumnNames,
  orderCsvColumns,
  orderCsvCustomerNameOf,
  orderCsvDetailsOf,
  orderCsvSpecResponse,
  orderCsvTemplateText,
} from '../fixtures/orderCsv'
import { detailError, requestValidationError } from './_shared'

/*
 * CSV一括注文（取込み → プレビュー → 受付完了）。
 *
 * 4 本とも実 API は実装済みだが、単体テストと E2E がこの handlers を共用するので残す
 * （index.js の冒頭コメントの例外）。形は実 API（app/api/order_api.py・app/services/order_service.py）に寄せてある。
 *
 * 事前検証は固定の見本を返さず、**アップロードされた CSV を実際に読む**。E2E がテストの中で組んだ
 * CSV を渡して、OK の行・NG の行・警告の行を作り分けられるようにするため。検査は画面の出し分けに
 * 要る分だけで、本物の検証（余力・期限・銘柄の取引規制など）はバックエンドの責務。
 * CSV は素朴に `,` で割るだけにしてある（クォート付きの値は扱わない）。
 */
export const orderCsvHandlers = [
  http.get('*/api/orders/csv-spec', () => HttpResponse.json(orderCsvSpecResponse)),

  http.get(
    '*/api/orders/csv-template',
    () =>
      new HttpResponse(orderCsvTemplateText, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${ORDER_CSV_TEMPLATE_FILENAME}"`,
        },
      }),
  ),

  /*
   *   422 … file が無い（FastAPI の UploadFile 必須の検証）
   *   400 … ヘッダーの列が足りない（空ファイルも全列不足になる）
   *   200 … 行ごとの不備は rows[].errors に積む。データ行が 0 件でも 200（all_valid は false）
   */
  http.post('*/api/orders/validate-csv', async ({ request }) => {
    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!file || typeof file === 'string') {
      return requestValidationError(['body', 'file'], 'Field required', 'missing')
    }

    // テンプレートは BOM 付き、手で作った CSV は付かないことがある。どちらも受ける
    const raw = await file.text()
    const text = raw.startsWith(BOM) ? raw.slice(1) : raw
    const [headerLine = '', ...lines] = text.split(/\r?\n/)

    const header = headerLine.split(',').map((cell) => cell.trim())
    const missing = orderCsvColumnNames.filter((name) => !header.includes(name))
    if (missing.length > 0) {
      // 文言は実 API のまま（不足項目は Python の list の表記）
      const names = missing.map((name) => `'${name}'`).join(', ')
      return detailError(400, `CSVヘッダーに不足があります: 不足項目=[${names}]`)
    }

    // 行番号はヘッダーを 1 行目として数える。空行は数えるが読まない
    const rows = lines.flatMap((line, index) =>
      line.trim() ? [validateRow(toCells(header, line), index + 2)] : [],
    )
    const invalidCount = rows.filter((row) => !row.valid).length

    return HttpResponse.json({
      total_count: rows.length,
      valid_count: rows.length - invalidCount,
      invalid_count: invalidCount,
      all_valid: rows.length > 0 && invalidCount === 0,
      has_error: invalidCount > 0,
      rows,
    })
  }),

  /*
   *   422 … 作成者が無い（OrderRequest の必須。事前検証の行には入っていないので、フロントが足し忘れると出る）
   *   400 … orders が空
   *   200 … 送った並びで連番の注文 ID を返す（状態は持たない）
   */
  http.post('*/api/orders/bulk-create', async ({ request }) => {
    const body = await request.json().catch(() => null)
    const orders = Array.isArray(body?.orders) ? body.orders : []
    if (orders.length === 0) return detailError(400, '登録対象の注文データが空です')

    const withoutCreator = orders.findIndex((order) => typeof order?.作成者 !== 'string')
    if (withoutCreator >= 0) {
      return requestValidationError(
        ['body', 'orders', withoutCreator, '作成者'],
        'Field required',
        'missing',
      )
    }

    return HttpResponse.json({
      success: true,
      total_orders: orders.length,
      order_ids: orders.map((_, index) => BULK_ORDER_FIRST_ID + index),
      message: `${orders.length}件の注文を一括受付しました`,
      errors: [],
    })
  }),
]

/* ここから事前検証のモック用ヘルパ */

const BOM = String.fromCharCode(0xfeff)

/** 数量がこれ以上の行に警告を付ける（モックだけの仮の規則。画面の警告の出し分けを確かめるためのもの） */
const LARGE_QUANTITY = 10000

/** 1 行をヘッダーの列名で引ける形にする（22 列だけ。知らない列は捨てる） */
function toCells(header, line) {
  const values = line.split(',')
  return Object.fromEntries(
    orderCsvColumnNames.map((name) => [name, (values[header.indexOf(name)] ?? '').trim()]),
  )
}

function toInteger(value) {
  return /^-?\d+$/.test(value) ? Number(value) : null
}

/**
 * 1 行を検証する（CsvOrderRowResult）。
 *
 * バックエンドと同じく、先に値の型を寄せ（口座番号・数量を数値に、部店を 3 桁に…）、
 * 寄せられなかった行は検証まで進めない（details は null、warnings は空）。
 * customer_name は口座から引いた顧客名（fixtures/orderCsv.js の orderCsvCustomerNameOf）。
 */
function validateRow(cells, rowNumber) {
  const accountNumber = toInteger(cells.口座番号)
  const quantity = toInteger(cells.数量)
  const limitPrice = cells.指値単価 === '' ? null : Number(cells.指値単価)

  const data = {
    ...cells,
    部店: /^\d{1,3}$/.test(cells.部店) ? cells.部店.padStart(3, '0') : cells.部店,
    口座番号: accountNumber ?? 0,
    数量: quantity ?? 0,
    指値単価: Number.isFinite(limitPrice) ? limitPrice : null,
    金銭受渡方法: ['0', '00'].includes(cells.金銭受渡方法) ? '000' : cells.金銭受渡方法,
    VWAP区分: cells.VWAP区分 === '1' ? 1 : 0,
  }

  const conversionErrors = [
    cells.口座番号 !== '' && accountNumber === null && '口座番号は整数で入力してください',
    cells.数量 !== '' && quantity === null && '数量は整数で入力してください',
    cells.指値単価 !== '' && !Number.isFinite(limitPrice) && '指値単価は数値で入力してください',
  ].filter(Boolean)
  if (conversionErrors.length > 0) {
    return {
      row_number: rowNumber,
      valid: false,
      data,
      errors: conversionErrors,
      warnings: [],
      details: null,
      customer_name: orderCsvCustomerNameOf(data),
    }
  }

  const errors = columnErrors(cells, data)
  const warnings =
    data.数量 >= LARGE_QUANTITY
      ? ['数量が10,000株以上です。スライス発注の対象になる場合があります']
      : []
  const details = orderCsvDetailsOf(data)
  if (data.銘柄コード && details.stock_name === null) {
    // 文言は実 API のまま（2026-09-25 に残高マスタの事前検証で実測したもの）
    errors.push(`指定された銘柄コードが存在しません: ${data.銘柄コード}`)
  }

  return {
    row_number: rowNumber,
    valid: errors.length === 0,
    data,
    errors,
    warnings,
    details,
    customer_name: orderCsvCustomerNameOf(data),
  }
}

/** 必須・区分の値・指値単価の条件付き必須・数量の下限 */
function columnErrors(cells, data) {
  const errors = []
  for (const column of orderCsvColumns) {
    const value = column.name === '金銭受渡方法' ? data.金銭受渡方法 : cells[column.name]
    if (value === '') {
      if (column.required) errors.push(`${column.name}は必須です`)
      continue
    }
    if (column.allowed_values && !column.allowed_values.some((item) => item.code === value)) {
      errors.push(`${column.name}「${value}」は指定できません`)
    }
  }
  if (data.指成区分 === 'LO' && data.指値単価 === null) {
    errors.push('指成区分がLO（指値）の場合、指値単価は必須です')
  }
  if (cells.数量 !== '' && data.数量 < 1) errors.push('数量は1以上で入力してください')
  return errors
}
