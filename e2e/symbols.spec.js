import { expect, test } from '@playwright/test'
import { symbols } from '../src/mocks/fixtures/symbols'
import { formatQuantity, formatUsdUnit } from '../src/utils/format'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/symbols.md（タイトル先頭の [SM-xx] が対応 ID）
// ページ位置と検索条件は URL クエリを正とするため、URL と画面の同期をここで守る。
// mockApi() は固定の body を返すだけで offset / 銘柄コード / 区分 3 つを解釈しない。
// ページングと絞り込み（SM-02〜SM-07）は
// クエリを実際に処理する既定ハンドラで検証する。

const PATH = '/masters/symbols'

// src/stores/symbols.js の SYMBOLS_PAGE_SIZE と同じ値（実 API も 1 ページ 50 件固定）。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

/*
 * フィクスチャはバックエンドの生の形（日本語キー / フラグは 0・1 の integer）なので、
 * 期待値は api 層と同じ変換でアプリ内モデルの形に直してから使う。
 * 相場の 3 列は null のまま持つ（'—' で出ることを SM-11 で見る）。
 */
const toRow = (symbol) => ({
  symbolCode: symbol.銘柄コード,
  ticker: symbol.Ticker ?? '',
  nameEn: symbol.銘柄名_英字 ?? '',
  name: symbol.銘柄名 ?? '',
  previousClose: symbol.前日終値 ?? null,
  previousVolume: symbol.前日出来高 ?? null,
  averageVolume: symbol.平均出来高 ?? null,
  regulation: symbol.規制情報 ?? '',
  regulationName: symbol.規制情報名 ?? '',
  orderRoute: symbol.注文ルート ?? '',
  vwapTarget: symbol.VWAP対象区分 ?? '',
  userModified: symbol.ユーザー操作フラグ === 1,
})

// 取消済み（取消区分 1）は既定の一覧に出ない。並びはハンドラと同じ銘柄コードの昇順
const allRows = symbols
  .filter((symbol) => symbol.取消区分 === 0)
  .map(toRow)
  .sort((a, b) => a.symbolCode.localeCompare(b.symbolCode))
const TOTAL = allRows.length
const firstPage = allRows.slice(0, PAGE_SIZE)
const secondPage = allRows.slice(PAGE_SIZE)
const firstRow = allRows[0]

// 絞り込みに使う値もフィクスチャから導く（'AAPL' や '1' を直接書かない）
const TICKER = firstRow.ticker
const byTicker = allRows.filter((row) => row.ticker === TICKER)

// 取引不可（規制情報 1）の行。表示名もフィクスチャが持っている
const CLOSED = allRows.find((row) => row.regulation === '1')
const byRegulation = allRows.filter((row) => row.regulation === CLOSED.regulation)

// 預託先区分と VWAP対象区分の複合条件（AND で効くことを SM-05 で見る）
const ORDER_ROUTE = '0' // src/utils/symbolTypes.js の ORDER_ROUTE_OPTIONS（0: みずほ証券）
const VWAP_TARGET = '0' // 同 VWAP_TARGET_OPTIONS（0: 対象外）
const byRouteAndVwap = allRows.filter(
  (row) => row.orderRoute === ORDER_ROUTE && row.vwapTarget === VWAP_TARGET,
)

// 相場の値が未取得（null）の行。1 ページ目に 1 件だけ置いてある
const NO_QUOTE_INDEX = firstPage.findIndex((row) => row.previousClose === null)

// DataTable の列順（SymbolListView.vue の columns）。相場の 3 列の位置
const COLUMN_INDEX = { previousClose: 4, previousVolume: 5, averageVolume: 6 }

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('symbols-table').getByTestId('data-table-row')
}

/** 行の背景色。CSS クラス名ではなく「見えかた」で確かめる（SM-09） */
function backgroundColorOf(row) {
  return row.evaluate((el) => getComputedStyle(el).backgroundColor)
}

/** 追加モーダル。タイトルで絞る（編集・削除を足しても取り違えないように） */
function addDialogOf(page) {
  return page.getByRole('dialog', { name: '銘柄 新規追加' })
}

// フィクスチャに無い銘柄コード（追加に使う）と、既にある銘柄コード（重複で弾かれる）
const NEW_SYMBOL = { symbolCode: 'S900', ticker: 'ZZZZ', name: 'テスト銘柄' }
const duplicateMessage = (code) => `銘柄コード(${code})は既に登録されています`

