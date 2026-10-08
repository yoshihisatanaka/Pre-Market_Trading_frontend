import { expect, test } from '@playwright/test'
import { clickSideMenuLink } from './helpers/sideMenu'
import { mockApi } from './helpers/mockApi'
import { feePreferences } from '../src/mocks/fixtures/feePreferences'
import { customers } from '../src/mocks/fixtures/customers'

// シナリオ: docs/e2e/fee-preferences.md（タイトル先頭の [FP-nn] が対応 ID）
// ページ位置と検索条件は URL クエリを正とするため、URL と画面の同期をここで守る。
// 登録・編集・削除は既定ハンドラが状態を保持するので、件数・行が変わるところまで見る。
// モックの可変状態はページを開き直すと初期化されるため、テスト間で持ち越さない。
// mockApi() は固定の body を返すだけで offset / branch_code / account_no / fee_pattern を解釈しない。
// ページングと絞り込みはクエリを実際に処理する既定ハンドラで検証する。

const PATH = '/masters/fee-preferences'

// src/stores/feePreferences.js の FEE_PREFERENCES_PAGE_SIZE と同じ値（実 API の既定も 50）。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

// 取消済み（取消区分 1）は既定の一覧に出ない。並びはハンドラと同じ口座番号の昇順
const allRows = feePreferences
  .filter((row) => row.取消区分 === 0)
  .map((row) => ({
    id: String(row.ID),
    accountNumber: String(row.口座番号),
    branchCode: row.部店コード,
    customerName: row.顧客名,
    feePattern: row.手数料パターン,
  }))
  .sort((a, b) => Number(a.accountNumber) - Number(b.accountNumber))
const TOTAL = allRows.length
const secondPage = allRows.slice(PAGE_SIZE)
const firstRow = allRows[0]

// 絞り込みに使う値もフィクスチャから導く
const SECOND_ACCOUNT = allRows[1].accountNumber
const BRANCH = allRows.find((row) => row.branchCode !== firstRow.branchCode).branchCode
const byBranch = allRows.filter((row) => row.branchCode === BRANCH)
const DIRECT_ROW = allRows[4]
// 手数料パターンの「デフォルト」は空文字。URL には src/utils/feePreferenceOptions.js の目印で載る
const DEFAULT_FILTER = 'default'
const byDefaultPattern = allRows.filter((row) => row.feePattern === '')

// 優遇の登録が無い口座（顧客マスタにあってフィクスチャに無いもの。各部店の 14 件目）
const unregisteredAccounts = customers
  .map((customer) => String(customer.口座番号))
  .filter((accountNumber) => !allRows.some((row) => row.accountNumber === accountNumber))
const UNREGISTERED = unregisteredAccounts[0]
// 別部店の未登録口座（FP-20。FP-15 と同じ口座を避けて意図を分ける）
const OTHER_UNREGISTERED = unregisteredAccounts.find(
  (accountNumber) => !accountNumber.startsWith(UNREGISTERED.slice(0, 3)),
)

// DataTable の列順（FeePreferenceListView.vue の columns）
const COLUMN_INDEX = { applyMethod: 3, feePattern: 4, fxSpread: 9 }

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'
const duplicateMessage = (accountNumber) =>
  `口座番号(${accountNumber})の手数料優遇は既に登録されています`

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('fee-preferences-table').getByTestId('data-table-row')
}

function addDialogOf(page) {
  return page.getByRole('dialog', { name: '手数料優遇 新規追加' })
}

function editDialogOf(page) {
  return page.getByRole('dialog', { name: '手数料優遇 編集' })
}

function deleteDialogOf(page) {
  return page.getByRole('dialog', { name: '削除確認' })
}

/** 一覧を開いて 1 ページ目が出るまで待つ */
async function openList(page) {
  await page.goto(PATH)
  await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
}

async function openAdd(page) {
  await page.getByTestId('fee-preferences-add').click()
  await expect(addDialogOf(page)).toBeVisible()
}

/** 行の「編集」を押す（ボタンの data-testid は行の id を含む） */
async function openEdit(page, row = firstRow) {
  await page.getByTestId(`fee-preferences-edit-${row.id}`).click()
  await expect(editDialogOf(page)).toBeVisible()
}

