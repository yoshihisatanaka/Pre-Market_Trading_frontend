import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { apiContext, assertRealApi, fetchAll, logExchange, skipUnlessRealApi } from './helpers/realApi.js'

/*
 * CSV一括注文（取込み → プレビュー → 受付完了）を「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/order-csv-real-api.md（タイトル先頭の [OCR-xx] が対応 ID）
 *
 * order-csv.spec.js（OC）とは目的が違う。OC は MSW のモックに当てて 3 画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせ（テンプレートの BOM と
 * Content-Disposition・multipart の事前検証・行の変換・一括受付の本文）だけを見るので、
 * 期待値に**データの中身を書かない**。列名は画面が受け取った GET /orders/csv-spec から、
 * CSV に書く口座・銘柄は実 DB のマスタの先頭の有効な行から、区分の値は実 API のテンプレートの
 * 1 行目から、実行時に読む。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次をそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   3. VITE_USER_CODE を設定しておく（無いと bulk-create が 422 になる）
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test order-csv.real-api
 *
 * OCR-05 だけが実 DB に注文を登録する（1 行）。同じシナリオの中で取消 API で戻すので、
 * 1 回の実行につき取消済み（034）の注文が 1 件残る。ローカルの開発 DB 前提。
 */

const UPLOAD_PATH = '/orders/csv/upload'
const PREVIEW_PATH = '/orders/csv/preview'
const COMPLETE_PATH = '/orders/csv/complete'

// 実 API のパス（openapi.json）。dev サーバの /api プロキシ越しに届く
const SPEC_API_PATH = '/api/orders/csv-spec'
const TEMPLATE_API_PATH = '/api/orders/csv-template'
const VALIDATE_API_PATH = '/api/orders/validate-csv'
const BULK_CREATE_API_PATH = '/api/orders/bulk-create'
const ORDERS_API_PATH = '/api/orders'
const CUSTOMERS_API_PATH = '/api/masters/customers'
const SYMBOLS_API_PATH = '/api/masters/symbols'

// 一覧の応答の配列キー（openapi.json の CustomerListResponse.customers / SymbolListResponse.stocks）
const CUSTOMERS_LIST_KEY = 'customers'
const SYMBOLS_LIST_KEY = 'stocks'

// 存在しない銘柄コード（OCR-03）。銘柄コードは m_銘柄情報 のコードなので、この形は登録されない
const UNKNOWN_SYMBOL = 'E2E-NONE'

const BOM = String.fromCharCode(0xfeff)
const BOM_BYTES = [0xef, 0xbb, 0xbf]

// 見出しの列名（csv-spec の name）。CSV の 1 行目に書く列名そのもの
const COLUMN = {
  branch: '部店',
  account: '口座番号',
  symbol: '銘柄コード',
  side: '売買区分',
  quantity: '数量',
  orderType: '指成区分',
  limitPrice: '指値単価',
  expiryDate: '有効期限',
  orderDate: '受注日',
}

// 売買区分のコード（openapi.json の SideEnum。1: 売 / 3: 買）
const SIDE_BUY = '3'
const ORDER_TYPE_LIMIT = 'LO'

/*
 * テンプレートにサンプル行が無かったときの区分の値（csv-spec の example。
 * バックエンドの CSV_BULK_ORDER_SPEC_METADATA と同じ）。あればテンプレートの 1 行目を優先する。
 */
const FALLBACK_ROW = {
  売買区分: SIDE_BUY,
  数量: '100',
  指成区分: ORDER_TYPE_LIMIT,
  指値単価: '150',
  決済通貨区分: '1',
  証券受渡方法: '100',
  預り売買区分: '0',
  取引: '100',
  勧誘区分: '1',
  受注方法: '1',
  資金性格: '1',
  金銭受渡方法: '000',
  注文チャネル: 'EGY',
  受注時刻: '090100',
  受注者: '999',
  VWAP区分: '0',
  発注範囲: '03',
}

/** beforeAll が実 API から集める下ごしらえ */
const fixture = {
  /** csv-spec の列名（index 順） */
  columnNames: [],
  /** テンプレートの本文（BOM 付き）と Content-Disposition */
  template: { text: '', disposition: '' },
  /** 顧客マスタの先頭の有効な行 */
  customer: null,
  /** 銘柄マスタの先頭の有効な行 */
  symbol: null,
}