/** 必須 3 項目を埋める */
async function fillRequired(page, symbol = NEW_SYMBOL) {
  await page.getByTestId('symbols-add-symbol-code').fill(symbol.symbolCode)
  await page.getByTestId('symbols-add-ticker').fill(symbol.ticker)
  await page.getByTestId('symbols-add-name').fill(symbol.name)
}

test.describe('銘柄マスタ一覧', () => {
  test('[SM-01] サイドメニューから開くと一覧と件数が表示される', async ({ page }) => {
    await page.goto('/')

    await page
      .getByRole('navigation', { name: 'メインメニュー' })
      .getByRole('link', { name: '銘柄マスタ', exact: true })
      .click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByRole('heading', { name: '銘柄マスタ', exact: true })).toBeVisible()
    // 画面固有の操作がヘッダ（#topbar-actions）へ差し込まれている
    await expect(page.getByTestId('symbols-reload')).toBeVisible()

    await expect(page.getByTestId('symbols-count')).toHaveText(`${TOTAL} 件`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)
    await expect(rows.first()).toContainText(firstRow.symbolCode)
    await expect(rows.first()).toContainText(firstRow.ticker)
    await expect(rows.first()).toContainText(firstRow.nameEn)
    await expect(rows.first()).toContainText(firstRow.name)
  })

  test('[SM-02] 「次のページ」を押すと 2 ページ目が表示される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    const pagination = page.getByTestId('symbols-pagination')
    await pagination.getByRole('button', { name: '次のページ' }).click()

    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(secondPage.length)
    await expect(rows.first()).toContainText(secondPage[0].symbolCode)

    await expect(pagination.getByTestId('pagination-range')).toHaveText(
      `${TOTAL} 件中 ${PAGE_SIZE + 1}–${TOTAL} 件`,
    )
  })

  test('[SM-03] ティッカーコードで絞り込むと URL と一覧に反映される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('symbols-symbol-code').fill(TICKER)
    await page.getByTestId('symbols-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`symbol_code=${TICKER}`))
    await expect(page.getByTestId('symbols-count')).toHaveText(`${byTicker.length} 件`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(byTicker.length)
    await expect(rows.first()).toContainText(byTicker[0].symbolCode)
  })

  test('[SM-04] 取引可否で絞り込むと取引不可の行だけになる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('symbols-regulation').selectOption(CLOSED.regulation)
    await page.getByTestId('symbols-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`regulation=${CLOSED.regulation}`))
    await expect(page.getByTestId('symbols-count')).toHaveText(`${byRegulation.length} 件`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(byRegulation.length)
    // 取引可の行が混ざっていない
    await expect(rows.filter({ hasText: CLOSED.regulationName })).toHaveCount(byRegulation.length)
  })

  test('[SM-05] 預託先区分と VWAP対象区分は組み合わせて効く', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('symbols-order-route').selectOption(ORDER_ROUTE)
    await page.getByTestId('symbols-vwap-target').selectOption(VWAP_TARGET)
    await page.getByTestId('symbols-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`order_route=${ORDER_ROUTE}`))
    await expect(page).toHaveURL(new RegExp(`vwap_target=${VWAP_TARGET}`))

    // 片方だけの件数より少ない＝ AND で効いている
    await expect(page.getByTestId('symbols-count')).toHaveText(`${byRouteAndVwap.length} 件`)
    await expect(rowsOf(page)).toHaveCount(Math.min(byRouteAndVwap.length, PAGE_SIZE))
  })

  test('[SM-06] 「クリア」を押すと絞り込みが解除される', async ({ page }) => {
    await page.goto(PATH)

    await page.getByTestId('symbols-symbol-code').fill(TICKER)
    await page.getByTestId('symbols-search-submit').click()
    await expect(rowsOf(page)).toHaveCount(byTicker.length)

    await page.getByTestId('symbols-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('symbols-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('symbols-symbol-code')).toHaveValue('')
  })

  test('[SM-07] 銘柄名では絞れず空状態になる', async ({ page }) => {
    await page.goto(PATH)

    // 検索欄は実 API の `銘柄コード` にだけ乗るので、銘柄名を入れても当たらない
    await page.getByTestId('symbols-symbol-code').fill(firstRow.name)
    await page.getByTestId('symbols-search-submit').click()

    await expect(page.getByTestId('symbols-empty')).toHaveText('該当する銘柄はありません。')
    await expect(page.getByTestId('symbols-table')).toBeHidden()
    // 0 件のときこそ条件を直したいので、検索カードは消えない
    await expect(page.getByTestId('symbols-search')).toBeVisible()
  })

  test('[SM-08] API がエラーを返したときエラー表示と再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [
      { path: '*/api/masters/symbols', status: 500, body: { detail: ERROR_MESSAGE } },
    ])
    await page.goto(PATH)

    const error = page.getByTestId('symbols-error')
    await expect(error).toContainText(ERROR_MESSAGE)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('symbols-table')).toBeHidden()
    // エラーのときも説明バナーと検索カードは消えない
    await expect(page.getByTestId('symbols-description')).toBeVisible()
    await expect(page.getByTestId('symbols-search')).toBeVisible()
  })

  test('[SM-09] 手動操作された行だけ背景色が変わる', async ({ page }) => {
    await page.goto(PATH)
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)

    const markedIndex = firstPage.findIndex((row) => row.userModified)
    const plainIndex = firstPage.findIndex((row) => !row.userModified)
    // フィクスチャが両方の行を持っていないと、このシナリオは意味を失う
    expect(markedIndex).toBeGreaterThanOrEqual(0)
    expect(plainIndex).toBeGreaterThanOrEqual(0)

    const markedColor = await backgroundColorOf(rows.nth(markedIndex))
    const plainColor = await backgroundColorOf(rows.nth(plainIndex))
    expect(markedColor).not.toBe(plainColor)
  })

  test('[SM-10] 列順が仕様どおりで、右端の操作列に編集がある', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await expect(page.getByTestId('symbols-table').locator('th')).toHaveText([
      '銘柄コード',
      'ティッカーコード',
      '銘柄名（英語）',
      '銘柄名（日本語）',
      '前日終値',
      '前日出来高',
      '5日平均出来高',
      '取引可否',
      '預託先区分',
      'VWAP対象区分',
      '備考',
      // 行ごとの操作。画面モックに合わせて見出しは空
      '',
    ])

    // 追加はヘッダから行う。行の操作は編集 1 つだけ（削除はまだ無い）
    await expect(page.getByTestId('symbols-add')).toBeVisible()
    const rowButtons = rowsOf(page).first().getByRole('button')
    await expect(rowButtons).toHaveCount(1)
    await expect(rowButtons).toHaveText('編集')
  })

  test('[SM-11] 相場の 3 列は整形され、未取得の行は「—」になる', async ({ page }) => {
    await page.goto(PATH)
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)

    // 期待値は画面と同じ整形関数から導く（'227.16 ドル' を直接書かない）
    const first = rows.first()
    const cells = first.locator('td')
    await expect(cells.nth(COLUMN_INDEX.previousClose)).toHaveText(
      formatUsdUnit(firstRow.previousClose),
    )
    await expect(cells.nth(COLUMN_INDEX.previousVolume)).toHaveText(
      formatQuantity(firstRow.previousVolume),
    )
    await expect(cells.nth(COLUMN_INDEX.averageVolume)).toHaveText(
      formatQuantity(firstRow.averageVolume),
    )

    // 未取得（null）の行は 3 列とも '—'。0 と区別が付かなくならないことを見る
    expect(NO_QUOTE_INDEX).toBeGreaterThanOrEqual(0)
    const noQuote = rows.nth(NO_QUOTE_INDEX).locator('td')
    await expect(noQuote.nth(COLUMN_INDEX.previousClose)).toHaveText('—')
    await expect(noQuote.nth(COLUMN_INDEX.previousVolume)).toHaveText('—')
    await expect(noQuote.nth(COLUMN_INDEX.averageVolume)).toHaveText('—')
  })

  test('[SM-12] ブラウザバックで前のページに戻る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('symbols-pagination').getByRole('button', { name: '次のページ' }).click()
    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))
    await expect(rowsOf(page)).toHaveCount(secondPage.length)

    await page.goBack()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(rowsOf(page).first()).toContainText(firstRow.symbolCode)
  })
})

