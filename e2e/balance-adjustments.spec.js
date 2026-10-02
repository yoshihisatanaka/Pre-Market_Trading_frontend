import { expect, test } from '@playwright/test'
import { clickSideMenuLink } from './helpers/sideMenu'
import { balanceAdjustments } from '../src/mocks/fixtures/balanceAdjustments'
import { customers } from '../src/mocks/fixtures/customers'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/balance-adjustments.md（タイトル先頭の [BA-xx] が対応 ID）
// ページ位置と検索条件は URL クエリを正とするため、URL と画面の同期をここで守る。
// mockApi() は固定の body を返すだけで limit / offset / account_no / symbol を解釈しない。
// ページングと絞り込み（BA-02〜06 / 09）はクエリを実際に処理する既定ハンドラで検証する。

const PATH = '/masters/balance-adjustments'

// src/stores/balanceAdjustments.js の BALANCE_ADJUSTMENTS_PAGE_SIZE と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

/*
 * 一覧の並びは既定ハンドラ（src/mocks/handlers/balanceAdjustments.js）が決める
 * 口座番号 → 銘柄コード の昇順。フィクスチャは生成順のままなので、期待値はここで並べ直す。
 * 取消済みの行は別の配列（canceledBalanceAdjustments）にあり、一覧には出ない。
 */
const sortedRows = [...balanceAdjustments].sort(
  (a, b) => a.口座番号 - b.口座番号 || a.銘柄コード.localeCompare(b.銘柄コード),
)
const firstPage = sortedRows.slice(0, PAGE_SIZE)
const secondPage = sortedRows.slice(PAGE_SIZE)
const firstRow = sortedRows[0]

// 検索条件。値はフィクスチャの先頭行から取り、期待件数も同じ規則で数える
const SEARCH_ACCOUNT_NO = String(firstRow.口座番号)
const byAccount = sortedRows.filter((row) => row.口座番号 === firstRow.口座番号)
const SEARCH_TICKER = firstRow.Ticker
const byTicker = sortedRows.filter(
  (row) =>
    row.銘柄コード.toUpperCase().includes(SEARCH_TICKER) ||
    (row.Ticker ?? '').toUpperCase().includes(SEARCH_TICKER),
)
// 銘柄名の先頭の語（'Apple Inc.' → 'Apple'）。モックのハンドラだけが解釈する
const SEARCH_SYMBOL_NAME = firstRow.銘柄名.split(' ')[0]
const bySymbolName = sortedRows.filter((row) =>
  (row.銘柄名 ?? '').toUpperCase().includes(SEARCH_SYMBOL_NAME.toUpperCase()),
)

// 1 ページ目にある「取込のままの行」と「手で補正された行」。BA-10 で見比べる
const untouchedIndex = firstPage.findIndex((row) => row.更新日時 === null)
const modifiedIndex = firstPage.findIndex((row) => row.ユーザー操作フラグ === 1)
const modifiedRow = firstPage[modifiedIndex]

