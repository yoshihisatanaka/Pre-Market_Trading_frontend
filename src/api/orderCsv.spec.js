import { File as NodeFile } from 'node:buffer'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import {
  bulkOrderCreateResponse,
  ORDER_CSV_CASH_SHORT_QUANTITY,
  ORDER_CSV_REMOVED_COLUMN_NAMES,
  ORDER_CSV_TEMPLATE_FILENAME,
  orderCsvCashShortForcedWarning,
  orderCsvCashShortMessage,
  orderCsvColumnNames,
  orderCsvColumns,
  orderCsvCustomerNameOf,
  orderCsvDetailsOf,
  orderCsvSampleOrders,
  orderCsvTemplateText,
  orderCsvValidateForceableResponse,
  orderCsvValidateResponse,
  orderCsvValidateWithErrorsResponse,
} from '@/mocks/fixtures/orderCsv'
import { ApiError } from './client'
import {
  bulkCreateOrders,
  fetchOrderCsvSpec,
  fetchOrderCsvTemplate,
  validateOrderCsv,
} from './orderCsv'

/*
 * API 層のテスト。CsvHeaderSpecResponse の生の形（列ごとに型が違う example / null の condition /
 * 順不同の列）がアプリ内モデルに揃うことと、テンプレートDL・事前検証・一括受付の送り方と変換を守る。
 */

const PATH = '*/api/orders/csv-spec'
const TEMPLATE_PATH = '*/api/orders/csv-template'
const VALIDATE_PATH = '*/api/orders/validate-csv'
const BULK_PATH = '*/api/orders/bulk-create'

/*
 * jsdom の FormData は MSW(node) の XHR インターセプタが Fetch の Request に変換できず、
 * POST が応答しないまま止まる。テストの間だけ Node（undici）の FormData に差し替える
 * （src/api/stalledOrders.spec.js と同じ）。
 */
let NodeFormData = null

