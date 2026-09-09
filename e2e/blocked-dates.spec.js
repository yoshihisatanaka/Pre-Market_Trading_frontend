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

// 編集で入れ直す理由。フィクスチャのどの行の理由とも重ならない文言にする
const EDITED_REASON = '受注停止（テストで変更）'

// BD-29 で差し替える 409 の message。サーバが返す文言をそのまま出すことを見るための値
const CONFLICT_MESSAGE = '他の担当者が先に更新しました。再読み込みしてからやり直してください。'

// 理由の maxlength。src/views/BlockedDateListView.vue の入力欄（実仕様 BlackoutDateRequest の備考）と同じ値
const REASON_MAX_LENGTH = 45

// 末尾から PAGE_SIZE + 1 件目の日付。これを date_from にすると既定ハンドラの絞り込みが
// ちょうど 51 件になり、offset=50 の 2 ページ目が「最後の 1 件」だけになる
const LAST_PAGE_FROM = blockedDates[blockedDates.length - (PAGE_SIZE + 1)].date

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('blocked-dates-table').getByTestId('data-table-row')
}

/** 追加モーダル。role=dialog の aria-label はモーダルのタイトル（BaseModal） */
function addDialogOf(page) {
  return page.getByRole('dialog', { name: '受注不可日 新規追加' })
}

/** 編集モーダル。モーダルは 3 つあるのでタイトルで絞る */
function editDialogOf(page) {
  return page.getByRole('dialog', { name: '受注不可日 編集' })
}

/** 削除確認モーダル。追加モーダルと取り違えないようタイトルで絞る */
function deleteDialogOf(page) {
  return page.getByRole('dialog', { name: '削除確認' })
}

/** 行の編集ボタン。testid は行の id を含む（日付を変えると id も作り直される点に注意） */
function editButtonOf(page, blocked) {
  return page.getByTestId(`blocked-dates-edit-${blocked.id}`)
}