/** OCR-05 が登録した注文 ID と、そのとき画面が付けた操作者コード。afterAll が取り消す */
const createdOrders = []

/**
 * CSV を行×列に割る。`"` で囲まれた値の中の `,` `""` 改行を扱い、改行は CRLF / LF のどちらでも受ける
 * （実 API の改行コードは openapi.json に書かれていない）。BOM は落とす。
 * e2e/executions.real-api.spec.js と同じもの（共通化の候補）。
 */
function parseCsv(text) {
  const body = text.startsWith(BOM) ? text.slice(BOM.length) : text
  const records = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < body.length; i += 1) {
    const c = body[i]
    if (quoted) {
      if (c !== '"') field += c
      else if (body[i + 1] === '"') {
        field += '"'
        i += 1
      } else quoted = false
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && body[i + 1] === '\n') i += 1
      row.push(field)
      records.push(row)
      row = []
      field = ''
    } else field += c
  }
  // 末尾に改行が無いときの最後の行
  if (field !== '' || row.length > 0) {
    row.push(field)
    records.push(row)
  }
  return records
}

/** 列名のキーを持つ行を CSV の 1 行にする（無い列は空欄。値にカンマは置かない） */
function toCsvLine(row, columnNames) {
  return columnNames.map((name) => (row[name] == null ? '' : String(row[name]))).join(',')
}

/** 見出しと行から CSV の本文を組む（実 API のテンプレートと同じ CRLF） */
function csvOf(rows, columnNames = fixture.columnNames) {
  return [columnNames.join(','), ...rows.map((row) => toCsvLine(row, columnNames))].join('\r\n') + '\r\n'
}

/** 実行日（JST）の YYYYMMDD。コンテナの TZ に依らない */
function todayJst() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 10).replace(/-/g, '')
}

/** テンプレートの 1 行目（サンプル）を列名のキーで読む。無ければ null */
function templateFirstRow() {
  const [header, ...data] = parseCsv(fixture.template.text)
  const first = data.find((row) => row.length === header.length)
  if (!header || !first) return null
  return Object.fromEntries(header.map((name, index) => [name, first[index]]))
}

/**
 * 実 DB の口座・銘柄で組んだ 1 行。区分の値は実 API のテンプレートの 1 行目（無ければ FALLBACK_ROW）。
 * 買い・数量 1・指値は銘柄の 前日終値（無ければテンプレートの値）。受注日と有効期限は実行日。
 */
function testRow(overrides = {}) {
  const { customer, symbol } = fixture
  const today = todayJst()
  const close = Number(symbol?.前日終値)
  const base = templateFirstRow() ?? FALLBACK_ROW
  return {
    ...base,
    [COLUMN.branch]: customer.部店コード,
    [COLUMN.account]: String(customer.口座番号),
    [COLUMN.symbol]: symbol.銘柄コード,
    [COLUMN.side]: SIDE_BUY,
    [COLUMN.quantity]: '1',
    [COLUMN.orderType]: ORDER_TYPE_LIMIT,
    [COLUMN.limitPrice]:
      Number.isFinite(close) && close > 0 ? close.toFixed(2) : base[COLUMN.limitPrice] || '1',
    [COLUMN.orderDate]: today,
    [COLUMN.expiryDate]: today,
    ...overrides,
  }
}

/** 取込み口の input[type=file]（visually-hidden なので setInputFiles で直接渡す。OC-03 と同じ） */
function fileInputOf(page) {
  return page.getByTestId('order-csv-file').locator('input[type="file"]')
}

/** CSV を取込み口に渡す（一時ファイルは作らない） */
async function chooseCsv(page, text, name = 'orders-real-api.csv') {
  await fileInputOf(page).setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(text, 'utf-8'),
  })
}

/** 実 API の応答のうち、パスとメソッドが合うものを待つ */
function waitForApi(page, pathname, method = 'GET') {
  return page.waitForResponse(
    (res) => new URL(res.url()).pathname === pathname && res.request().method() === method,
  )
}

/** 取込み画面を開き、画面が受け取った csv-spec の応答と、CSVフォーマットの表の描画を待つ */
async function openUpload(page) {
  const response = waitForApi(page, SPEC_API_PATH)
  await page.goto(UPLOAD_PATH)
  const res = await response
  expect(res.ok(), `${SPEC_API_PATH} が ${res.status()} を返した`).toBe(true)
  const body = await res.json()
  await expect(formatRowsOf(page)).toHaveCount(body.columns.length)
  await assertRealApi(page)
  return body
}

