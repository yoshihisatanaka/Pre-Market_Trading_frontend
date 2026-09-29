import { expect, test } from '@playwright/test'
import { orderCsvColumns } from '../src/mocks/fixtures/orderCsv'
import { mockApi } from './helpers/mockApi'

const UPLOAD_PATH = '/orders/csv/upload'
const SPEC_PATH = '*/api/orders/csv-spec'

const SERVER_ERROR = 'サーバーでエラーが発生しました。'

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
// 取込み画面の CSVフォーマット（GET /orders/csv-spec）の 4 状態と、ファイル選択で「内容を確認する」が
// 押せるようになることを守る。テンプレートDL・事前検証は処理が未実装なので、押したあとの動きは見ない。
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
})
