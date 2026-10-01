import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { closedMizuhoClosingStatus, mizuhoClosingStatus } from '../src/mocks/fixtures/closing'
import { mizuhoExecutions } from '../src/mocks/fixtures/mizuhoExecutions'
import { mizuhoOrders } from '../src/mocks/fixtures/mizuhoOrders'
import { formatDateTime } from '../src/utils/format'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/mizuho-operations.md（タイトル先頭の [MZ-nn] が対応 ID）
// 締めカード（受付中 / 締め済）と確認ダイアログの出し分け、締め・締め解除・注文ファイル作成の実行と通知、
// 件数カード、約定一覧の検索と URL の同期、約定一覧の「CSV出力」（MZ-23〜25）、および締め状態と約定一覧が互いに独立して 4 状態を出すことを守る。
// mockApi() は固定の body を返すだけで検索条件を解釈しない。絞り込み（MZ-09〜14）は
// クエリを実際に処理する既定ハンドラ（src/mocks/handlers/mizuhoExecutions.js）で検証する。
// 注文ファイルは締め済でないとモックも 400 を返すので、画面で締めてから作る（MZ-21 / MZ-22）。
// 出来状況コードの対応・props の境界・売りだけ失敗したときの出し方は単体テスト側が担保する。

const PATH = '/executions/mizuho-operations'

const CLOSING_PATH = '*/api/closing/status'
const CLOSE_PATH = '*/api/closing/mizuho'
const EXECUTIONS_PATH = '*/api/executions'
const EXPORT_PATH = '*/api/mizuho/export-orders'
const EXECUTIONS_CSV_PATH = '*/api/executions/export-csv'

// 約定一覧の CSV（MZ-23〜25）。書式は src/mocks/handlers/executions.js の toExecutionsCsvResponse
// （ファイル名 executions.csv・先頭に BOM・改行は CRLF・データ行の先頭 2 列は 約定日時, 約定ID）
const CSV_FILENAME = 'executions.csv'
const BOM = '﻿'
const csvLinePrefix = (row) => `${row.約定日時},${row.ID},`

const SERVER_ERROR = 'サーバーでエラーが発生しました。'
const FORBIDDEN_ERROR = '操作権限がありません。'
const TEMPLATE_ERROR = 'オーダーシートのテンプレートが見つかりません。'

// 注文ファイル（MZ-21）。ファイル名は締め状態の基準日、件数は Dream 登録済の注文だけを数える
const BUY_FILENAME = `オーダーシート_${mizuhoClosingStatus.基準日}_BUY_US.xlsx`
const SELL_FILENAME = `オーダーシート_${mizuhoClosingStatus.基準日}_SELL_US.xlsx`
const ordersOf = (sideCode) => mizuhoOrders.filter((row) => row.売買区分 === sideCode)
const buyExported = ordersOf('3').filter((row) => row.Dream登録状況 === '2').length
const sellExported = ordersOf('1').filter((row) => row.Dream登録状況 === '2').length
const sellSkipped = ordersOf('1').filter((row) => row.Dream登録状況 !== '2').length

// 期待値はフィクスチャ（実 API の生の形）から数える。売買区分は 3:買 / 1:売、処理状況は 010:一部出来
const buyRows = mizuhoExecutions.filter((row) => row.売買区分 === '3')
const sellRows = mizuhoExecutions.filter((row) => row.売買区分 === '1')
const partialRows = mizuhoExecutions.filter((row) => row.処理状況 === '010')

// MZ-11: 部店 123 かつ AMD の行（取消済）
const AMD_BRANCH = '123'
const AMD_SYMBOL = 'AMD'
const amdRows = mizuhoExecutions.filter(
  (row) => row.部店 === AMD_BRANCH && row.銘柄コード === AMD_SYMBOL,
)

// MZ-12: 約定日が 2026-09-26 の行
const TARGET_DATE = '2026-09-26'
const targetDateRows = mizuhoExecutions.filter((row) => row.約定日時.startsWith(TARGET_DATE))

// 表の列の並び（MizuhoExecutionTable の COLUMNS と公開モックの順）
const COLUMN_HEADERS = [
  '約定ID',
  '注文ID',
  '口座番号',
  '顧客名',
  '銘柄',
  '売買',
  '元注文数量',
  '約定数量',
  '約定単価(USD)',
  '約定金額(円)',
  '約定日時',
  '出来状況',
]
const SIDE_COLUMN = COLUMN_HEADERS.indexOf('売買')
const AMOUNT_JPY_COLUMN = COLUMN_HEADERS.indexOf('約定金額(円)')
const FILL_STATUS_COLUMN = COLUMN_HEADERS.indexOf('出来状況')

