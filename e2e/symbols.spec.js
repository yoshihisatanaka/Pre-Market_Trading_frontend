import { expect, test } from '@playwright/test'
import { clickSideMenuLink } from './helpers/sideMenu'
import { symbols } from '../src/mocks/fixtures/symbols'
import { formatQuantity, formatUsdUnit } from '../src/utils/format'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/symbols.md（タイトル先頭の [SM-xx] が対応 ID）
// ページ位置と検索条件は URL クエリを正とするため、URL と画面の同期をここで守る。
// mockApi() は固定の body を返すだけで offset / 銘柄コード / 銘柄名 / 区分 3 つを解釈しない。
// ページングと絞り込み（SM-02〜SM-07、SM-35〜SM-36）は
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
  id: String(symbol.ID),
  symbolCode: symbol.銘柄コード,
  ticker: symbol.Ticker ?? '',
  nameEn: symbol.銘柄名_英字 ?? '',
  name: symbol.銘柄名 ?? '',
  note: symbol.備考 ?? '',
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

// DataTable の列順（SymbolListView.vue の columns）。相場の 3 列と VWAP対象区分の位置
const COLUMN_INDEX = { previousClose: 4, previousVolume: 5, averageVolume: 6, vwapTarget: 9 }

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/*
 * 「銘柄名」欄の検索語。日本語名はそのまま、英語名は先頭の 1 語を小文字にして
 * 「大文字小文字を区別しない部分一致」であることも一緒に見る（'アップル' / 'apple' を直接書かない）。
 * 日本語か英語かの振り分けは api 層（ASCII 以外を含むか）が行い、境界値は単体テスト側。
 */
const NAME_JA = firstRow.name
const byNameJa = allRows.filter((row) => row.name.includes(NAME_JA))
const NAME_EN = firstRow.nameEn.split(' ')[0].toLowerCase()
const byNameEn = allRows.filter((row) => row.nameEn.toUpperCase().includes(NAME_EN.toUpperCase()))

/*
 * 一括対象外化の対象 = VWAP対象区分が「対象」の有効な銘柄（母数は有効な全件）。
 * ダイアログの一覧は既定ハンドラがフィクスチャの順（= 銘柄コードの昇順）で返す。
 */
const VWAP_TARGET_ON = '1' // src/utils/symbolTypes.js の VWAP_TARGET_OPTIONS（1: 対象）
const vwapTargets = allRows.filter((row) => row.vwapTarget === VWAP_TARGET_ON)
const successMessageOf = (count) => `VWAP対象の銘柄 ${count} 件を対象外にしました。`

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

/** 編集モーダル。同上 */
function editDialogOf(page) {
  return page.getByRole('dialog', { name: '銘柄 編集' })
}

/** 行の「編集」を押す（ボタンの data-testid は行の id を含む） */
async function openEdit(page, row = firstRow) {
  await page.getByTestId(`symbols-edit-${row.id}`).click()
  await expect(editDialogOf(page)).toBeVisible()
}

// フィクスチャに無い銘柄コード（追加に使う）と、既にある銘柄コード（重複で弾かれる）
const NEW_SYMBOL = { symbolCode: 'S900', ticker: 'ZZZZ', name: 'テスト銘柄' }
const duplicateMessage = (code) => `銘柄コード(${code})は既に登録されています`

/** 削除確認ダイアログ。追加・編集と同じくタイトルで絞る */
function deleteDialogOf(page) {
  return page.getByRole('dialog', { name: '削除確認' })
}

/** 行の「削除」を押す（ボタンの data-testid は行の id を含む） */
async function openDelete(page, row = firstRow) {
  await page.getByTestId(`symbols-delete-${row.id}`).click()
  await expect(deleteDialogOf(page)).toBeVisible()
}

/*
 * 取引可（規制情報 0）で絞った行。フィクスチャでは 51 件（= 1 ページ + 1 件）なので、
 * 2 ページ目がちょうど 1 行になる。その 1 行を消すと最終ページが空になり、
 * ページ戻しが起きる（SM-34）。
 */