/** 取込み画面で CSV を選んで「内容を確認する」を押し、事前検証の応答を返す */
async function confirm(page, text, label) {
  await openUpload(page)
  await chooseCsv(page, text)
  const response = waitForApi(page, VALIDATE_API_PATH, 'POST')
  await page.getByTestId('order-csv-confirm').click()
  const res = await response
  await logExchange(label, res)
  return res
}

/** CSVフォーマットの表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function formatRowsOf(page) {
  return page.getByTestId('order-csv-format-table').getByTestId('data-table-row')
}

function previewRowsOf(page) {
  return page.getByTestId('order-csv-preview-table').getByTestId('data-table-row')
}

function completeRowsOf(page) {
  return page.getByTestId('order-csv-complete-table').getByTestId('data-table-row')
}

/** プレビューの件数の 3 枠（取込み件数 / 正常 / エラー） */
async function expectPreviewCounts(page, { total, valid, invalid }) {
  await expect(page).toHaveURL(new RegExp(`${PREVIEW_PATH}$`))
  await expect(page.getByTestId('order-csv-preview-total')).toContainText(String(total))
  await expect(page.getByTestId('order-csv-preview-valid')).toContainText(String(valid))
  await expect(page.getByTestId('order-csv-preview-invalid')).toContainText(String(invalid))
  await expect(previewRowsOf(page)).toHaveCount(total)
}

/** 注文を取り消す（OCR-05 の後片付け）。登録したときと同じ操作者で呼ぶ */
async function cancelOrder(playwright, { orderId, userCode }) {
  const api = await apiContext(playwright, { userCode })
  const res = await api.post(`${ORDERS_API_PATH}/${orderId}/cancel`, { data: {} })
  const body = await logExchange(`cancel ${orderId}`, res)
  await api.dispose()
  return { ok: res.ok(), status: res.status(), body }
}