/*
 * 新規追加（SM-13〜20）。既定ハンドラは追加した行を保持するので、件数が増えるところまで見る。
 * モックの可変状態はページを開き直すと初期化されるため、テスト間で持ち越さない。
 *
 * 登録は「事前検証 → 登録」の 2 段で、エラーの出し先が 3 系統に分かれる。
 *   必須未入力       … FormField の error（SM-14）
 *   事前検証の不合格 … symbols-add-validation-error の箇条書き（SM-16）
 *   通信・サーバ障害 … symbols-add-error（SM-17）
 * 事前検証と登録は別パス（/masters/symbols/validate と /masters/symbols）なので、
 * mockApi() で一方だけを差し替えられる。
 *
 * 一覧は銘柄コードの昇順なので追加した行が 1 ページ目に出るとは限らない。
 * 行は追いかけず、成功メッセージと件数で受理を見て、内容は検索して確かめる（SM-20）。
 */
test.describe('銘柄マスタ 新規追加', () => {
  test('[SM-13] 「新規追加」を押すと 10 項目のモーダルが開く', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('symbols-add').click()

    const dialog = addDialogOf(page)
    await expect(dialog).toBeVisible()

    // 文字と数値の欄は空、区分 3 つは実 API の既定（'0'）が選ばれている
    for (const name of [
      'symbol-code',
      'ticker',
      'name',
      'name-en',
      'previous-close',
      'average-volume',
      'note',
    ]) {
      await expect(page.getByTestId(`symbols-add-${name}`)).toHaveValue('')
    }
    await expect(page.getByTestId('symbols-add-regulation')).toHaveValue('0')
    await expect(page.getByTestId('symbols-add-order-route')).toHaveValue('0')
    await expect(page.getByTestId('symbols-add-vwap-target')).toHaveValue('0')

    // 入力項目は 10（input 7 + select 3）。市場名・前日出来高・Pre区分 は持たない
    const form = dialog.getByTestId('symbols-add-form')
    await expect(form.locator('input')).toHaveCount(7)
    await expect(form.getByRole('combobox')).toHaveCount(3)
    // ラベル（アクセシブルネーム）でも項目を確かめる
    await expect(form.getByLabel(/銘柄コード/)).toHaveCount(1)
    await expect(form.getByLabel(/ティッカーコード/)).toHaveCount(1)
    await expect(form.getByLabel(/銘柄名（日本語）/)).toHaveCount(1)
  })

  test('[SM-14] 未入力のまま「追加」を押すと必須 3 項目にエラーが出る', async ({ page }) => {
    await page.goto(PATH)
    await page.getByTestId('symbols-add').click()

    const dialog = addDialogOf(page)
    await page.getByTestId('symbols-add-submit').click()

    await expect(dialog.getByText('銘柄コードを入力してください。')).toBeVisible()
    await expect(dialog.getByText('ティッカーコードを入力してください。')).toBeVisible()
    await expect(dialog.getByText('銘柄名（日本語）を入力してください。')).toBeVisible()

    // 3 系統のうち項目直下だけに出る。サーバへは行かないので他の 2 つは出ない
    await expect(page.getByTestId('symbols-add-validation-error')).toHaveCount(0)
    await expect(page.getByTestId('symbols-add-error')).toHaveCount(0)

    // 入力を直せるようモーダルは閉じない。一覧にも影響しない
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('symbols-count')).toHaveText(`${TOTAL} 件`)
  })

  test('[SM-15] 一覧に無い銘柄コードを追加すると件数が 1 増える', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('symbols-add').click()
    await fillRequired(page)
    await page.getByTestId('symbols-add-submit').click()

    await expect(addDialogOf(page)).toBeHidden()

    // 追加した行は昇順のどこに入るか決まらないので、銘柄コードをメッセージで示す
    const notice = page.getByTestId('symbols-notice')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText(NEW_SYMBOL.symbolCode)

    await expect(page.getByTestId('symbols-count')).toHaveText(`${TOTAL + 1} 件`)

    // 登録は一覧の単方向フローに触らない（URL は変わらない）
    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
  })

  test('[SM-16] 既にある銘柄コードを追加すると事前検証の理由が箇条書きで出る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('symbols-add').click()
    await fillRequired(page, { ...NEW_SYMBOL, symbolCode: firstRow.symbolCode })
    await page.getByTestId('symbols-add-submit').click()

    const validationError = page.getByTestId('symbols-add-validation-error')
    await expect(validationError).toBeVisible()
    await expect(validationError.getByRole('listitem')).toHaveText([
      duplicateMessage(firstRow.symbolCode),
    ])

    // 事前検証の不合格は通信障害ではないので、専用の表示には出ない
    await expect(page.getByTestId('symbols-add-error')).toHaveCount(0)

    await expect(addDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('symbols-notice')).toHaveCount(0)
    await expect(page.getByTestId('symbols-count')).toHaveText(`${TOTAL} 件`)
  })

  test('[SM-17] 登録に失敗するとモーダルは開いたままエラーが出る', async ({ page }) => {
    // 事前検証（*/api/masters/symbols/validate）はパスが別なので既定ハンドラのまま通る
    await mockApi(page, [
      {
        method: 'post',
        path: '*/api/masters/symbols',
        status: 500,
        body: { detail: ERROR_MESSAGE },
      },
    ])
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('symbols-add').click()
    await fillRequired(page)
    await page.getByTestId('symbols-add-submit').click()

    await expect(addDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('symbols-add-error')).toContainText(ERROR_MESSAGE)

    // 事前検証は通っているので箇条書きは出ない。登録もされていない
    await expect(page.getByTestId('symbols-add-validation-error')).toHaveCount(0)
    await expect(page.getByTestId('symbols-notice')).toHaveCount(0)
    await expect(page.getByTestId('symbols-count')).toHaveText(`${TOTAL} 件`)
  })

  test('[SM-18] モーダルを開き直すと前回の失敗と入力が残らない', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('symbols-add').click()
    await fillRequired(page, { ...NEW_SYMBOL, symbolCode: firstRow.symbolCode })
    await page.getByTestId('symbols-add-submit').click()
    await expect(page.getByTestId('symbols-add-validation-error')).toBeVisible()

    await page.getByTestId('symbols-add-cancel').click()
    await expect(addDialogOf(page)).toBeHidden()
    await page.getByTestId('symbols-add').click()

    await expect(page.getByTestId('symbols-add-validation-error')).toHaveCount(0)
    await expect(page.getByTestId('symbols-add-symbol-code')).toHaveValue('')
    await expect(page.getByTestId('symbols-add-ticker')).toHaveValue('')
    await expect(page.getByTestId('symbols-add-name')).toHaveValue('')
    // 区分 3 つは既定値に戻る（空にはならない）
    await expect(page.getByTestId('symbols-add-regulation')).toHaveValue('0')
  })

  test('[SM-19] ティッカーコードは 10 文字までしか入らない', async ({ page }) => {
    await page.goto(PATH)
    await page.getByTestId('symbols-add').click()

    const ticker = page.getByTestId('symbols-add-ticker')
    await ticker.fill('ABCDEFGHIJ')
    // maxlength を越える入力は打ち込んでも足されない（実 API の 10 文字に合わせてある）
    await ticker.pressSequentially('K')

    await expect(ticker).toHaveValue('ABCDEFGHIJ')
  })

  test('[SM-20] 追加した銘柄は検索すると入力した内容で出る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('symbols-add').click()
    await fillRequired(page)
    await page.getByTestId('symbols-add-name-en').fill('Test Inc.')
    await page.getByTestId('symbols-add-regulation').selectOption('1')
    await page.getByTestId('symbols-add-order-route').selectOption('1')
    await page.getByTestId('symbols-add-vwap-target').selectOption('1')
    await page.getByTestId('symbols-add-previous-close').fill('123.45')
    await page.getByTestId('symbols-add-average-volume').fill('1000000')
    await page.getByTestId('symbols-add-note').fill('追加した銘柄')
    await page.getByTestId('symbols-add-submit').click()
    await expect(addDialogOf(page)).toBeHidden()

    // 成功メッセージに出た銘柄コードで探す（昇順のどこに入ったかは追わない）
    await page.getByTestId('symbols-symbol-code').fill(NEW_SYMBOL.symbolCode)
    await page.getByTestId('symbols-search-submit').click()

    await expect(page.getByTestId('symbols-count')).toHaveText('1 件')
    const row = rowsOf(page).first()
    await expect(row).toContainText(NEW_SYMBOL.ticker)
    await expect(row).toContainText(NEW_SYMBOL.name)
    await expect(row).toContainText('Test Inc.')
    await expect(row).toContainText('取引不可')
    await expect(row).toContainText('IB証券')
    await expect(row).toContainText('対象')
    await expect(row).toContainText(formatUsdUnit(123.45))
    await expect(row).toContainText(formatQuantity(1_000_000))
    await expect(row).toContainText('追加した銘柄')

    // 画面から登録した行なので、手動操作の印（背景色）が付く
    const marked = await backgroundColorOf(row)
    const plainIndex = firstPage.findIndex((candidate) => !candidate.userModified)
    expect(plainIndex).toBeGreaterThanOrEqual(0)
    await page.getByTestId('symbols-search-clear').click()
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    expect(marked).not.toBe(await backgroundColorOf(rowsOf(page).nth(plainIndex)))
  })
})