/** 行の「削除」を押す（ボタンの data-testid は行の id を含む） */
async function openDelete(page, row = firstRow) {
  await page.getByTestId(`fee-preferences-delete-${row.id}`).click()
  await expect(deleteDialogOf(page)).toBeVisible()
}

test.describe('手数料優遇マスタ一覧', () => {
  test('[FP-01] サイドメニューから開くと一覧と件数が表示される', async ({ page }) => {
    await page.goto('/')

    await clickSideMenuLink(page, '手数料優遇マスタ')

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByRole('heading', { name: '手数料優遇マスタ', exact: true })).toBeVisible()
    await expect(page.getByTestId('fee-preferences-add')).toHaveText('新規追加')

    await expect(page.getByTestId('fee-preferences-count')).toHaveText(`${TOTAL} 件`)
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)
    await expect(rows.first()).toContainText(firstRow.accountNumber)
    await expect(rows.first()).toContainText(firstRow.customerName)
  })

  test('[FP-02] 「次のページ」を押すと 2 ページ目が表示される', async ({ page }) => {
    await openList(page)

    const pagination = page.getByTestId('fee-preferences-pagination')
    await pagination.getByRole('button', { name: '次のページ' }).click()

    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(secondPage.length)
    await expect(rows.first()).toContainText(secondPage[0].accountNumber)
    await expect(pagination.getByTestId('pagination-range')).toHaveText(
      `${TOTAL} 件中 ${PAGE_SIZE + 1}–${TOTAL} 件`,
    )
  })

  test('[FP-03] 口座番号で絞り込むと URL と一覧に反映される', async ({ page }) => {
    await openList(page)

    await page.getByTestId('fee-preferences-account-number').fill(SECOND_ACCOUNT)
    await page.getByTestId('fee-preferences-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`account_no=${SECOND_ACCOUNT}`))
    await expect(page.getByTestId('fee-preferences-count')).toHaveText('1 件')
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(SECOND_ACCOUNT)
  })

  test('[FP-04] 部店コードで絞り込むとその部店の行だけになる', async ({ page }) => {
    await openList(page)

    await page.getByTestId('fee-preferences-branch-code').selectOption(BRANCH)
    await page.getByTestId('fee-preferences-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`branch_code=${BRANCH}`))
    await expect(page.getByTestId('fee-preferences-count')).toHaveText(`${byBranch.length} 件`)
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(byBranch.length)
    // 部店の列（先頭）が全行その部店
    await expect(rows.locator('td:first-child')).toHaveText(
      Array.from({ length: byBranch.length }, () => BRANCH),
    )
  })

  test('[FP-05] 「クリア」を押すと絞り込みが解除される', async ({ page }) => {
    await openList(page)

    await page.getByTestId('fee-preferences-branch-code').selectOption(firstRow.branchCode)
    await page.getByTestId('fee-preferences-account-number').fill(firstRow.accountNumber)
    await page.getByTestId('fee-preferences-search-submit').click()
    await expect(rowsOf(page)).toHaveCount(1)

    await page.getByTestId('fee-preferences-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('fee-preferences-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('fee-preferences-branch-code')).toHaveValue('')
    await expect(page.getByTestId('fee-preferences-account-number')).toHaveValue('')
    await expect(page.getByTestId('fee-preferences-fee-pattern')).toHaveValue('')
  })

  test('[FP-06] 優遇の登録が無い口座で検索すると空状態になる', async ({ page }) => {
    await openList(page)

    await page.getByTestId('fee-preferences-account-number').fill(UNREGISTERED)
    await page.getByTestId('fee-preferences-search-submit').click()

    await expect(page.getByTestId('fee-preferences-empty')).toHaveText(
      '該当する手数料優遇はありません。',
    )
    await expect(page.getByTestId('fee-preferences-table')).toBeHidden()
  })

  test('[FP-07] API がエラーを返したときエラー表示と再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [
      { path: '*/api/masters/fee-preferences', status: 500, body: { detail: ERROR_MESSAGE } },
    ])
    await page.goto(PATH)

    const error = page.getByTestId('fee-preferences-error')
    await expect(error).toContainText(ERROR_MESSAGE)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('fee-preferences-table')).toBeHidden()
  })

  test('[FP-08] 列順が仕様どおりで、右端の操作列に編集と削除がある', async ({ page }) => {
    await openList(page)

    await expect(page.getByTestId('fee-preferences-table').locator('th')).toHaveText([
      '部店',
      '口座番号',
      '顧客名',
      '適用方式',
      '手数料パターン',
      '掛目',
      '手数料 下限〜上限',
      'ベイシス',
      'ベイシス 下限〜上限',
      '為替スプレッド',
      '更新日時',
      // 行ごとの操作。他のマスタ画面に合わせて見出しは空
      '',
    ])

    const rowButtons = rowsOf(page).first().getByRole('button')
    await expect(rowButtons).toHaveCount(2)
    await expect(rowButtons).toHaveText(['編集', '削除'])
  })

  test('[FP-09] ブラウザバックで前のページに戻る', async ({ page }) => {
    await openList(page)

    await page
      .getByTestId('fee-preferences-pagination')
      .getByRole('button', { name: '次のページ' })
      .click()
    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))
    await expect(rowsOf(page)).toHaveCount(secondPage.length)

    await page.goBack()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(rowsOf(page).first()).toContainText(firstRow.accountNumber)
  })

  test('[FP-10] URL を直接開くと検索欄と一覧に反映される', async ({ page }) => {
    await page.goto(
      `${PATH}?branch_code=${DIRECT_ROW.branchCode}&account_no=${DIRECT_ROW.accountNumber}`,
    )

    await expect(page.getByTestId('fee-preferences-branch-code')).toHaveValue(DIRECT_ROW.branchCode)
    await expect(page.getByTestId('fee-preferences-account-number')).toHaveValue(
      DIRECT_ROW.accountNumber,
    )
    await expect(page.getByTestId('fee-preferences-count')).toHaveText('1 件')
    await expect(rowsOf(page)).toHaveCount(1)
    await expect(rowsOf(page).first()).toContainText(DIRECT_ROW.accountNumber)
  })

  test('[FP-11] 手数料パターン「デフォルト」で絞り込める', async ({ page }) => {
    // 1 ページに収まらないとページ内の全行を見る検査が成り立たない
    expect(byDefaultPattern.length).toBeLessThanOrEqual(PAGE_SIZE)
    await openList(page)

    await page.getByTestId('fee-preferences-fee-pattern').selectOption(DEFAULT_FILTER)
    await page.getByTestId('fee-preferences-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`fee_pattern=${DEFAULT_FILTER}`))
    await expect(page.getByTestId('fee-preferences-count')).toHaveText(
      `${byDefaultPattern.length} 件`,
    )
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(byDefaultPattern.length)
    await expect(rows.locator(`td:nth-child(${COLUMN_INDEX.feePattern + 1})`)).toHaveText(
      Array.from({ length: byDefaultPattern.length }, () => 'デフォルト'),
    )
  })
})