const OPEN_REGULATION = '0'
const byOpenRegulation = allRows.filter((row) => row.regulation === OPEN_REGULATION)
const lastPageRow = byOpenRegulation[PAGE_SIZE]

/** 一括対象外化のダイアログ。追加・編集・削除と同じくタイトルで絞る */
function vwapBulkDialogOf(page) {
  return page.getByRole('dialog', { name: 'VWAP対象を一括で対象外へ' })
}

/** ヘッダの「VWAP対象を一括で対象外へ」を押す（開いた時点で事前確認が走る） */
async function openVwapBulk(page) {
  await page.getByTestId('symbols-vwap-bulk').click()
  await expect(vwapBulkDialogOf(page)).toBeVisible()
}

/** 行の VWAP対象区分 のセル */
function vwapCellOf(row) {
  return row.locator('td').nth(COLUMN_INDEX.vwapTarget)
}

/** 必須 3 項目を埋める */
async function fillRequired(page, symbol = NEW_SYMBOL) {
  await page.getByTestId('symbols-add-symbol-code').fill(symbol.symbolCode)
  await page.getByTestId('symbols-add-ticker').fill(symbol.ticker)
  await page.getByTestId('symbols-add-name').fill(symbol.name)
}

test.describe('銘柄マスタ一覧', () => {
  test('[SM-01] サイドメニューから開くと一覧と件数が表示される', async ({ page }) => {
    await page.goto('/')

    await clickSideMenuLink(page, '銘柄マスタ')

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByRole('heading', { name: '銘柄マスタ', exact: true })).toBeVisible()
    // 画面固有の操作がヘッダ（#topbar-actions）へ差し込まれている（一括操作が左、新規追加が右）
    await expect(page.getByTestId('symbols-add')).toBeVisible()
    await expect(page.getByTestId('symbols-vwap-bulk')).toBeVisible()

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
    await page.getByTestId('symbols-symbol-name').fill(NAME_JA)
    await page.getByTestId('symbols-search-submit').click()
    await expect(rowsOf(page)).toHaveCount(byTicker.length)

    await page.getByTestId('symbols-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('symbols-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    // 文字の欄は 2 つとも空に戻る
    await expect(page.getByTestId('symbols-symbol-code')).toHaveValue('')
    await expect(page.getByTestId('symbols-symbol-name')).toHaveValue('')
  })

  test('[SM-07] 銘柄コード欄に銘柄名を入れても絞れず空状態になる', async ({ page }) => {
    await page.goto(PATH)

    // この欄は実 API の `symbol`（銘柄コード・Ticker）にだけ乗るので、銘柄名を入れても当たらない
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

  test('[SM-10] 列順が仕様どおりで、右端の操作列に編集と削除がある', async ({ page }) => {
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

    // 追加と一括操作はヘッダから行う。並びは画面モックどおり一括操作が左・新規追加が右
    const add = page.getByTestId('symbols-add')
    const bulk = page.getByTestId('symbols-vwap-bulk')
    await expect(add).toBeVisible()
    await expect(bulk).toHaveText('VWAP対象を一括で対象外へ')
    expect((await bulk.boundingBox()).x).toBeLessThan((await add.boundingBox()).x)

    // 行の操作は編集が左・削除が右端（破壊的な操作を最後にする）
    const rowButtons = rowsOf(page).first().getByRole('button')
    await expect(rowButtons).toHaveCount(2)
    await expect(rowButtons).toHaveText(['編集', '削除'])
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

  test('[SM-35] 銘柄名欄に日本語名を入れると URL と一覧に反映される', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await page.getByTestId('symbols-symbol-name').fill(NAME_JA)
    await page.getByTestId('symbols-search-submit').click()

    // クエリ名は 1 つ（symbol_name）。日本語名に乗せるのは api 層の仕事で、URL には現れない
    await expect(page).toHaveURL((url) => url.searchParams.get('symbol_name') === NAME_JA)
    await expect(page.getByTestId('symbols-count')).toHaveText(`${byNameJa.length} 件`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(byNameJa.length)
    await expect(rows.first()).toContainText(byNameJa[0].symbolCode)
    await expect(rows.first()).toContainText(byNameJa[0].ticker)
  })

  test('[SM-36] URL の symbol_name は英語名に大文字小文字を無視して当たる', async ({ page }) => {
    await page.goto(`${PATH}?symbol_name=${NAME_EN}`)

    // URL → 画面の同期（入力欄に値が入る）
    await expect(page.getByTestId('symbols-symbol-name')).toHaveValue(NAME_EN)
    await expect(page.getByTestId('symbols-count')).toHaveText(`${byNameEn.length} 件`)

    const rows = rowsOf(page)
    await expect(rows).toHaveCount(byNameEn.length)
    await expect(rows.first()).toContainText(byNameEn[0].nameEn)
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
    await expect(page.getByTestId('symbols-add-order-route')).toHaveValue('1')
    await expect(page.getByTestId('symbols-add-vwap-target')).toHaveValue('1')

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
    // 初期値（IB証券 / 対象）から変えて、選んだ値が届くことを見る
    await page.getByTestId('symbols-add-order-route').selectOption('0')
    await page.getByTestId('symbols-add-vwap-target').selectOption('0')
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
    await expect(row).toContainText('みずほ証券')
    await expect(row).toContainText('対象外')
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

/*
 * 編集（SM-21〜27）。既定ハンドラは更新した内容を保持するので、一覧の行が変わるところまで見る。
 * 更新は行を増やさないので、件数が変わらないことも一緒に確かめる。
 *
 * エラーの出し先は新規追加と同じ 3 系統（data-testid は symbols-edit-… に振り替わる）。
 *   入力の不備      … 項目の直下（SM-24）
 *   事前検証の不合格 … symbols-edit-validation-error の箇条書き（SM-25）
 *   通信・サーバ障害 … symbols-edit-error（SM-26。楽観的ロックの競合 409 も同じ枠）
 *
 * **銘柄コードは変更できない**（SM-21）ので、事前検証の不合格は画面の導線からは起こせない。
 * SM-25 は mockApi() で応答を差し替えて出しかただけを見る。
 */
test.describe('銘柄マスタ 編集', () => {
  const VALIDATION_MESSAGE = '注文ルート(9)はコードマスタに存在しません'
  const CONFLICT_MESSAGE = '他のユーザーによって銘柄データが更新されています。'

  /** 事前検証を不合格にする差し替え（更新そのものは既定ハンドラのまま） */
  const failValidate = (page) =>
    mockApi(page, [
      {
        method: 'post',
        path: '*/api/masters/symbols/validate',
        body: { valid: false, errors: [VALIDATION_MESSAGE], warnings: [], details: null },
      },
    ])

  test('[SM-21] 行の「編集」を押すと現在値が入り、銘柄コードは変更できない', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openEdit(page)

    await expect(page.getByTestId('symbols-edit-symbol-code')).toHaveValue(firstRow.symbolCode)
    await expect(page.getByTestId('symbols-edit-ticker')).toHaveValue(firstRow.ticker)
    await expect(page.getByTestId('symbols-edit-name')).toHaveValue(firstRow.name)
    await expect(page.getByTestId('symbols-edit-name-en')).toHaveValue(firstRow.nameEn)
    await expect(page.getByTestId('symbols-edit-regulation')).toHaveValue(firstRow.regulation)
    await expect(page.getByTestId('symbols-edit-vwap-target')).toHaveValue(firstRow.vwapTarget)
    await expect(page.getByTestId('symbols-edit-previous-close')).toHaveValue(
      String(firstRow.previousClose),
    )
    await expect(page.getByTestId('symbols-edit-note')).toHaveValue(firstRow.note)

    // 主キーではないが、実 API の詳細照会・更新履歴がこの値で 1 件を指すので固定する
    await expect(page.getByTestId('symbols-edit-symbol-code')).toHaveJSProperty('readOnly', true)

    // 項目は追加と同じ 10（input 7 + select 3）
    const form = editDialogOf(page).getByTestId('symbols-edit-form')
    await expect(form.locator('input')).toHaveCount(7)
    await expect(form.getByRole('combobox')).toHaveCount(3)
  })

  test('[SM-22] 備考を書き換えて更新すると一覧のその行が変わる', async ({ page }) => {
    const EDITED_NOTE = '編集した備考'
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openEdit(page)
    await page.getByTestId('symbols-edit-note').fill(EDITED_NOTE)
    await page.getByTestId('symbols-edit-submit').click()

    await expect(editDialogOf(page)).toBeHidden()

    const notice = page.getByTestId('symbols-notice')
    await expect(notice).toContainText(firstRow.symbolCode)
    await expect(notice).toContainText(firstRow.ticker)
    await expect(notice).toContainText(firstRow.name)

    // 更新は行を増やさない。並びは銘柄コード順のままなので同じ位置に居る
    await expect(page.getByTestId('symbols-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page).first()).toContainText(EDITED_NOTE)
  })

  test('[SM-23] 区分を変えて更新すると一覧の表示名が変わる', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openEdit(page)
    await page.getByTestId('symbols-edit-regulation').selectOption('1')
    await page.getByTestId('symbols-edit-vwap-target').selectOption('0')
    await page.getByTestId('symbols-edit-submit').click()

    await expect(editDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('symbols-count')).toHaveText(`${TOTAL} 件`)

    const row = rowsOf(page).first()
    await expect(row).toContainText('取引不可')
    await expect(row).toContainText('対象外')
  })

  test('[SM-24] 必須を空にして更新すると項目の直下にエラーが出る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openEdit(page)
    await page.getByTestId('symbols-edit-ticker').fill('')
    await page.getByTestId('symbols-edit-submit').click()

    const dialog = editDialogOf(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('ティッカーコードを入力してください。')).toBeVisible()

    // 3 系統を混ぜない。事前検証にも通信エラーにも出さず、成功メッセージも出ない
    await expect(page.getByTestId('symbols-edit-validation-error')).toBeHidden()
    await expect(page.getByTestId('symbols-edit-error')).toBeHidden()
    await expect(page.getByTestId('symbols-notice')).toBeHidden()
  })

  test('[SM-25] 事前検証に弾かれると理由が箇条書きで出る', async ({ page }) => {
    await failValidate(page)
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openEdit(page)
    await page.getByTestId('symbols-edit-note').fill('編集した備考')
    await page.getByTestId('symbols-edit-submit').click()

    await expect(editDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('symbols-edit-validation-error')).toContainText(
      VALIDATION_MESSAGE,
    )
    // 通信は成功しているので、サーバ障害の枠には出さない
    await expect(page.getByTestId('symbols-edit-error')).toBeHidden()
    await expect(page.getByTestId('symbols-count')).toHaveText(`${TOTAL} 件`)
  })

  test('[SM-26] 競合(409)は通信・サーバ障害と同じ枠に出る', async ({ page }) => {
    await mockApi(page, [
      {
        method: 'put',
        path: '*/api/masters/symbols/:id',
        status: 409,
        body: { detail: CONFLICT_MESSAGE },
      },
    ])
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openEdit(page)
    await page.getByTestId('symbols-edit-note').fill('編集した備考')
    await page.getByTestId('symbols-edit-submit').click()

    await expect(editDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('symbols-edit-error')).toContainText(CONFLICT_MESSAGE)
    // 画面は 409 を特別扱いしない（事前検証の枠には出さない）
    await expect(page.getByTestId('symbols-edit-validation-error')).toBeHidden()

    // 一覧は変わらず、成功メッセージも出ない
    await expect(page.getByTestId('symbols-count')).toHaveText(`${TOTAL} 件`)
    await expect(page.getByTestId('symbols-notice')).toBeHidden()
    await expect(rowsOf(page).first()).not.toContainText('編集した備考')
  })

  test('[SM-27] モーダルを開き直すと前回の理由が消え現在値に戻る', async ({ page }) => {
    await failValidate(page)
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openEdit(page)
    await page.getByTestId('symbols-edit-note').fill('編集した備考')
    await page.getByTestId('symbols-edit-submit').click()
    await expect(page.getByTestId('symbols-edit-validation-error')).toBeVisible()

    await page.getByTestId('symbols-edit-cancel').click()
    await expect(editDialogOf(page)).toBeHidden()
    await openEdit(page)

    await expect(page.getByTestId('symbols-edit-validation-error')).toBeHidden()
    await expect(page.getByTestId('symbols-edit-note')).toHaveValue(firstRow.note)
    await expect(page.getByTestId('symbols-edit-ticker')).toHaveValue(firstRow.ticker)
  })
})

test.describe('銘柄マスタ 削除', () => {
  test('[SM-30] 削除確認は消す対象と取り消せない旨を出す', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openDelete(page)

    // 銘柄コードだけでは何の銘柄か分からないので、一覧で実際に読む 3 点を並べる
    const dialog = deleteDialogOf(page)
    await expect(dialog).toContainText(
      `${firstRow.symbolCode} / ${firstRow.ticker} / ${firstRow.name}`,
    )
    await expect(dialog).toContainText('を削除しますか？')
    await expect(dialog).toContainText('この操作は元に戻せません。')
  })

  test('[SM-31] キャンセルすると何も起きない', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openDelete(page)
    await page.getByTestId('symbols-delete-cancel').click()

    await expect(deleteDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('symbols-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('symbols-notice')).toBeHidden()
  })

  test('[SM-32] 削除するとダイアログが閉じ、件数が 1 減って行が消える', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openDelete(page)
    await page.getByTestId('symbols-delete-submit').click()

    await expect(deleteDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('symbols-notice')).toContainText(
      `${firstRow.symbolCode} / ${firstRow.ticker} / ${firstRow.name} を削除しました。`,
    )

    // 論理削除だが、一覧は取消済みを返さないので消えたように見える
    await expect(page.getByTestId('symbols-count')).toHaveText(`${TOTAL - 1} 件`)
    await expect(page.getByTestId(`symbols-edit-${firstRow.id}`)).toHaveCount(0)

    // 一覧の単方向フローには触らない（削除で URL は変わらない）
    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
  })

  test('[SM-33] 削除に失敗するとダイアログは開いたまま理由を出す', async ({ page }) => {
    await mockApi(page, [
      {
        method: 'delete',
        path: '*/api/masters/symbols/:id',
        status: 500,
        body: { detail: ERROR_MESSAGE },
      },
    ])
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openDelete(page)
    await page.getByTestId('symbols-delete-submit').click()

    await expect(deleteDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('symbols-delete-error')).toContainText(ERROR_MESSAGE)

    // 行も件数も変わらず、成功メッセージも出ない
    await expect(page.getByTestId('symbols-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('symbols-notice')).toBeHidden()
  })

  test('[SM-34] 最終ページの最後の 1 件を消すと 1 ページ戻る', async ({ page }) => {
    // 取引可で絞ると 51 件。2 ページ目は 1 行だけになる
    await page.goto(`${PATH}?regulation=${OPEN_REGULATION}&offset=${PAGE_SIZE}`)
    await expect(rowsOf(page)).toHaveCount(1)

    await openDelete(page, lastPageRow)
    await page.getByTestId('symbols-delete-submit').click()
    await expect(deleteDialogOf(page)).toBeHidden()

    // 空のページに取り残さない。絞り込み条件は残したまま 1 ページ前へ戻す
    await expect(page).toHaveURL(new RegExp(`${PATH}\\?regulation=${OPEN_REGULATION}$`))
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('symbols-count')).toHaveText(
      `${byOpenRegulation.length - 1} 件`,
    )
  })
})

/*
 * VWAP対象を一括で対象外へ（SM-37〜42）。「事前確認（dry-run）→ 実行」の 2 段で、
 * ダイアログを開いた時点で事前確認が走り、何件・どの銘柄が変わるかを実行前に見せる。
 *
 * エラーの出し先は 2 系統（どちらもダイアログ内。入れ物は別）:
 *   事前確認の失敗 … symbols-vwap-bulk-preview-error（件数の代わりに出て、実行させない。SM-40）
 *   実行の失敗     … symbols-vwap-bulk-error（件数を見せたまま理由を出す。SM-41）
 * 事前確認と実行は別パス（/vwap-target/validate と /vwap-target）なので、mockApi() で一方だけを差し替えられる。
 * 対象 0 件は既定モックでは起こせないので、事前確認の応答を差し替えて出しかただけを見る（SM-42）。
 *
 * 既定ハンドラは実行後の値を保持するので、一覧が読み直されて全行「対象外」になるところまで見る。
 * モックの可変状態はページを開き直すと初期化されるため、テスト間で持ち越さない。
 */
test.describe('銘柄マスタ VWAP対象の一括対象外化', () => {
  const previewFailure = (page) =>
    mockApi(page, [
      {
        method: 'post',
        path: '*/api/masters/symbols/vwap-target/validate',
        status: 500,
        body: { detail: ERROR_MESSAGE },
      },
    ])

  test('[SM-37] ボタンを押すと件数と変わる銘柄の一覧が出る', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openVwapBulk(page)

    const dialog = vwapBulkDialogOf(page)
    // 取引可否には触れないことを本文で明記する（画面モックの confirm() の文言）
    await expect(dialog).toContainText(
      'VWAP対象の銘柄をすべて対象外へ変更します。通常注文の取引可否は変更しません。',
    )
    await expect(page.getByTestId('symbols-vwap-bulk-count')).toHaveText(
      `対象 ${vwapTargets.length} 件（有効な銘柄 ${TOTAL} 件中）`,
    )

    // 件数だけでは何が変わるか分からないので、変わる銘柄が並ぶ（銘柄コードの昇順）
    const items = page.getByTestId('symbols-vwap-bulk-list').getByRole('listitem')
    await expect(items).toHaveCount(vwapTargets.length)
    await expect(items.first()).toContainText(vwapTargets[0].symbolCode)
    await expect(items.first()).toContainText(vwapTargets[0].ticker)
    await expect(items.first()).toContainText(vwapTargets[0].name)

    await expect(page.getByTestId('symbols-vwap-bulk-submit')).toHaveText('対象外にする')
    await expect(page.getByTestId('symbols-vwap-bulk-submit')).toBeEnabled()
    await expect(page.getByTestId('symbols-vwap-bulk-cancel')).toBeVisible()
  })

  test('[SM-38] キャンセルすると何も変わらない', async ({ page }) => {
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openVwapBulk(page)
    await expect(page.getByTestId('symbols-vwap-bulk-count')).toBeVisible()
    await page.getByTestId('symbols-vwap-bulk-cancel').click()

    await expect(vwapBulkDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('symbols-count')).toHaveText(`${TOTAL} 件`)
    // 1 行目（フィクスチャでは VWAP対象）はそのまま
    await expect(vwapCellOf(rowsOf(page).first())).toHaveText('対象')
    await expect(page.getByTestId('symbols-notice')).toBeHidden()
  })

  test('[SM-39] 実行すると全行が対象外になり、変わった行に色が付く', async ({ page }) => {
    // 変わる行（対象・自動取込のまま）と、元から対象外で自動取込のままの行を 1 ページ目から選ぶ
    const changedIndex = firstPage.findIndex(
      (row) => row.vwapTarget === VWAP_TARGET_ON && !row.userModified,
    )
    const plainIndex = firstPage.findIndex(
      (row) => row.vwapTarget === VWAP_TARGET && !row.userModified,
    )
    expect(changedIndex).toBeGreaterThanOrEqual(0)
    expect(plainIndex).toBeGreaterThanOrEqual(0)

    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)
    // 実行前は「対象」が混ざっている
    await expect(vwapCellOf(rowsOf(page).nth(changedIndex))).toHaveText('対象')

    await openVwapBulk(page)
    await expect(page.getByTestId('symbols-vwap-bulk-count')).toBeVisible()
    await page.getByTestId('symbols-vwap-bulk-submit').click()

    await expect(vwapBulkDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('symbols-notice')).toHaveText(
      successMessageOf(vwapTargets.length),
    )

    // 件数は変わらず、1 ページ目の全行が「対象外」になる
    const rows = rowsOf(page)
    await expect(page.getByTestId('symbols-count')).toHaveText(`${TOTAL} 件`)
    await expect(rows).toHaveCount(PAGE_SIZE)
    // VWAP対象区分 のセルが「対象外」でない行が 1 つも残らない（has の中の locator は行を起点に探す）
    const stillTargeted = rows.filter({
      hasNot: page.locator('td').nth(COLUMN_INDEX.vwapTarget).filter({ hasText: /^対象外$/ }),
    })
    await expect(stillTargeted).toHaveCount(0)

    // 変わった行には手動操作の印（背景色）が付き、触っていない行とは異なる
    expect(await backgroundColorOf(rows.nth(changedIndex))).not.toBe(
      await backgroundColorOf(rows.nth(plainIndex)),
    )

    // 一覧の単方向フローには触らない（URL は変わらない）
    await expect(page).toHaveURL(new RegExp(`${PATH}$`))

    // 2 ページ目も含めて「対象」が残っていない
    await page.getByTestId('symbols-vwap-target').selectOption(VWAP_TARGET_ON)
    await page.getByTestId('symbols-search-submit').click()
    await expect(page.getByTestId('symbols-empty')).toHaveText('該当する銘柄はありません。')
  })

  test('[SM-40] 事前確認に失敗すると理由が出て実行できない', async ({ page }) => {
    await previewFailure(page)
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openVwapBulk(page)

    await expect(page.getByTestId('symbols-vwap-bulk-preview-error')).toContainText(ERROR_MESSAGE)
    // 件数も一覧も出ず、実行させない
    await expect(page.getByTestId('symbols-vwap-bulk-count')).toHaveCount(0)
    await expect(page.getByTestId('symbols-vwap-bulk-list')).toHaveCount(0)
    await expect(page.getByTestId('symbols-vwap-bulk-submit')).toBeDisabled()
  })

  test('[SM-41] 実行に失敗するとダイアログは開いたまま理由を出す', async ({ page }) => {
    // 事前確認（…/vwap-target/validate）はパスが別なので既定ハンドラのまま通る
    await mockApi(page, [
      {
        method: 'post',
        path: '*/api/masters/symbols/vwap-target',
        status: 500,
        body: { detail: ERROR_MESSAGE },
      },
    ])
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openVwapBulk(page)
    await expect(page.getByTestId('symbols-vwap-bulk-count')).toBeVisible()
    await page.getByTestId('symbols-vwap-bulk-submit').click()

    await expect(vwapBulkDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('symbols-vwap-bulk-error')).toContainText(ERROR_MESSAGE)
    // 件数は見せたまま（事前確認の枠には出さない）
    await expect(page.getByTestId('symbols-vwap-bulk-count')).toBeVisible()
    await expect(page.getByTestId('symbols-vwap-bulk-preview-error')).toHaveCount(0)

    // 一覧は変わらず、成功メッセージも出ない
    await expect(page.getByTestId('symbols-count')).toHaveText(`${TOTAL} 件`)
    await expect(vwapCellOf(rowsOf(page).first())).toHaveText('対象')
    await expect(page.getByTestId('symbols-notice')).toBeHidden()
  })

  test('[SM-42] 対象が 0 件なら実行できない', async ({ page }) => {
    // 既定モックでは起こせないので、事前確認の応答（VwapTargetBulkResponse）を差し替える
    await mockApi(page, [
      {
        method: 'post',
        path: '*/api/masters/symbols/vwap-target/validate',
        body: {
          success: true,
          dry_run: true,
          mode: 'set',
          VWAP対象区分: VWAP_TARGET,
          候補件数: TOTAL,
          対象件数: 0,
          更新件数: 0,
          symbols: [],
          message: '',
        },
      },
    ])
    await page.goto(PATH)
    await expect(rowsOf(page)).toHaveCount(PAGE_SIZE)

    await openVwapBulk(page)

    await expect(page.getByTestId('symbols-vwap-bulk-empty')).toHaveText(
      '対象外へ変更する銘柄はありません（VWAP対象の銘柄が無い）。',
    )
    await expect(page.getByTestId('symbols-vwap-bulk-count')).toHaveCount(0)
    await expect(page.getByTestId('symbols-vwap-bulk-submit')).toBeDisabled()
  })
})
