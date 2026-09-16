import { expect, test } from '@playwright/test'
import { caStocks, corporateActions } from '../src/mocks/fixtures/ca'
import { statusCodes } from '../src/mocks/fixtures/codes'
import { CA_TYPE_OPTIONS } from '../src/utils/caTypes'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/ca.md（タイトル先頭の [CA-xx] が対応 ID）
// ページ位置と検索条件は URL クエリを正とするため、URL と画面の同期をここで守る。
// mockApi() は固定の body を返すだけで offset / stock_code / ca_type / status を解釈しない。
// ページングと絞り込み（CA-02 / 03 / 04 / 05 / 28 / 29）は
// クエリを実際に処理する既定ハンドラで検証する。

const PATH = '/masters/ca'

// src/stores/ca.js の CA_PAGE_SIZE と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

/*
 * フィクスチャはバックエンドの生の形（日本語キー / 日付は YYYYMMDD の integer）なので、
 * 期待値は api 層と同じ変換でアプリ内モデルの形に直してから使う。
 */
const toIsoDate = (value) => {
  const digits = String(value ?? '')
  if (!/^\d{8}$/.test(digits)) return ''
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}
const toRow = (ca) => ({
  stockCode: ca.銘柄コード,
  ticker: ca.Ticker ?? '',
  caTypeName: ca.CA種別名 ?? '',
  effectiveDate: toIsoDate(ca.効力発生日),
  ratio: ca.比率 ?? '',
  note: ca.備考 ?? '',
  userModified: ca.ユーザー操作フラグ === 1,
})

/** 実 API と同じ並び（効力発生日の降順、同じなら ID の降順） */
const sortKey = (ca) => ca.効力発生日 ?? ca.権利付最終日 ?? 99999999
const sorted = [...corporateActions].sort((a, b) => sortKey(b) - sortKey(a) || b.ID - a.ID)
const allRows = sorted.map(toRow)
const TOTAL = allRows.length
const secondPage = allRows.slice(PAGE_SIZE)
const firstRow = allRows[0]
// 2 ページ目に残る行（CA-27 で 1 件ずつ消す）。削除ボタンの testid に使う ID ごと必要なので生の形
const secondPageCas = sorted.slice(PAGE_SIZE)

// 絞り込みに使う値もフィクスチャから導く（'AAPL' や '110' を直接書かない）
const TICKER = firstRow.ticker
const byTicker = allRows.filter((row) => row.ticker === TICKER)
const CA_TYPE = sorted[0].CA種別
const CA_TYPE_NAME = firstRow.caTypeName
const byCaType = allRows.filter((row) => row.caTypeName === CA_TYPE_NAME)

/*
 * ステータス（実 API 未実装の仮項目）。選択肢はコードマスタ（GET /codes の ステータス）から来るので、
 * 期待するコード値も表示名も statusCodes から引く（'2' や '確定' を直接書かない）。
 */
const statusOf = (label) => statusCodes.find((code) => code.label === label)
const FILTER_STATUS = statusOf('確定')
const byStatus = sorted.filter((ca) => ca.ステータス === FILTER_STATUS.code)

// フィクスチャのどの銘柄コード・Ticker にも当たらない文字列
const NO_MATCH = 'ZZZZ'

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/*
 * 新規追加に使う値。銘柄コードは銘柄マスタ（caStocks）に実在するものでないと
 * サーバの事前検証で弾かれるので、フィクスチャの先頭から採る。
 */
const NEW_STOCK = caStocks[0]
const NEW_CA_TYPE = CA_TYPE_OPTIONS.find((option) => option.label === '株式分割')
// 比率は 分母:分子 をサーバが組んだ表示項目（src/mocks/fixtures/ca.js の formatRatio）
const NEW_DENOMINATOR = '1'
const NEW_NUMERATOR = '2'
const NEW_RATIO = `${NEW_DENOMINATOR}:${NEW_NUMERATOR}`
// 追加フォームの初期値（'1' 予定）とは違う値を選んで、選んだものが反映されたと言えるようにする
const NEW_STATUS = statusOf('完了')

// 銘柄マスタ（caStocks）のどのコードにも当たらない文字列
const UNKNOWN_STOCK_CODE = 'ZZZZZ'

