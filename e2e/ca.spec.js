import { expect, test } from '@playwright/test'
import { caStocks, corporateActions } from '../src/mocks/fixtures/ca'
import { CA_TYPE_OPTIONS } from '../src/utils/caTypes'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/ca.md（タイトル先頭の [CA-xx] が対応 ID）
// ページ位置と検索条件は URL クエリを正とするため、URL と画面の同期をここで守る。
// mockApi() は固定の body を返すだけで offset / stock_code / ca_type を解釈しない。
// ページングと絞り込み（CA-02 / 03 / 04 / 05）は
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

// 絞り込みに使う値もフィクスチャから導く（'AAPL' や '110' を直接書かない）
const TICKER = firstRow.ticker
const byTicker = allRows.filter((row) => row.ticker === TICKER)
const CA_TYPE = sorted[0].CA種別
const CA_TYPE_NAME = firstRow.caTypeName
const byCaType = allRows.filter((row) => row.caTypeName === CA_TYPE_NAME)

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

// 銘柄マスタ（caStocks）のどのコードにも当たらない文字列
const UNKNOWN_STOCK_CODE = 'ZZZZZ'

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('ca-table').getByTestId('data-table-row')
}

/** 追加モーダル。role=dialog の aria-label はモーダルのタイトル（BaseModal） */
function addDialogOf(page) {
  return page.getByRole('dialog', { name: 'CA 新規追加' })
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
    await mockApi(page, [{ path: '*/api/ca', status: 500, body: { detail: ERROR_MESSAGE } }])
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

  test('[CA-09] 列順が仕様どおりでステータス列と行の操作が無い', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await expect(page.getByTestId('ca-table').locator('th')).toHaveText([
      '銘柄',
      'CA種別',
      '権利付最終日',
      '効力発生日',
      '支払日',
      '比率',
      '備考',
    ])

    // 追加はヘッダの「新規追加」から行う。行には編集・削除のボタンが無い
    await expect(page.getByTestId('ca-add')).toBeVisible()
    await expect(rowsOf(page).first().getByRole('button')).toHaveCount(0)
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
})

/*
 * 新規追加（CA-11〜16）。既定ハンドラは登録した行を保持するので、件数が増えるところまで見る。
 * モックの可変状態はページを開き直すと初期化されるため、テスト間で持ち越さない。
 *
 * 登録は「事前検証 → 登録」の 2 段で、エラーの出し先が 3 系統に分かれる。
 *   必須未入力       … FormField の error（CA-13）
 *   事前検証の不合格 … ca-add-validation-error の箇条書き（CA-14）
 *   通信・サーバ障害 … ca-add-error（CA-15）
 * 事前検証と登録は別パス（/ca/validate と /ca）なので、mockApi() で一方だけを差し替えられる。
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
    // 事前検証（*/api/ca/validate）はパスが別なので既定ハンドラのまま通る
    await mockApi(page, [
      { method: 'post', path: '*/api/ca', status: 500, body: { detail: ERROR_MESSAGE } },
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
})
