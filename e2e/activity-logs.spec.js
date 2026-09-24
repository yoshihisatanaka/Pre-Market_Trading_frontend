import { expect, test } from '@playwright/test'
import { activityLogs } from '../src/mocks/fixtures/activityLogs'
import { activityLogTargets } from '../src/mocks/fixtures/activityLogTargets'
import { formatActivityAt } from '../src/utils/activityLogTypes'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/activity-logs.md（タイトル先頭の [AL-xx] が対応 ID）
// 各マスタの変更履歴を横断して読む画面。ページ位置と検索条件は URL クエリを正とするため、
// URL と画面の同期と、行の「詳細」ダイアログをここで守る。
// mockApi() は固定の body を返すだけで offset や検索条件のクエリを解釈しない。
// ページングと絞り込み（AL-02〜AL-10 / AL-15 / AL-16）はクエリを実際に処理する既定ハンドラで検証する。

const PATH = '/operations/activity-logs'

// src/stores/activityLogs.js の ACTIVITY_LOGS_PAGE_SIZE と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

/** 列の並び。見出しの検証（AL-12）と、セルを列名で引くための索引を兼ねる。最後は「詳細」ボタンの列 */
const COLUMNS = ['操作日時', '対象種別', '操作区分', '操作者', '対象キー', '変更項目', '']

// フィクスチャは実 API の既定（sort=desc）と同じ操作日時の降順
const TOTAL = activityLogs.length
const firstRow = activityLogs[0]
const secondPage = activityLogs.slice(PAGE_SIZE)
const oldestRow = activityLogs[TOTAL - 1]

// 絞り込みに使う値もフィクスチャから導く（'005' や 'AAPL' の件数を直接書かない）
const byDelete = activityLogs.filter((log) => log.操作区分 === 'DELETE')

const symbolsTarget = activityLogTargets.find((target) => target.対象種別 === 'symbols')
const bySymbols = activityLogs.filter((log) => log.対象種別 === symbolsTarget.対象種別)

const OPERATOR = firstRow.操作者
const byOperator = activityLogs.filter((log) => log.操作者 === OPERATOR)

/** 先頭行の対象キーの先頭 3 文字。部分一致で別の対象種別の行にも当たることを見る（AL-06） */
const KEY_FRAGMENT = firstRow.対象キー.slice(0, 3)
const byKeyFragment = activityLogs.filter((log) => (log.対象キー ?? '').includes(KEY_FRAGMENT))

/** 期間。フィクスチャの 4 行目と 8 行目の日付（降順なので To が 4 行目） */
const dateOf = (log) => log.操作日時.slice(0, 10)
const DATE_TO = dateOf(activityLogs[3])
const DATE_FROM = dateOf(activityLogs[7])
const byPeriod = activityLogs.filter(
  (log) => dateOf(log) >= DATE_FROM && dateOf(log) <= DATE_TO,
)

const byCustomersUpdate = activityLogs.filter(
  (log) => log.対象種別 === 'customers' && log.操作区分 === 'UPDATE',
)

// フィクスチャのどの対象キーにも当たらない文字列
const NO_MATCH = 'ZZZZ'

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('activity-logs-table').getByTestId('data-table-row')
}

/** 行の中の 1 セル。列名から位置を引く */
function cellOf(row, column) {
  return row.locator('td').nth(COLUMNS.indexOf(column))
}

/** 表の 1 列ぶんのセル（全行） */
function columnOf(page, column) {
  return page
    .getByTestId('activity-logs-table')
    .locator(`td:nth-child(${COLUMNS.indexOf(column) + 1})`)
}

/** 行の「詳細」ボタン。testid は `対象種別:履歴ID`（履歴ID だけでは横断した一覧で一意にならない） */
function detailButtonOf(page, log) {
  return page.getByTestId(`activity-logs-detail-${log.対象種別}:${log.履歴ID}`)
}

/** 並び順のボタン */
function sortButton(page, label) {
  return page.getByTestId('activity-logs-sort').getByRole('button', { name: label, exact: true })
}

async function search(page) {
  await page.getByTestId('activity-logs-search-submit').click()
}