/*
 * 編集に使う行は一覧の 1 行目（並びは上の sorted と同じ規則）。
 * 行の「編集」ボタンの data-testid は ca-edit-<CA の ID> なので、ID もフィクスチャから採る。
 * 入力欄が持つのは表示項目（比率）ではなく元の 分母 / 分子 で、日付は api 層が
 * YYYYMMDD の integer から 'YYYY-MM-DD' に直した値。
 */
const firstCa = sorted[0]
const EDIT_TARGET = {
  id: firstCa.ID,
  stockCode: firstCa.銘柄コード,
  caType: firstCa.CA種別,
  caTypeName: firstCa.CA種別名 ?? '',
  exRightsDate: toIsoDate(firstCa.権利付最終日),
  effectiveDate: toIsoDate(firstCa.効力発生日),
  paymentDate: toIsoDate(firstCa.支払日),
  denominator: String(firstCa.分母 ?? ''),
  numerator: String(firstCa.分子 ?? ''),
  note: firstCa.備考 ?? '',
  status: firstCa.ステータス ?? '',
}
const EDITED_NOTE = `${EDIT_TARGET.note}（訂正）`
// 切り替え先は 1 行目の現在のステータス以外なら何でもよい（変化したことが見たい）
const EDITED_STATUS = statusCodes.find((code) => code.code !== EDIT_TARGET.status)

/*
 * 削除の対象も一覧の 1 行目（EDIT_TARGET と同じ行）。確認ダイアログに出る対象ラベルは
 * 成功メッセージと同じ 銘柄コード / CA種別名 / 効力発生日 の 1 行（この行は効力発生日を持つ）。
 */
const DELETE_LABEL = [EDIT_TARGET.stockCode, EDIT_TARGET.caTypeName, EDIT_TARGET.effectiveDate].join(
  ' / ',
)

// 楽観的ロックの競合（PUT が 409）。実 API と同じ文言を body に載せる
const CONFLICT_MESSAGE =
  '他のユーザーによってCAデータが更新されています。最新データを再取得してください。'

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('ca-table').getByTestId('data-table-row')
}

/**
 * 行のステータス列。ステータスは操作列の左（最後から 2 番目のセル）に置く。
 * 列そのものの位置は CA-09 が守るので、ここはその約束に乗って位置で採る。
 */
function statusCellOf(rows) {
  return rows.locator('td:nth-last-child(2)')
}

/** 追加モーダル。role=dialog の aria-label はモーダルのタイトル（BaseModal） */
function addDialogOf(page) {
  return page.getByRole('dialog', { name: 'CA 新規追加' })
}

/** 編集モーダル。追加と同じくタイトルが aria-label になる */
function editDialogOf(page) {
  return page.getByRole('dialog', { name: 'CA 編集' })
}

/** 削除確認ダイアログ。追加・編集のモーダルと取り違えないよう aria-label（タイトル）で絞る */
function deleteDialogOf(page) {
  return page.getByRole('dialog', { name: '削除確認' })
}

/** 行の削除ボタン。testid は行の CA の ID を含む */
function deleteButtonOf(page, id) {
  return page.getByTestId(`ca-delete-${id}`)
}

/** 一覧の 1 行目（EDIT_TARGET の行）の「削除」を押す */
async function openDeleteOfFirstRow(page) {
  await deleteButtonOf(page, EDIT_TARGET.id).click()
  await expect(deleteDialogOf(page)).toBeVisible()
}

/** 一覧の 1 行目（EDIT_TARGET の行）の「編集」を押す */
async function openEditOfFirstRow(page) {
  await page.getByTestId(`ca-edit-${EDIT_TARGET.id}`).click()
  await expect(editDialogOf(page)).toBeVisible()
}

/** 必須の 2 項目だけ埋める（日付と比率は任意） */
async function fillRequiredAddFields(page) {
  await page.getByTestId('ca-add-stock-code').fill(NEW_STOCK.stockCode)
  await page.getByTestId('ca-add-type').selectOption(NEW_CA_TYPE.value)
}

/** 行の背景色。CSS クラス名ではなく「見えかた」で確かめる（CA-08） */
function backgroundColorOf(row) {
  return row.evaluate((el) => getComputedStyle(el).backgroundColor)
}