/*
 * 新規追加（FP-13〜20）。登録は「事前検証 → 登録」の 2 段で、エラーの出し先が 4 系統に分かれる。
 *   入力の不備       … 項目の直下（FP-14 / FP-19）
 *   事前検証の不合格 … fee-preferences-add-validation-error の箇条書き（FP-16）
 *   事前検証の警告   … fee-preferences-add-validation-warning（FP-20。ボタンが「続行」になる）
 *   通信・サーバ障害 … fee-preferences-add-error（FP-17）
 * 事前検証と登録は別パス（…/validate と …/fee-preferences）なので mockApi() で一方だけを差し替えられる。
 */
test.describe('手数料優遇マスタ 新規追加', () => {
  test('[FP-13] 「新規追加」を押すと 9 項目のモーダルが開く', async ({ page }) => {
    await openList(page)
    await openAdd(page)

    for (const name of [
      'account-number',
      'fee-multiplier',
      'min-fee',
      'max-fee',
      'basis-points',
      'min-basis-fee',
      'max-basis-fee',
      'fx-spread',
    ]) {
      await expect(page.getByTestId(`fee-preferences-add-${name}`)).toHaveValue('')
    }
    // 手数料パターンは未選択を作らず、デフォルト（空文字）から始める
    const feePattern = page.getByTestId('fee-preferences-add-fee-pattern')
    await expect(feePattern).toHaveValue('')
    await expect(feePattern.locator('option:checked')).toHaveText('デフォルト')

    // 入力項目は 9（input 8 + select 1）
    const form = addDialogOf(page).getByTestId('fee-preferences-add-form')
    await expect(form.locator('input')).toHaveCount(8)
    await expect(form.getByRole('combobox')).toHaveCount(1)
    for (const label of [
      '口座番号',
      '手数料パターン',
      '掛目（%）',
      '下限手数料（円）',
      '上限手数料（円）',
      'ベイシス（bp）',
      '下限ベイシス（円）',
      '上限ベイシス（円）',
      '為替スプレッド（円/USD）',
    ]) {
      await expect(form.getByLabel(label)).toHaveCount(1)
    }
  })

  test('[FP-14] 未入力のまま「追加」を押すと口座番号の直下にエラーが出る', async ({ page }) => {
    await openList(page)
    await openAdd(page)

    await page.getByTestId('fee-preferences-add-submit').click()

    const dialog = addDialogOf(page)
    await expect(dialog.getByText('口座番号を入力してください。')).toBeVisible()
    await expect(page.getByTestId('fee-preferences-add-validation-error')).toHaveCount(0)
    await expect(page.getByTestId('fee-preferences-add-error')).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('fee-preferences-count')).toHaveText(`${TOTAL} 件`)
  })

  test('[FP-15] 登録の無い口座を追加すると件数が 1 増える', async ({ page }) => {
    await openList(page)
    await openAdd(page)

    await page.getByTestId('fee-preferences-add-account-number').fill(UNREGISTERED)
    await page.getByTestId('fee-preferences-add-fx-spread').fill('0')
    await page.getByTestId('fee-preferences-add-submit').click()

    await expect(addDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('fee-preferences-notice')).toContainText(UNREGISTERED)
    await expect(page.getByTestId('fee-preferences-count')).toHaveText(`${TOTAL + 1} 件`)
    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
  })

  test('[FP-16] 既に登録のある口座を追加すると事前検証の理由が箇条書きで出る', async ({ page }) => {
    await openList(page)
    await openAdd(page)

    await page.getByTestId('fee-preferences-add-account-number').fill(firstRow.accountNumber)
    await page.getByTestId('fee-preferences-add-submit').click()

    const validationError = page.getByTestId('fee-preferences-add-validation-error')
    await expect(validationError.getByRole('listitem')).toHaveText([
      duplicateMessage(firstRow.accountNumber),
    ])
    // 項目直下には混ざらない
    await expect(addDialogOf(page).getByText('口座番号を入力してください。')).toHaveCount(0)
    await expect(page.getByTestId('fee-preferences-add-error')).toHaveCount(0)
    await expect(addDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('fee-preferences-count')).toHaveText(`${TOTAL} 件`)
  })

  test('[FP-17] 登録に失敗するとモーダルは開いたままエラーが出る', async ({ page }) => {
    // 事前検証（*/api/masters/fee-preferences/validate）はパスが別なので既定ハンドラのまま通る
    await mockApi(page, [
      {
        method: 'post',
        path: '*/api/masters/fee-preferences',
        status: 500,
        body: { detail: ERROR_MESSAGE },
      },
    ])
    await openList(page)
    await openAdd(page)

    await page.getByTestId('fee-preferences-add-account-number').fill(UNREGISTERED)
    await page.getByTestId('fee-preferences-add-submit').click()

    await expect(page.getByTestId('fee-preferences-add-error')).toContainText(ERROR_MESSAGE)
    await expect(addDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('fee-preferences-add-validation-error')).toHaveCount(0)
    await expect(page.getByTestId('fee-preferences-notice')).toHaveCount(0)
    await expect(page.getByTestId('fee-preferences-count')).toHaveText(`${TOTAL} 件`)
  })

  test('[FP-18] モーダルを開き直すと前回の失敗と入力が残らない', async ({ page }) => {
    await openList(page)
    await openAdd(page)

    await page.getByTestId('fee-preferences-add-account-number').fill(firstRow.accountNumber)
    await page.getByTestId('fee-preferences-add-fee-pattern').selectOption('A')
    await page.getByTestId('fee-preferences-add-submit').click()
    await expect(page.getByTestId('fee-preferences-add-validation-error')).toBeVisible()

    await page.getByTestId('fee-preferences-add-cancel').click()
    await expect(addDialogOf(page)).toBeHidden()
    await openAdd(page)

    await expect(page.getByTestId('fee-preferences-add-validation-error')).toHaveCount(0)
    await expect(page.getByTestId('fee-preferences-add-account-number')).toHaveValue('')
    await expect(page.getByTestId('fee-preferences-add-fee-pattern')).toHaveValue('')
  })

  test('[FP-19] 掛目に数値でない値を入れると掛目の直下にエラーが出る', async ({ page }) => {
    await openList(page)
    await openAdd(page)

    await page.getByTestId('fee-preferences-add-account-number').fill(UNREGISTERED)
    await page.getByTestId('fee-preferences-add-fee-multiplier').fill('abc')
    await page.getByTestId('fee-preferences-add-submit').click()

    const dialog = addDialogOf(page)
    await expect(dialog.getByText('掛目は 0 以上の数値で入力してください。')).toBeVisible()
    await expect(dialog).toBeVisible()
    // サーバへは送らないので、事前検証にも通信エラーにも出ない
    await expect(page.getByTestId('fee-preferences-add-validation-error')).toHaveCount(0)
    await expect(page.getByTestId('fee-preferences-add-error')).toHaveCount(0)
    await expect(page.getByTestId('fee-preferences-count')).toHaveText(`${TOTAL} 件`)
  })

  test('[FP-20] 警告を見てから「続行」を押すと登録される', async ({ page }) => {
    await openList(page)
    await openAdd(page)

    await page.getByTestId('fee-preferences-add-account-number').fill(OTHER_UNREGISTERED)
    await page.getByTestId('fee-preferences-add-fee-pattern').selectOption('E')
    await page.getByTestId('fee-preferences-add-submit').click()

    // 1 回目は登録せずに警告を見せる。警告はエラーの枠には出ない
    const warning = page.getByTestId('fee-preferences-add-validation-warning')
    await expect(warning).toContainText('手数料パターン(E)は手数料パターンマスタに未登録です')
    await expect(page.getByTestId('fee-preferences-add-validation-error')).toHaveCount(0)
    await expect(addDialogOf(page)).toBeVisible()
    const submit = page.getByTestId('fee-preferences-add-submit')
    await expect(submit).toHaveText('続行')
    await expect(page.getByTestId('fee-preferences-count')).toHaveText(`${TOTAL} 件`)

    await submit.click()

    await expect(addDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('fee-preferences-notice')).toContainText(OTHER_UNREGISTERED)
    await expect(page.getByTestId('fee-preferences-count')).toHaveText(`${TOTAL + 1} 件`)
  })
})