beforeAll(async () => {
  const response = new Response('', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  NodeFormData = (await response.formData()).constructor
})

beforeEach(() => {
  vi.stubGlobal('FormData', NodeFormData)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** jsdom の Blob をバイト列で読む（jsdom 26 の Blob には arrayBuffer() が無い） */
const readBytes = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })

/** 送る File も Node の実装にする（jsdom の File を Node の FormData に積むと文字列で届く） */
const csvFile = (text, name = 'orders.csv') => new NodeFile([text], name, { type: 'text/csv' })

/** 例外を受け取る（投げられなければテストを落とす） */
async function caught(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('例外が投げられなかった')
}

/** 事前検証の応答を差し替える */
function respondValidate(body, status = 200) {
  server.use(http.post(VALIDATE_PATH, () => HttpResponse.json(body, { status })))
}

/**
 * 一括受付の本文を記録する。応答は返さず既定のハンドラに回す（MSW は何も返さないと次のハンドラへ進む）。
 * @returns {object[]} 届いた本文の配列
 */
function recordBulk() {
  const bodies = []
  server.use(
    http.post(BULK_PATH, async ({ request }) => {
      bodies.push(await request.clone().json())
    }),
  )
  return bodies
}

/** 生の行の data（日本語キー）から、アプリ内の注文に期待する形を作る */
const SIDE_OF = { 1: 'sell', 3: 'buy' }
const toExpectedOrder = (raw) => ({
  branchCode: raw.部店,
  accountNumber: raw.口座番号,
  symbol: raw.銘柄コード,
  side: SIDE_OF[raw.売買区分],
  quantity: raw.数量,
  orderType: raw.指成区分,
  limitPrice: raw.指値単価,
  settlementCurrency: raw.決済通貨区分,
  securitiesDelivery: raw.証券受渡方法,
  depositCategory: raw.預り売買区分,
  transactionType: raw.取引,
  solicitation: raw.勧誘区分,
  orderMethod: raw.受注方法,
  fundNature: raw.資金性格,
  cashDelivery: raw.金銭受渡方法,
  expiryDate: raw.有効期限,
  orderChannel: raw.注文チャネル,
  orderDate: raw.受注日,
  orderTime: raw.受注時刻,
  receiver: raw.受注者,
  vwap: raw.VWAP区分 === 1,
  marketScope: raw.発注範囲,
  // CSV では強制を指定できない（2026-10-13 の方針変更）。事前検証の注文は常に強制なし
  forced: false,
})

/** 生の行の forced_overrides から、アプリ内の形に期待するものを作る */
const toExpectedOverrides = (raw) =>
  (raw.forced_overrides ?? []).map((item) => ({ check: item.チェック, content: item.内容 }))

/** 買付余力不足になる注文（MSW の仮規則。買いで数量が ORDER_CSV_CASH_SHORT_QUANTITY 以上） */
const cashShortOrder = { ...orderCsvSampleOrders[0], 数量: ORDER_CSV_CASH_SHORT_QUANTITY }

/** 列の並び（既定は全列）と注文の行から CSV の本文を組む（null は空欄） */
const csvOf = (orders, header = orderCsvColumnNames) =>
  [
    header.join(','),
    ...orders.map((order) =>
      header.map((name) => (order[name] == null ? '' : String(order[name]))).join(','),
    ),
  ].join('\r\n') + '\r\n'

/** ヘッダーの列が足りない CSV（先頭 2 列だけ）と、そのとき handler が返す detail */
const SHORT_HEADER = orderCsvColumnNames.slice(0, 2)
const SHORT_HEADER_CSV = `${SHORT_HEADER.join(',')}\r\n`
const SHORT_HEADER_DETAIL = `CSVヘッダーに不足があります: 不足項目=[${orderCsvColumnNames
  .filter((name) => !SHORT_HEADER.includes(name))
  .map((name) => `'${name}'`)
  .join(', ')}]`

/** 応答を差し替える（列だけ渡せば total_columns はその件数にする） */
function respondWithColumns(columns) {
  server.use(
    http.get(PATH, () => HttpResponse.json({ total_columns: columns.length, columns })),
  )
}

// 期待値はフィクスチャから導く（22 列・列名を直接書かない）
const byIndex = [...orderCsvColumns].sort((a, b) => a.index - b.index)
const withCondition = orderCsvColumns.filter((column) => column.condition)
const typesOfExample = new Set(orderCsvColumns.map((column) => typeof column.example))
const numericExample = orderCsvColumns.find((column) => typeof column.example === 'number')

// シナリオ: docs/unit/api-order-csv.md
describe('api/orderCsv', () => {
  it('[OCA-01] 既定モックの全列を 6 つのキーだけのアプリ内モデルで返す', async () => {
    const columns = await fetchOrderCsvSpec()

    expect(columns).toHaveLength(orderCsvColumns.length)
    for (const column of columns) {
      expect(Object.keys(column).sort()).toEqual(
        ['condition', 'description', 'example', 'index', 'name', 'required'].sort(),
      )
    }
    expect(columns.map((column) => column.name)).toEqual(byIndex.map((column) => column.name))
  })

  it('[OCA-02] 列が順不同で来ても index の昇順に並べ直す', async () => {
    respondWithColumns([...orderCsvColumns].reverse())

    const columns = await fetchOrderCsvSpec()

    expect(columns.map((column) => column.index)).toEqual(byIndex.map((column) => column.index))
    expect(columns.map((column) => column.name)).toEqual(byIndex.map((column) => column.name))
  })

  it('[OCA-03] 型の違う例をすべて文字列にする', async () => {
    // 前提: フィクスチャに string 以外の例が混ざっている
    expect(typesOfExample.size).toBeGreaterThan(1)

    const columns = await fetchOrderCsvSpec()

    for (const column of columns) {
      expect(typeof column.example).toBe('string')
    }
    const expected = byIndex.map((column) => String(column.example))
    expect(columns.map((column) => column.example)).toEqual(expected)
    const numeric = columns.find((column) => column.index === numericExample.index)
    expect(numeric.example).toBe(String(numericExample.example))
  })

  it('[OCA-04] 例が null の列と、例が無い列は空文字になる', async () => {
    const [first, second] = byIndex
    const withoutExample = { ...second }
    delete withoutExample.example
    respondWithColumns([{ ...first, example: null }, withoutExample])

    const columns = await fetchOrderCsvSpec()

    expect(columns.map((column) => column.example)).toEqual(['', ''])
  })

  it('[OCA-05] condition は文言があればそのまま、null は空文字になる', async () => {
    // 前提: condition を持つ列がフィクスチャにある
    expect(withCondition.length).toBeGreaterThan(0)

    const columns = await fetchOrderCsvSpec()

    for (const column of columns) {
      const raw = orderCsvColumns.find((item) => item.index === column.index)
      expect(column.condition).toBe(raw.condition ?? '')
    }
    const conditioned = columns.filter((column) => column.condition !== '')
    expect(conditioned.map((column) => column.name)).toEqual(
      withCondition.map((column) => column.name),
    )
  })

  it('[OCA-06] required は true のときだけ必須になる', async () => {
    const [base] = byIndex
    const withoutRequired = { ...base }
    delete withoutRequired.required
    respondWithColumns([
      { ...base, index: 1, required: false },
      { ...withoutRequired, index: 2 },
      { ...base, index: 3, required: 'true' },
      { ...base, index: 4, required: 1 },
      { ...base, index: 5, required: true },
    ])

    const columns = await fetchOrderCsvSpec()

    expect(columns.map((column) => column.required)).toEqual([false, false, false, false, true])
  })

  it('[OCA-07] columns が無い応答は空配列になる', async () => {
    server.use(http.get(PATH, () => HttpResponse.json({})))

    await expect(fetchOrderCsvSpec()).resolves.toEqual([])
  })

  it('[OCA-08] 500 は detail を message に持つ ApiError になる', async () => {
    const detail = 'サーバーでエラーが発生しました。'
    server.use(http.get(PATH, () => HttpResponse.json({ detail }, { status: 500 })))

    const error = await fetchOrderCsvSpec().catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toBe(detail)
  })

  it('[OCA-09] テンプレートは BOM を含むバイト列のまま、サーバのファイル名で返る', async () => {
    const { blob, filename } = await fetchOrderCsvTemplate()

    expect(filename).toBe(ORDER_CSV_TEMPLATE_FILENAME)
    // text で読むと BOM が落ちるので、バイト列で比べる（TextEncoder は U+FEFF を EF BB BF にする）
    // jsdom と Node で Uint8Array の realm が違い toEqual が型で落ちるので、素の配列で比べる
    const bytes = Array.from(await readBytes(blob))
    expect(bytes.slice(0, 3)).toEqual([0xef, 0xbb, 0xbf])
    expect(bytes).toEqual(Array.from(new TextEncoder().encode(orderCsvTemplateText)))
  })

  it('[OCA-10] Content-Disposition が無いときは既定のファイル名になる', async () => {
    server.use(
      http.get(
        TEMPLATE_PATH,
        () => new HttpResponse(orderCsvTemplateText, { headers: { 'Content-Type': 'text/csv' } }),
      ),
    )

    const { filename } = await fetchOrderCsvTemplate()

    expect(filename).toBe('bulk_orders_template.csv')
  })

  it('[OCA-11] 引用符の無い filename も読む', async () => {
    server.use(
      http.get(
        TEMPLATE_PATH,
        () =>
          new HttpResponse(orderCsvTemplateText, {
            headers: {
              'Content-Type': 'text/csv',
              'Content-Disposition': 'attachment; filename=orders.csv',
            },
          }),
      ),
    )

    const { filename } = await fetchOrderCsvTemplate()

    expect(filename).toBe('orders.csv')
  })

  it('[OCA-12] テンプレートが 500 のとき detail を message に持つ ApiError になる', async () => {
    const detail = 'テンプレートを作れませんでした'
    server.use(http.get(TEMPLATE_PATH, () => HttpResponse.json({ detail }, { status: 500 })))

    const error = await caught(fetchOrderCsvTemplate())

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(500)
    // 本文はバイト列で届くが、client.js の decodeBinaryBody が JSON に戻すので detail が読める
    expect(error.message).toBe(detail)
  })

  it('[OCA-13] テンプレートの CSV を multipart で送り、行を camelCase の注文で返す', async () => {
    let received = null
    server.use(
      http.post(VALIDATE_PATH, async ({ request }) => {
        const form = await request.clone().formData()
        const file = form.get('file')
        received = {
          contentType: request.headers.get('content-type') ?? '',
          name: typeof file === 'string' ? null : file?.name,
        }
      }),
    )

    const result = await validateOrderCsv(csvFile(orderCsvTemplateText, 'template.csv'))

    expect(received.contentType).toMatch(/^multipart\/form-data/)
    expect(received.name).toBe('template.csv')
    expect(result.totalCount).toBe(orderCsvValidateResponse.total_count)
    expect(result.validCount).toBe(orderCsvValidateResponse.valid_count)
    expect(result.invalidCount).toBe(orderCsvValidateResponse.invalid_count)
    expect(result.allValid).toBe(orderCsvValidateResponse.all_valid)
    expect(result.hasError).toBe(orderCsvValidateResponse.has_error)
    expect(result.rows.map((row) => row.rowNumber)).toEqual(
      orderCsvSampleOrders.map((_, index) => index + 2),
    )
    result.rows.forEach((row, index) => {
      const raw = orderCsvSampleOrders[index]
      expect(row.valid).toBe(true)
      expect(row.order).toEqual(toExpectedOrder(raw))
      expect(row.customerName).toBe(orderCsvCustomerNameOf(raw))
      expect(row.stockName).toBe(orderCsvDetailsOf(raw).stock_name)
    })
    // 前提: フィクスチャに成行・売・買の行がある。成行の指値単価は null のまま
    const market = result.rows.find((row) => row.order.orderType === 'MO')
    expect(market.order.limitPrice).toBeNull()
    expect(new Set(result.rows.map((row) => row.order.side))).toEqual(new Set(['buy', 'sell']))
    expect(result.rows.every((row) => typeof row.order.vwap === 'boolean')).toBe(true)
  })

  it('[OCA-14] 行のエラーと警告はそのまま返り、引けなかった名前は空文字になる', async () => {
    respondValidate(orderCsvValidateWithErrorsResponse)

    const result = await validateOrderCsv(csvFile('x'))

    result.rows.forEach((row, index) => {
      const raw = orderCsvValidateWithErrorsResponse.rows[index]
      expect(row.errors).toEqual(raw.errors)
      expect(row.warnings).toEqual(raw.warnings)
      expect(row.valid).toBe(raw.valid)
      expect(row.stockName).toBe(raw.details?.stock_name ?? '')
      expect(row.customerName).toBe(raw.customer_name ?? '')
    })
    // 前提: details と customer_name が null の行がある
    const unresolved = result.rows.filter(
      (_, index) => orderCsvValidateWithErrorsResponse.rows[index].details === null,
    )
    expect(unresolved.length).toBeGreaterThan(0)
    for (const row of unresolved) {
      expect(row.stockName).toBe('')
      expect(row.customerName).toBe('')
    }
  })

  it('[OCA-15] 欠けた値や知らない値は正常や片方の向きに倒さない', async () => {
    const [base] = orderCsvValidateResponse.rows
    const withoutValid = { ...base }
    delete withoutValid.valid
    const unknownSide = { ...base, data: { ...base.data, 売買区分: '9' } }
    const withoutRowNumber = { ...base }
    delete withoutRowNumber.row_number
    respondValidate({
      total_count: 1.5,
      valid_count: '3',
      invalid_count: null,
      all_valid: false,
      has_error: false,
      rows: [withoutValid, unknownSide, withoutRowNumber],
    })

    const result = await validateOrderCsv(csvFile('x'))

    expect(result.rows[0].valid).toBe(false)
    expect(result.rows[1].order.side).toBe('')
    expect(result.rows[2].rowNumber).toBeNull()
    expect([result.totalCount, result.validCount, result.invalidCount]).toEqual([0, 0, 0])
  })

  it('[OCA-16] ヘッダーの列が足りない CSV は detail を持つ 400 の ApiError になる', async () => {
    const error = await caught(validateOrderCsv(csvFile(SHORT_HEADER_CSV)))

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 400, message: SHORT_HEADER_DETAIL })
  })

  it('[OCA-17] file が無いと 422 の ApiError になる', async () => {
    const error = await caught(validateOrderCsv(undefined))

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(422)
  })

  it('[OCA-18] 事前検証の注文を作成者付きの元の形で送り、採番を文字列で返す', async () => {
    const CREATED_BY = 'operator-x'
    const validation = await validateOrderCsv(csvFile(orderCsvTemplateText))
    const bodies = recordBulk()

    const result = await bulkCreateOrders(
      validation.rows.map((row) => row.order),
      { createdBy: CREATED_BY },
    )

    expect(bodies).toHaveLength(1)
    expect(bodies[0].orders).toEqual(
      orderCsvSampleOrders.map((order) => ({ ...order, 強制区分: 0, 作成者: CREATED_BY })),
    )
    expect(result.orderIds).toEqual(bulkOrderCreateResponse.order_ids.map(String))
    expect(result.totalOrders).toBe(bulkOrderCreateResponse.total_orders)
    expect(result.message).toBe(bulkOrderCreateResponse.message)
    expect(result.warnings).toEqual(bulkOrderCreateResponse.warnings)
  })

  it('[OCA-19] createdBy を渡さなければ作成者は空文字で届き、422 にならない', async () => {
    const validation = await validateOrderCsv(csvFile(orderCsvTemplateText))
    const bodies = recordBulk()

    const result = await bulkCreateOrders(validation.rows.map((row) => row.order))

    expect(bodies[0].orders.map((order) => order.作成者)).toEqual(
      orderCsvSampleOrders.map(() => ''),
    )
    expect(result.totalOrders).toBe(orderCsvSampleOrders.length)
  })

  it('[OCA-20] 空の注文は detail を持つ 400 の ApiError になる', async () => {
    const error = await caught(bulkCreateOrders([]))

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 400, message: '登録対象の注文データが空です' })
  })

  it('[OCA-21] 一括受付が 422 のとき ApiError になる', async () => {
    const validation = await validateOrderCsv(csvFile(orderCsvTemplateText))
    server.use(
      http.post(BULK_PATH, () =>
        HttpResponse.json(
          { detail: [{ loc: ['body', 'orders', 0, '作成者'], msg: 'Field required', type: 'missing' }] },
          { status: 422 },
        ),
      ),
    )

    const error = await caught(bulkCreateOrders(validation.rows.map((row) => row.order)))

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(422)
  })

  it('[OCA-22] forceable は NG で true の行だけ true になる', async () => {
    const invalid = orderCsvValidateWithErrorsResponse.rows.find((row) => row.valid === false)
    const [valid] = orderCsvValidateResponse.rows
    const withForceable = (base, value) => ({ ...base, forceable: value })
    const withoutForceable = { ...invalid }
    delete withoutForceable.forceable
    respondValidate({
      ...orderCsvValidateWithErrorsResponse,
      rows: [
        withForceable(invalid, true),
        withForceable(invalid, false),
        withForceable(invalid, null),
        withoutForceable,
        withForceable(invalid, 'true'),
        withForceable(valid, true),
      ],
    })

    const result = await validateOrderCsv(csvFile('x'))

    expect(result.rows.map((row) => row.forceable)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ])
  })

  it('[OCA-23] forced を true にした注文だけ 強制区分 1 で一括受付に送る', async () => {
    const FORCED_INDEX = 1
    const validation = await validateOrderCsv(csvFile(orderCsvTemplateText))
    const orders = validation.rows.map((row, index) => ({
      ...row.order,
      forced: index === FORCED_INDEX,
    }))
    const bodies = recordBulk()

    await bulkCreateOrders(orders)

    expect(bodies[0].orders.map((order) => order.強制区分)).toEqual(
      orders.map((_, index) => (index === FORCED_INDEX ? 1 : 0)),
    )
  })

  it('[OCA-24] 廃止された強制区分の列がある CSV は 400 の ApiError になる', async () => {
    const header = [...orderCsvColumnNames, ...ORDER_CSV_REMOVED_COLUMN_NAMES]
    const removedList = `[${ORDER_CSV_REMOVED_COLUMN_NAMES.map((name) => `'${name}'`).join(', ')}]`

    const error = await caught(validateOrderCsv(csvFile(csvOf(orderCsvSampleOrders, header))))

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(400)
    expect(error.message.startsWith(`CSVに廃止された列が含まれています: ${removedList}`)).toBe(true)
    expect(error.message).toContain('強制区分は CSV では指定できません')
  })

  it('[OCA-25] 強制で救える行の errorsIfForced と forcedOverrides をアプリ内の形で返す', async () => {
    respondValidate(orderCsvValidateForceableResponse)

    const result = await validateOrderCsv(csvFile('x'))

    const raws = orderCsvValidateForceableResponse.rows
    expect(result.rows).toHaveLength(raws.length)
    result.rows.forEach((row, index) => {
      const raw = raws[index]
      expect(row.errorsIfForced).toEqual(raw.errors_if_forced)
      expect(row.forcedOverrides).toEqual(toExpectedOverrides(raw))
    })
    // 救えるのは見本で forceable が true の NG の行だけ（前提: そういう行が見本にある）
    const forceable = raws.filter((raw) => raw.valid !== true && raw.forceable === true)
    expect(forceable.length).toBeGreaterThan(0)
    expect(result.rows.filter((row) => row.forceable).map((row) => row.rowNumber)).toEqual(
      forceable.map((raw) => raw.row_number),
    )
  })

  it('[OCA-26] 救済の項目が無い行は空配列、data の強制区分は読まない', async () => {
    const [base] = orderCsvValidateResponse.rows
    const legacy = { ...base, data: { ...base.data, 強制区分: 1 } }
    delete legacy.errors_if_forced
    delete legacy.forced_overrides
    respondValidate({ ...orderCsvValidateResponse, rows: [legacy] })

    const result = await validateOrderCsv(csvFile('x'))

    const [row] = result.rows
    expect(row.errorsIfForced).toEqual([])
    expect(row.forcedOverrides).toEqual([])
    expect(row.order.forced).toBe(false)
  })

  it('[OCA-27] MSW は買付余力不足だけの行を救え、指値単価の欠落が残る行を救えないと返す', async () => {
    const raws = orderCsvValidateForceableResponse.rows
    // 前提: 買付余力不足の行が見本にある（仮規則の境界の数量）
    expect(raws.some((raw) => raw.data.数量 >= ORDER_CSV_CASH_SHORT_QUANTITY)).toBe(true)

    const result = await validateOrderCsv(csvFile(csvOf(raws.map((raw) => raw.data))))

    expect(result.rows).toHaveLength(raws.length)
    result.rows.forEach((row, index) => {
      const raw = raws[index]
      expect(row.rowNumber).toBe(raw.row_number)
      expect(row.valid).toBe(raw.valid)
      expect(row.errors).toEqual(raw.errors)
      expect(row.forceable).toBe(raw.valid !== true && raw.forceable === true)
      expect(row.errorsIfForced).toEqual(raw.errors_if_forced)
      expect(row.forcedOverrides).toEqual(toExpectedOverrides(raw))
    })
  })

  it('[OCA-28] 値の変換で止まる行は NG で、強制でも救えない', async () => {
    const result = await validateOrderCsv(
      csvFile(csvOf([{ ...orderCsvSampleOrders[0], 口座番号: 'abc' }])),
    )

    const [row] = result.rows
    expect(row.valid).toBe(false)
    expect(row.forceable).toBe(false)
    expect(row.errorsIfForced).toEqual([])
    expect(row.forcedOverrides).toEqual([])
  })

  it('[OCA-29] 買付余力不足の注文を強制なしで送ると 400 の ApiError になる', async () => {
    const validation = await validateOrderCsv(
      csvFile(csvOf([orderCsvSampleOrders[0], cashShortOrder])),
    )

    const error = await caught(bulkCreateOrders(validation.rows.map((row) => row.order)))

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 400,
      message: `注文検証エラーが存在するため一括登録を中止しました: 2行目: ${orderCsvCashShortMessage(
        cashShortOrder.数量,
      )}`,
    })
  })

  it('[OCA-30] 買付余力不足の注文を強制で送ると受け付けられ、警告を位置付きで返す', async () => {
    const validation = await validateOrderCsv(
      csvFile(csvOf([orderCsvSampleOrders[0], cashShortOrder])),
    )
    const orders = validation.rows.map((row, index) => ({ ...row.order, forced: index === 1 }))

    const result = await bulkCreateOrders(orders)

    expect(result.totalOrders).toBe(orders.length)
    expect(result.warnings).toEqual([
      { index: 1, message: orderCsvCashShortForcedWarning(cashShortOrder.数量) },
    ])
  })

  it('[OCA-31] 警告の「N行目: 」を 0 始まりの index に分け、形が違えば index は null', async () => {
    const validation = await validateOrderCsv(csvFile(orderCsvTemplateText))
    const orders = validation.rows.map((row) => row.order)
    const NO_ROW = '大口取引の確認が必要です'
    const NO_SPACE = '3行目:空白なし'
    server.use(
      http.post(BULK_PATH, () =>
        HttpResponse.json({ ...bulkOrderCreateResponse, warnings: ['3行目: X', NO_ROW, NO_SPACE] }),
      ),
    )

    const result = await bulkCreateOrders(orders)

    expect(result.warnings).toEqual([
      { index: 2, message: 'X' },
      { index: null, message: NO_ROW },
      { index: null, message: NO_SPACE },
    ])

    const withoutWarnings = { ...bulkOrderCreateResponse }
    delete withoutWarnings.warnings
    server.use(http.post(BULK_PATH, () => HttpResponse.json(withoutWarnings)))

    await expect(bulkCreateOrders(orders)).resolves.toMatchObject({ warnings: [] })
  })
})