test.describe('操作ログ一覧', () => {
  test('[AL-01] サイドメニューから開くと一覧と件数が表示される', async ({ page }) => {
    await page.goto('/')

    await page
      .getByRole('navigation', { name: 'メインメニュー' })
      .getByRole('link', { name: '操作ログ', exact: true })
      .click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByRole('heading', { name: '操作ログ', exact: true })).toBeVisible()

    await expect(page.getByTestId('activity-logs-count')).toHaveText(`${TOTAL} 件`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)
    await expect(cellOf(rows.first(), '操作日時')).toHaveText(formatActivityAt(firstRow.操作日時))
    await expect(cellOf(rows.first(), '対象種別')).toHaveText(firstRow.対象種別名)
    await expect(cellOf(rows.first(), '対象キー')).toHaveText(firstRow.対象キー)
  })

  test('[AL-02] 「次のページ」を押すと 2 ページ目が表示される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    const pagination = page.getByTestId('activity-logs-pagination')
    await pagination.getByRole('button', { name: '次のページ' }).click()

    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(secondPage.length)
    await expect(cellOf(rows.first(), '対象キー')).toHaveText(secondPage[0].対象キー)
    await expect(pagination.getByTestId('pagination-range')).toHaveText(
      `${TOTAL} 件中 ${PAGE_SIZE + 1}–${TOTAL} 件`,
    )
  })

  test('[AL-03] 操作区分で絞り込むと URL と一覧に反映される', async ({ page }) => {
    expect(byDelete.length).toBeGreaterThan(0)

    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('activity-logs-operation').selectOption({ label: '削除' })
    await search(page)

    await expect(page).toHaveURL(/operation=DELETE/)
    await expect(page.getByTestId('activity-logs-count')).toHaveText(`${byDelete.length} 件`)
    await expect(rowsOf(page)).toHaveCount(byDelete.length)
    await expect(columnOf(page, '操作区分')).toHaveText(Array(byDelete.length).fill('削除'))
  })

  test('[AL-04] 対象種別の選択肢が API から並び、選ぶと絞り込まれる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    const select = page.getByTestId('activity-logs-target-type')
    const options = select.locator('option')
    // 先頭は「全て」の空選択肢
    await expect(options).toHaveCount(activityLogTargets.length + 1)
    for (const target of activityLogTargets) {
      await expect(options.filter({ hasText: target.対象種別名 })).toHaveCount(1)
    }

    await select.selectOption({ label: symbolsTarget.対象種別名 })
    await search(page)

    await expect(page).toHaveURL(new RegExp(`target_types=${symbolsTarget.対象種別}`))
    await expect(page.getByTestId('activity-logs-count')).toHaveText(`${bySymbols.length} 件`)
    await expect(rowsOf(page)).toHaveCount(bySymbols.length)
    await expect(columnOf(page, '対象種別')).toHaveText(
      Array(bySymbols.length).fill(symbolsTarget.対象種別名),
    )
  })

  test('[AL-05] 操作者コードで絞り込むと完全一致の行だけが出る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('activity-logs-operator').fill(OPERATOR)
    await search(page)

    await expect(page.getByTestId('activity-logs-count')).toHaveText(`${byOperator.length} 件`)
    expect(new URL(page.url()).searchParams.get('operator')).toBe(OPERATOR)
    await expect(rowsOf(page)).toHaveCount(byOperator.length)
    await expect(columnOf(page, '操作者')).toHaveText(Array(byOperator.length).fill(OPERATOR))
  })

  test('[AL-06] 対象キーの部分一致で別の対象種別の行も当たる', async ({ page }) => {
    // 部分一致であることと、対象種別をまたぐことの両方が見える形でないとシナリオが成立しない
    expect(new Set(byKeyFragment.map((log) => log.対象種別)).size).toBeGreaterThan(1)
    expect(byKeyFragment.every((log) => log.対象キー !== KEY_FRAGMENT)).toBe(true)

    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('activity-logs-target-key').fill(KEY_FRAGMENT)
    await search(page)

    await expect(page.getByTestId('activity-logs-count')).toHaveText(`${byKeyFragment.length} 件`)
    expect(new URL(page.url()).searchParams.get('target_key')).toBe(KEY_FRAGMENT)
    await expect(rowsOf(page)).toHaveCount(byKeyFragment.length)
    await expect(rowsOf(page).filter({ hasText: KEY_FRAGMENT })).toHaveCount(byKeyFragment.length)
  })

  test('[AL-07] 期間で絞り込むとその期間の行だけが出る', async ({ page }) => {
    // 期間の外にも行があること（絞り込みが効いたと言えること）
    expect(byPeriod.length).toBeGreaterThan(0)
    expect(byPeriod.length).toBeLessThan(TOTAL)

    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('activity-logs-date-from').fill(DATE_FROM)
    await page.getByTestId('activity-logs-date-to').fill(DATE_TO)
    await search(page)

    await expect(page.getByTestId('activity-logs-count')).toHaveText(`${byPeriod.length} 件`)
    const query = new URL(page.url()).searchParams
    expect(query.get('start_date')).toBe(DATE_FROM)
    expect(query.get('end_date')).toBe(DATE_TO)

    await expect(rowsOf(page)).toHaveCount(byPeriod.length)
    await expect(columnOf(page, '操作日時')).toHaveText(
      byPeriod.map((log) => formatActivityAt(log.操作日時)),
    )
  })

  test('[AL-08] 並び順を「古い順」にすると最も古い行が先頭に来る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    // 既定は新しい順で、URL には出ない
    await expect(sortButton(page, '新しい順')).toHaveAttribute('aria-pressed', 'true')

    await sortButton(page, '古い順').click()
    await search(page)

    await expect(page).toHaveURL(/sort=asc/)
    await expect(sortButton(page, '古い順')).toHaveAttribute('aria-pressed', 'true')
    await expect(sortButton(page, '新しい順')).toHaveAttribute('aria-pressed', 'false')

    const first = rowsOf(page).first()
    await expect(cellOf(first, '操作日時')).toHaveText(formatActivityAt(oldestRow.操作日時))
    await expect(cellOf(first, '対象キー')).toHaveText(oldestRow.対象キー)
  })

  test('[AL-09] 「クリア」を押すと絞り込みと並び順が既定に戻る', async ({ page }) => {
    await page.goto(PATH)

    await page.getByTestId('activity-logs-operation').selectOption({ label: '削除' })
    await sortButton(page, '古い順').click()
    await search(page)
    await expect(rowsOf(page)).toHaveCount(byDelete.length)

    await page.getByTestId('activity-logs-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('activity-logs-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('activity-logs-operation')).toHaveValue('')
    await expect(sortButton(page, '新しい順')).toHaveAttribute('aria-pressed', 'true')
  })

  test('[AL-10] 該当が無いときは空状態が表示される', async ({ page }) => {
    await page.goto(PATH)

    await page.getByTestId('activity-logs-target-key').fill(NO_MATCH)
    await search(page)

    await expect(page.getByTestId('activity-logs-empty')).toHaveText('該当する操作ログはありません。')
    await expect(page.getByTestId('activity-logs-table')).toBeHidden()
    // 0 件のときこそ条件を直したいので、検索カードは消えない
    await expect(page.getByTestId('activity-logs-search')).toBeVisible()
  })

  test('[AL-11] API がエラーを返したときエラー表示と再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [
      { path: '*/api/operations/activity-logs', status: 500, body: { detail: ERROR_MESSAGE } },
    ])
    await page.goto(PATH)

    const error = page.getByTestId('activity-logs-error')
    await expect(error).toContainText(ERROR_MESSAGE)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('activity-logs-table')).toBeHidden()
    // エラーのときも説明バナーと検索カードは消えない
    await expect(page.getByTestId('activity-logs-description')).toBeVisible()
    await expect(page.getByTestId('activity-logs-search')).toBeVisible()
  })

  test('[AL-12] 列順が仕様どおりで、欠けた値は — になり、行の操作は詳細だけ', async ({ page }) => {
    const firstPage = activityLogs.slice(0, PAGE_SIZE)
    const noKeyIndex = firstPage.findIndex((log) => log.操作者 === null && log.対象キー === null)
    // 操作者も対象キーも持たない行がフィクスチャに無いと、このシナリオは意味を失う
    expect(noKeyIndex).toBeGreaterThanOrEqual(0)

    await page.goto(PATH)
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)

    await expect(page.getByTestId('activity-logs-table').locator('th')).toHaveText(COLUMNS)

    const noKeyRow = rows.nth(noKeyIndex)
    await expect(cellOf(noKeyRow, '操作者')).toHaveText('—')
    await expect(cellOf(noKeyRow, '対象キー')).toHaveText('—')

    // 読むだけの画面。追加の導線は無く、行の操作は「詳細」だけ
    await expect(page.getByTestId('activity-logs-add')).toHaveCount(0)
    const buttons = rows.first().getByRole('button')
    await expect(buttons).toHaveCount(1)
    await expect(buttons).toHaveText('詳細')
  })

  test('[AL-13] 「詳細」で変更項目と差分が見え、「閉じる」で消える', async ({ page }) => {
    const changed = Object.keys(firstRow.差分)
    expect(changed.length).toBe(1)
    const [field] = changed

    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await detailButtonOf(page, firstRow).click()

    const dialog = page.getByRole('dialog', { name: '操作ログの詳細' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('activity-log-detail-changed-fields')).toHaveText(field)

    const diffRows = dialog.getByTestId('activity-log-detail-diff').getByTestId('data-table-row')
    await expect(diffRows).toHaveCount(1)
    await expect(diffRows.first().locator('td')).toHaveText([
      field,
      String(firstRow.差分[field].before),
      String(firstRow.差分[field].after),
    ])

    // 全項目は折りたたまれていて、開くと見える
    const before = dialog.getByTestId('activity-log-detail-before')
    const after = dialog.getByTestId('activity-log-detail-after')
    await expect(before).toBeHidden()
    await expect(after).toBeHidden()

    await dialog.getByText('変更前データ（全項目）').click()
    await dialog.getByText('変更後データ（全項目）').click()
    await expect(before.getByTestId('data-table-row')).toHaveCount(
      Object.keys(firstRow.変更前データ).length,
    )
    await expect(after.getByTestId('data-table-row')).toHaveCount(
      Object.keys(firstRow.変更後データ).length,
    )
    await expect(before).toBeVisible()
    await expect(after).toBeVisible()

    await dialog.getByTestId('activity-log-detail-close').click()
    await expect(dialog).toBeHidden()
  })

  test('[AL-14] 登録の行の詳細には変更前データの欄が出ない', async ({ page }) => {
    const created = activityLogs.find(
      (log) => log.対象種別 === 'symbols' && log.操作区分 === 'CREATE',
    )
    expect(created).toBeDefined()
    const fieldCount = Object.keys(created.差分).length

    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await detailButtonOf(page, created).click()

    const dialog = page.getByRole('dialog', { name: '操作ログの詳細' })
    await expect(dialog.getByTestId('activity-log-detail')).toBeVisible()
    await expect(dialog.getByTestId('activity-log-detail-before')).toHaveCount(0)
    await expect(dialog.getByText('変更前データ（全項目）')).toHaveCount(0)
    await expect(dialog.getByTestId('activity-log-detail-after')).toHaveCount(1)

    const diff = dialog.getByTestId('activity-log-detail-diff')
    await expect(diff.getByTestId('data-table-row')).toHaveCount(fieldCount)
    await expect(diff.locator('td:nth-child(2)')).toHaveText(Array(fieldCount).fill('—'))
  })

  test('[AL-15] 条件付きの URL を直接開くと検索欄・並び順・一覧に復元される', async ({ page }) => {
    const oldestCustomersUpdate = byCustomersUpdate[byCustomersUpdate.length - 1]

    await page.goto(`${PATH}?operation=UPDATE&target_types=customers&sort=asc`)

    await expect(page.getByTestId('activity-logs-operation')).toHaveValue('UPDATE')
    await expect(page.getByTestId('activity-logs-target-type')).toHaveValue('customers')
    await expect(sortButton(page, '古い順')).toHaveAttribute('aria-pressed', 'true')

    await expect(page.getByTestId('activity-logs-count')).toHaveText(
      `${byCustomersUpdate.length} 件`,
    )
    await expect(rowsOf(page)).toHaveCount(byCustomersUpdate.length)
    await expect(cellOf(rowsOf(page).first(), '対象キー')).toHaveText(
      oldestCustomersUpdate.対象キー,
    )
  })

  test('[AL-16] ブラウザバックで前のページに戻る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page
      .getByTestId('activity-logs-pagination')
      .getByRole('button', { name: '次のページ' })
      .click()
    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))
    await expect(rowsOf(page)).toHaveCount(secondPage.length)

    await page.goBack()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(cellOf(rowsOf(page).first(), '対象キー')).toHaveText(firstRow.対象キー)
  })

  test('[AL-17] 対象種別の取得に失敗しても一覧と検索は使える', async ({ page }) => {
    await mockApi(page, [
      {
        path: '*/api/operations/activity-logs/targets',
        status: 500,
        body: { detail: ERROR_MESSAGE },
      },
    ])
    await page.goto(PATH)

    await expect(page.getByTestId('activity-logs-search')).toContainText(
      '対象種別を取得できませんでした',
    )
    await expect(page.getByTestId('activity-logs-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    // 対象種別なしで他の条件の検索はできる
    await page.getByTestId('activity-logs-operation').selectOption({ label: '削除' })
    await search(page)
    await expect(page.getByTestId('activity-logs-count')).toHaveText(`${byDelete.length} 件`)
  })
})
