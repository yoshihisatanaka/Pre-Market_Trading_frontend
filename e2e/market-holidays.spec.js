import { expect, test } from '@playwright/test'
import { marketHolidays } from '../src/mocks/fixtures/marketHolidays'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/market-holidays.md（タイトル先頭の [MH-xx] が対応 ID）
// ページ位置と検索条件は URL クエリを正とするため、URL と画面の同期をここで守る。
// mockApi() は固定の body を返すだけで limit / offset / date_from を解釈しない。
// ページングと絞り込み（MH-02 / 03 / 04 / 07）はクエリを実際に処理する既定ハンドラで検証する。

const PATH = '/masters/market-holidays'

// src/stores/marketHolidays.js の MARKET_HOLIDAYS_PAGE_SIZE と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

const secondPage = marketHolidays.slice(PAGE_SIZE)
const year2025 = marketHolidays.filter((h) => h.date >= '2025-01-01' && h.date <= '2025-12-31')

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('market-holidays-table').getByTestId('data-table-row')
}

test.describe('海外休場日マスタ一覧', () => {
  test('[MH-01] サイドメニューから開くと一覧と件数が表示される', async ({ page }) => {
    await page.goto('/')

    await page
      .getByRole('navigation', { name: 'メインメニュー' })
      .getByRole('link', { name: '海外休場日マスタ', exact: true })
      .click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByRole('heading', { name: '海外休場日マスタ', exact: true })).toBeVisible()
    // 画面固有の操作がヘッダ（#topbar-actions）へ差し込まれている
    await expect(page.getByTestId('market-holidays-reload')).toBeVisible()

    await expect(page.getByTestId('market-holidays-count')).toHaveText(
      `${marketHolidays.length} 件`,
    )

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)
    await expect(rows.first()).toContainText(marketHolidays[0].date)
    await expect(rows.first()).toContainText(marketHolidays[0].reason)
  })

  test('[MH-02] 「次のページ」を押すと 2 ページ目が表示される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    const pagination = page.getByTestId('market-holidays-pagination')
    await pagination.getByRole('button', { name: '次のページ' }).click()

    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(secondPage.length)
    await expect(rows.first()).toContainText(secondPage[0].date)
    await expect(rows.first()).toContainText(secondPage[0].reason)

    await expect(pagination.getByTestId('pagination-range')).toHaveText(
      `${marketHolidays.length} 件中 ${PAGE_SIZE + 1}–${marketHolidays.length} 件`,
    )
  })

  test('[MH-03] 日付で絞り込むと URL と一覧に反映される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('market-holidays-date-from').fill('2025-01-01')
    await page.getByTestId('market-holidays-date-to').fill('2025-12-31')
    await page.getByTestId('market-holidays-search-submit').click()

    await expect(page).toHaveURL(/date_from=2025-01-01/)
    await expect(page).toHaveURL(/date_to=2025-12-31/)

    await expect(page.getByTestId('market-holidays-count')).toHaveText(`${year2025.length} 件`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(year2025.length)
    for (const holiday of year2025) {
      await expect(rows.filter({ hasText: holiday.date })).toHaveCount(1)
    }
  })

  test('[MH-04] 「クリア」を押すと絞り込みが解除される', async ({ page }) => {
    await page.goto(PATH)

    await page.getByTestId('market-holidays-date-from').fill('2025-01-01')
    await page.getByTestId('market-holidays-date-to').fill('2025-12-31')
    await page.getByTestId('market-holidays-search-submit').click()
    await expect(rowsOf(page)).toHaveCount(year2025.length)

    await page.getByTestId('market-holidays-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('market-holidays-count')).toHaveText(
      `${marketHolidays.length} 件`,
    )
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('market-holidays-date-from')).toHaveValue('')
    await expect(page.getByTestId('market-holidays-date-to')).toHaveValue('')
  })

  test('[MH-05] API がエラーを返したときエラー表示と再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [
      {
        path: '*/api/market-holidays',
        status: 500,
        body: { message: 'サーバーでエラーが発生しました。' },
      },
    ])
    await page.goto(PATH)

    const error = page.getByTestId('market-holidays-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('サーバーでエラーが発生しました。')
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('market-holidays-table')).toHaveCount(0)

    // 検索フォームは 4 状態の外。条件を直せるよう消えない
    await expect(page.getByTestId('market-holidays-search')).toBeVisible()
  })

  test('[MH-06] 休場日が 0 件のとき空状態が表示される', async ({ page }) => {
    await mockApi(page, [{ path: '*/api/market-holidays', body: { items: [], total: 0 } }])
    await page.goto(PATH)

    await expect(page.getByTestId('market-holidays-empty')).toBeVisible()
    await expect(page.getByTestId('market-holidays-empty')).toContainText(
      '該当する海外休場日はありません。',
    )
    await expect(page.getByTestId('data-table-row')).toHaveCount(0)
    await expect(page.getByTestId('market-holidays-count')).toHaveText('0 件')
  })

  test('[MH-07] offset 付きの URL を直接開くと 2 ページ目が復元される', async ({ page }) => {
    await page.goto(`${PATH}?offset=${PAGE_SIZE}`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(secondPage.length)
    await expect(rows.first()).toContainText(secondPage[0].date)

    await expect(
      page.getByTestId('market-holidays-pagination').getByRole('button', { name: '2', exact: true }),
    ).toHaveAttribute('aria-current', 'page')
  })
})