/** 'YYYY-MM-DDThh:mm:ss' → 'MM/DD hh:mm'（src/utils/format.js の formatMonthDayTime の表示） */
const toMonthDayTime = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)} ${iso.slice(11, 16)}`

// 列の並び（src/views/BalanceAdjustmentListView.vue の columns）
const COL = {
  branchCode: 0,
  accountNumber: 1,
  customerName: 3,
  ticker: 4,
  symbolName: 5,
  balance: 7,
  updated: 9,
}

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('balance-adjustments-table').getByTestId('data-table-row')
}

/** 行の n 列目のセル */
function cellOf(row, column) {
  return row.getByRole('cell').nth(column)
}

test.describe('残高マスタ 一覧・検索', () => {
  test('[BA-01] サイドメニューから開くと一覧と件数が表示される', async ({ page }) => {
    await page.goto('/')

    await clickSideMenuLink(page, '残高マスタ')

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByRole('heading', { name: '残高マスタ', exact: true })).toBeVisible()
    // 画面固有の操作がヘッダ（#topbar-actions）へ差し込まれている
    await expect(page.getByTestId('balance-adjustments-add')).toBeVisible()
    await expect(page.getByTestId('balance-adjustments-add')).toHaveText('新規保有を追加')

    await expect(page.getByTestId('balance-adjustments-count')).toHaveText(
      `${balanceAdjustments.length} 件`,
    )

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)

    const first = rows.first()
    await expect(cellOf(first, COL.branchCode)).toHaveText(firstRow.部店コード)
    await expect(cellOf(first, COL.accountNumber)).toHaveText(String(firstRow.口座番号))
    await expect(cellOf(first, COL.customerName)).toHaveText(firstRow.顧客名)
    await expect(cellOf(first, COL.ticker)).toHaveText(firstRow.Ticker)
    await expect(cellOf(first, COL.symbolName)).toHaveText(firstRow.銘柄名)
    await expect(cellOf(first, COL.balance)).toHaveText(
      `${firstRow.残高.toLocaleString('ja-JP')}株`,
    )
  })

  test('[BA-02] 「次のページ」を押すと 2 ページ目が表示される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    const pagination = page.getByTestId('balance-adjustments-pagination')
    await pagination.getByRole('button', { name: '次のページ' }).click()

    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(secondPage.length)
    await expect(cellOf(rows.first(), COL.accountNumber)).toHaveText(
      String(secondPage[0].口座番号),
    )
    await expect(cellOf(rows.first(), COL.ticker)).toHaveText(secondPage[0].Ticker)

    await expect(pagination.getByTestId('pagination-range')).toHaveText(
      `${balanceAdjustments.length} 件中 ${PAGE_SIZE + 1}–${balanceAdjustments.length} 件`,
    )
  })

  test('[BA-03] 口座番号で絞り込むと URL と一覧に反映される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('balance-adjustments-account-number').fill(SEARCH_ACCOUNT_NO)
    await page.getByTestId('balance-adjustments-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`account_no=${SEARCH_ACCOUNT_NO}`))
    await expect(page.getByTestId('balance-adjustments-count')).toHaveText(
      `${byAccount.length} 件`,
    )

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(byAccount.length)
    for (let index = 0; index < byAccount.length; index += 1) {
      await expect(cellOf(rows.nth(index), COL.accountNumber)).toHaveText(SEARCH_ACCOUNT_NO)
    }
  })

  test('[BA-04] ティッカーで絞り込むと該当銘柄の行だけになる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('balance-adjustments-ticker').fill(SEARCH_TICKER)
    await page.getByTestId('balance-adjustments-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`symbol=${SEARCH_TICKER}`))
    await expect(page.getByTestId('balance-adjustments-count')).toHaveText(
      `${byTicker.length} 件`,
    )

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(byTicker.length)
    for (let index = 0; index < byTicker.length; index += 1) {
      await expect(cellOf(rows.nth(index), COL.ticker)).toHaveText(SEARCH_TICKER)
    }
  })

  test('[BA-05] 銘柄名で絞り込むと銘柄名を含む行だけになる（モック限定）', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('balance-adjustments-symbol-name').fill(SEARCH_SYMBOL_NAME)
    await page.getByTestId('balance-adjustments-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`symbol_name=${SEARCH_SYMBOL_NAME}`))
    await expect(page.getByTestId('balance-adjustments-count')).toHaveText(
      `${bySymbolName.length} 件`,
    )

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(bySymbolName.length)
    for (let index = 0; index < bySymbolName.length; index += 1) {
      await expect(cellOf(rows.nth(index), COL.symbolName)).toContainText(SEARCH_SYMBOL_NAME)
    }
  })

  test('[BA-06] 「クリア」を押すと絞り込みが解除される', async ({ page }) => {
    await page.goto(PATH)

    await page.getByTestId('balance-adjustments-account-number').fill(SEARCH_ACCOUNT_NO)
    await page.getByTestId('balance-adjustments-search-submit').click()
    await expect(rowsOf(page)).toHaveCount(byAccount.length)

    await page.getByTestId('balance-adjustments-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('balance-adjustments-count')).toHaveText(
      `${balanceAdjustments.length} 件`,
    )
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('balance-adjustments-account-number')).toHaveValue('')
  })

  test('[BA-07] API がエラーを返したときエラー表示と再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [
      {
        path: '*/api/masters/balance-adjustments',
        status: 500,
        body: { detail: 'サーバーでエラーが発生しました。' },
      },
    ])
    await page.goto(PATH)

    const error = page.getByTestId('balance-adjustments-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('サーバーでエラーが発生しました。')
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('balance-adjustments-table')).toHaveCount(0)

    // 検索フォームは 4 状態の外。条件を直せるよう消えない
    await expect(page.getByTestId('balance-adjustments-search')).toBeVisible()
  })

  test('[BA-08] 残高が 0 件のとき空状態が表示される', async ({ page }) => {
    await mockApi(page, [
      {
        path: '*/api/masters/balance-adjustments',
        body: { total: 0, limit: PAGE_SIZE, offset: 0, balances: [] },
      },
    ])
    await page.goto(PATH)

    const empty = page.getByTestId('balance-adjustments-empty')
    await expect(empty).toBeVisible()
    await expect(empty).toContainText('条件に一致する保有残高がありません。')
    await expect(page.getByTestId('data-table-row')).toHaveCount(0)
    await expect(page.getByTestId('balance-adjustments-count')).toHaveText('0 件')
  })

  test('[BA-09] offset 付きの URL を直接開くと 2 ページ目が復元される', async ({ page }) => {
    await page.goto(`${PATH}?offset=${PAGE_SIZE}`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(secondPage.length)
    await expect(cellOf(rows.first(), COL.accountNumber)).toHaveText(
      String(secondPage[0].口座番号),
    )

    await expect(
      page
        .getByTestId('balance-adjustments-pagination')
        .getByRole('button', { name: '2', exact: true }),
    ).toHaveAttribute('aria-current', 'page')
  })

  test('[BA-10] 最終更新が「—」の行と日時＋更新者の行が両方あり、後者に色が付く', async ({
    page,
  }) => {
    await page.goto(PATH)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)

    const untouched = rows.nth(untouchedIndex)
    const modified = rows.nth(modifiedIndex)

    // 取込のままの行は最終更新を持たない
    await expect(cellOf(untouched, COL.updated)).toHaveText('—')

    // 手で補正された行は 日時（MM/DD hh:mm）と更新者 の 2 段。
    // 更新者はコードマスタの表示名（「001 田中」の形）か、引けなければコードのまま出るので、コードで見る
    const updatedCell = cellOf(modified, COL.updated)
    await expect(updatedCell).toContainText(toMonthDayTime(modifiedRow.更新日時))
    await expect(updatedCell).toContainText(modifiedRow.更新者)

    // 手動補正の色。クラス名ではなく、利用者に見える背景色が取込のままの行と違うことで見る
    const backgroundOf = (locator) =>
      locator.evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(await backgroundOf(modified)).not.toBe(await backgroundOf(untouched))
  })
})

/*
 * 数量を加算（BA-11〜18）。入力 → 確認 → 確定 の 2 段階で、サーバへ行くのは確定の 1 回だけ。
 * 既定ハンドラ（PUT /masters/balance-adjustments/:id）は更新した行を保持するので、
 * 確定後に一覧の現在数量が変わるところまで見る。モックの可変状態はページを開き直すと
 * 初期化されるため（src/mocks/handlers/balanceAdjustments.js はモジュール変数で持つ）、テスト間で持ち越さない。
 *
 * エラーの出し先は 2 系統に分かれる。
 *   入力の不備      … 加算数量の直下（FormField の error。入力欄の aria-describedby で結ばれる）（BA-13 / 14）
 *   通信・サーバ障害 … balance-adjustments-increase-error（409 の競合もここ）（BA-18）
 */

// 加算する数量と、その結果の補正後数量。対象は一覧の 1 行目（口座番号 → 銘柄コードの先頭）
const ADD_QUANTITY = 50
const AFTER_QUANTITY = firstRow.残高 + ADD_QUANTITY
// 補正後が負になる加算数量（1 行目の保有より 100 株多く減らす）
const NEGATIVE_QUANTITY = -(firstRow.残高 + 100)

const CONFLICT_MESSAGE =
  '他のユーザーによって残高データが更新されています。最新データを再取得してください。'

// コードと名称のあいだの全角空白（src/utils/format.js の joinWide と同じ区切り）
const WIDE_SPACE = String.fromCharCode(0x3000)

/** 数量の表示（src/utils/format.js の formatQuantity + 単位） */
const shares = (value) => `${value.toLocaleString('ja-JP')}株`

/** 加算モーダル。見出しは入力ステップと確認ステップで変わる */
function increaseDialogOf(page, name = '既存保有への数量加算') {
  return page.getByRole('dialog', { name })
}

/** 確認ステップの定義リストで、見出し label に対応する値 */
function summaryValueOf(confirm, label) {
  return confirm
    .locator('dt', { hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]')
}

/** 一覧を開き、1 行目の「数量を加算」を押してモーダルを出す */
async function openIncreaseForFirstRow(page) {
  await page.goto(PATH)
  await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
  await page.getByTestId(`balance-adjustments-increase-${firstRow.ID}`).click()
  await expect(increaseDialogOf(page)).toBeVisible()
}

/** 加算数量を入れて確認ステップへ進める */
async function goToIncreaseConfirm(page, quantity = ADD_QUANTITY) {
  await page.getByTestId('balance-adjustments-increase-quantity').fill(String(quantity))
  await page.getByTestId('balance-adjustments-increase-next').click()
  await expect(increaseDialogOf(page, '残高更新の確認')).toBeVisible()
}

test.describe('残高マスタ 数量を加算', () => {
  test('[BA-11] 「数量を加算」で対象が読み取り専用のモーダルが開く', async ({ page }) => {
    await openIncreaseForFirstRow(page)
    const dialog = increaseDialogOf(page)

    await expect(dialog.getByTestId('balance-adjustments-increase-customer')).toHaveText(
      `${firstRow.顧客名}（${firstRow.口座番号}）`,
    )
    await expect(dialog.getByTestId('balance-adjustments-increase-symbol')).toHaveText(
      `${firstRow.Ticker}${WIDE_SPACE}${firstRow.銘柄名}`,
    )
    await expect(dialog.getByTestId('balance-adjustments-increase-deposit')).toHaveText(
      firstRow.特定預り区分名,
    )
    // 読み取り専用の 3 項目は入力欄ではない
    await expect(dialog.getByRole('textbox')).toHaveCount(1)

    await expect(dialog.getByTestId('balance-adjustments-increase-quantity')).toHaveValue('')
    await expect(dialog.getByTestId('balance-adjustments-increase-before')).toHaveText(
      shares(firstRow.残高),
    )
    await expect(dialog.getByTestId('balance-adjustments-increase-added')).toHaveText('—')
    await expect(dialog.getByTestId('balance-adjustments-increase-after')).toHaveText(
      shares(firstRow.残高),
    )
  })

  test('[BA-12] 加算数量を入れると集計パネルが追従する', async ({ page }) => {
    await openIncreaseForFirstRow(page)
    const dialog = increaseDialogOf(page)

    await dialog.getByTestId('balance-adjustments-increase-quantity').fill(String(ADD_QUANTITY))

    await expect(dialog.getByTestId('balance-adjustments-increase-before')).toHaveText(
      shares(firstRow.残高),
    )
    await expect(dialog.getByTestId('balance-adjustments-increase-added')).toHaveText(
      `+${shares(ADD_QUANTITY)}`,
    )
    await expect(dialog.getByTestId('balance-adjustments-increase-after')).toHaveText(
      shares(AFTER_QUANTITY),
    )
  })

  test('[BA-13] 加算数量が空のままでは確認ステップに進まない', async ({ page }) => {
    await openIncreaseForFirstRow(page)
    const dialog = increaseDialogOf(page)

    await dialog.getByTestId('balance-adjustments-increase-next').click()

    const quantity = dialog.getByTestId('balance-adjustments-increase-quantity')
    await expect(quantity).toHaveAccessibleDescription(/加算数量を整数で入力してください/)
    await expect(dialog.getByTestId('balance-adjustments-increase-confirm')).toHaveCount(0)
    await expect(increaseDialogOf(page, '残高更新の確認')).toHaveCount(0)
  })

  test('[BA-14] 補正後が負になる加算数量では確認ステップに進まない', async ({ page }) => {
    await openIncreaseForFirstRow(page)
    const dialog = increaseDialogOf(page)

    const quantity = dialog.getByTestId('balance-adjustments-increase-quantity')
    await quantity.fill(String(NEGATIVE_QUANTITY))
    await dialog.getByTestId('balance-adjustments-increase-next').click()

    await expect(quantity).toHaveAccessibleDescription(/補正後数量が負になります/)
    await expect(dialog.getByTestId('balance-adjustments-increase-confirm')).toHaveCount(0)
    await expect(increaseDialogOf(page, '残高更新の確認')).toHaveCount(0)
  })

  test('[BA-15] 「内容を確認」で確認ステップに補正の内容が並ぶ', async ({ page }) => {
    await openIncreaseForFirstRow(page)
    await goToIncreaseConfirm(page)

    const dialog = increaseDialogOf(page, '残高更新の確認')
    await expect(dialog.getByTestId('balance-adjustments-increase-confirm-notice')).toBeVisible()

    const confirm = dialog.getByTestId('balance-adjustments-increase-confirm')
    await expect(confirm.locator('dt')).toHaveText([
      '操作種別',
      '対象顧客',
      '対象銘柄',
      '口座区分',
      '補正前数量',
      '加算数量',
      '補正後数量',
      '更新者',
    ])
    await expect(summaryValueOf(confirm, '操作種別')).toHaveText('既存保有への数量加算')
    await expect(summaryValueOf(confirm, '対象顧客')).toHaveText(
      `${firstRow.部店コード} / ${firstRow.口座番号}${WIDE_SPACE}${firstRow.顧客名}`,
    )
    await expect(summaryValueOf(confirm, '対象銘柄')).toHaveText(
      `${firstRow.Ticker}${WIDE_SPACE}${firstRow.銘柄名}`,
    )
    await expect(summaryValueOf(confirm, '口座区分')).toHaveText(firstRow.特定預り区分名)
    await expect(summaryValueOf(confirm, '補正前数量')).toHaveText(shares(firstRow.残高))
    await expect(summaryValueOf(confirm, '加算数量')).toHaveText(`+${shares(ADD_QUANTITY)}`)
    await expect(summaryValueOf(confirm, '補正後数量')).toHaveText(shares(AFTER_QUANTITY))
    // 更新者は .env の社員コード（VITE_OPERATOR_CODE）から引くので、空でないことだけを見る
    await expect(summaryValueOf(confirm, '更新者')).toHaveText(/\S/)

    await expect(dialog.getByTestId('balance-adjustments-increase-back')).toHaveText('戻る')
    await expect(dialog.getByTestId('balance-adjustments-increase-submit')).toHaveText(
      '補正を確定',
    )
  })

  test('[BA-16] 確認ステップの「戻る」で入力値を保ったまま入力ステップに戻る', async ({
    page,
  }) => {
    await openIncreaseForFirstRow(page)
    await goToIncreaseConfirm(page)

    await page.getByTestId('balance-adjustments-increase-back').click()

    const dialog = increaseDialogOf(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('balance-adjustments-increase-quantity')).toHaveValue(
      String(ADD_QUANTITY),
    )
    await expect(dialog.getByTestId('balance-adjustments-increase-after')).toHaveText(
      shares(AFTER_QUANTITY),
    )
  })

  test('[BA-17] 「補正を確定」で一覧の現在数量と最終更新が変わる', async ({ page }) => {
    await openIncreaseForFirstRow(page)
    // 対象は取込のままの行（最終更新が「—」）から始める
    await expect(cellOf(rowsOf(page).first(), COL.updated)).toHaveText('—')
    await goToIncreaseConfirm(page)

    await page.getByTestId('balance-adjustments-increase-submit').click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('balance-adjustments-notice')).toContainText(
      `${firstRow.Ticker} の残高を ${shares(AFTER_QUANTITY)} に更新しました。`,
    )

    const first = rowsOf(page).first()
    await expect(cellOf(first, COL.accountNumber)).toHaveText(String(firstRow.口座番号))
    await expect(cellOf(first, COL.ticker)).toHaveText(firstRow.Ticker)
    await expect(cellOf(first, COL.balance)).toHaveText(shares(AFTER_QUANTITY))
    // 日時（MM/DD hh:mm）の後ろに更新者が続く 2 段
    await expect(cellOf(first, COL.updated)).toHaveText(/^\d{2}\/\d{2} \d{2}:\d{2}\s*\S+/)
  })

  test('[BA-18] 更新が 409 のときモーダルは開いたままで理由が出る', async ({ page }) => {
    await mockApi(page, [
      {
        method: 'put',
        path: '*/api/masters/balance-adjustments/:id',
        status: 409,
        body: { detail: CONFLICT_MESSAGE },
      },
    ])
    await openIncreaseForFirstRow(page)
    await goToIncreaseConfirm(page)

    await page.getByTestId('balance-adjustments-increase-submit').click()

    const dialog = increaseDialogOf(page, '残高更新の確認')
    await expect(dialog.getByTestId('balance-adjustments-increase-error')).toContainText(
      CONFLICT_MESSAGE,
    )
    await expect(dialog.getByTestId('balance-adjustments-increase-confirm')).toBeVisible()
    await expect(page.getByTestId('balance-adjustments-notice')).toHaveCount(0)

    const first = rowsOf(page).first()
    await expect(cellOf(first, COL.balance)).toHaveText(shares(firstRow.残高))
    await expect(cellOf(first, COL.updated)).toHaveText('—')
  })
})

/*
 * 新規保有を追加（BA-19〜27）。加算と同じ 入力 → 確認 → 確定 の 2 段階で、
 * サーバへ行くのは確定の 1 回だけ。既定ハンドラ（POST /masters/balance-adjustments）は
 * 登録した行を保持するので、確定後に件数が増えるところまで見る（ページを開き直すと初期化される）。
 * 同じ 口座番号 × 銘柄コード × 特定預り区分 の有効な行があれば、ハンドラが重複として 400 で弾く。
 *
 * エラーの出し先は加算と同じく 2 系統。
 *   入力の不備      … 各項目の直下（FormField の error。入力欄の aria-describedby で結ばれる）（BA-20 / 22）
 *   通信・サーバ障害 … balance-adjustments-add-error（重複もここ）（BA-26）
 */

/*
 * 対象顧客の選択肢。ストア（src/stores/customerOptions.js）が /masters/customers から読み、
 * 既定ハンドラが返す順（有効な行を口座番号の昇順）に並ぶ。ラベルは `部店 / 口座番号` と顧客名を全角空白でつないだ形。
 */
const customerOptionRows = customers
  .filter((customer) => customer.取消区分 === 0)
  .sort((a, b) => a.口座番号 - b.口座番号)
const customerLabelOf = (customer) =>
  `${customer.部店コード} / ${customer.口座番号}${WIDE_SPACE}${customer.顧客名}`
const customerValueOf = (customer) => `${customer.部店コード}-${customer.口座番号}`
const firstCustomer = customerOptionRows[0]

// 追加する新しい保有（既定モックに無い銘柄なので重複にならない）
const NEW_TICKER = 'NEWCO'
const NEW_SYMBOL_NAME = 'NewCo Inc.'
const NEW_QUANTITY = 100

// 重複の組は一覧の 1 行目と同じ 口座 × 銘柄コード × 口座区分
const firstRowCustomer = customerOptionRows.find(
  (customer) => customer.口座番号 === firstRow.口座番号,
)

// 画面の初期選択（'1' 特定）の表示名。名前はコードマスタ（GET /codes）の 特定預り区分
const DEFAULT_DEPOSIT_LABEL = '特定'

/** 新規追加モーダル。見出しは入力ステップと確認ステップで変わる */
function addDialogOf(page, name = '新規保有を追加') {
  return page.getByRole('dialog', { name })
}

/** 一覧を開き、ヘッダの「新規保有を追加」を押してモーダルを出す */
async function openAdd(page) {
  await page.goto(PATH)
  await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
  await page.getByTestId('balance-adjustments-add').click()
  await expect(addDialogOf(page)).toBeVisible()
}

/** 入力ステップの 4 項目（と口座区分）を埋める */
async function fillAdd(
  page,
  {
    customer = firstCustomer,
    ticker = NEW_TICKER,
    symbolName = NEW_SYMBOL_NAME,
    quantity = NEW_QUANTITY,
    deposit = null,
  } = {},
) {
  const dialog = addDialogOf(page)
  await dialog
    .getByTestId('balance-adjustments-add-customer')
    .selectOption({ label: customerLabelOf(customer) })
  await dialog.getByTestId('balance-adjustments-add-ticker').fill(ticker)
  await dialog.getByTestId('balance-adjustments-add-symbol-name').fill(symbolName)
  if (deposit !== null) {
    await dialog.getByTestId('balance-adjustments-add-deposit').selectOption(deposit)
  }
  await dialog.getByTestId('balance-adjustments-add-quantity').fill(String(quantity))
}

/** 「内容を確認」を押して確認ステップへ進める */
async function goToAddConfirm(page) {
  await addDialogOf(page).getByTestId('balance-adjustments-add-next').click()
  await expect(addDialogOf(page, '残高更新の確認')).toBeVisible()
}

test.describe('残高マスタ 新規保有を追加', () => {
  test('[BA-19] 「新規保有を追加」で空の入力モーダルが開く', async ({ page }) => {
    await openAdd(page)
    const dialog = addDialogOf(page)

    const customer = dialog.getByTestId('balance-adjustments-add-customer')
    await expect(customer).toHaveValue('')
    await expect(customer.locator('option:checked')).toHaveText('選択してください')
    await expect(dialog.getByTestId('balance-adjustments-add-ticker')).toHaveValue('')
    await expect(dialog.getByTestId('balance-adjustments-add-symbol-name')).toHaveValue('')
    await expect(dialog.getByTestId('balance-adjustments-add-quantity')).toHaveValue('')
    await expect(
      dialog.getByTestId('balance-adjustments-add-deposit').locator('option:checked'),
    ).toHaveText(DEFAULT_DEPOSIT_LABEL)

    await expect(dialog.getByTestId('balance-adjustments-add-before')).toHaveText(shares(0))
    await expect(dialog.getByTestId('balance-adjustments-add-added')).toHaveText('—')
    await expect(dialog.getByTestId('balance-adjustments-add-after')).toHaveText(shares(0))
  })

  test('[BA-20] 未入力のまま「内容を確認」を押すと 4 項目にエラーが出る', async ({ page }) => {
    await openAdd(page)
    const dialog = addDialogOf(page)

    await dialog.getByTestId('balance-adjustments-add-next').click()

    await expect(dialog.getByTestId('balance-adjustments-add-customer')).toHaveAccessibleDescription(
      /対象顧客を選択してください/,
    )
    await expect(dialog.getByTestId('balance-adjustments-add-ticker')).toHaveAccessibleDescription(
      /ティッカーを入力してください/,
    )
    await expect(
      dialog.getByTestId('balance-adjustments-add-symbol-name'),
    ).toHaveAccessibleDescription(/銘柄名を入力してください/)
    await expect(dialog.getByTestId('balance-adjustments-add-quantity')).toHaveAccessibleDescription(
      /加算数量を整数で入力してください/,
    )
    await expect(dialog.getByTestId('balance-adjustments-add-confirm')).toHaveCount(0)
    await expect(addDialogOf(page, '残高更新の確認')).toHaveCount(0)
  })

  test('[BA-21] 対象顧客の選択肢が「部店 / 口座番号 顧客名」の形で並ぶ', async ({ page }) => {
    await openAdd(page)

    // 先頭は「選択してください」、続いて顧客が口座番号の昇順に並ぶ
    const options = addDialogOf(page)
      .getByTestId('balance-adjustments-add-customer')
      .locator('option')
    await expect(options).toHaveText([
      '選択してください',
      ...customerOptionRows.map(customerLabelOf),
    ])
  })

  test('[BA-22] 加算数量が 0 では確認ステップに進まない', async ({ page }) => {
    await openAdd(page)
    await fillAdd(page, { quantity: 0 })
    const dialog = addDialogOf(page)

    await dialog.getByTestId('balance-adjustments-add-next').click()

    await expect(dialog.getByTestId('balance-adjustments-add-quantity')).toHaveAccessibleDescription(
      /1 以上で入力してください/,
    )
    await expect(addDialogOf(page, '残高更新の確認')).toHaveCount(0)
  })

  test('[BA-23] 4 項目を埋めて「内容を確認」で確認ステップに新規追加の内容が並ぶ', async ({
    page,
  }) => {
    await openAdd(page)
    await fillAdd(page)
    await goToAddConfirm(page)

    const dialog = addDialogOf(page, '残高更新の確認')
    const confirm = dialog.getByTestId('balance-adjustments-add-confirm')
    await expect(summaryValueOf(confirm, '操作種別')).toHaveText('新規銘柄を追加')
    await expect(summaryValueOf(confirm, '対象顧客')).toHaveText(customerLabelOf(firstCustomer))
    await expect(summaryValueOf(confirm, '対象銘柄')).toHaveText(
      `${NEW_TICKER}${WIDE_SPACE}${NEW_SYMBOL_NAME}`,
    )
    await expect(summaryValueOf(confirm, '口座区分')).toHaveText(DEFAULT_DEPOSIT_LABEL)
    await expect(summaryValueOf(confirm, '補正前数量')).toHaveText(shares(0))
    await expect(summaryValueOf(confirm, '加算数量')).toHaveText(`+${shares(NEW_QUANTITY)}`)
    await expect(summaryValueOf(confirm, '補正後数量')).toHaveText(shares(NEW_QUANTITY))

    await expect(dialog.getByTestId('balance-adjustments-add-submit')).toHaveText('補正を確定')
  })

  test('[BA-24] 確認ステップの「戻る」で入力した 4 項目を保ったまま戻る', async ({ page }) => {
    await openAdd(page)
    await fillAdd(page)
    await goToAddConfirm(page)

    await page.getByTestId('balance-adjustments-add-back').click()

    const dialog = addDialogOf(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('balance-adjustments-add-customer')).toHaveValue(
      customerValueOf(firstCustomer),
    )
    await expect(dialog.getByTestId('balance-adjustments-add-ticker')).toHaveValue(NEW_TICKER)
    await expect(dialog.getByTestId('balance-adjustments-add-symbol-name')).toHaveValue(
      NEW_SYMBOL_NAME,
    )
    await expect(dialog.getByTestId('balance-adjustments-add-quantity')).toHaveValue(
      String(NEW_QUANTITY),
    )
  })

  test('[BA-25] 「補正を確定」でモーダルが閉じ、件数が 1 件増える', async ({ page }) => {
    await openAdd(page)
    await fillAdd(page)
    await goToAddConfirm(page)

    await page.getByTestId('balance-adjustments-add-submit').click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('balance-adjustments-notice')).toContainText(
      `${NEW_TICKER} の保有を追加しました。`,
    )
    await expect(page.getByTestId('balance-adjustments-count')).toHaveText(
      `${balanceAdjustments.length + 1} 件`,
    )
  })

  test('[BA-26] 既にある組で確定するとモーダルは開いたままで重複の理由が出る', async ({
    page,
  }) => {
    await openAdd(page)
    await fillAdd(page, {
      customer: firstRowCustomer,
      ticker: firstRow.銘柄コード,
      deposit: firstRow.特定預り区分,
    })
    await goToAddConfirm(page)

    await page.getByTestId('balance-adjustments-add-submit').click()

    const dialog = addDialogOf(page, '残高更新の確認')
    // 既定ハンドラ（src/mocks/handlers/balanceAdjustments.js）の重複の理由
    await expect(dialog.getByTestId('balance-adjustments-add-error')).toContainText(
      '同じ口座・銘柄・口座区分の残高が既に登録されています',
    )
    await expect(dialog.getByTestId('balance-adjustments-add-confirm')).toBeVisible()
    await expect(page.getByTestId('balance-adjustments-notice')).toHaveCount(0)
    await expect(page.getByTestId('balance-adjustments-count')).toHaveText(
      `${balanceAdjustments.length} 件`,
    )
  })

  test('[BA-27] 入力ステップの「戻る」でモーダルが閉じ、件数は変わらない', async ({ page }) => {
    await openAdd(page)

    await addDialogOf(page).getByTestId('balance-adjustments-add-back').click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('balance-adjustments-count')).toHaveText(
      `${balanceAdjustments.length} 件`,
    )
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
  })
})

/*
 * 売却不可区分の切替（BA-28〜33）。入力が無いので 2 段階ではなく、問いを出す確認ダイアログ 1 枚。
 * 既定ハンドラ（PUT /masters/balance-adjustments/:id/sell-prohibited）は 売却不可区分 だけを書き換え、
 * 更新した行を保持するので、確定後に行のバッジとボタンが変わるところまで見る
 * （ページを開き直すと初期化される）。通信・サーバ障害は balance-adjustments-sell-error に出る。
 */

// 売却不可区分の列（src/views/BalanceAdjustmentListView.vue の columns）
const SELL_COLUMN = 8

// 1 ページ目にある「売却可」の行と「売却不可」の行。どちらもフィクスチャの 売却不可区分 から探す
const sellOkIndex = firstPage.findIndex((row) => row.売却不可区分 === 0)
const sellOkRow = firstPage[sellOkIndex]
const sellNgIndex = firstPage.findIndex((row) => row.売却不可区分 === 1)

const STOP_MESSAGE = '売却を停止します。よろしいですか？'
const RESUME_MESSAGE = '売却停止を解除します。よろしいですか？'

/** 確認ダイアログの問いの下に添える対象の 1 行。ティッカーと銘柄名を WIDE_SPACE でつなぎ、括弧内に口座番号と顧客名 */
const sellTargetLabelOf = (row) =>
  `${row.Ticker}${WIDE_SPACE}${row.銘柄名}（${row.口座番号} ${row.顧客名}）`

/** 売却可否の確認ダイアログ */
function sellDialogOf(page) {
  return page.getByRole('dialog', { name: '売却可否の変更' })
}

/** 一覧を開き、売却可の行の「売却を停止」を押して確認を出す */
async function openSellForOkRow(page) {
  await page.goto(PATH)
  await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
  await page.getByTestId(`balance-adjustments-sell-${sellOkRow.ID}`).click()
  await expect(sellDialogOf(page)).toBeVisible()
}

test.describe('残高マスタ 売却不可区分の切替', () => {
  test('[BA-28] 売却不可区分の列に「売却可」の行と「売却不可」のバッジの行が両方ある', async ({
    page,
  }) => {
    await page.goto(PATH)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)

    const okCell = cellOf(rows.nth(sellOkIndex), SELL_COLUMN)
    const ngCell = cellOf(rows.nth(sellNgIndex), SELL_COLUMN)
    await expect(okCell).toHaveText('売却可')
    await expect(ngCell).toHaveText('売却不可')

    // 体裁の違い（灰色の文字 / 赤いバッジ）は、クラス名ではなく利用者に見える文字色で見る
    const colorOf = (cell) =>
      cell.locator(':scope > *').first().evaluate((element) => getComputedStyle(element).color)
    expect(await colorOf(okCell)).not.toBe(await colorOf(ngCell))
  })

  test('[BA-29] 「売却を停止」で対象の銘柄と口座を添えた確認が開く', async ({ page }) => {
    await openSellForOkRow(page)
    const dialog = sellDialogOf(page)

    await expect(dialog.getByTestId('balance-adjustments-sell-message')).toHaveText(STOP_MESSAGE)
    await expect(dialog).toContainText(sellTargetLabelOf(sellOkRow))
    await expect(dialog.getByTestId('balance-adjustments-sell-cancel')).toHaveText('キャンセル')
    await expect(dialog.getByTestId('balance-adjustments-sell-submit')).toHaveText('OK')
  })

  test('[BA-30] 「OK」で確認が閉じ、行が「売却不可」とボタン「売却停止を解除」に変わる', async ({
    page,
  }) => {
    await openSellForOkRow(page)

    await sellDialogOf(page).getByTestId('balance-adjustments-sell-submit').click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('balance-adjustments-notice')).toContainText(
      `${sellOkRow.Ticker} の売却を停止しました。`,
    )
    const row = rowsOf(page).nth(sellOkIndex)
    await expect(cellOf(row, COL.ticker)).toHaveText(sellOkRow.Ticker)
    await expect(cellOf(row, SELL_COLUMN)).toHaveText('売却不可')
    await expect(page.getByTestId(`balance-adjustments-sell-${sellOkRow.ID}`)).toHaveText(
      '売却停止を解除',
    )
  })

  test('[BA-31] 「キャンセル」で確認が閉じ、行の表示は変わらない', async ({ page }) => {
    await openSellForOkRow(page)

    await sellDialogOf(page).getByTestId('balance-adjustments-sell-cancel').click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('balance-adjustments-notice')).toHaveCount(0)
    await expect(cellOf(rowsOf(page).nth(sellOkIndex), SELL_COLUMN)).toHaveText('売却可')
    await expect(page.getByTestId(`balance-adjustments-sell-${sellOkRow.ID}`)).toHaveText(
      '売却を停止',
    )
  })

  test('[BA-32] 停止した行の「売却停止を解除」→「OK」で「売却可」に戻る', async ({ page }) => {
    await openSellForOkRow(page)
    await sellDialogOf(page).getByTestId('balance-adjustments-sell-submit').click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    const button = page.getByTestId(`balance-adjustments-sell-${sellOkRow.ID}`)
    await expect(button).toHaveText('売却停止を解除')
    await button.click()

    const dialog = sellDialogOf(page)
    await expect(dialog.getByTestId('balance-adjustments-sell-message')).toHaveText(RESUME_MESSAGE)
    await dialog.getByTestId('balance-adjustments-sell-submit').click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('balance-adjustments-notice')).toContainText(
      `${sellOkRow.Ticker} の売却停止を解除しました。`,
    )
    await expect(cellOf(rowsOf(page).nth(sellOkIndex), SELL_COLUMN)).toHaveText('売却可')
    await expect(button).toHaveText('売却を停止')
  })

  test('[BA-33] 更新が 409 のとき確認は開いたままで理由が出て、行は変わらない', async ({
    page,
  }) => {
    await mockApi(page, [
      {
        method: 'put',
        path: '*/api/masters/balance-adjustments/:id/sell-prohibited',
        status: 409,
        body: { detail: CONFLICT_MESSAGE },
      },
    ])
    await openSellForOkRow(page)

    const dialog = sellDialogOf(page)
    await dialog.getByTestId('balance-adjustments-sell-submit').click()

    await expect(dialog.getByTestId('balance-adjustments-sell-error')).toContainText(
      CONFLICT_MESSAGE,
    )
    await expect(dialog.getByTestId('balance-adjustments-sell-message')).toHaveText(STOP_MESSAGE)
    await expect(page.getByTestId('balance-adjustments-notice')).toHaveCount(0)
    await expect(cellOf(rowsOf(page).nth(sellOkIndex), SELL_COLUMN)).toHaveText('売却可')
  })
})