/** 行の削除ボタン。testid は行の id を含む */
function deleteButtonOf(page, blocked) {
  return page.getByTestId(`blocked-dates-delete-${blocked.id}`)
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

  test('[BD-08] 一覧の右端に編集・削除の操作列がある', async ({ page }) => {
    await page.goto(PATH)

    const table = page.getByTestId('blocked-dates-table')
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    // 見出しの並び。最後の列（行ごとの操作）は画面モックに合わせて見出しが空
    await expect(table.getByRole('columnheader')).toHaveText(['日付', '対象市場', '理由', ''])

    // 理由のセルは操作のセルより左（列の並びと同じ位置関係）
    const firstRow = rowsOf(page).first()
    await expect(firstRow.getByRole('cell').nth(2)).toHaveText(firstBlockedDate.reason)

    // 行の操作は編集 → 削除の順。破壊的な操作を右端に置く
    const actionCell = firstRow.getByRole('cell').nth(3)
    await expect(actionCell.getByRole('button')).toHaveText(['編集', '削除'])

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

/*
 * 削除（BD-19〜23）。既定ハンドラは DELETE を可変配列に反映するので、件数が減るところまで見る。
 * モックの可変状態はページを開き直すと初期化されるため、テスト間で持ち越さない。
 *
 * サーバの拒否は blocked-dates-delete-error（モーダル内）に出る。新規追加と違い
 * 事前検証の 2 段は無いので、エラーの系統はこの 1 つだけ。
 */
test.describe('受注不可日マスタ 削除', () => {
  test('[BD-19] 行の「削除」を押すと確認モーダルが開く', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await deleteButtonOf(page, firstBlockedDate).click()

    const dialog = deleteDialogOf(page)
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(firstBlockedDate.date)
    await expect(dialog).toContainText('を削除しますか？')
    await expect(dialog).toContainText('この操作は元に戻せません。')
  })

  test('[BD-20] 「キャンセル」を押すと何も消えずに閉じる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await deleteButtonOf(page, firstBlockedDate).click()
    await expect(deleteDialogOf(page)).toBeVisible()

    await page.getByTestId('blocked-dates-delete-cancel').click()

    await expect(deleteDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('blocked-dates-count')).toHaveText(`${blockedDates.length} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(rowsOf(page).filter({ hasText: firstBlockedDate.date })).toHaveCount(1)
    await expect(page.getByTestId('blocked-dates-notice')).toHaveCount(0)
  })

  test('[BD-21] 「削除する」を押すと件数が 1 減りその行が消える', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await deleteButtonOf(page, firstBlockedDate).click()
    await page.getByTestId('blocked-dates-delete-submit').click()

    await expect(deleteDialogOf(page)).toBeHidden()

    // 成功メッセージの枠は追加と削除で共用
    const notice = page.getByTestId('blocked-dates-notice')
    await expect(notice).toBeVisible()
    await expect(notice).toHaveText(`${firstBlockedDate.date} を削除しました。`)

    await expect(page.getByTestId('blocked-dates-count')).toHaveText(
      `${blockedDates.length - 1} 件`,
    )
    await expect(rowsOf(page).filter({ hasText: firstBlockedDate.date })).toHaveCount(0)

    // 削除は一覧の単方向フローに触らない（URL は変わらない）
    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
  })

  test('[BD-22] 削除に失敗するとモーダルは開いたままエラーが出る', async ({ page }) => {
    await mockApi(page, [
      {
        method: 'delete',
        path: '*/api/blocked-dates/:id',
        status: 500,
        body: { message: 'サーバーでエラーが発生しました。' },
      },
    ])
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await deleteButtonOf(page, firstBlockedDate).click()
    await page.getByTestId('blocked-dates-delete-submit').click()

    const error = page.getByTestId('blocked-dates-delete-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('サーバーでエラーが発生しました。')

    // 消せていないので閉じない。一覧も通知も変わらない
    await expect(deleteDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('blocked-dates-count')).toHaveText(`${blockedDates.length} 件`)
    await expect(rowsOf(page).filter({ hasText: firstBlockedDate.date })).toHaveCount(1)
    await expect(page.getByTestId('blocked-dates-notice')).toHaveCount(0)
  })

  test('[BD-23] 最終ページの最後の 1 件を消すと 1 ページ前に戻る', async ({ page }) => {
    // 51 件に絞った 2 ページ目。行はちょうど 1 件になる
    await page.goto(`${PATH}?date_from=${LAST_PAGE_FROM}&offset=${PAGE_SIZE}`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(lastBlockedDate.date)

    await deleteButtonOf(page, lastBlockedDate).click()
    await page.getByTestId('blocked-dates-delete-submit').click()

    // 戻る直前に空状態が一瞬描画されるため、最終状態だけを web-first assertion で待つ
    await expect(page).toHaveURL(new RegExp(`\\${PATH}\\?date_from=${LAST_PAGE_FROM}$`))
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('blocked-dates-count')).toHaveText(`${PAGE_SIZE} 件`)
  })
})

/*
 * 編集（BD-24〜30）。既定ハンドラは PUT を可変配列に反映するので、更新後の行の見えかたまで見る。
 * モックの可変状態はページを開き直すと初期化されるため、テスト間で持ち越さない。
 *
 * エラーの出し先は新規追加と同じ 3 系統（項目直下 / 箇条書き / 専用の表示）で、
 * 楽観的ロックの競合 409 も 3 つ目に出る（画面は 409 を特別扱いしない）。
 * 既定ハンドラは合札（updated_at）が一致していれば通るので、競合の見えかたは
 * mockApi() で PUT を 409 に差し替えて作る（BD-29）。
 *
 * 事前検証は編集のとき「対象自身を重複と見なさない」ので、理由だけの変更は通る（BD-25）。
 */
test.describe('受注不可日マスタ 編集', () => {
  test('[BD-24] 行の「編集」を押すと現在値の入った入力欄でモーダルが開く', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await editButtonOf(page, firstBlockedDate).click()

    const dialog = editDialogOf(page)
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('blocked-dates-edit-date')).toHaveValue(firstBlockedDate.date)
    await expect(page.getByTestId('blocked-dates-edit-reason')).toHaveValue(firstBlockedDate.reason)

    // 入力項目は追加と同じ日付と理由の 2 つだけ（対象市場は編集できない）
    const form = dialog.getByTestId('blocked-dates-edit-form')
    await expect(form.locator('input')).toHaveCount(2)
    await expect(form.getByRole('combobox')).toHaveCount(0)
    await expect(form.getByLabel(/日付/)).toHaveCount(1)
    await expect(form.getByLabel(/理由/)).toHaveCount(1)
  })

  test('[BD-25] 理由だけを変えて「更新」を押すとその行の理由が変わる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await editButtonOf(page, firstBlockedDate).click()
    await page.getByTestId('blocked-dates-edit-reason').fill(EDITED_REASON)
    await page.getByTestId('blocked-dates-edit-submit').click()

    await expect(editDialogOf(page)).toBeHidden()

    // 成功メッセージの枠は追加・削除と共用
    const notice = page.getByTestId('blocked-dates-notice')
    await expect(notice).toBeVisible()
    await expect(notice).toHaveText(`${firstBlockedDate.date} を更新しました。`)

    // 日付を変えていないので件数も並びも動かない（自分自身の日付は重複として弾かれない）
    await expect(page.getByTestId('blocked-dates-count')).toHaveText(`${blockedDates.length} 件`)
    const row = rowsOf(page).filter({ hasText: firstBlockedDate.date })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(EDITED_REASON)
  })

  test('[BD-26] 日付を一覧に無い日付へ変えると元の日付の行が無くなる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await editButtonOf(page, firstBlockedDate).click()
    await page.getByTestId('blocked-dates-edit-date').fill(NEW_DATE)
    await page.getByTestId('blocked-dates-edit-submit').click()

    await expect(editDialogOf(page)).toBeHidden()

    // 成功メッセージはサーバが受理した（＝新しい）日付を出す
    const notice = page.getByTestId('blocked-dates-notice')
    await expect(notice).toBeVisible()
    await expect(notice).toHaveText(`${NEW_DATE} を更新しました。`)

    // 付け替えなので件数は増えない。元の日付は一覧から消える
    await expect(page.getByTestId('blocked-dates-count')).toHaveText(`${blockedDates.length} 件`)
    await expect(rowsOf(page).filter({ hasText: firstBlockedDate.date })).toHaveCount(0)
  })

  test('[BD-27] 別の行の日付へ変えると事前検証の理由が箇条書きで出る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await editButtonOf(page, firstBlockedDate).click()
    await page.getByTestId('blocked-dates-edit-date').fill(blockedDates[1].date)
    await page.getByTestId('blocked-dates-edit-submit').click()

    const validationError = page.getByTestId('blocked-dates-edit-validation-error')
    await expect(validationError).toBeVisible()
    await expect(validationError.getByRole('listitem')).toHaveText([
      'その日付の受注不可日はすでに登録されています。',
    ])

    // 事前検証の不合格は通信障害ではないので、専用の表示には出ない
    await expect(page.getByTestId('blocked-dates-edit-error')).toHaveCount(0)

    await expect(editDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('blocked-dates-notice')).toHaveCount(0)
    await expect(page.getByTestId('blocked-dates-count')).toHaveText(`${blockedDates.length} 件`)
  })

  test('[BD-28] 理由を空にして「更新」を押すと項目の直下にエラーが出る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await editButtonOf(page, firstBlockedDate).click()
    await page.getByTestId('blocked-dates-edit-reason').fill('')

    const dialog = editDialogOf(page)
    await page.getByTestId('blocked-dates-edit-submit').click()

    await expect(dialog.getByText('理由を入力してください。')).toBeVisible()

    // 3 系統のうち項目直下だけに出る。サーバへは行かないので他の 2 つは出ない
    await expect(page.getByTestId('blocked-dates-edit-validation-error')).toHaveCount(0)
    await expect(page.getByTestId('blocked-dates-edit-error')).toHaveCount(0)

    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('blocked-dates-notice')).toHaveCount(0)
  })

  test('[BD-29] 更新が競合するとモーダルは開いたままエラーが出る', async ({ page }) => {
    // 実ブラウザで「他の利用者」を作れないので、競合の応答そのものを差し替える。
    // 事前検証（*/api/blocked-dates/validate）はパスが別なので既定ハンドラのまま通る。
    // message を入れるのは、client.js が 409 の既定文言を持たないため（無いと汎用の文言になる）
    await mockApi(page, [
      {
        method: 'put',
        path: '*/api/blocked-dates/:id',
        status: 409,
        body: { message: CONFLICT_MESSAGE, code: 'conflict' },
      },
    ])
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await editButtonOf(page, firstBlockedDate).click()
    await page.getByTestId('blocked-dates-edit-reason').fill(EDITED_REASON)
    await page.getByTestId('blocked-dates-edit-submit').click()

    // 409 も通信・サーバ障害と同じ枠に出る（画面は 409 を特別扱いしない）
    const error = page.getByTestId('blocked-dates-edit-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText(CONFLICT_MESSAGE)

    // 事前検証は通っているので箇条書きは出ない
    await expect(page.getByTestId('blocked-dates-edit-validation-error')).toHaveCount(0)

    // 更新できていないので閉じない。一覧も通知も変わらない（自動で読み直さない）
    await expect(editDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('blocked-dates-count')).toHaveText(`${blockedDates.length} 件`)
    const row = rowsOf(page).filter({ hasText: firstBlockedDate.date })
    await expect(row).toContainText(firstBlockedDate.reason)
    await expect(page.getByTestId('blocked-dates-notice')).toHaveCount(0)
  })

  test('[BD-30] 開き直すと前回のエラーが消え現在値に戻る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await editButtonOf(page, firstBlockedDate).click()
    await page.getByTestId('blocked-dates-edit-date').fill(blockedDates[1].date)
    await page.getByTestId('blocked-dates-edit-submit').click()
    await expect(page.getByTestId('blocked-dates-edit-validation-error')).toBeVisible()

    await page.getByTestId('blocked-dates-edit-cancel').click()
    await expect(editDialogOf(page)).toBeHidden()

    await editButtonOf(page, firstBlockedDate).click()

    await expect(editDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('blocked-dates-edit-validation-error')).toHaveCount(0)
    // 入力は「前回いじった値」ではなくその行の現在値に戻る
    await expect(page.getByTestId('blocked-dates-edit-date')).toHaveValue(firstBlockedDate.date)
    await expect(page.getByTestId('blocked-dates-edit-reason')).toHaveValue(firstBlockedDate.reason)
  })
})
