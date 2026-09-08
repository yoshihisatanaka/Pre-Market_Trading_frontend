import { expect, test } from '@playwright/test'
import { marketHolidays } from '../src/mocks/fixtures/marketHolidays'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/market-holidays.md（タイトル先頭の [MH-xx] が対応 ID）
// ページ位置と検索条件は URL クエリを正とするため、URL と画面の同期をここで守る。
// mockApi() は固定の body を返すだけで limit / offset / date_from / holiday_type を解釈しない。
// ページングと絞り込み（MH-02 / 03 / 04 / 07 / 18 / 19 / 20 / 21）は
// クエリを実際に処理する既定ハンドラで検証する。

const PATH = '/masters/market-holidays'

// src/stores/marketHolidays.js の MARKET_HOLIDAYS_PAGE_SIZE と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

const secondPage = marketHolidays.slice(PAGE_SIZE)
const year2025 = marketHolidays.filter((h) => h.date >= '2025-01-01' && h.date <= '2025-12-31')

const firstHoliday = marketHolidays[0]
const lastHoliday = marketHolidays[marketHolidays.length - 1]

// 休場区分。画面に出る表示名で書く（コード '0' / '1' は利用者に見えない）
const TYPE_ALL_LABEL = '-- すべて --'
const TYPE_FULL_LABEL = '終日休場'
const TYPE_SHORT_LABEL = '短縮取引'

// 短縮取引の行はフィクスチャから数える（件数を直書きするとフィクスチャ変更で崩れる）
const shortenedHolidays = marketHolidays.filter((holiday) => holiday.holiday_type === '1')
const fullDayHoliday = marketHolidays.find((holiday) => holiday.holiday_type === '0')

// フィクスチャに無い日付。年を直書きすると YEARS が伸びたとき重複エラーになるので最終年の翌年から作る
const NEW_DATE = `${Number(lastHoliday.date.slice(0, 4)) + 1}-01-01`
const NEW_REASON = '独立記念日（テスト）'

// 末尾から PAGE_SIZE + 1 件目の日付。これを date_from にすると既定ハンドラの絞り込みが
// ちょうど 51 件になり、offset=50 の 2 ページ目が「最後の 1 件」だけになる
const LAST_PAGE_FROM = marketHolidays[marketHolidays.length - (PAGE_SIZE + 1)].date

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('market-holidays-table').getByTestId('data-table-row')
}

/** 追加モーダル。削除確認モーダルと取り違えないよう aria-label（タイトル）で絞る */
function addDialogOf(page) {
  return page.getByRole('dialog', { name: '海外休場日 新規追加' })
}

/** 削除確認モーダル */
function deleteDialogOf(page) {
  return page.getByRole('dialog', { name: '削除確認' })
}