/** 約定一覧の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('mizuho-executions-table').getByTestId('data-table-row')
}

/** 表の列ごとのセル（全行ぶん） */
function columnCellsOf(page, index) {
  return rowsOf(page).locator(`td:nth-child(${index + 1})`)
}

function dialogOf(page) {
  return page.getByRole('dialog')
}

/** 件数カード 4 枚の値（総約定件数 / 買い約定 / 売り約定 / 一部出来） */
async function expectSummary(page, { total, buy, sell, partial }) {
  await expect(page.getByTestId('mizuho-summary-total')).toHaveText(total)
  await expect(page.getByTestId('mizuho-summary-buy')).toHaveText(buy)
  await expect(page.getByTestId('mizuho-summary-sell')).toHaveText(sell)
  await expect(page.getByTestId('mizuho-summary-partial')).toHaveText(partial)
}

async function submitSearch(page) {
  await page.getByTestId('mizuho-executions-search-submit').click()
}

/** 受付中の締めカードから「みずほ注文締め」→「締める」まで進め、締め済になるのを待つ */
async function closeFromPanel(page) {
  await page.getByTestId('mizuho-closing-close').click()
  await page.getByTestId('mizuho-closing-dialog-submit').click()
  await expect(page.getByTestId('mizuho-closing-state')).toHaveText('締め済')
}

/** このあと発生するダウンロードを集める（注文ファイルは 1 回の確定で 2 つ落ちる） */
function collectDownloads(page) {
  const downloads = []
  page.on('download', (download) => downloads.push(download))
  return downloads
}

/** 「約定一覧」の「CSV出力」を押してダウンロードを待ち、ファイル名と本文（BOM を含む生の文字列）を返す */
async function downloadCsv(page) {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('mizuho-executions-export').click(),
  ])
  return { name: file.suggestedFilename(), text: readFileSync(await file.path(), 'utf8') }
}

/** CSV の本文を行に分ける（BOM と末尾の空行を除く） */
function csvLines(text) {
  return text.replace(BOM, '').split('\r\n').filter(Boolean)
}