test.describe('CSV一括注文（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test.beforeAll(async ({ playwright }) => {
    const api = await apiContext(playwright)

    const spec = await api.get(SPEC_API_PATH)
    expect(spec.ok(), `実 API から ${SPEC_API_PATH} を取得できない: ${spec.status()}`).toBe(true)
    fixture.columnNames = ((await spec.json()).columns ?? [])
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((column) => column.name)
    expect(fixture.columnNames.length, 'csv-spec の列が 0 件').toBeGreaterThan(0)

    const template = await api.get(TEMPLATE_API_PATH)
    expect(template.ok(), `実 API から ${TEMPLATE_API_PATH} を取得できない: ${template.status()}`).toBe(
      true,
    )
    fixture.template = {
      text: (await template.body()).toString('utf-8'),
      disposition: template.headers()['content-disposition'] ?? '',
    }

    // 先頭の有効な行。部店コードの無い口座は CSV に書けないので飛ばす
    const customers = await fetchAll(api, CUSTOMERS_API_PATH, CUSTOMERS_LIST_KEY)
    fixture.customer =
      customers.find((row) => row.取消区分 === 0 && row.部店コード && row.口座番号 != null) ?? null
    const symbols = await fetchAll(api, SYMBOLS_API_PATH, SYMBOLS_LIST_KEY)
    fixture.symbol = symbols.find((row) => row.取消区分 === 0 && row.銘柄コード) ?? null
    await api.dispose()

    console.log(
      `[beforeAll] 列 ${fixture.columnNames.length} / 口座 ${fixture.customer?.部店コード}-${fixture.customer?.口座番号} / 銘柄 ${fixture.symbol?.銘柄コード}`,
    )
  })

  test.afterAll(async ({ playwright }) => {
    // OCR-05 が途中で落ちて取り消せなかった注文を残さない
    for (const order of createdOrders.filter((item) => !item.canceled)) {
      const result = await cancelOrder(playwright, order)
      if (result.ok) order.canceled = true
      else console.log(`[afterAll] 注文 ${order.orderId} を取り消せない（手で取り消すこと）: ${result.body}`)
    }
  })

  test('[OCR-01] テンプレートDL で BOM 付きのテンプレートがサーバのファイル名で保存され、見出しが csv-spec と一致する', async ({
    page,
  }) => {
    const spec = await openUpload(page)
    const columnNames = spec.columns
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((column) => column.name)

    const response = waitForApi(page, TEMPLATE_API_PATH)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('order-csv-template').click(),
    ])
    const res = await response
    expect(res.ok(), `${TEMPLATE_API_PATH} が ${res.status()} を返した`).toBe(true)

    // ファイル名はサーバが Content-Disposition で付ける（api 層は読めなければ既定の名前に倒すので、応答側から確かめる）
    const disposition = res.headers()['content-disposition'] ?? ''
    const expectedName = /filename="?([^";]+)"?/i.exec(disposition)?.[1]?.trim()
    expect(expectedName, `Content-Disposition にファイル名が無い: "${disposition}"`).toBeTruthy()
    expect(download.suggestedFilename()).toBe(expectedName)

    const bytes = readFileSync(await download.path())
    expect([...bytes.subarray(0, 3)], 'テンプレートが UTF-8 の BOM で始まらない').toEqual(BOM_BYTES)

    const [header, ...data] = parseCsv(bytes.toString('utf-8'))
    expect(header).toEqual(columnNames)
    // サンプル行付き（openapi.json の説明）。行数は固定しないが、各行の列数は見出しと同じ
    expect(data.length).toBeGreaterThan(0)
    for (const row of data) expect(row, `列数が見出しと違う行: ${row.join(',')}`).toHaveLength(header.length)

    await expect(formatRowsOf(page)).toHaveCount(columnNames.length)
    await expect(page.getByTestId('order-csv-template-error')).toHaveCount(0)
  })

  test('[OCR-02] 実 DB の口座・銘柄で組んだ 1 行の CSV が事前検証に受理され、プレビューに OK で出る', async ({
    page,
  }) => {
    test.skip(!fixture.customer || !fixture.symbol, '顧客マスタか銘柄マスタに有効な行が無い')
    const row = testRow()

    const res = await confirm(page, csvOf([row]), 'OCR-02')
    expect(res.request().headers()['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(res.status()).toBe(200)

    await expectPreviewCounts(page, { total: 1, valid: 1, invalid: 0 })
    await expect(page.getByTestId('order-csv-preview-has-error')).toHaveCount(0)

    const first = previewRowsOf(page).first()
    const cells = first.getByRole('cell')
    await expect(cells.nth(1)).toHaveText('OK')
    // 口座番号は「部店-口座番号」（api 層が rows[].data の日本語キーを読めている証拠）
    await expect(cells.nth(2)).toHaveText(`${row[COLUMN.branch]}-${row[COLUMN.account]}`)
    // 顧客名はサーバが口座から引く（customer_name）。同じ DB の顧客マスタの値と一致する
    await expect(cells.nth(3)).toHaveText(fixture.customer.顧客名 ?? '')
    await expect(cells.nth(4)).toContainText(row[COLUMN.symbol])
    await expect(first.getByTestId('order-csv-preview-error')).toHaveCount(0)

    const submit = page.getByTestId('order-csv-preview-submit')
    await expect(submit).toHaveText('1件を受付する')
    await expect(submit).toBeEnabled()
  })

  test('[OCR-03] 存在しない銘柄コードの行は NG になり、理由が出て受付できない', async ({ page }) => {
    test.skip(!fixture.customer || !fixture.symbol, '顧客マスタか銘柄マスタに有効な行が無い')
    const row = testRow({ [COLUMN.symbol]: UNKNOWN_SYMBOL })

    const res = await confirm(page, csvOf([row]), 'OCR-03')
    expect(res.status()).toBe(200)

    await expectPreviewCounts(page, { total: 1, valid: 0, invalid: 1 })
    await expect(page.getByTestId('order-csv-preview-has-error')).toContainText('エラーがあります。')

    const first = previewRowsOf(page).first()
    await expect(first.getByRole('cell').nth(1)).toHaveText('NG')
    // 文言はサーバが決めるので固定しない。理由が 1 つ以上あることだけを見る
    expect(await first.getByTestId('order-csv-preview-error').count()).toBeGreaterThan(0)

    const submit = page.getByTestId('order-csv-preview-submit')
    await expect(submit).toHaveText('エラーを修正してください')
    await expect(submit).toBeDisabled()
  })

  test('[OCR-04] 見出しの列が足りない CSV は 400 になり、取込み画面に留まって理由が出る', async ({
    page,
  }) => {
    const header = fixture.columnNames.slice(0, -1)
    const res = await confirm(page, csvOf([], header), 'OCR-04')
    expect(res.status()).toBe(400)

    await expect(page).toHaveURL(new RegExp(`${UPLOAD_PATH}$`))
    const error = page.getByTestId('order-csv-validate-error')
    await expect(error).toContainText('内容を確認できませんでした。')
    // 理由は ErrorResponse.detail（文言は固定しない）。既定の文言だけなら detail が読めていない
    const detail = (await res.json())?.detail
    if (typeof detail === 'string' && detail) await expect(error).toContainText(detail)
  })

  test('[OCR-05] 「1件を受付する」が実 API に受理され、受付完了に採番された注文ID が出て、取消で戻せる', async ({
    page,
    playwright,
  }) => {
    test.skip(!fixture.customer || !fixture.symbol, '顧客マスタか銘柄マスタに有効な行が無い')
    const row = testRow()

    const validate = await confirm(page, csvOf([row]), 'OCR-05 validate')
    expect(validate.status()).toBe(200)
    await expectPreviewCounts(page, { total: 1, valid: 1, invalid: 0 })

    const response = waitForApi(page, BULK_CREATE_API_PATH, 'POST')
    await page.getByTestId('order-csv-preview-submit').click()
    const res = await response
    const body = await logExchange('OCR-05', res)

    // 本文は OrderRequest の配列。作成者 は事前検証の行に無く、api 層が /auth/me の操作者コードを足す
    const sent = res.request().postDataJSON()
    expect(sent.orders).toHaveLength(1)
    expect(sent.orders[0]).toHaveProperty('作成者')
    expect(sent.orders[0][COLUMN.symbol]).toBe(row[COLUMN.symbol])
    // 取消は登録したときと同じ操作者で行う（X-User-Code が無ければ 422 で、ここで止まる）
    const userCode = res.request().headers()['x-user-code'] ?? ''
    expect(res.status(), `実 API が一括受付を受理しない: ${body}`).toBe(200)

    const created = JSON.parse(body)
    expect(created.order_ids, '採番された注文 ID が 1 件でない').toHaveLength(1)
    const [orderId] = created.order_ids
    createdOrders.push({ orderId, userCode, canceled: false })
    console.log(`[OCR-05] 登録した注文 ID: ${orderId}（取消で戻す）`)

    await expect(page).toHaveURL(new RegExp(`${COMPLETE_PATH}$`))
    await expect(page.getByTestId('order-csv-complete-total')).toContainText('1')
    await expect(page.getByTestId('order-csv-complete-pending')).toContainText('1')
    await expect(page.getByTestId('order-csv-complete-message')).toContainText(
      'CSV注文を受け付けました。',
    )
    const rows = completeRowsOf(page)
    await expect(rows).toHaveCount(1)
    await expect(rows.first().getByRole('cell').last()).toHaveText(`#${orderId}`)

    // 未発注（000）は即時取消（034）になる（openapi.json の取消 API の説明）
    const result = await cancelOrder(playwright, { orderId, userCode })
    expect(result.ok, `登録した注文 ${orderId} を取り消せない: ${result.status} ${result.body}`).toBe(
      true,
    )
    expect(JSON.parse(result.body).success).toBe(true)
    createdOrders[createdOrders.length - 1].canceled = true
  })

  test('[OCR-06] 実 API のテンプレートをそのまま取り込むと、サンプル行の数だけプレビューに出る', async ({
    page,
  }) => {
    const [, ...data] = parseCsv(fixture.template.text)
    const sampleCount = data.length
    test.skip(sampleCount === 0, 'テンプレートにサンプル行が無い')

    const res = await confirm(page, fixture.template.text, 'OCR-06')
    expect(res.status()).toBe(200)

    await expect(page).toHaveURL(new RegExp(`${PREVIEW_PATH}$`))
    await expect(page.getByTestId('order-csv-preview-total')).toContainText(String(sampleCount))
    const rows = previewRowsOf(page)
    await expect(rows).toHaveCount(sampleCount)
    // サンプルの口座・銘柄が実 DB に在るかは問わない。OK / NG のどちらかに落ちていればよい
    for (let index = 0; index < sampleCount; index += 1) {
      await expect(rows.nth(index).getByRole('cell').nth(1)).toHaveText(/^(OK|NG)$/)
    }
    await expect(page.getByTestId('order-csv-preview-submit-error')).toHaveCount(0)
  })
})