/*
 * 編集（FP-21〜27）。警告で止まらず、変更の応答が返した警告を fee-preferences-notice-warning に出す。
 * エラーの出し先は新規追加と同じ（data-testid は fee-preferences-edit-… に振り替わる）。
 * 409 の競合も通信・サーバ障害と同じ枠に出す。
 */
test.describe('手数料優遇マスタ 編集', () => {
  const VALIDATION_MESSAGE = '下限手数料は上限手数料以下で指定してください'
  const CONFLICT_MESSAGE =
    '他のユーザーによって手数料優遇が更新されています。最新データを再取得してください。'

  /** 事前検証を不合格にする差し替え（更新そのものは既定ハンドラのまま） */
  const failValidate = (page) =>
    mockApi(page, [
      {
        method: 'post',
        path: '*/api/masters/fee-preferences/validate',
        body: { valid: false, errors: [VALIDATION_MESSAGE], warnings: [], details: null },
      },
    ])

  test('[FP-21] 行の「編集」を押すと現在値が入り、口座番号も変更できる', async ({ page }) => {
    const raw = feePreferences.find((row) => String(row.ID) === firstRow.id)
    await openList(page)
    await openEdit(page)

    const accountNumber = page.getByTestId('fee-preferences-edit-account-number')
    await expect(accountNumber).toHaveValue(firstRow.accountNumber)
    const feePattern = page.getByTestId('fee-preferences-edit-fee-pattern')
    await expect(feePattern).toHaveValue(raw.手数料パターン)
    await expect(feePattern.locator('option:checked')).toHaveText('デフォルト')
    await expect(page.getByTestId('fee-preferences-edit-fx-spread')).toHaveValue(
      String(raw.スプレッド),
    )

    // パスキーが ID なので口座番号は読み取り専用にしない
    await expect(accountNumber).toBeEditable()
  })

  test('[FP-22] 為替スプレッドを変えて更新すると一覧のその行が変わる', async ({ page }) => {
    await openList(page)
    await openEdit(page)

    await page.getByTestId('fee-preferences-edit-fx-spread').fill('0.3')
    await page.getByTestId('fee-preferences-edit-submit').click()

    await expect(editDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('fee-preferences-notice')).toContainText(firstRow.accountNumber)
    await expect(page.getByTestId('fee-preferences-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page).first().locator('td').nth(COLUMN_INDEX.fxSpread)).toHaveText(
      '0.3 円/USD',
    )
  })

  test('[FP-23] 方式で使われない項目を入れて更新すると警告が添えられる', async ({ page }) => {
    await openList(page)
    await openEdit(page)

    await page.getByTestId('fee-preferences-edit-basis-points').fill('30')
    await page.getByTestId('fee-preferences-edit-fee-multiplier').fill('80')
    await page.getByTestId('fee-preferences-edit-submit').click()

    // 編集は警告で止まらない
    await expect(editDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('fee-preferences-notice')).toBeVisible()
    await expect(page.getByTestId('fee-preferences-notice-warning')).toContainText(
      'ベイシス方式のため、掛目は使用されません',
    )
    await expect(rowsOf(page).first().locator('td').nth(COLUMN_INDEX.applyMethod)).toHaveText(
      'ベイシス方式',
    )
  })

  test('[FP-24] 口座番号を空にして更新すると項目の直下にエラーが出る', async ({ page }) => {
    await openList(page)
    await openEdit(page)

    await page.getByTestId('fee-preferences-edit-account-number').fill('')
    await page.getByTestId('fee-preferences-edit-submit').click()

    const dialog = editDialogOf(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('口座番号を入力してください。')).toBeVisible()
    await expect(page.getByTestId('fee-preferences-edit-validation-error')).toHaveCount(0)
    await expect(page.getByTestId('fee-preferences-edit-error')).toHaveCount(0)
    await expect(page.getByTestId('fee-preferences-notice')).toHaveCount(0)
  })

  test('[FP-25] 事前検証に弾かれると理由が箇条書きで出る', async ({ page }) => {
    await failValidate(page)
    await openList(page)
    await openEdit(page)

    await page.getByTestId('fee-preferences-edit-fx-spread').fill('0.3')
    await page.getByTestId('fee-preferences-edit-submit').click()

    await expect(
      page.getByTestId('fee-preferences-edit-validation-error').getByRole('listitem'),
    ).toHaveText([VALIDATION_MESSAGE])
    await expect(editDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('fee-preferences-edit-error')).toHaveCount(0)
    await expect(page.getByTestId('fee-preferences-count')).toHaveText(`${TOTAL} 件`)
  })

  test('[FP-26] 競合(409)は通信・サーバ障害と同じ枠に出る', async ({ page }) => {
    await mockApi(page, [
      {
        method: 'put',
        path: '*/api/masters/fee-preferences/:id',
        status: 409,
        body: { detail: CONFLICT_MESSAGE },
      },
    ])
    await openList(page)
    await openEdit(page)

    await page.getByTestId('fee-preferences-edit-fx-spread').fill('0.3')
    await page.getByTestId('fee-preferences-edit-submit').click()

    await expect(page.getByTestId('fee-preferences-edit-error')).toContainText(CONFLICT_MESSAGE)
    await expect(editDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('fee-preferences-edit-validation-error')).toHaveCount(0)
    await expect(page.getByTestId('fee-preferences-notice')).toHaveCount(0)
    await expect(page.getByTestId('fee-preferences-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page).first().locator('td').nth(COLUMN_INDEX.fxSpread)).not.toHaveText(
      '0.3 円/USD',
    )
  })

  test('[FP-27] モーダルを開き直すと前回の理由が消え現在値に戻る', async ({ page }) => {
    const raw = feePreferences.find((row) => String(row.ID) === firstRow.id)
    await failValidate(page)
    await openList(page)
    await openEdit(page)

    await page.getByTestId('fee-preferences-edit-fx-spread').fill('0.3')
    await page.getByTestId('fee-preferences-edit-submit').click()
    await expect(page.getByTestId('fee-preferences-edit-validation-error')).toBeVisible()

    await page.getByTestId('fee-preferences-edit-cancel').click()
    await expect(editDialogOf(page)).toBeHidden()
    await openEdit(page)

    await expect(page.getByTestId('fee-preferences-edit-validation-error')).toHaveCount(0)
    await expect(page.getByTestId('fee-preferences-edit-fx-spread')).toHaveValue(
      String(raw.スプレッド),
    )
    await expect(page.getByTestId('fee-preferences-edit-account-number')).toHaveValue(
      firstRow.accountNumber,
    )
  })
})

test.describe('手数料優遇マスタ 削除', () => {
  test('[FP-30] 削除確認は消す対象と取り消せない旨を出す', async ({ page }) => {
    await openList(page)
    await openDelete(page)

    const dialog = deleteDialogOf(page)
    await expect(dialog).toContainText(firstRow.accountNumber)
    await expect(dialog).toContainText(firstRow.customerName)
    await expect(dialog).toContainText('を削除しますか？')
    await expect(dialog).toContainText('この操作は元に戻せません。')
  })

  test('[FP-31] キャンセルすると何も起きない', async ({ page }) => {
    await openList(page)
    await openDelete(page)

    await page.getByTestId('fee-preferences-delete-cancel').click()

    await expect(deleteDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('fee-preferences-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(rowsOf(page).first()).toContainText(firstRow.accountNumber)
    await expect(page.getByTestId('fee-preferences-notice')).toHaveCount(0)
  })

  test('[FP-32] 削除するとダイアログが閉じ、件数が 1 減って行が消える', async ({ page }) => {
    await openList(page)
    await openDelete(page)

    await page.getByTestId('fee-preferences-delete-submit').click()

    await expect(deleteDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('fee-preferences-notice')).toContainText(firstRow.accountNumber)
    await expect(page.getByTestId('fee-preferences-count')).toHaveText(`${TOTAL - 1} 件`)
    await expect(page.getByTestId(`fee-preferences-edit-${firstRow.id}`)).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
  })

  test('[FP-33] 削除に失敗するとダイアログは開いたまま理由を出す', async ({ page }) => {
    await mockApi(page, [
      {
        method: 'delete',
        path: '*/api/masters/fee-preferences/:id',
        status: 500,
        body: { detail: ERROR_MESSAGE },
      },
    ])
    await openList(page)
    await openDelete(page)

    await page.getByTestId('fee-preferences-delete-submit').click()

    await expect(page.getByTestId('fee-preferences-delete-error')).toContainText(ERROR_MESSAGE)
    await expect(deleteDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('fee-preferences-count')).toHaveText(`${TOTAL} 件`)
    await expect(page.getByTestId(`fee-preferences-edit-${firstRow.id}`)).toHaveCount(1)
    await expect(page.getByTestId('fee-preferences-notice')).toHaveCount(0)
  })

  test('[FP-34] 最終ページの行をすべて消すと 1 ページ目に戻る', async ({ page }) => {
    // 2 ページ目が 2 行あることが前提
    expect(secondPage.length).toBe(2)
    await page.goto(`${PATH}?offset=${PAGE_SIZE}`)
    await expect(rowsOf(page)).toHaveCount(secondPage.length)

    await openDelete(page, secondPage[0])
    await page.getByTestId('fee-preferences-delete-submit').click()
    await expect(deleteDialogOf(page)).toBeHidden()
    // 1 件目を消した時点ではまだ 2 ページ目に居る
    await expect(rowsOf(page)).toHaveCount(1)
    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))

    await openDelete(page, secondPage[1])
    await page.getByTestId('fee-preferences-delete-submit').click()
    await expect(deleteDialogOf(page)).toBeHidden()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('fee-preferences-count')).toHaveText(`${TOTAL - 2} 件`)
  })
})
