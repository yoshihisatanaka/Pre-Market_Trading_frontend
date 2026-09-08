import { expect, test } from '@playwright/test'
import { blockedDates } from '../src/mocks/fixtures/blockedDates'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/blocked-dates.md（タイトル先頭の [BD-xx] が対応 ID）
// ページ位置と検索条件は URL クエリを正とするため、URL と画面の同期をここで守る。
// mockApi() は固定の body を返すだけで limit / offset / date_from / date_to を解釈しない。
// ページングと絞り込み（BD-02 / 03 / 04 / 07 / 10）は
// クエリを実際に処理する既定ハンドラで検証する。

const PATH = '/masters/blocked-dates'

// src/stores/blockedDates.js の BLOCKED_DATES_PAGE_SIZE と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

const secondPage = blockedDates.slice(PAGE_SIZE)
const year2025 = blockedDates.filter((d) => d.date >= '2025-01-01' && d.date <= '2025-12-31')

const firstBlockedDate = blockedDates[0]

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('blocked-dates-table').getByTestId('data-table-row')
}

test.describe('受注不可日マスタ一覧', () => {
  test('[BD-01] サイドメニューから開くと一覧と件数が表示される', async ({ page }) => {
    await page.goto('/')

    await page
      .getByRole('navigation', { name: 'メインメニュー' })
      .getByRole('link', { name: '受注不可日マスタ', exact: true })
      .click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByRole('heading', { name: '受注不可日マスタ', exact: true })).toBeVisible()
    // 画面固有の操作がヘッダ（#topbar-actions）へ差し込まれている
    await expect(page.getByTestId('blocked-dates-reload')).toBeVisible()

    await expect(page.getByTestId('blocked-dates-count')).toHaveText(`${blockedDates.length} 件`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)
    await expect(rows.first()).toContainText(firstBlockedDate.date)
    await expect(rows.first()).toContainText(firstBlockedDate.market)
    await expect(rows.first()).toContainText(firstBlockedDate.reason)
  })

  test('[BD-02] 「次のページ」を押すと 2 ページ目が表示される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    const pagination = page.getByTestId('blocked-dates-pagination')
    await pagination.getByRole('button', { name: '次のページ' }).click()

    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(secondPage.length)
    await expect(rows.first()).toContainText(secondPage[0].date)
    await expect(rows.first()).toContainText(secondPage[0].reason)

    await expect(pagination.getByTestId('pagination-range')).toHaveText(
      `${blockedDates.length} 件中 ${PAGE_SIZE + 1}–${blockedDates.length} 件`,
    )
  })

  test('[BD-03] 日付で絞り込むと URL と一覧に反映される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('blocked-dates-date-from').fill('2025-01-01')
    await page.getByTestId('blocked-dates-date-to').fill('2025-12-31')
    await page.getByTestId('blocked-dates-search-submit').click()

    await expect(page).toHaveURL(/date_from=2025-01-01/)
    await expect(page).toHaveURL(/date_to=2025-12-31/)

    await expect(page.getByTestId('blocked-dates-count')).toHaveText(`${year2025.length} 件`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(year2025.length)
    for (const blocked of year2025) {
      await expect(rows.filter({ hasText: blocked.date })).toHaveCount(1)
    }
  })

  test('[BD-04] 「クリア」を押すと絞り込みが解除される', async ({ page }) => {
    await page.goto(PATH)

    await page.getByTestId('blocked-dates-date-from').fill('2025-01-01')
    await page.getByTestId('blocked-dates-date-to').fill('2025-12-31')
    await page.getByTestId('blocked-dates-search-submit').click()
    await expect(rowsOf(page)).toHaveCount(year2025.length)

    await page.getByTestId('blocked-dates-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('blocked-dates-count')).toHaveText(`${blockedDates.length} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('blocked-dates-date-from')).toHaveValue('')
    await expect(page.getByTestId('blocked-dates-date-to')).toHaveValue('')
  })

  test('[BD-05] API がエラーを返したときエラー表示と再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [
      {
        path: '*/api/blocked-dates',
        status: 500,
        body: { message: 'サーバーでエラーが発生しました。' },
      },
    ])
    await page.goto(PATH)

    const error = page.getByTestId('blocked-dates-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('サーバーでエラーが発生しました。')
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('blocked-dates-table')).toHaveCount(0)

    // 検索フォームは 4 状態の外。条件を直せるよう消えない
    await expect(page.getByTestId('blocked-dates-search')).toBeVisible()
  })

  test('[BD-06] 受注不可日が 0 件のとき空状態が表示される', async ({ page }) => {
    await mockApi(page, [{ path: '*/api/blocked-dates', body: { items: [], total: 0 } }])
    await page.goto(PATH)

    const empty = page.getByTestId('blocked-dates-empty')
    await expect(empty).toBeVisible()
    await expect(empty).toContainText('該当する受注不可日はありません。')
    await expect(page.getByTestId('data-table-row')).toHaveCount(0)
    await expect(page.getByTestId('blocked-dates-count')).toHaveText('0 件')
  })

  test('[BD-07] offset 付きの URL を直接開くと 2 ページ目が復元される', async ({ page }) => {
    await page.goto(`${PATH}?offset=${PAGE_SIZE}`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(secondPage.length)
    await expect(rows.first()).toContainText(secondPage[0].date)

    await expect(
      page.getByTestId('blocked-dates-pagination').getByRole('button', { name: '2', exact: true }),
    ).toHaveAttribute('aria-current', 'page')
  })

  test('[BD-08] 一覧は 3 列の読み取り専用で行に操作ボタンが無い', async ({ page }) => {
    await page.goto(PATH)

    const table = page.getByTestId('blocked-dates-table')
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    // 追加 / 削除が実装されたらこの行が落ちて気づける（シナリオを更新する合図）
    await expect(table.getByRole('columnheader')).toHaveText(['日付', '対象市場', '理由'])
    await expect(rowsOf(page).first().getByRole('button')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '新規追加' })).toHaveCount(0)
  })

  test('[BD-09] 説明バナーはデータの有無に関わらず表示される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('blocked-dates-description')).toBeVisible()

    // 0 件でも 4 状態の外なので消えない
    await mockApi(page, [{ path: '*/api/blocked-dates', body: { items: [], total: 0 } }])
    await page.goto(PATH)

    await expect(page.getByTestId('blocked-dates-empty')).toBeVisible()
    await expect(page.getByTestId('blocked-dates-description')).toBeVisible()
  })

  test('[BD-10] 「再読み込み」を押しても絞り込みが保たれる', async ({ page }) => {
    await page.goto(`${PATH}?date_from=2025-01-01&date_to=2025-12-31`)
    await expect(rowsOf(page)).toHaveCount(year2025.length)

    await page.getByTestId('blocked-dates-reload').click()

    // reload() は URL を変えない契約
    await expect(page).toHaveURL(/date_from=2025-01-01/)
    await expect(page).toHaveURL(/date_to=2025-12-31/)
    await expect(page.getByTestId('blocked-dates-count')).toHaveText(`${year2025.length} 件`)
    await expect(rowsOf(page)).toHaveCount(year2025.length)
    await expect(page.getByTestId('blocked-dates-date-from')).toHaveValue('2025-01-01')
  })
})