test.describe('CAマスタ一覧', () => {
  test('[CA-01] サイドメニューから開くと一覧と件数が表示される', async ({ page }) => {
    await page.goto('/')

    await page
      .getByRole('navigation', { name: 'メインメニュー' })
      .getByRole('link', { name: 'CAマスタ', exact: true })
      .click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByRole('heading', { name: 'CAマスタ', exact: true })).toBeVisible()
    // 画面固有の操作がヘッダ（#topbar-actions）へ差し込まれている
    await expect(page.getByTestId('ca-reload')).toBeVisible()

    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL} 件`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)
    await expect(rows.first()).toContainText(firstRow.stockCode)
    await expect(rows.first()).toContainText(firstRow.ticker)
    await expect(rows.first()).toContainText(firstRow.caTypeName)
    await expect(rows.first()).toContainText(firstRow.ratio)
  })

  test('[CA-02] 「次のページ」を押すと 2 ページ目が表示される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    const pagination = page.getByTestId('ca-pagination')
    await pagination.getByRole('button', { name: '次のページ' }).click()

    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(secondPage.length)
    await expect(rows.first()).toContainText(secondPage[0].stockCode)

    await expect(pagination.getByTestId('pagination-range')).toHaveText(
      `${TOTAL} 件中 ${PAGE_SIZE + 1}–${TOTAL} 件`,
    )
  })

  test('[CA-03] 銘柄コードで絞り込むと URL と一覧に反映される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('ca-stock-code').fill(TICKER)
    await page.getByTestId('ca-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`stock_code=${TICKER}`))
    await expect(page.getByTestId('ca-count')).toHaveText(`${byTicker.length} 件`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(byTicker.length)
    // 絞り込んだ銘柄以外が混ざっていない
    await expect(rows.filter({ hasText: TICKER })).toHaveCount(byTicker.length)
  })

  test('[CA-04] CA種別で絞り込むと URL と一覧に反映される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('ca-type').selectOption(CA_TYPE)
    await page.getByTestId('ca-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`ca_type=${CA_TYPE}`))
    await expect(page.getByTestId('ca-count')).toHaveText(`${byCaType.length} 件`)

    const rows = rowsOf(page)
    await expect(rows.filter({ hasText: CA_TYPE_NAME })).toHaveCount(
      Math.min(byCaType.length, PAGE_SIZE),
    )
  })

  test('[CA-05] 「クリア」を押すと絞り込みが解除される', async ({ page }) => {
    await page.goto(PATH)

    await page.getByTestId('ca-stock-code').fill(TICKER)
    await page.getByTestId('ca-search-submit').click()
    await expect(rowsOf(page)).toHaveCount(byTicker.length)

    await page.getByTestId('ca-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('ca-stock-code')).toHaveValue('')
  })

  test('[CA-06] 該当が無いときは空状態が表示される', async ({ page }) => {
    await page.goto(PATH)

    await page.getByTestId('ca-stock-code').fill(NO_MATCH)
    await page.getByTestId('ca-search-submit').click()

    await expect(page.getByTestId('ca-empty')).toHaveText('該当するCAはありません。')
    await expect(page.getByTestId('ca-table')).toBeHidden()
    // 0 件のときこそ条件を直したいので、検索カードは消えない
    await expect(page.getByTestId('ca-search')).toBeVisible()
  })

  test('[CA-07] API がエラーを返したときエラー表示と再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [{ path: '*/api/masters/ca', status: 500, body: { detail: ERROR_MESSAGE } }])
    await page.goto(PATH)

    const error = page.getByTestId('ca-error')
    await expect(error).toContainText(ERROR_MESSAGE)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('ca-table')).toBeHidden()
    // エラーのときも説明バナーと検索カードは消えない
    await expect(page.getByTestId('ca-description')).toBeVisible()
    await expect(page.getByTestId('ca-search')).toBeVisible()
  })

  test('[CA-08] 手動操作された行だけ背景色が変わる', async ({ page }) => {
    await page.goto(PATH)
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)

    const firstPage = allRows.slice(0, PAGE_SIZE)
    const markedIndex = firstPage.findIndex((row) => row.userModified)
    const plainIndex = firstPage.findIndex((row) => !row.userModified)
    // フィクスチャが両方の行を持っていないと、このシナリオは意味を失う
    expect(markedIndex).toBeGreaterThanOrEqual(0)
    expect(plainIndex).toBeGreaterThanOrEqual(0)

    const markedColor = await backgroundColorOf(rows.nth(markedIndex))
    const plainColor = await backgroundColorOf(rows.nth(plainIndex))
    expect(markedColor).not.toBe(plainColor)
  })

  test('[CA-09] 列順が仕様どおりで操作列の左にステータスがあり行に編集と削除がある', async ({
    page,
  }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    // 右端は行ごとの操作列。画面モックに合わせて見出しを持たない（その左がステータス）
    await expect(page.getByTestId('ca-table').locator('th')).toHaveText([
      '銘柄',
      'CA種別',
      '権利付最終日',
      '効力発生日',
      '支払日',
      '比率',
      '備考',
      'ステータス',
      '',
    ])

    // 追加はヘッダの「新規追加」から行う。行の操作は「編集」「削除」の 2 つがこの順に並ぶ
    await expect(page.getByTestId('ca-add')).toBeVisible()
    const rowButtons = rowsOf(page).first().getByRole('button')
    await expect(rowButtons).toHaveText(['編集', '削除'])
  })

  test('[CA-10] ブラウザバックで前のページに戻る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('ca-pagination').getByRole('button', { name: '次のページ' }).click()
    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))
    await expect(rowsOf(page)).toHaveCount(secondPage.length)

    await page.goBack()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(rowsOf(page).first()).toContainText(firstRow.stockCode)
  })

  test('[CA-28] ステータスで絞り込むと URL と一覧に反映される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('ca-status').selectOption(FILTER_STATUS.code)
    await page.getByTestId('ca-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`status=${FILTER_STATUS.code}`))
    await expect(page.getByTestId('ca-count')).toHaveText(`${byStatus.length} 件`)

    // 絞り込んだステータス以外が混ざっていない（該当は 1 ページに収まる件数）
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(byStatus.length)
    await expect(statusCellOf(rows)).toHaveText(Array(byStatus.length).fill(FILTER_STATUS.label))
  })

  test('[CA-29] 「クリア」を押すとステータスの絞り込みが解除される', async ({ page }) => {
    await page.goto(PATH)

    await page.getByTestId('ca-status').selectOption(FILTER_STATUS.code)
    await page.getByTestId('ca-search-submit').click()
    await expect(rowsOf(page)).toHaveCount(byStatus.length)

    await page.getByTestId('ca-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    // 選択も「-- すべて --」（空値）に戻る
    await expect(page.getByTestId('ca-status')).toHaveValue('')
  })
})

/*
 * 新規追加（CA-11〜16）。既定ハンドラは登録した行を保持するので、件数が増えるところまで見る。
 * モックの可変状態はページを開き直すと初期化されるため、テスト間で持ち越さない。
 *
 * 登録は「事前検証 → 登録」の 2 段で、エラーの出し先が 3 系統に分かれる。
 *   必須未入力       … FormField の error（CA-13）
 *   事前検証の不合格 … ca-add-validation-error の箇条書き（CA-14）
 *   通信・サーバ障害 … ca-add-error（CA-15）
 * 事前検証と登録は別パス（/masters/ca/validate と /masters/ca）なので、mockApi() で一方だけを差し替えられる。
 *
 * CA には一意性の規則が無いので、サーバが見るのは銘柄コードが銘柄マスタに実在するか（CA-14）。
 */
test.describe('CAマスタ 新規追加', () => {
  test('[CA-11] 必要な項目を入れて追加すると件数が 1 増える', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('ca-add').click()
    await fillRequiredAddFields(page)
    await page.getByTestId('ca-add-denominator').fill(NEW_DENOMINATOR)
    await page.getByTestId('ca-add-numerator').fill(NEW_NUMERATOR)
    await page.getByTestId('ca-add-submit').click()

    await expect(addDialogOf(page)).toBeHidden()

    /*
     * 追加した行が 1 ページ目に出るとは限らないので、何が増えたのかはメッセージで示す。
     * 効力発生日を入れていないので、ラベルは銘柄コードと CA種別名の 2 点だけになる。
     */
    const notice = page.getByTestId('ca-notice')
    await expect(notice).toBeVisible()
    await expect(notice).toHaveText(
      `${NEW_STOCK.stockCode} / ${NEW_CA_TYPE.label} を追加しました。`,
    )

    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL + 1} 件`)

    // 登録は一覧の単方向フローに触らない（URL は変わらない）
    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
  })

  test('[CA-12] 日付の無い行は一覧の先頭に手動操作の色で出る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('ca-add').click()
    await fillRequiredAddFields(page)
    await page.getByTestId('ca-add-denominator').fill(NEW_DENOMINATOR)
    await page.getByTestId('ca-add-numerator').fill(NEW_NUMERATOR)
    await page.getByTestId('ca-add-submit').click()
    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL + 1} 件`)

    /*
     * サーバの並びは COALESCE(効力発生日, 権利付最終日, 99999999) の降順なので、
     * 日付を持たない行は先頭に来る。
     */
    const rows = rowsOf(page)
    const created = rows.first()
    await expect(created).toContainText(NEW_STOCK.stockCode)
    // Ticker は送っていない。サーバが銘柄マスタから補完する
    await expect(created).toContainText(NEW_STOCK.ticker)
    await expect(created).toContainText(NEW_CA_TYPE.label)
    await expect(created).toContainText(NEW_RATIO)

    /*
     * 画面から登録した行はユーザー操作フラグ 1 になる（CA-08 と同じく色で確かめる）。
     * 1 行増えたぶん、既存の行の位置は 1 つずつ下にずれる。
     */
    const markedIndex = allRows.findIndex((row) => row.userModified) + 1
    const plainIndex = allRows.findIndex((row) => !row.userModified) + 1
    expect(markedIndex).toBeLessThan(PAGE_SIZE)
    expect(plainIndex).toBeLessThan(PAGE_SIZE)

    const createdColor = await backgroundColorOf(created)
    expect(createdColor).toBe(await backgroundColorOf(rows.nth(markedIndex)))
    expect(createdColor).not.toBe(await backgroundColorOf(rows.nth(plainIndex)))
  })

  test('[CA-13] 未入力のまま「追加」を押すと項目ごとにエラーが出る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('ca-add').click()
    const dialog = addDialogOf(page)
    await page.getByTestId('ca-add-submit').click()

    await expect(dialog.getByText('銘柄コードを入力してください。')).toBeVisible()
    await expect(dialog.getByText('CA種別を選択してください。')).toBeVisible()

    // 3 系統のうち項目直下だけに出る。サーバへは行かないので他の 2 つは出ない
    await expect(page.getByTestId('ca-add-validation-error')).toHaveCount(0)
    await expect(page.getByTestId('ca-add-error')).toHaveCount(0)

    // 入力を直せるようモーダルは閉じない。一覧にも影響しない
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL} 件`)
  })

  test('[CA-14] 銘柄マスタに無い銘柄コードは事前検証で弾かれる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('ca-add').click()
    await page.getByTestId('ca-add-stock-code').fill(UNKNOWN_STOCK_CODE)
    await page.getByTestId('ca-add-type').selectOption(NEW_CA_TYPE.value)
    await page.getByTestId('ca-add-submit').click()

    const validationError = page.getByTestId('ca-add-validation-error')
    await expect(validationError).toBeVisible()
    await expect(validationError.getByRole('listitem')).toHaveText([
      `銘柄コード(${UNKNOWN_STOCK_CODE})は銘柄マスタに存在しません`,
    ])

    // 事前検証の不合格は通信障害ではないので、専用の表示には出ない
    await expect(page.getByTestId('ca-add-error')).toHaveCount(0)

    await expect(addDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('ca-notice')).toHaveCount(0)
    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL} 件`)
  })

  test('[CA-15] 登録に失敗するとモーダルは開いたままエラーが出る', async ({ page }) => {
    // 事前検証（*/api/masters/ca/validate）はパスが別なので既定ハンドラのまま通る
    await mockApi(page, [
      { method: 'post', path: '*/api/masters/ca', status: 500, body: { detail: ERROR_MESSAGE } },
    ])
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('ca-add').click()
    await fillRequiredAddFields(page)
    await page.getByTestId('ca-add-submit').click()

    const error = page.getByTestId('ca-add-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText(ERROR_MESSAGE)

    // 事前検証は通っているので箇条書きは出ない
    await expect(page.getByTestId('ca-add-validation-error')).toHaveCount(0)

    await expect(addDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('ca-notice')).toHaveCount(0)
    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL} 件`)
  })

  test('[CA-16] 「キャンセル」を押すと何も増えずに閉じる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('ca-add').click()
    await fillRequiredAddFields(page)
    await page.getByTestId('ca-add-cancel').click()

    await expect(addDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('ca-notice')).toHaveCount(0)
    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(rowsOf(page).first()).toContainText(firstRow.stockCode)
  })

  test('[CA-30] 選んだステータスが追加した行に出る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('ca-add').click()
    await fillRequiredAddFields(page)
    await page.getByTestId('ca-add-status').selectOption(NEW_STATUS.code)
    await page.getByTestId('ca-add-submit').click()

    await expect(addDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL + 1} 件`)

    // 日付を入れていないので、この行はサーバの並びで先頭に来る（CA-12 と同じ）
    const created = rowsOf(page).first()
    await expect(created).toContainText(NEW_STOCK.stockCode)
    await expect(statusCellOf(created)).toHaveText(NEW_STATUS.label)
  })
})

/*
 * 編集（CA-17〜22）。既定ハンドラは更新した内容を保持するので、一覧の行が変わるところまで見る。
 * 更新は行を増やさないので、件数が変わらないことも一緒に確かめる（CA-18）。
 *
 * エラーの出し先は新規追加と同じ 3 系統（data-testid は ca-edit-… に振り替わる）。
 *   必須未入力       … FormField の error（CA-19）
 *   事前検証の不合格 … ca-edit-validation-error の箇条書き（CA-20）
 *   通信・サーバ障害 … ca-edit-error（CA-21。楽観的ロックの競合 409 も同じ枠）
 */
test.describe('CAマスタ 編集', () => {
  test('[CA-17] 行の「編集」を押すとその行の値が入った状態で開く', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openEditOfFirstRow(page)

    await expect(page.getByTestId('ca-edit-stock-code')).toHaveValue(EDIT_TARGET.stockCode)
    await expect(page.getByTestId('ca-edit-type')).toHaveValue(EDIT_TARGET.caType)
    await expect(page.getByTestId('ca-edit-ex-rights-date')).toHaveValue(EDIT_TARGET.exRightsDate)
    await expect(page.getByTestId('ca-edit-effective-date')).toHaveValue(EDIT_TARGET.effectiveDate)
    await expect(page.getByTestId('ca-edit-payment-date')).toHaveValue(EDIT_TARGET.paymentDate)
    // 入力欄が持つのは一覧に出る表示項目（比率）ではなく、元の 分母 / 分子
    await expect(page.getByTestId('ca-edit-denominator')).toHaveValue(EDIT_TARGET.denominator)
    await expect(page.getByTestId('ca-edit-numerator')).toHaveValue(EDIT_TARGET.numerator)
    await expect(page.getByTestId('ca-edit-note')).toHaveValue(EDIT_TARGET.note)
  })

  test('[CA-18] 備考を書き換えて更新すると一覧のその行が変わる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openEditOfFirstRow(page)
    await page.getByTestId('ca-edit-note').fill(EDITED_NOTE)
    await page.getByTestId('ca-edit-submit').click()

    await expect(editDialogOf(page)).toBeHidden()

    /*
     * 銘柄・CA種別・日付のどれも変えられるので、メッセージには受理された内容が出る
     * （効力発生日を持つ行なので日付まで並ぶ）。
     */
    const notice = page.getByTestId('ca-notice')
    await expect(notice).toBeVisible()
    await expect(notice).toHaveText(
      `${EDIT_TARGET.stockCode} / ${EDIT_TARGET.caTypeName} / ${EDIT_TARGET.effectiveDate} を更新しました。`,
    )

    // 効力発生日を変えていないので並びは動かない。その行の備考だけが新しくなる
    await expect(rowsOf(page).first()).toContainText(EDITED_NOTE)

    // 更新は行を増やさない
    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
  })

  test('[CA-19] 銘柄コードを空にして更新すると必須のエラーが出る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openEditOfFirstRow(page)
    await page.getByTestId('ca-edit-stock-code').fill('')
    await page.getByTestId('ca-edit-submit').click()

    const dialog = editDialogOf(page)
    await expect(dialog.getByText('銘柄コードを入力してください。')).toBeVisible()

    // 3 系統のうち項目直下だけに出る。サーバへは行かないので他の 2 つは出ない
    await expect(page.getByTestId('ca-edit-validation-error')).toHaveCount(0)
    await expect(page.getByTestId('ca-edit-error')).toHaveCount(0)

    // 入力を直せるようモーダルは閉じない。一覧にも影響しない
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page).first()).toContainText(EDIT_TARGET.note)
  })

  test('[CA-20] 銘柄マスタに無い銘柄コードは事前検証で弾かれる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openEditOfFirstRow(page)
    await page.getByTestId('ca-edit-stock-code').fill(UNKNOWN_STOCK_CODE)
    await page.getByTestId('ca-edit-submit').click()

    const validationError = page.getByTestId('ca-edit-validation-error')
    await expect(validationError).toBeVisible()
    await expect(validationError.getByRole('listitem')).toHaveText([
      `銘柄コード(${UNKNOWN_STOCK_CODE})は銘柄マスタに存在しません`,
    ])

    // 事前検証の不合格は通信障害ではないので、専用の表示には出ない
    await expect(page.getByTestId('ca-edit-error')).toHaveCount(0)

    await expect(editDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('ca-notice')).toHaveCount(0)
    await expect(rowsOf(page).first()).toContainText(EDIT_TARGET.stockCode)
  })

  test('[CA-21] 更新が競合するとモーダルは開いたままエラーが出る', async ({ page }) => {
    // 事前検証（*/api/masters/ca/validate）はパスが別なので既定ハンドラのまま通る
    await mockApi(page, [
      { method: 'put', path: '*/api/masters/ca/*', status: 409, body: { detail: CONFLICT_MESSAGE } },
    ])
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openEditOfFirstRow(page)
    await page.getByTestId('ca-edit-note').fill(EDITED_NOTE)
    await page.getByTestId('ca-edit-submit').click()

    // 409 は通信・サーバ障害と同じ枠に出す（画面は競合を特別扱いしない）
    const error = page.getByTestId('ca-edit-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText(CONFLICT_MESSAGE)

    // 事前検証は通っているので箇条書きは出ない
    await expect(page.getByTestId('ca-edit-validation-error')).toHaveCount(0)

    /*
     * モーダルは開いたまま入力を保つ。一覧を自動で読み直すこともしない
     * （読み直してもモーダルが握る合札は古いままで、再度 409 になるため）。
     */
    await expect(editDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('ca-edit-note')).toHaveValue(EDITED_NOTE)
    await expect(page.getByTestId('ca-notice')).toHaveCount(0)
    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page).first()).toContainText(EDIT_TARGET.note)
  })

  test('[CA-22] 「キャンセル」を押すと何も変わらずに閉じる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openEditOfFirstRow(page)
    await page.getByTestId('ca-edit-note').fill(EDITED_NOTE)
    await page.getByTestId('ca-edit-cancel').click()

    await expect(editDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('ca-notice')).toHaveCount(0)
    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(rowsOf(page).first()).toContainText(EDIT_TARGET.note)
  })

  test('[CA-31] ステータスを変えて更新すると一覧のその行が変わる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openEditOfFirstRow(page)
    // 開いた時点では一覧と同じ値が入っている
    await expect(page.getByTestId('ca-edit-status')).toHaveValue(EDIT_TARGET.status)

    await page.getByTestId('ca-edit-status').selectOption(EDITED_STATUS.code)
    await page.getByTestId('ca-edit-submit').click()

    await expect(editDialogOf(page)).toBeHidden()

    // 効力発生日を変えていないので並びは動かない。その行のステータスだけが新しくなる
    await expect(statusCellOf(rowsOf(page).first())).toHaveText(EDITED_STATUS.label)
    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL} 件`)
  })
})