test.describe('みずほ注文締', () => {
  test('[MZ-01] サイドメニューから開くと締め状態と約定一覧が表示される', async ({ page }) => {
    await page.goto('/')

    await page
      .getByRole('navigation', { name: 'メインメニュー' })
      .getByRole('link', { name: 'みずほ注文締', exact: true })
      .click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByRole('heading', { name: 'みずほ注文締', exact: true })).toBeVisible()
    // CSV 出力は「約定一覧」カードの見出しにだけ置く（画面ヘッダには出さない）
    await expect(page.getByTestId('topbar-actions').getByRole('button')).toHaveCount(0)
    await expect(page.getByTestId('mizuho-executions-export')).toHaveText('CSV出力')

    await expect(page.getByTestId('mizuho-closing-state')).toHaveText('受付中')
    await expect(page.getByTestId('mizuho-executions-count')).toHaveText(
      `${mizuhoExecutions.length} 件`,
    )
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(mizuhoExecutions.length)
    await expect(rows.first().getByRole('cell').first()).toHaveText(`#${mizuhoExecutions[0].ID}`)
  })

  test('[MZ-02] 表の列が公開モックの順に並び、約定金額(円) は — になる', async ({ page }) => {
    await page.goto(PATH)

    await expect(
      page.getByTestId('mizuho-executions-table').getByRole('columnheader'),
    ).toHaveText(COLUMN_HEADERS)
    await expect(rowsOf(page)).toHaveCount(mizuhoExecutions.length)
    await expect(columnCellsOf(page, AMOUNT_JPY_COLUMN)).toHaveText(
      mizuhoExecutions.map(() => '—'),
    )
  })

  test('[MZ-03] 受付中は締めのボタンだけ押せ、注文ファイル作成は押せない', async ({ page }) => {
    await page.goto(PATH)

    const closing = page.getByTestId('mizuho-closing')
    await expect(page.getByTestId('mizuho-closing-state')).toHaveText('受付中')
    await expect(closing).toContainText('現在、みずほ注文の受付状態です')
    await expect(page.getByTestId('mizuho-closing-history-empty')).toHaveText(
      '状態変更履歴はありません',
    )
    await expect(page.getByTestId('mizuho-closing-order-file')).toBeDisabled()
    await expect(page.getByTestId('mizuho-closing-close')).toBeEnabled()
    await expect(page.getByTestId('mizuho-closing-reopen')).toHaveCount(0)
  })

  test('[MZ-04] 締めの確認ダイアログはキャンセルで閉じ、受付中のまま', async ({ page }) => {
    await page.goto(PATH)

    await page.getByTestId('mizuho-closing-close').click()

    const dialog = dialogOf(page)
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('みずほ注文を締めます。よろしいですか？')
    const submit = page.getByTestId('mizuho-closing-dialog-submit')
    await expect(submit).toHaveText('締める')
    await expect(submit).toBeEnabled()

    await page.getByTestId('mizuho-closing-dialog-cancel').click()

    await expect(dialogOf(page)).toHaveCount(0)
    await expect(page.getByTestId('mizuho-closing-state')).toHaveText('受付中')
  })

  test('[MZ-05] 締め済は締め解除と注文ファイル作成が出て、履歴が 1 行出る', async ({ page }) => {
    await mockApi(page, [{ path: CLOSING_PATH, body: closedMizuhoClosingStatus }])
    await page.goto(PATH)

    await expect(page.getByTestId('mizuho-closing-state')).toHaveText('締め済')
    await expect(page.getByTestId('mizuho-closing-reopen')).toBeVisible()
    await expect(page.getByTestId('mizuho-closing-order-file')).toBeEnabled()
    await expect(page.getByTestId('mizuho-closing-close')).toHaveCount(0)

    const history = page.getByTestId('mizuho-closing-history-row')
    await expect(history).toHaveCount(1)
    await expect(history).toContainText(formatDateTime(closedMizuhoClosingStatus.更新日時))
    await expect(history).toContainText('締め実行')
    await expect(history).toContainText(closedMizuhoClosingStatus.実行者)
    await expect(page.getByTestId('mizuho-closing-history-empty')).toHaveCount(0)
  })

  test('[MZ-06] 締め解除の確認ダイアログはキャンセルで閉じ、締め済のまま', async ({ page }) => {
    await mockApi(page, [{ path: CLOSING_PATH, body: closedMizuhoClosingStatus }])
    await page.goto(PATH)

    await page.getByTestId('mizuho-closing-reopen').click()

    const dialog = dialogOf(page)
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(
      'みずほ注文の締めを解除し、受付中に戻します。よろしいですか？',
    )
    const submit = page.getByTestId('mizuho-closing-dialog-submit')
    await expect(submit).toHaveText('締めを解除する')
    await expect(submit).toBeEnabled()

    await page.getByTestId('mizuho-closing-dialog-cancel').click()

    await expect(dialogOf(page)).toHaveCount(0)
    await expect(page.getByTestId('mizuho-closing-state')).toHaveText('締め済')
  })

  test('[MZ-07] 注文ファイル作成の確認ダイアログは 2 冊作ることと取消・訂正できない旨を出す', async ({
    page,
  }) => {
    await mockApi(page, [{ path: CLOSING_PATH, body: closedMizuhoClosingStatus }])
    await page.goto(PATH)
    const downloads = collectDownloads(page)

    await page.getByTestId('mizuho-closing-order-file').click()

    const dialog = dialogOf(page)
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('買い・売りの 2 冊')
    await expect(dialog).toContainText('以降は取消・訂正できません')
    const submit = page.getByTestId('mizuho-closing-dialog-submit')
    await expect(submit).toHaveText('作成する')
    await expect(submit).toBeEnabled()

    await page.getByTestId('mizuho-closing-dialog-cancel').click()

    await expect(dialogOf(page)).toHaveCount(0)
    expect(downloads).toHaveLength(0)
  })

  test('[MZ-08] 件数カードに総件数・買い・売りが出て、一部出来は — になる', async ({ page }) => {
    await page.goto(PATH)

    await expectSummary(page, {
      total: String(mizuhoExecutions.length),
      buy: String(buyRows.length),
      sell: String(sellRows.length),
      partial: '—',
    })
  })

  test('[MZ-09] 売買区分「売り」で検索すると売りの約定だけになる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(mizuhoExecutions.length)

    await page.getByTestId('mizuho-executions-side').selectOption({ label: '売り' })
    await submitSearch(page)

    await expect(page).toHaveURL(/[?&]side=1(&|$)/)
    await expect(page.getByTestId('mizuho-executions-count')).toHaveText(`${sellRows.length} 件`)
    await expect(rowsOf(page)).toHaveCount(sellRows.length)
    await expect(columnCellsOf(page, SIDE_COLUMN)).toHaveText(sellRows.map(() => '売'))
    await expectSummary(page, {
      total: String(sellRows.length),
      buy: '0',
      sell: String(sellRows.length),
      partial: '—',
    })
  })

  test('[MZ-10] 出来状況「一部出来」で検索すると一部出来の約定だけになる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(mizuhoExecutions.length)

    await page.getByTestId('mizuho-executions-fill-status').selectOption({ label: '一部出来' })
    await submitSearch(page)

    // 選択肢の値は処理状況コード（コードマスタ 約定出来状況。一部出来は 010）
    await expect(page).toHaveURL(/[?&]status=010(&|$)/)
    await expect(page.getByTestId('mizuho-executions-count')).toHaveText(
      `${partialRows.length} 件`,
    )
    await expect(rowsOf(page)).toHaveCount(partialRows.length)
    await expect(columnCellsOf(page, FILL_STATUS_COLUMN)).toHaveText(
      partialRows.map(() => '一部出来'),
    )
  })

  test('[MZ-11] 部店コードと銘柄コードで絞り込むと該当の 1 件になる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(mizuhoExecutions.length)

    await page.getByTestId('mizuho-executions-branch-code').fill(AMD_BRANCH)
    await page.getByTestId('mizuho-executions-symbol').fill(AMD_SYMBOL)
    await submitSearch(page)

    await expect(page).toHaveURL(new RegExp(`[?&]branch_code=${AMD_BRANCH}(&|$)`))
    await expect(page).toHaveURL(new RegExp(`[?&]symbol=${AMD_SYMBOL}(&|$)`))
    await expect(page.getByTestId('mizuho-executions-count')).toHaveText(`${amdRows.length} 件`)
    await expect(rowsOf(page)).toHaveCount(amdRows.length)
    await expect(columnCellsOf(page, FILL_STATUS_COLUMN)).toHaveText(['取消済（出来有）'])
  })

  test('[MZ-12] 約定日の範囲で絞り込むとその日の約定だけになる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(mizuhoExecutions.length)

    await page.getByTestId('mizuho-executions-date-from').fill(TARGET_DATE)
    await page.getByTestId('mizuho-executions-date-to').fill(TARGET_DATE)
    await submitSearch(page)

    await expect(page).toHaveURL(new RegExp(`[?&]date_from=${TARGET_DATE}(&|$)`))
    await expect(page).toHaveURL(new RegExp(`[?&]date_to=${TARGET_DATE}(&|$)`))
    await expect(page.getByTestId('mizuho-executions-count')).toHaveText(
      `${targetDateRows.length} 件`,
    )
    await expect(rowsOf(page)).toHaveCount(targetDateRows.length)
  })

  test('[MZ-13] 「クリア」で URL のクエリと入力欄が消え、全件に戻る', async ({ page }) => {
    await page.goto(`${PATH}?side=1&branch_code=123`)
    await expect(page.getByTestId('mizuho-executions-side')).toHaveValue('1')
    await expect(page.getByTestId('mizuho-executions-branch-code')).toHaveValue('123')
    await expect(rowsOf(page)).not.toHaveCount(mizuhoExecutions.length)

    await page.getByTestId('mizuho-executions-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('mizuho-executions-count')).toHaveText(
      `${mizuhoExecutions.length} 件`,
    )
    await expect(rowsOf(page)).toHaveCount(mizuhoExecutions.length)
    await expect(page.getByTestId('mizuho-executions-side')).toHaveValue('')
    await expect(page.getByTestId('mizuho-executions-branch-code')).toHaveValue('')
  })

  test('[MZ-14] 該当が 0 件だと空の文言が出て、件数カードは 0 になる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(mizuhoExecutions.length)

    await page.getByTestId('mizuho-executions-branch-code').fill('999')
    await submitSearch(page)

    await expect(page.getByTestId('mizuho-executions-empty')).toHaveText(
      '該当する約定はありません。',
    )
    await expect(page.getByTestId('mizuho-executions-table')).toHaveCount(0)
    await expectSummary(page, { total: '0', buy: '0', sell: '0', partial: '—' })
    // 条件を直せるよう検索カードは残り、締めカードも影響を受けない
    await expect(page.getByTestId('mizuho-executions-search')).toBeVisible()
    await expect(page.getByTestId('mizuho-closing-state')).toHaveText('受付中')
  })

  test('[MZ-15] 約定一覧の取得が 500 でも締めカードは操作できる', async ({ page }) => {
    await mockApi(page, [{ path: EXECUTIONS_PATH, status: 500, body: { detail: SERVER_ERROR } }])
    await page.goto(PATH)

    const error = page.getByTestId('mizuho-executions-error')
    await expect(error).toContainText(SERVER_ERROR)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('mizuho-executions-table')).toHaveCount(0)
    await expectSummary(page, { total: '—', buy: '—', sell: '—', partial: '—' })

    await expect(page.getByTestId('mizuho-closing-state')).toHaveText('受付中')
    await expect(page.getByTestId('mizuho-closing-close')).toBeEnabled()
  })

  test('[MZ-16] 締め状態の取得が 500 でも約定一覧は表示される', async ({ page }) => {
    await mockApi(page, [{ path: CLOSING_PATH, status: 500, body: { detail: SERVER_ERROR } }])
    await page.goto(PATH)

    const error = page.getByTestId('mizuho-closing-error')
    await expect(error).toContainText(SERVER_ERROR)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('mizuho-closing-close')).toHaveCount(0)
    await expect(page.getByTestId('mizuho-closing-reopen')).toHaveCount(0)
    await expect(page.getByTestId('mizuho-closing-order-file')).toHaveCount(0)

    await expect(page.getByTestId('mizuho-executions-count')).toHaveText(
      `${mizuhoExecutions.length} 件`,
    )
    await expect(rowsOf(page)).toHaveCount(mizuhoExecutions.length)
  })

  test('[MZ-18] 「締める」で締め済になり、履歴と通知が出る', async ({ page }) => {
    await page.goto(PATH)

    await closeFromPanel(page)

    await expect(dialogOf(page)).toHaveCount(0)
    await expect(page.getByTestId('mizuho-closing-reopen')).toBeVisible()
    await expect(page.getByTestId('mizuho-closing-order-file')).toBeEnabled()
    await expect(page.getByTestId('mizuho-closing-close')).toHaveCount(0)
    await expect(page.getByTestId('mizuho-closing-history-row')).toContainText('締め実行')
    await expect(page.getByTestId('mizuho-operations-notice')).toHaveText(
      'みずほ注文を締めました。',
    )
  })

  test('[MZ-19] 締め済から「締めを解除する」で受付中に戻り、通知が出る', async ({ page }) => {
    await page.goto(PATH)
    await closeFromPanel(page)

    await page.getByTestId('mizuho-closing-reopen').click()
    await page.getByTestId('mizuho-closing-dialog-submit').click()

    await expect(dialogOf(page)).toHaveCount(0)
    await expect(page.getByTestId('mizuho-closing-state')).toHaveText('受付中')
    await expect(page.getByTestId('mizuho-closing-close')).toBeEnabled()
    await expect(page.getByTestId('mizuho-closing-history-row')).toContainText('締め解除')
    await expect(page.getByTestId('mizuho-operations-notice')).toHaveText(
      'みずほ注文締めを解除しました。',
    )
  })

  test('[MZ-20] 締めが 403 ならダイアログに理由が出て、受付中のまま', async ({ page }) => {
    await mockApi(page, [
      { method: 'post', path: CLOSE_PATH, status: 403, body: { detail: FORBIDDEN_ERROR } },
    ])
    await page.goto(PATH)

    await page.getByTestId('mizuho-closing-close').click()
    await page.getByTestId('mizuho-closing-dialog-submit').click()

    await expect(page.getByTestId('mizuho-closing-dialog-error')).toHaveText(FORBIDDEN_ERROR)
    await expect(dialogOf(page)).toBeVisible()
    await expect(page.getByTestId('mizuho-operations-notice')).toHaveCount(0)

    await page.getByTestId('mizuho-closing-dialog-cancel').click()

    await expect(dialogOf(page)).toHaveCount(0)
    await expect(page.getByTestId('mizuho-closing-state')).toHaveText('受付中')
  })

  test('[MZ-21] 締めたあと「作成する」で買い・売りの 2 ファイルが落ち、件数が通知される', async ({
    page,
  }) => {
    await page.goto(PATH)
    await closeFromPanel(page)
    const downloads = collectDownloads(page)

    await page.getByTestId('mizuho-closing-order-file').click()
    await page.getByTestId('mizuho-closing-dialog-submit').click()

    await expect.poll(() => downloads.length).toBe(2)
    expect(downloads.map((download) => download.suggestedFilename())).toEqual([
      BUY_FILENAME,
      SELL_FILENAME,
    ])
    await expect(dialogOf(page)).toHaveCount(0)

    const notice = page.getByTestId('mizuho-operations-notice')
    await expect(notice).toHaveAttribute('data-variant', 'warning')
    await expect(notice).toContainText(`買い ${buyExported} 件・売り ${sellExported} 件`)
    await expect(notice).toContainText(`今回発注済にした注文 ${buyExported + sellExported} 件`)
    await expect(notice).toContainText(
      `Dream 未登録のため載せていない注文があります（売り ${sellSkipped} 件）`,
    )
  })

  test('[MZ-22] 注文ファイルが 500 なら何も落ちず、ダイアログにサーバの理由が出る', async ({
    page,
  }) => {
    await mockApi(page, [{ path: EXPORT_PATH, status: 500, body: { detail: TEMPLATE_ERROR } }])
    await page.goto(PATH)
    await closeFromPanel(page)
    const downloads = collectDownloads(page)

    await page.getByTestId('mizuho-closing-order-file').click()
    await page.getByTestId('mizuho-closing-dialog-submit').click()

    // バイト列で届いたエラー本文から理由を読めている（読めなければ既定の「サーバーでエラー…」になる）
    await expect(page.getByTestId('mizuho-closing-dialog-error')).toHaveText(TEMPLATE_ERROR)
    await expect(dialogOf(page)).toBeVisible()
    expect(downloads).toHaveLength(0)
  })

  test('[MZ-23] 絞り込んだ一覧の「CSV出力」は同じ条件の行だけの CSV になる', async ({ page }) => {
    expect(sellRows.length).toBeLessThan(mizuhoExecutions.length)

    await page.goto(`${PATH}?side=1`)
    await expect(page.getByTestId('mizuho-executions-count')).toHaveText(`${sellRows.length} 件`)

    const file = await downloadCsv(page)

    expect(file.name).toBe(CSV_FILENAME)
    expect(file.text.startsWith(BOM)).toBe(true)
    const [, ...data] = csvLines(file.text)
    expect(data).toHaveLength(sellRows.length)
    // 行の特定は先頭 2 列だけで行う（後ろの列は `"` で囲まれることがある）。並びは問わず集合で比べる
    expect(data.map((line) => line.split(',').slice(0, 2).join(',') + ',').sort()).toEqual(
      sellRows.map(csvLinePrefix).sort(),
    )
  })

  test('[MZ-24] 0 件のときは「CSV出力」が押せない', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(mizuhoExecutions.length)
    await expect(page.getByTestId('mizuho-executions-export')).toBeEnabled()

    await page.getByTestId('mizuho-executions-branch-code').fill('999')
    await submitSearch(page)

    await expect(page.getByTestId('mizuho-executions-empty')).toBeVisible()
    await expect(page.getByTestId('mizuho-executions-export')).toBeDisabled()
  })

  test('[MZ-25] CSV 出力が 500 なら理由が出て何も落ちず、一覧は残る', async ({ page }) => {
    await mockApi(page, [
      { path: EXECUTIONS_CSV_PATH, status: 500, body: { detail: SERVER_ERROR } },
    ])
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(mizuhoExecutions.length)
    const downloads = collectDownloads(page)

    await page.getByTestId('mizuho-executions-export').click()

    await expect(page.getByTestId('mizuho-executions-export-error')).toContainText(SERVER_ERROR)
    expect(downloads).toHaveLength(0)
    await expect(rowsOf(page)).toHaveCount(mizuhoExecutions.length)
    await expect(page.getByTestId('mizuho-executions-count')).toHaveText(
      `${mizuhoExecutions.length} 件`,
    )
    await expect(page.getByTestId('mizuho-executions-export')).toHaveText('CSV出力')
  })
})
