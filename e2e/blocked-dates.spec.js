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
const lastBlockedDate = blockedDates[blockedDates.length - 1]

// フィクスチャに無い日付。年を直書きすると YEARS が伸びたとき重複エラーになるので最終年の翌年から作る
const NEW_DATE = `${Number(lastBlockedDate.date.slice(0, 4)) + 1}-01-01`
const NEW_REASON = '年末年始休業（テスト）'

// 理由の maxlength。src/views/BlockedDateListView.vue の入力欄（実仕様 BlackoutDateRequest の備考）と同じ値
const REASON_MAX_LENGTH = 45

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('blocked-dates-table').getByTestId('data-table-row')
}

/** 追加モーダル。role=dialog の aria-label はモーダルのタイトル（BaseModal） */
function addDialogOf(page) {
  return page.getByRole('dialog', { name: '受注不可日 新規追加' })
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

    // 行ごとの操作（編集 / 削除）が実装されたらこの行が落ちて気づける（シナリオを更新する合図）
    await expect(table.getByRole('columnheader')).toHaveText(['日付', '対象市場', '理由'])
    await expect(rowsOf(page).first().getByRole('button')).toHaveCount(0)

    // 追加は行ではなくヘッダのボタンから行う
    await expect(page.getByTestId('blocked-dates-add')).toBeVisible()
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

/*
 * 新規追加（BD-11〜18）。既定ハンドラは追加した行を保持するので、件数が増えるところまで見る。
 * モックの可変状態はページを開き直すと初期化されるため、テスト間で持ち越さない。
 *
 * 登録は「事前検証 → 登録」の 2 段で、エラーの出し先が 3 系統に分かれる。
 *   必須未入力       … FormField の error（BD-12）
 *   事前検証の不合格 … blocked-dates-add-validation-error の箇条書き（BD-14 / 15）
 *   通信・サーバ障害 … blocked-dates-add-error（BD-16）
 * 事前検証と登録は別パス（/blocked-dates/validate と /blocked-dates）なので、
 * mockApi() で一方だけを差し替えられる。
 */
test.describe('受注不可日マスタ 新規追加', () => {
  test('[BD-11] 「新規追加」を押すと空の入力欄でモーダルが開く', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('blocked-dates-add').click()

    const dialog = addDialogOf(page)
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('blocked-dates-add-date')).toHaveValue('')
    await expect(page.getByTestId('blocked-dates-add-reason')).toHaveValue('')

    // 入力項目は日付と理由の 2 つだけ（休場区分のような選択項目は持たない）
    const form = dialog.getByTestId('blocked-dates-add-form')
    await expect(form.locator('input')).toHaveCount(2)
    await expect(form.getByRole('combobox')).toHaveCount(0)
    // その 2 つが「日付」と「理由」であることはラベル（アクセシブルネーム）で確かめる
    await expect(form.getByLabel(/日付/)).toHaveCount(1)
    await expect(form.getByLabel(/理由/)).toHaveCount(1)
  })

  test('[BD-12] 未入力のまま「追加」を押すと項目ごとにエラーが出る', async ({ page }) => {
    await page.goto(PATH)
    await page.getByTestId('blocked-dates-add').click()

    const dialog = addDialogOf(page)
    await page.getByTestId('blocked-dates-add-submit').click()

    await expect(dialog.getByText('日付を入力してください。')).toBeVisible()
    await expect(dialog.getByText('理由を入力してください。')).toBeVisible()

    // 3 系統のうち項目直下だけに出る。サーバへは行かないので他の 2 つは出ない
    await expect(page.getByTestId('blocked-dates-add-validation-error')).toHaveCount(0)
    await expect(page.getByTestId('blocked-dates-add-error')).toHaveCount(0)

    // 入力を直せるようモーダルは閉じない。一覧にも影響しない
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('blocked-dates-count')).toHaveText(`${blockedDates.length} 件`)
  })

  test('[BD-13] 一覧に無い日付を追加すると件数が 1 増える', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('blocked-dates-add').click()
    await page.getByTestId('blocked-dates-add-date').fill(NEW_DATE)
    await page.getByTestId('blocked-dates-add-reason').fill(NEW_REASON)
    await page.getByTestId('blocked-dates-add-submit').click()

    await expect(addDialogOf(page)).toBeHidden()

    const notice = page.getByTestId('blocked-dates-notice')
    await expect(notice).toBeVisible()
    await expect(notice).toHaveText(`${NEW_DATE} を追加しました。`)

    await expect(page.getByTestId('blocked-dates-count')).toHaveText(
      `${blockedDates.length + 1} 件`,
    )

    // 登録は一覧の単方向フローに触らない（URL は変わらない）
    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
  })

  test('[BD-14] 既にある日付を追加すると事前検証の理由が箇条書きで出る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('blocked-dates-add').click()
    await page.getByTestId('blocked-dates-add-date').fill(firstBlockedDate.date)
    await page.getByTestId('blocked-dates-add-reason').fill(NEW_REASON)
    await page.getByTestId('blocked-dates-add-submit').click()

    const validationError = page.getByTestId('blocked-dates-add-validation-error')
    await expect(validationError).toBeVisible()
    await expect(validationError.getByRole('listitem')).toHaveText([
      'その日付の受注不可日はすでに登録されています。',
    ])

    // 事前検証の不合格は通信障害ではないので、専用の表示には出ない
    await expect(page.getByTestId('blocked-dates-add-error')).toHaveCount(0)

    await expect(addDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('blocked-dates-notice')).toHaveCount(0)
    await expect(page.getByTestId('blocked-dates-count')).toHaveText(`${blockedDates.length} 件`)
  })

  test('[BD-15] 事前検証が理由を複数返すと全て箇条書きに並ぶ', async ({ page }) => {
    const errors = [
      '日付は YYYY-MM-DD 形式で入力してください。',
      'その日付の受注不可日はすでに登録されています。',
    ]
    await mockApi(page, [
      {
        method: 'post',
        path: '*/api/blocked-dates/validate',
        body: { valid: false, errors, warnings: [], details: null },
      },
    ])
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('blocked-dates-add').click()
    await page.getByTestId('blocked-dates-add-date').fill(NEW_DATE)
    await page.getByTestId('blocked-dates-add-reason').fill(NEW_REASON)
    await page.getByTestId('blocked-dates-add-submit').click()

    const validationError = page.getByTestId('blocked-dates-add-validation-error')
    await expect(validationError).toBeVisible()
    await expect(validationError.getByRole('listitem')).toHaveText(errors)

    await expect(addDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('blocked-dates-count')).toHaveText(`${blockedDates.length} 件`)
  })

  test('[BD-16] 登録に失敗するとモーダルは開いたままエラーが出る', async ({ page }) => {
    // 事前検証（*/api/blocked-dates/validate）はパスが別なので既定ハンドラのまま通る
    await mockApi(page, [
      {
        method: 'post',
        path: '*/api/blocked-dates',
        status: 500,
        body: { message: 'サーバーでエラーが発生しました。' },
      },
    ])
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('blocked-dates-add').click()
    await page.getByTestId('blocked-dates-add-date').fill(NEW_DATE)
    await page.getByTestId('blocked-dates-add-reason').fill(NEW_REASON)
    await page.getByTestId('blocked-dates-add-submit').click()

    const error = page.getByTestId('blocked-dates-add-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('サーバーでエラーが発生しました。')

    // 事前検証は通っているので箇条書きは出ない
    await expect(page.getByTestId('blocked-dates-add-validation-error')).toHaveCount(0)

    await expect(addDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('blocked-dates-notice')).toHaveCount(0)
    await expect(page.getByTestId('blocked-dates-count')).toHaveText(`${blockedDates.length} 件`)
  })

  test('[BD-17] 開き直すと前回のエラーと入力が残らない', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('blocked-dates-add').click()
    await page.getByTestId('blocked-dates-add-date').fill(firstBlockedDate.date)
    await page.getByTestId('blocked-dates-add-reason').fill(NEW_REASON)
    await page.getByTestId('blocked-dates-add-submit').click()
    await expect(page.getByTestId('blocked-dates-add-validation-error')).toBeVisible()

    await page.getByTestId('blocked-dates-add-cancel').click()
    await expect(addDialogOf(page)).toBeHidden()

    await page.getByTestId('blocked-dates-add').click()

    await expect(addDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('blocked-dates-add-validation-error')).toHaveCount(0)
    await expect(page.getByTestId('blocked-dates-add-date')).toHaveValue('')
    await expect(page.getByTestId('blocked-dates-add-reason')).toHaveValue('')
  })

  test('[BD-18] 理由は 45 文字を超えて入力できない', async ({ page }) => {
    await page.goto(PATH)
    await page.getByTestId('blocked-dates-add').click()

    const reason = page.getByTestId('blocked-dates-add-reason')
    // fill() は値を流し込むだけで maxlength を通らない経路があるため、1 文字ずつ入力する
    await reason.pressSequentially('あ'.repeat(REASON_MAX_LENGTH + 1))

    await expect(reason).toHaveValue('あ'.repeat(REASON_MAX_LENGTH))
  })
})
