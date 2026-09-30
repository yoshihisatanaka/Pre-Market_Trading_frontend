import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import {
  BULK_ORDER_FIRST_ID,
  ORDER_CSV_TEMPLATE_FILENAME,
  orderCsvColumnNames,
  orderCsvColumns,
  orderCsvCustomerNameOf,
  orderCsvDetailsOf,
  orderCsvSampleOrders,
  orderCsvTemplateText,
  orderCsvValidateWithErrorsResponse,
} from '../src/mocks/fixtures/orderCsv'
import { mockApi } from './helpers/mockApi'

const UPLOAD_PATH = '/orders/csv/upload'
const PREVIEW_PATH = '/orders/csv/preview'
const COMPLETE_PATH = '/orders/csv/complete'
const SPEC_PATH = '*/api/orders/csv-spec'
const VALIDATE_PATH = '*/api/orders/validate-csv'
const BULK_CREATE_PATH = '*/api/orders/bulk-create'

const SERVER_ERROR = 'サーバーでエラーが発生しました。'

const BOM = String.fromCharCode(0xfeff)

/*
 * 事前検証のモックが返す文言。モックの handlers は文言を export していないので、
 * 同じ文言を持つフィクスチャの見本（orderCsvValidateWithErrorsResponse）から引く。
 *   rows[0] … 数量 10000 以上の警告 / rows[1] … 指値なのに指値単価が無い / rows[2] … 口座番号が整数でない
 */
const [largeQuantityRow, missingLimitPriceRow, badAccountRow] =
  orderCsvValidateWithErrorsResponse.rows
const LARGE_QUANTITY_WARNING = largeQuantityRow.warnings[0]
const MISSING_LIMIT_PRICE_ERROR = missingLimitPriceRow.errors[0]
const BAD_ACCOUNT_ERROR = badAccountRow.errors[0]

/** 1 行の注文（列名のキー）を CSV の 1 行にする（null は空欄） */
function toCsvLine(order) {
  return orderCsvColumnNames.map((name) => (order[name] == null ? '' : String(order[name]))).join(',')
}

/** ヘッダー（既定は 22 列すべて）と注文の行から CSV の本文を組む */
function csvOf(orders, header = orderCsvColumnNames) {
  return [header.join(','), ...orders.map(toCsvLine)].join('\r\n') + '\r\n'
}

/** CSV を取込み口に渡す */
async function chooseCsv(page, text, name = 'orders-e2e.csv') {
  await fileInputOf(page).setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(text, 'utf-8'),
  })
}

/** 取込み画面で CSV を選んで「内容を確認する」を押し、プレビューへ進む */
async function goToPreview(page, text = orderCsvTemplateText) {
  await page.goto(UPLOAD_PATH)
  await chooseCsv(page, text)
  await page.getByTestId('order-csv-confirm').click()
  await expect(page).toHaveURL(new RegExp(`${PREVIEW_PATH}$`))
}

/** テンプレートの 3 行でプレビューを経て受付完了まで進む */
async function goToComplete(page) {
  await goToPreview(page)
  await page.getByTestId('order-csv-preview-submit').click()
  await expect(page).toHaveURL(new RegExp(`${COMPLETE_PATH}$`))
}

function previewRowsOf(page) {
  return page.getByTestId('order-csv-preview-table').getByTestId('data-table-row')
}

function completeRowsOf(page) {
  return page.getByTestId('order-csv-complete-table').getByTestId('data-table-row')
}

// 必須でない列（既定モックでは「指値単価」の 1 列だけ）。件数や位置はフィクスチャから導く
const optionalColumn = orderCsvColumns.find((column) => !column.required)
const optionalIndex = orderCsvColumns.indexOf(optionalColumn)
const firstColumn = orderCsvColumns[0]
const lastColumn = orderCsvColumns[orderCsvColumns.length - 1]