/** 行の削除ボタン。testid は行の id を含む */
function deleteButtonOf(page, holiday) {
  return page.getByTestId(`market-holidays-delete-${holiday.id}`)
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

// 新規追加（MH-08〜11）。既定ハンドラは追加した行を保持するので、件数が増えるところまで見る。
// モックの可変状態はページを開き直すと初期化されるため、テスト間で持ち越さない。
test.describe('海外休場日マスタ 新規追加', () => {
  test('[MH-08] 「新規追加」を押すと空の入力欄でモーダルが開く', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('market-holidays-add').click()

    const dialog = addDialogOf(page)
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('market-holidays-add-date')).toHaveValue('')
    await expect(page.getByTestId('market-holidays-add-reason')).toHaveValue('')
  })

  test('[MH-09] 未入力のまま「追加」を押すと項目ごとにエラーが出る', async ({ page }) => {
    await page.goto(PATH)
    await page.getByTestId('market-holidays-add').click()

    const dialog = addDialogOf(page)
    await page.getByTestId('market-holidays-add-submit').click()

    await expect(dialog.getByText('日付を入力してください。')).toBeVisible()
    await expect(dialog.getByText('休場理由を入力してください。')).toBeVisible()

    // 入力を直せるようモーダルは閉じない。一覧にも影響しない
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('market-holidays-count')).toHaveText(
      `${marketHolidays.length} 件`,
    )
  })

  test('[MH-10] 一覧に無い日付を追加すると件数が 1 増える', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('market-holidays-add').click()
    await page.getByTestId('market-holidays-add-date').fill(NEW_DATE)
    await page.getByTestId('market-holidays-add-reason').fill(NEW_REASON)
    await page.getByTestId('market-holidays-add-submit').click()

    await expect(addDialogOf(page)).toBeHidden()

    // 成功メッセージの枠は追加と削除で共用
    const notice = page.getByTestId('market-holidays-notice')
    await expect(notice).toBeVisible()
    await expect(notice).toHaveText(`${NEW_DATE} を追加しました。`)

    await expect(page.getByTestId('market-holidays-count')).toHaveText(
      `${marketHolidays.length + 1} 件`,
    )
  })

  test('[MH-11] 既にある日付を追加すると重複エラーが出る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('market-holidays-add').click()
    await page.getByTestId('market-holidays-add-date').fill(firstHoliday.date)
    await page.getByTestId('market-holidays-add-reason').fill(NEW_REASON)
    await page.getByTestId('market-holidays-add-submit').click()

    const error = page.getByTestId('market-holidays-add-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('その日付の海外休場日はすでに登録されています。')

    await expect(addDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('market-holidays-count')).toHaveText(
      `${marketHolidays.length} 件`,
    )
  })

  test('[MH-21] 短縮取引で追加した行が一覧に短縮取引で出る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('market-holidays-add').click()

    // 既定は終日休場（プレースホルダを置かないので常に有効なコードが入っている）
    const addType = page.getByTestId('market-holidays-add-holiday-type')
    await expect(addType.getByRole('option', { selected: true })).toHaveText(TYPE_FULL_LABEL)

    await addType.selectOption({ label: TYPE_SHORT_LABEL })
    await page.getByTestId('market-holidays-add-date').fill(NEW_DATE)
    await page.getByTestId('market-holidays-add-reason').fill(NEW_REASON)
    await page.getByTestId('market-holidays-add-submit').click()

    await expect(addDialogOf(page)).toBeHidden()

    /*
     * 追加した日付はフィクスチャの最終年の翌年なので日付昇順では末尾に来る。
     * 1 ページ目（50 行）には現れないため、休場区分で絞り込んで追加行を見る。
     * ページを開き直すとモックの可変状態が初期化されるので、遷移せず検索する。
     */
    await page.getByTestId('market-holidays-holiday-type').selectOption({ label: TYPE_SHORT_LABEL })
    await page.getByTestId('market-holidays-search-submit').click()

    await expect(page.getByTestId('market-holidays-count')).toHaveText(
      `${shortenedHolidays.length + 1} 件`,
    )

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(shortenedHolidays.length + 1)

    const addedRow = rows.filter({ hasText: NEW_DATE })
    await expect(addedRow).toHaveCount(1)
    await expect(addedRow).toContainText(NEW_REASON)
    await expect(addedRow).toContainText(TYPE_SHORT_LABEL)
  })
})

// 削除（MH-12〜16）。既定ハンドラは DELETE を可変配列に反映するので、件数が減るところまで見る。
test.describe('海外休場日マスタ 削除', () => {
  test('[MH-12] 行の「削除」を押すと確認モーダルが開く', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await deleteButtonOf(page, firstHoliday).click()

    const dialog = deleteDialogOf(page)
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(firstHoliday.date)
    await expect(dialog).toContainText('を削除しますか？')
    await expect(dialog).toContainText('この操作は元に戻せません。')
  })

  test('[MH-13] 「キャンセル」を押すと何も消えずに閉じる', async ({ page }) => {
    await page.goto(PATH)
    await deleteButtonOf(page, firstHoliday).click()
    await expect(deleteDialogOf(page)).toBeVisible()

    await page.getByTestId('market-holidays-delete-cancel').click()

    await expect(deleteDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('market-holidays-count')).toHaveText(
      `${marketHolidays.length} 件`,
    )
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(rowsOf(page).filter({ hasText: firstHoliday.date })).toHaveCount(1)
  })

  test('[MH-14] 「削除する」を押すと件数が 1 減りその行が消える', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await deleteButtonOf(page, firstHoliday).click()
    await page.getByTestId('market-holidays-delete-submit').click()

    await expect(deleteDialogOf(page)).toBeHidden()

    const notice = page.getByTestId('market-holidays-notice')
    await expect(notice).toBeVisible()
    await expect(notice).toHaveText(`${firstHoliday.date} を削除しました。`)

    await expect(page.getByTestId('market-holidays-count')).toHaveText(
      `${marketHolidays.length - 1} 件`,
    )
    await expect(rowsOf(page).filter({ hasText: firstHoliday.date })).toHaveCount(0)
  })

  test('[MH-15] 削除に失敗するとモーダルは開いたままエラーが出る', async ({ page }) => {
    await mockApi(page, [
      {
        method: 'delete',
        path: '*/api/market-holidays/:id',
        status: 500,
        body: { message: 'サーバーでエラーが発生しました。' },
      },
    ])
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await deleteButtonOf(page, firstHoliday).click()
    await page.getByTestId('market-holidays-delete-submit').click()

    const error = page.getByTestId('market-holidays-delete-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('サーバーでエラーが発生しました。')

    await expect(deleteDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('market-holidays-count')).toHaveText(
      `${marketHolidays.length} 件`,
    )
    await expect(rowsOf(page).filter({ hasText: firstHoliday.date })).toHaveCount(1)
  })

  test('[MH-16] 最終ページの最後の 1 件を消すと 1 ページ前に戻る', async ({ page }) => {
    // 51 件に絞った 2 ページ目。行はちょうど 1 件になる
    await page.goto(`${PATH}?date_from=${LAST_PAGE_FROM}&offset=${PAGE_SIZE}`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(lastHoliday.date)

    await deleteButtonOf(page, lastHoliday).click()
    await page.getByTestId('market-holidays-delete-submit').click()

    // 戻る直前に空状態が一瞬描画されるため、最終状態だけを web-first assertion で待つ
    await expect(page).toHaveURL(new RegExp(`\\${PATH}\\?date_from=${LAST_PAGE_FROM}$`))
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('market-holidays-count')).toHaveText(`${PAGE_SIZE} 件`)
  })
})