/*
 * 削除（CA-23〜27）。実 API と同じく論理削除で、一覧は既定で取消済みを返さないので
 * 読み直すと行が消える。既定ハンドラは DELETE を可変配列に反映するため、件数が減るところまで見る。
 *
 * 事前検証は無い（DELETE は本文を取らない）ので、エラーの出し先は ca-delete-error の 1 系統だけ。
 *
 * CA には自然キーが無く日付 1 つでは行を特定できないので、確認ダイアログの対象ラベルは
 * 銘柄コード / CA種別名 / 効力発生日 の 3 点を並べた 1 行になる（CA-23）。
 */
test.describe('CAマスタ 削除', () => {
  test('[CA-23] 行の「削除」を押すと対象を示した確認ダイアログが開く', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openDeleteOfFirstRow(page)

    const dialog = deleteDialogOf(page)
    await expect(dialog).toContainText(DELETE_LABEL)
    await expect(dialog).toContainText('を削除しますか？')
    await expect(dialog).toContainText('この操作は元に戻せません。')
  })

  test('[CA-24] 「削除する」を押すと件数が 1 減りその行が消える', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openDeleteOfFirstRow(page)
    await page.getByTestId('ca-delete-submit').click()

    await expect(deleteDialogOf(page)).toBeHidden()

    const notice = page.getByTestId('ca-notice')
    await expect(notice).toBeVisible()
    await expect(notice).toHaveText(`${DELETE_LABEL} を削除しました。`)

    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL - 1} 件`)
    // 消えたのは押した行そのもの（行の testid が ID を持つので同じ行が残っていないと言える）
    await expect(deleteButtonOf(page, EDIT_TARGET.id)).toHaveCount(0)
    // 1 ページ目は 2 ページ目から 1 行繰り上がって埋まる
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
  })

  test('[CA-25] 「キャンセル」を押すと何も消えずに閉じる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openDeleteOfFirstRow(page)
    await page.getByTestId('ca-delete-cancel').click()

    await expect(deleteDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('ca-notice')).toHaveCount(0)
    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(deleteButtonOf(page, EDIT_TARGET.id)).toBeVisible()
  })

  test('[CA-26] 削除に失敗するとダイアログは開いたままエラーが出る', async ({ page }) => {
    await mockApi(page, [
      { method: 'delete', path: '*/api/masters/ca/*', status: 500, body: { detail: ERROR_MESSAGE } },
    ])
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openDeleteOfFirstRow(page)
    await page.getByTestId('ca-delete-submit').click()

    const error = page.getByTestId('ca-delete-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText(ERROR_MESSAGE)

    // 理由を読ませるためダイアログは閉じない。一覧にも影響しない
    await expect(deleteDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('ca-notice')).toHaveCount(0)
    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL} 件`)
    await expect(deleteButtonOf(page, EDIT_TARGET.id)).toBeVisible()
  })

  test('[CA-27] 最終ページを消し切ると 1 ページ前に戻る', async ({ page }) => {
    // 既定モックの 2 ページ目。1 ページ目は満杯なので、消えるのはこの 6 件だけ
    await page.goto(`${PATH}?offset=${PAGE_SIZE}`)
    await expect(rowsOf(page)).toHaveCount(secondPageCas.length)

    for (const [index, ca] of secondPageCas.entries()) {
      await deleteButtonOf(page, ca.ID).click()
      await expect(deleteDialogOf(page)).toBeVisible()
      await page.getByTestId('ca-delete-submit').click()
      await expect(deleteDialogOf(page)).toBeHidden()

      const remaining = secondPageCas.length - index - 1
      // 最後の 1 件を消すとこの offset が空になるので、行数ではなく URL の変化で見る
      if (remaining > 0) {
        await expect(rowsOf(page)).toHaveCount(remaining)
        await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))
      }
    }

    // 戻る直前に空状態が一瞬描画されるため、最終状態だけを web-first assertion で待つ
    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('ca-count')).toHaveText(`${TOTAL - secondPageCas.length} 件`)
  })
})