/** CSVフォーマットの表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function formatRowsOf(page) {
  return page.getByTestId('order-csv-format-table').getByTestId('data-table-row')
}

/** 取込み口の input[type=file]（visually-hidden なので setInputFiles で直接渡す） */
function fileInputOf(page) {
  return page.getByTestId('order-csv-file').locator('input[type="file"]')
}

function headingOf(page, title) {
  return page.getByRole('heading', { name: title, exact: true })
}

// シナリオ: docs/e2e/order-csv.md（タイトル先頭の [OC-nn] が対応 ID）
// 取込み → プレビュー → 受付完了の 1 本の業務フローを守る。取込み画面の CSVフォーマット
// （GET /orders/csv-spec）の 4 状態、テンプレートDL、事前検証の OK / NG / 警告の出し分けと失敗、
// 一括受付とその失敗、URL を直接開いたときの空状態、画面間の遷移、受付後の「戻る」での二重受付の防止。
test.describe('CSV一括注文', () => {
  test('[OC-01] サイドメニューから開くと取込みカードとフォーマットカードが表示される', async ({
    page,
  }) => {
    await page.goto('/')

    await page
      .getByRole('navigation', { name: 'メインメニュー' })
      .getByRole('link', { name: 'CSV一括注文', exact: true })
      .click()

    await expect(page).toHaveURL(new RegExp(`${UPLOAD_PATH}$`))
    await expect(headingOf(page, 'CSV一括注文')).toBeVisible()
    await expect(page.getByText('CSVファイル取込み', { exact: true })).toBeVisible()
    await expect(page.getByText('CSVフォーマット', { exact: true })).toBeVisible()
    await expect(page.getByTestId('order-csv-template')).toHaveText('テンプレートDL')
  })

  test('[OC-02] ファイル未選択では案内文が出て「内容を確認する」が押せない', async ({ page }) => {
    await page.goto(UPLOAD_PATH)

    const dropZone = page.getByTestId('order-csv-file')
    await expect(dropZone).toContainText('クリックまたはドラッグ＆ドロップでCSVを選択')
    await expect(dropZone).toContainText('UTF-8 / Shift-JIS 対応 · .csv ファイル')

    const confirm = page.getByTestId('order-csv-confirm')
    await expect(confirm).toHaveText('内容を確認する')
    await expect(confirm).toBeDisabled()
  })

  test('[OC-03] CSV ファイルを選ぶとファイル名が出て「内容を確認する」が押せる', async ({
    page,
  }) => {
    await page.goto(UPLOAD_PATH)
    await expect(page.getByTestId('order-csv-confirm')).toBeDisabled()

    const header = orderCsvColumns.map((column) => column.name).join(',')
    await fileInputOf(page).setInputFiles({
      name: 'orders-e2e.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`${header}\n`, 'utf-8'),
    })

    const dropZone = page.getByTestId('order-csv-file')
    await expect(dropZone).toContainText('orders-e2e.csv')
    await expect(dropZone).not.toContainText('クリックまたはドラッグ＆ドロップでCSVを選択')
    await expect(page.getByTestId('order-csv-confirm')).toBeEnabled()
  })

  test('[OC-04] CSVフォーマットに凡例と全列の表が表示される', async ({ page }) => {
    await page.goto(UPLOAD_PATH)

    const legend = page.getByTestId('order-csv-format-legend')
    await expect(legend).toContainText('1行目はヘッダー行です')
    await expect(legend).toContainText('赤字は必須項目です')

    const table = page.getByTestId('order-csv-format-table')
    await expect(table.getByRole('columnheader')).toHaveText(['列名', '説明', '例', '必須'])

    const rows = formatRowsOf(page)
    await expect(rows).toHaveCount(orderCsvColumns.length)
    await expect(rows.first().getByRole('cell').first()).toHaveText(firstColumn.name)
    await expect(rows.first()).toContainText(firstColumn.description)
    await expect(rows.last().getByRole('cell').first()).toHaveText(lastColumn.name)
  })

  test('[OC-05] 条件付きの列だけ「任意」で、条件が説明に添えられる', async ({ page }) => {
    await page.goto(UPLOAD_PATH)

    const rows = formatRowsOf(page)
    await expect(rows).toHaveCount(orderCsvColumns.length)

    const optionalRow = rows.nth(optionalIndex)
    const cells = optionalRow.getByRole('cell')
    await expect(cells.nth(0)).toHaveText(optionalColumn.name)
    await expect(cells.nth(1)).toContainText(optionalColumn.condition)
    await expect(cells.nth(3)).toContainText('任意')

    // 必須欄（4 列目）が「必須」になる行は、必須でない 1 列を除いた残り全部
    const requiredCells = rows.locator('td:nth-child(4)', { hasText: '必須' })
    await expect(requiredCells).toHaveCount(orderCsvColumns.filter((c) => c.required).length)
  })

  test('[OC-06] 応答が返るまで CSVフォーマットに読み込み中の表示が出る', async ({ page }) => {
    // ?mockDelay=<ミリ秒> を付けた URL だけ /api/* の応答が遅れる（src/mocks/handlers/index.js）
    await page.goto(`${UPLOAD_PATH}?mockDelay=1000`)

    await expect(page.getByTestId('order-csv-format-loading')).toBeVisible()
    await expect(page.getByTestId('order-csv-format-table')).toHaveCount(0)

    await expect(page.getByTestId('order-csv-format-loading')).toHaveCount(0)
    await expect(formatRowsOf(page)).toHaveCount(orderCsvColumns.length)
  })

  test('[OC-07] 列の仕様の取得が 500 だとエラーと再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [{ path: SPEC_PATH, status: 500, body: { detail: SERVER_ERROR } }])
    await page.goto(UPLOAD_PATH)

    const error = page.getByTestId('order-csv-format-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText(SERVER_ERROR)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()

    await expect(page.getByTestId('order-csv-format-legend')).toHaveCount(0)
    await expect(page.getByTestId('order-csv-format-table')).toHaveCount(0)
    // 取込みカードは残る
    await expect(page.getByTestId('order-csv-file')).toBeVisible()
    await expect(page.getByTestId('order-csv-confirm')).toBeVisible()
  })

  test('[OC-08] API が回復してから「再試行」を押すと表が表示される', async ({ page }) => {
    await mockApi(page, [{ path: SPEC_PATH, status: 500, body: { detail: SERVER_ERROR } }])
    await page.goto(UPLOAD_PATH)
    const error = page.getByTestId('order-csv-format-error')
    await expect(error).toBeVisible()

    /*
     * 回復の再現（e2e/incidents.spec.js の IN-11 と同じ手）。mockApi() の差し替えは起動時に
     * worker.use() へ積まれるので、dev サーバが配る MSW の worker を同じ URL で import し、
     * 差し替えだけを外して既定ハンドラへ戻す。
     */
    await page.evaluate(async () => {
      const { worker } = await import('/src/mocks/browser.js')
      worker.resetHandlers()
    })

    await error.getByRole('button', { name: '再試行' }).click()

    await expect(error).toHaveCount(0)
    await expect(formatRowsOf(page)).toHaveCount(orderCsvColumns.length)
  })

  test('[OC-09] 列が 0 件だと定義が無い旨が出て表は出ない', async ({ page }) => {
    await mockApi(page, [{ path: SPEC_PATH, body: { total_columns: 0, columns: [] } }])
    await page.goto(UPLOAD_PATH)

    await expect(page.getByTestId('order-csv-format-empty')).toHaveText(
      'CSVフォーマットの定義がありません',
    )
    await expect(page.getByTestId('order-csv-format-legend')).toHaveCount(0)
    await expect(page.getByTestId('order-csv-format-table')).toHaveCount(0)
  })

  /*
   * 保留（fixme）: E2E では BOM を確かめられない。
   * E2E の接続先 http://frontend:5173 は secure context ではないので MSW が Service Worker を使えず、
   * ページ内の fallback mode で XHR を横取りする。そのインターセプタが responseType: 'blob' の応答から
   * 先頭の BOM を落とす（同じページで fetch なら EF BB BF が残り、XHR の blob だと残らないことを確認済み）。
   * 画面は受け取った Blob をそのまま保存しているので、BOM の保持は実 API の E2E で確かめる。
   */
  test.fixme('[OC-10] テンプレートDL で BOM 付きのテンプレートがサーバのファイル名で保存される', async ({
    page,
  }) => {
    await page.goto(UPLOAD_PATH)

    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('order-csv-template').click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toBe(ORDER_CSV_TEMPLATE_FILENAME)
    // BOM を text で読むと落ちるので、バイト列のまま UTF-8 として読んで先頭を見る
    const content = (await readFile(await download.path())).toString('utf-8')
    const expectedHead = `${BOM}${orderCsvColumnNames.join(',')}`
    expect(content.slice(0, expectedHead.length)).toBe(expectedHead)
    await expect(page.getByTestId('order-csv-template-error')).toHaveCount(0)
  })

  test('[OC-11] 全行が正常な CSV を確認するとプレビューに件数と行が出て受付できる', async ({
    page,
  }) => {
    await goToPreview(page)

    const total = orderCsvSampleOrders.length
    await expect(page.getByTestId('order-csv-preview-total')).toContainText(String(total))
    await expect(page.getByTestId('order-csv-preview-valid')).toContainText(String(total))
    await expect(page.getByTestId('order-csv-preview-invalid')).toContainText('0')
    await expect(page.getByTestId('order-csv-preview-has-error')).toHaveCount(0)

    const rows = previewRowsOf(page)
    await expect(rows).toHaveCount(total)
    for (let index = 0; index < total; index += 1) {
      await expect(rows.nth(index).getByRole('cell').nth(1)).toHaveText('OK')
    }

    const [first] = orderCsvSampleOrders
    const firstRow = rows.first()
    await expect(firstRow).toContainText(`${first.部店}-${first.口座番号}`)
    await expect(firstRow).toContainText(orderCsvCustomerNameOf(first))
    await expect(firstRow).toContainText(first.銘柄コード)
    await expect(firstRow).toContainText(orderCsvDetailsOf(first).stock_name)

    const submit = page.getByTestId('order-csv-preview-submit')
    await expect(submit).toHaveText(`${total}件を受付する`)
    await expect(submit).toBeEnabled()
  })

  test('[OC-12] 事前検証が 500 だと取込み画面に留まり理由が出る', async ({ page }) => {
    await mockApi(page, [
      { method: 'post', path: VALIDATE_PATH, status: 500, body: { detail: SERVER_ERROR } },
    ])
    await page.goto(UPLOAD_PATH)
    await chooseCsv(page, orderCsvTemplateText)
    await page.getByTestId('order-csv-confirm').click()

    const error = page.getByTestId('order-csv-validate-error')
    await expect(error).toContainText('内容を確認できませんでした。')
    await expect(error).toContainText(SERVER_ERROR)
    await expect(page).toHaveURL(new RegExp(`${UPLOAD_PATH}$`))
  })

  test('[OC-13] 「N件を受付する」を押すと受付完了に件数と採番された注文ID が出る', async ({
    page,
  }) => {
    await goToComplete(page)

    const total = orderCsvSampleOrders.length
    await expect(page.getByTestId('order-csv-complete-total')).toContainText(String(total))
    await expect(page.getByTestId('order-csv-complete-pending')).toContainText(String(total))
    await expect(page.getByTestId('order-csv-complete-message')).toContainText(
      'CSV注文を受け付けました。',
    )

    const rows = completeRowsOf(page)
    await expect(rows).toHaveCount(total)
    for (let index = 0; index < total; index += 1) {
      // 注文ID は表の最後の列。一括受付のモックは送った並びで連番を振る
      await expect(rows.nth(index).getByRole('cell').last()).toHaveText(
        `#${BULK_ORDER_FIRST_ID + index}`,
      )
    }
    await expect(rows.first()).toContainText(orderCsvCustomerNameOf(orderCsvSampleOrders[0]))
  })

  test('[OC-14] NG 行が混ざるとエラーの帯と行ごとの理由が出て受付できない', async ({ page }) => {
    const [ok] = orderCsvSampleOrders
    const csv = csvOf([
      ok,
      { ...ok, 指成区分: 'LO', 指値単価: null },
      { ...ok, 口座番号: 'abc' },
    ])
    await goToPreview(page, csv)

    await expect(page.getByTestId('order-csv-preview-total')).toContainText('3')
    await expect(page.getByTestId('order-csv-preview-valid')).toContainText('1')
    await expect(page.getByTestId('order-csv-preview-invalid')).toContainText('2')
    await expect(page.getByTestId('order-csv-preview-has-error')).toContainText(
      'エラーがあります。',
    )

    const rows = previewRowsOf(page)
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0).getByRole('cell').nth(1)).toHaveText('OK')
    await expect(rows.nth(0).getByTestId('order-csv-preview-error')).toHaveCount(0)

    await expect(rows.nth(1).getByRole('cell').nth(1)).toHaveText('NG')
    await expect(rows.nth(1).getByTestId('order-csv-preview-error')).toContainText(
      MISSING_LIMIT_PRICE_ERROR,
    )

    await expect(rows.nth(2).getByRole('cell').nth(1)).toHaveText('NG')
    await expect(rows.nth(2).getByTestId('order-csv-preview-error')).toContainText(
      BAD_ACCOUNT_ERROR,
    )

    const submit = page.getByTestId('order-csv-preview-submit')
    await expect(submit).toHaveText('エラーを修正してください')
    await expect(submit).toBeDisabled()
  })

  test('[OC-15] 警告だけの行は OK のまま警告が出て受付できる', async ({ page }) => {
    const [first, ...rest] = orderCsvSampleOrders
    await goToPreview(page, csvOf([{ ...first, 数量: 12000 }, ...rest]))

    const total = orderCsvSampleOrders.length
    const rows = previewRowsOf(page)
    await expect(rows).toHaveCount(total)
    for (let index = 0; index < total; index += 1) {
      await expect(rows.nth(index).getByRole('cell').nth(1)).toHaveText('OK')
    }
    await expect(rows.first().getByTestId('order-csv-preview-warning')).toContainText(
      LARGE_QUANTITY_WARNING,
    )
    await expect(rows.first().getByTestId('order-csv-preview-error')).toHaveCount(0)
    await expect(page.getByTestId('order-csv-preview-has-error')).toHaveCount(0)

    const submit = page.getByTestId('order-csv-preview-submit')
    await expect(submit).toHaveText(`${total}件を受付する`)
    await expect(submit).toBeEnabled()
  })

  test('[OC-16] ヘッダーの列が足りない CSV は取込み画面に留まり不足の列名が出る', async ({
    page,
  }) => {
    const missing = '銘柄コード'
    const header = orderCsvColumnNames.filter((name) => name !== missing)
    await page.goto(UPLOAD_PATH)
    await chooseCsv(page, `${header.join(',')}\r\n`)
    await page.getByTestId('order-csv-confirm').click()

    const error = page.getByTestId('order-csv-validate-error')
    await expect(error).toContainText('CSVヘッダーに不足があります')
    await expect(error).toContainText(missing)
    await expect(page).toHaveURL(new RegExp(`${UPLOAD_PATH}$`))
  })

  test('[OC-17] 一括受付が 400 だとプレビューに留まり理由が出る', async ({ page }) => {
    const reason = '2行目: 指定された銘柄コードが存在しません'
    await mockApi(page, [
      { method: 'post', path: BULK_CREATE_PATH, status: 400, body: { detail: reason } },
    ])
    await goToPreview(page)
    await page.getByTestId('order-csv-preview-submit').click()

    const error = page.getByTestId('order-csv-preview-submit-error')
    await expect(error).toContainText('受付できませんでした。')
    await expect(error).toContainText(reason)
    await expect(page).toHaveURL(new RegExp(`${PREVIEW_PATH}$`))
    await expect(previewRowsOf(page)).toHaveCount(orderCsvSampleOrders.length)
  })

  test('[OC-18] プレビューを URL で直接開くと空状態で、取込みへ戻れる', async ({ page }) => {
    await page.goto(PREVIEW_PATH)

    await expect(page.getByTestId('order-csv-preview-empty')).toContainText(
      '取込み内容がありません。',
    )
    await expect(page.getByTestId('order-csv-preview-total')).toHaveCount(0)
    await expect(page.getByTestId('order-csv-preview-table')).toHaveCount(0)

    await page.getByTestId('order-csv-preview-to-upload').click()
    await expect(page).toHaveURL(new RegExp(`${UPLOAD_PATH}$`))
    await expect(page.getByTestId('order-csv-file')).toBeVisible()
  })

  test('[OC-19] 受付完了を URL で直接開くと空状態で、取込みへ戻れる', async ({ page }) => {
    await page.goto(COMPLETE_PATH)

    await expect(page.getByTestId('order-csv-complete-empty')).toContainText(
      '受付結果がありません。',
    )
    await expect(page.getByTestId('order-csv-complete-total')).toHaveCount(0)
    await expect(page.getByTestId('order-csv-complete-table')).toHaveCount(0)

    await page.getByTestId('order-csv-complete-to-upload').click()
    await expect(page).toHaveURL(new RegExp(`${UPLOAD_PATH}$`))
    await expect(page.getByTestId('order-csv-file')).toBeVisible()
  })

  test('[OC-20] プレビューの「← CSVを再取込みする」で取込み画面へ戻る', async ({ page }) => {
    await goToPreview(page)

    const back = page.getByTestId('order-csv-preview-back')
    await expect(back).toHaveText('← CSVを再取込みする')
    await back.click()

    await expect(page).toHaveURL(new RegExp(`${UPLOAD_PATH}$`))
    await expect(page.getByTestId('order-csv-file')).toBeVisible()
  })

  test('[OC-21] プレビューのカードの「← 再取込み」で取込み画面へ戻る', async ({ page }) => {
    await goToPreview(page)

    const reupload = page.getByTestId('order-csv-preview-reupload')
    await expect(reupload).toHaveText('← 再取込み')
    await reupload.click()

    await expect(page).toHaveURL(new RegExp(`${UPLOAD_PATH}$`))
    await expect(page.getByTestId('order-csv-file')).toBeVisible()
  })

  test('[OC-22] 「続けてCSV取込み」でファイル未選択の取込み画面へ戻る', async ({ page }) => {
    await goToComplete(page)

    await page.getByTestId('order-csv-complete-continue').click()

    await expect(page).toHaveURL(new RegExp(`${UPLOAD_PATH}$`))
    await expect(page.getByTestId('order-csv-file')).toContainText(
      'クリックまたはドラッグ＆ドロップでCSVを選択',
    )
    await expect(page.getByTestId('order-csv-confirm')).toBeDisabled()
  })

  test('[OC-23] 「Dream登録状況へ」で Dream登録状況の画面へ移る', async ({ page }) => {
    await goToComplete(page)

    await page.getByTestId('order-csv-complete-dream-status').click()

    await expect(page).toHaveURL(/\/orders\/dream-status$/)
    await expect(headingOf(page, 'Dream登録状況')).toBeVisible()
  })

  test('[OC-24] 受付後に「戻る」でプレビューへ戻っても空状態で、もう一度受け付けられない', async ({
    page,
  }) => {
    await goToComplete(page)

    await page.goBack()

    await expect(page).toHaveURL(new RegExp(`${PREVIEW_PATH}$`))
    await expect(page.getByTestId('order-csv-preview-empty')).toContainText(
      '取込み内容がありません。',
    )
    await expect(page.getByTestId('order-csv-preview-submit')).toHaveCount(0)
    await expect(page.getByTestId('order-csv-preview-table')).toHaveCount(0)
  })
})