// 休場区分（MH-17〜20）。一覧の列・検索条件・URL クエリ（holiday_type）の同期を守る。
// 既定モックの短縮取引はボクシングデーの 7 件だけなので、絞り込みの前後で件数が変わる。
test.describe('海外休場日マスタ 休場区分', () => {
  test('[MH-17] 一覧に休場区分の列が削除ボタンの左に表示される', async ({ page }) => {
    await page.goto(PATH)

    const table = page.getByTestId('market-holidays-table')
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    // 見出しの並び。最後の列（行ごとの操作）は画面モックに合わせて見出しが空
    await expect(table.getByRole('columnheader')).toHaveText([
      '日付',
      '休場理由',
      '休場区分',
      '',
    ])

    // 休場区分のセルは削除ボタンのセルより左（列の並びと同じ位置関係）
    const fullDayRow = rowsOf(page).filter({ hasText: fullDayHoliday.date })
    await expect(fullDayRow.getByRole('cell').nth(2)).toHaveText(TYPE_FULL_LABEL)
    await expect(fullDayRow.getByRole('cell').nth(3).getByRole('button', { name: '削除' })).toBeVisible()

    // ボクシングデーだけ短縮取引
    const shortenedRow = rowsOf(page).filter({ hasText: shortenedHolidays[0].date })
    await expect(shortenedRow.getByRole('cell').nth(2)).toHaveText(TYPE_SHORT_LABEL)
  })

  test('[MH-18] 休場区分で絞り込むと URL と一覧に反映される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('market-holidays-holiday-type').selectOption({ label: TYPE_SHORT_LABEL })
    await page.getByTestId('market-holidays-search-submit').click()

    await expect(page).toHaveURL(/holiday_type=1/)
    await expect(page.getByTestId('market-holidays-count')).toHaveText(
      `${shortenedHolidays.length} 件`,
    )

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(shortenedHolidays.length)
    await expect(rows.filter({ hasText: TYPE_SHORT_LABEL })).toHaveCount(shortenedHolidays.length)
    await expect(rows.filter({ hasText: TYPE_FULL_LABEL })).toHaveCount(0)
    for (const holiday of shortenedHolidays) {
      await expect(rows.filter({ hasText: holiday.date })).toHaveCount(1)
    }
  })

  test('[MH-19] holiday_type 付きの URL を直接開くと絞り込みが復元される', async ({ page }) => {
    await page.goto(`${PATH}?holiday_type=1`)

    // セレクトの選択も URL に追従する（ブラウザバックやブックマークで開いた場合も同じ）
    await expect(
      page.getByTestId('market-holidays-holiday-type').getByRole('option', { selected: true }),
    ).toHaveText(TYPE_SHORT_LABEL)

    await expect(page.getByTestId('market-holidays-count')).toHaveText(
      `${shortenedHolidays.length} 件`,
    )
    await expect(rowsOf(page)).toHaveCount(shortenedHolidays.length)
  })

  test('[MH-20] 「クリア」を押すと休場区分の条件も解除される', async ({ page }) => {
    await page.goto(PATH)

    await page.getByTestId('market-holidays-holiday-type').selectOption({ label: TYPE_SHORT_LABEL })
    await page.getByTestId('market-holidays-search-submit').click()
    await expect(rowsOf(page)).toHaveCount(shortenedHolidays.length)

    await page.getByTestId('market-holidays-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('market-holidays-count')).toHaveText(
      `${marketHolidays.length} 件`,
    )
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(
      page.getByTestId('market-holidays-holiday-type').getByRole('option', { selected: true }),
    ).toHaveText(TYPE_ALL_LABEL)
  })
})
