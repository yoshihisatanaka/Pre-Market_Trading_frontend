import { expect, test } from '@playwright/test'
import {
  API_LIMIT_MAX,
  apiContext,
  assertRealApi,
  cleanupMarked,
  fetchAll,
  listHelpers,
  logExchange,
  RESERVED_YEAR,
  skipUnlessRealApi,
} from './helpers/realApi.js'

/*
 * 残高マスタを「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/balance-adjustments-real-api.md（タイトル先頭の [BAR-xx] が対応 ID）
 *
 * balance-adjustments.spec.js（BA）とは目的が違う。BA は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせだけを見るので、
 * 期待値に**データの中身を書かない**（件数・口座番号・銘柄コードは実行時に画面か API から読む）。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test balance-adjustments.real-api
 *
 * BAR-02 と BAR-09 以降は実 DB に登録・更新・論理削除を行う。ローカルの開発 DB 前提。
 * 残高には自由入力欄が無いので、試験用の行は**数量の目印**（QUANTITY_MIN〜QUANTITY_MAX）と
 * 初期残高=null（手動追加）で見分け、開始時と終了時に有効なものを API で削除する
 * （画面に削除の導線は無い）。業務キー（口座番号 × 銘柄コード × 特定預り区分）は
 * 取消済みも含めて一度も使われていない組を beforeAll で 2 組選ぶ。
 */

const PATH = '/masters/balance-adjustments'
// 実 API のパス（openapi.json）。更新・削除のパスキーは integer の balance_id（行の ID）
const API_PATH = '/api/masters/balance-adjustments'
// 一覧の応答の配列キー（openapi.json の BalanceAdjustmentListResponse.balances）
const LIST_KEY = 'balances'

// 顧客の選択肢の取り先（src/stores/customerOptions.js と同じ取りかた）と配列キー（CustomerListResponse.customers）
const CUSTOMERS_API_PATH = '/api/masters/customers'
const CUSTOMERS_LIST_KEY = 'customers'
// 銘柄マスタ。配列キーは SymbolListResponse.stocks（src/api/symbols.js の冒頭コメント）
const SYMBOLS_API_PATH = '/api/masters/symbols'
const SYMBOLS_LIST_KEY = 'stocks'

// src/stores/balanceAdjustments.js の BALANCE_ADJUSTMENTS_PAGE_SIZE と同じ値。
// ストアは import.meta を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

/** 列の並び（src/views/BalanceAdjustmentListView.vue の columns）。セルを列名で引く索引 */
const COLUMNS = [
  '部店',
  '口座番号',
  '扱者',
  '顧客名',
  'ティッカー',
  '銘柄名',
  '口座区分',
  '現在数量',
  '売却不可区分',
  '最終更新',
  '',
]

/*
 * 試験用の行の目印。数量を 2035 年に寄せた範囲（20,350,000〜20,350,999）にし、
 * 初期残高=null（手動追加）かつ 取消区分=0 の行を試験用とみなして後片付けする。
 * 補正（BAR-11 / 12）で動かす値もこの範囲に収めること（外すと後片付けから漏れる）。
 */
const QUANTITY_MIN = RESERVED_YEAR * 10000
const QUANTITY_MAX = QUANTITY_MIN + 999
// BAR-02 の下ごしらえ（売却可否の往復に使う行）の数量
const SEED_QUANTITY = QUANTITY_MIN + 100
// BAR-09 で画面から登録する数量
const NEW_QUANTITY = QUANTITY_MIN + 200
// BAR-11 / 12 で画面から加算する数量
const ADD_QUANTITY = 50
// BAR-12 で別経路（API 直叩き）が入れる補正後の値
const ALT_QUANTITY = QUANTITY_MIN + 300

// 特定預り区分「特定」（src/utils/apiEnums.js の SPECIFIC_DEPOSIT.SPECIFIC。画面の初期選択と同じ）
const DEPOSIT_SPECIFIC = '1'

/** 数量の表示（src/utils/format.js の formatQuantity + 単位） */
const shares = (value) => `${value.toLocaleString('ja-JP')}株`

const { settleList, countOf, rowsOf, expectListConsistent } = listHelpers({
  path: PATH,
  testIdPrefix: 'balance-adjustments',
})

/*
 * 画面はコードマスタ（/codes・/branches・/handlers）と顧客の選択肢が返ってから一覧を読み始め、
 * 実 API は 1 画面の表示に 4 秒前後かかる。helpers の openList は expect 既定の 5 秒で待つため
 * 稀に落ちる（2026-10-05 の検証で BAR-04 が単独でも再現）。permissions.real-api.spec.js と同じく
 * ここだけ延ばす（共通化の候補: openList に待ち時間を渡せるようにする）
 */
const OPEN_TIMEOUT = 20_000

/** 一覧を開いて実 API に当たっていることまで確認する。helpers の openList と同じ手順で、表示の待ちだけ長い */
async function openList(page, query = '') {
  await page.goto(`${PATH}${query}`)
  await expect(page.getByTestId('balance-adjustments-count')).toBeVisible({ timeout: OPEN_TIMEOUT })
  await settleList(page)
  await assertRealApi(page)
}

/**
 * beforeAll が選ぶ試験用の組。どちらも同じ顧客で、銘柄だけ違う。
 * seed は BAR-02 の下ごしらえ、fresh は BAR-09 で画面から登録する組
 * （customer は CustomerItem、symbol は SymbolItem の生の形）
 */
let testCustomer = null
let seedSymbol = null
let freshSymbol = null
/** BAR-02 の下ごしらえで登録した行の ID（実 API の採番） */
let seedId = 0
/** BAR-09 で登録した行の ID（実 API の採番）。BAR-10〜12 が使う */
let createdId = 0

/** 行の中の 1 セル。列名から位置を引く */
function cellOf(row, column) {
  return row.locator('td').nth(COLUMNS.indexOf(column))
}

/** 表の 1 列ぶんのセル（全行） */
function columnOf(page, column) {
  return rowsOf(page).locator(`td:nth-child(${COLUMNS.indexOf(column) + 1})`)
}

/** 数量の目印を持つ試験用の行か（取消済みは含めない） */
function isTestRow(row) {
  return (
    row.取消区分 === 0 &&
    row.初期残高 === null &&
    Number.isInteger(row.残高) &&
    row.残高 >= QUANTITY_MIN &&
    row.残高 <= QUANTITY_MAX
  )
}

/** 口座番号で行を引く（取消済みも含む）。組の使用状況と登録結果の確認に使う */
async function fetchByAccount(api, accountNumber) {
  return fetchAll(api, API_PATH, LIST_KEY, { account_no: accountNumber, include_deleted: true })
}

/** ID から BalanceAdjustmentItem を引く（取消済みも含む）。無ければ null */
async function findById(api, id) {
  return (await fetchByAccount(api, testCustomer.口座番号)).find((row) => row.ID === id) ?? null
}

/** 試験用の組（口座 × 銘柄コード × 特定）の有効な行 */
function activeRowsOf(rows, symbolCode) {
  return rows.filter(
    (row) =>
      row.取消区分 === 0 &&
      row.銘柄コード === symbolCode &&
      String(row.特定預り区分) === DEPOSIT_SPECIFIC,
  )
}

/**
 * 試験用の有効な行を消す。前回が途中で落ちた残骸もここで片付く。消した行を返す（報告用）。
 * 目印は数量なので全件を舐める（絞り込みのクエリに数量は無い）。パスキーは openapi.json に従って ID。
 */
async function cleanupTestRows(api) {
  const removed = await cleanupMarked(api, {
    list: () => fetchAll(api, API_PATH, LIST_KEY, { include_deleted: true }),
    isMarked: isTestRow,
    deletePathOf: (row) => `${API_PATH}/${row.ID}`,
  })
  return removed.map((row) => `${row.口座番号}/${row.銘柄コード}(ID ${row.ID})`)
}

/*
 * 未使用の組を 2 つ選ぶ。顧客は画面のプルダウンと同じ取りかた（limit=200 の 1 ページ目）、
 * 銘柄は銘柄マスタの有効な行（1 ページ目の 200 件）から、その口座で取消済みも含めて
 * 「特定」の行が無い銘柄コードを採る。POST は削除済みの組を再有効化するので、素の新規登録を
 * 見るには一度も使われていない組でなければならない。
 *
 * 画面はティッカー欄の値を大文字にして 銘柄コード として送る（BalanceAdjustmentListView.vue の submitAdd）ので、
 * 小文字を含む銘柄コードは画面から同じ組を指せない。候補から外す。
 */
async function pickUnusedPairs(api) {
  const customersRes = await api.get(CUSTOMERS_API_PATH, {
    params: { limit: API_LIMIT_MAX, offset: 0 },
  })
  expect(customersRes.ok(), `実 API から ${CUSTOMERS_API_PATH} を取得できない`).toBe(true)
  const customers = ((await customersRes.json())[CUSTOMERS_LIST_KEY] ?? []).filter(
    (customer) => customer.取消区分 === 0 && Number.isInteger(customer.口座番号),
  )
  expect(customers.length, '顧客が 1 件も無く、試験用の組を作れない').toBeGreaterThan(0)

  const symbolsRes = await api.get(SYMBOLS_API_PATH, {
    params: { limit: API_LIMIT_MAX, offset: 0 },
  })
  expect(symbolsRes.ok(), `実 API から ${SYMBOLS_API_PATH} を取得できない`).toBe(true)
  const symbols = ((await symbolsRes.json())[SYMBOLS_LIST_KEY] ?? []).filter(
    (symbol) =>
      symbol.取消区分 === 0 &&
      typeof symbol.銘柄コード === 'string' &&
      symbol.銘柄コード !== '' &&
      symbol.銘柄コード === symbol.銘柄コード.toUpperCase(),
  )
  expect(symbols.length, '銘柄マスタに有効な銘柄が無く、試験用の組を作れない').toBeGreaterThan(0)

  for (const customer of customers) {
    const held = await fetchByAccount(api, customer.口座番号)
    const used = new Set(
      held
        .filter((row) => String(row.特定預り区分) === DEPOSIT_SPECIFIC)
        .map((row) => row.銘柄コード),
    )
    const free = symbols.filter((symbol) => !used.has(symbol.銘柄コード))
    if (free.length >= 2) return { customer, seed: free[0], fresh: free[1] }
  }
  throw new Error('どの顧客にも未使用の銘柄が 2 つ無い。試験用の行を DB から整理すること')
}

/** 対象顧客プルダウンの value（src/stores/customerOptions.js の toOptionValue と同じ複合キー） */
function customerOptionValue(customer) {
  return `${customer.部店コード ?? ''}-${customer.口座番号}`
}

/** 画面が成功メッセージと対象銘柄に使う名前（Ticker があればそれ、無ければ銘柄コード） */
function symbolLabelOf(row) {
  return row.Ticker || row.銘柄コード
}

function sellDialogOf(page) {
  return page.getByRole('dialog', { name: '売却可否の変更' })
}

/** 加算モーダル。見出しは入力ステップと確認ステップで変わる */
function increaseDialogOf(page, name = '既存保有への数量加算') {
  return page.getByRole('dialog', { name })
}

/** 新規追加モーダル。見出しは入力ステップと確認ステップで変わる */
function addDialogOf(page, name = '新規保有を追加') {
  return page.getByRole('dialog', { name })
}

/** ID で行を引く（行の操作ボタンの testid が ID を持つので、それで絞る） */
function rowById(page, id) {
  return rowsOf(page).filter({ has: page.getByTestId(`balance-adjustments-sell-${id}`) })
}

/**
 * 試験用の組に絞って一覧を開く。一覧は口座番号 → 銘柄コードの昇順なので 1 ページ目に出るとは限らない。
 * `symbol` は部分一致かもしれないので件数は固定せず、行は ID で引く。
 */
async function openPair(page, symbolCode) {
  await openList(page, `?account_no=${testCustomer.口座番号}&symbol=${symbolCode}`)
}

/** 一覧の取得リクエスト（クエリ名が実 API に届いているかを見る） */
function waitForListRequest(page, query, value) {
  return page.waitForRequest((req) => {
    const url = new URL(req.url())
    return url.pathname === API_PATH && url.searchParams.get(query) === value
  })
}

/** 画面から送られる POST /api/masters/balance-adjustments の応答を待つ */
function waitForPost(page) {
  return page.waitForResponse(
    (res) => res.request().method() === 'POST' && new URL(res.url()).pathname === API_PATH,
  )
}

/*
 * 画面から送られる PUT の応答を待つ。パスキーの部分は数字に限らず拾う
 * （ID が空なら '/api/masters/balance-adjustments/' で終わる。それも捕まえて、原因の判る形で落とす）。
 * suffix は '' （数量の補正）か '/sell-prohibited'（売却可否）
 */
function waitForPut(page, suffix = '') {
  const pattern = new RegExp(`/api/masters/balance-adjustments/[^/?]*${suffix}$`)
  return page.waitForResponse(
    (res) => res.request().method() === 'PUT' && pattern.test(new URL(res.url()).pathname),
  )
}

/**
 * 「新規保有を追加」を開き、試験用の組を入れて確認ステップまで進める。
 * 銘柄名は本文に項目が無く送られない（確認ステップの表示だけ）ので、銘柄マスタの名前をそのまま入れる。
 */
async function fillAddToConfirm(page, symbol) {
  await page.getByTestId('balance-adjustments-add').click()
  const dialog = addDialogOf(page)
  await expect(dialog).toBeVisible()

  // 選択肢は実 API の顧客から来る。beforeAll で選んだ顧客が無ければ噛み合っていない
  const customerSelect = dialog.getByTestId('balance-adjustments-add-customer')
  const optionValue = customerOptionValue(testCustomer)
  await expect(
    customerSelect.locator(`option[value="${optionValue}"]`),
    `対象顧客のプルダウンに ${optionValue} が無い（/masters/customers の 1 ページ目と食い違う）`,
  ).toHaveCount(1)
  await customerSelect.selectOption(optionValue)

  await dialog.getByTestId('balance-adjustments-add-ticker').fill(symbol.銘柄コード)
  await dialog.getByTestId('balance-adjustments-add-symbol-name').fill(symbol.銘柄名 || symbol.銘柄コード)
  // 選択肢はコードマスタ（GET /codes の 特定預り区分）から来る。'1'（特定）が無ければここで落ちる
  await dialog.getByTestId('balance-adjustments-add-deposit').selectOption(DEPOSIT_SPECIFIC)
  await dialog.getByTestId('balance-adjustments-add-quantity').fill(String(NEW_QUANTITY))

  await dialog.getByTestId('balance-adjustments-add-next').click()
  await expect(addDialogOf(page, '残高更新の確認')).toBeVisible()
}

/** 行の「数量を加算」を開き、加算数量を入れて確認ステップまで進める */
async function fillIncreaseToConfirm(page, id) {
  await page.getByTestId(`balance-adjustments-increase-${id}`).click()
  const dialog = increaseDialogOf(page)
  await expect(dialog).toBeVisible()
  await dialog.getByTestId('balance-adjustments-increase-quantity').fill(String(ADD_QUANTITY))
  await dialog.getByTestId('balance-adjustments-increase-next').click()
  await expect(increaseDialogOf(page, '残高更新の確認')).toBeVisible()
}

/** 売却可否の確認で「OK」を押し、画面から送られた本文と応答を返す */
async function submitSell(page, id) {
  await page.getByTestId(`balance-adjustments-sell-${id}`).click()
  await expect(sellDialogOf(page)).toBeVisible()
  const putResponse = waitForPut(page, '/sell-prohibited')
  await sellDialogOf(page).getByTestId('balance-adjustments-sell-submit').click()
  return putResponse
}

// 下ごしらえ → 往復 → 登録 → 重複 → 補正 → 競合 は 1 本の流れなので順に実行する
test.describe.configure({ mode: 'serial' })

test.describe('残高マスタ（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test.beforeAll(async ({ playwright }) => {
    const api = await apiContext(playwright)
    const removed = await cleanupTestRows(api)
    if (removed.length > 0) console.log(`[beforeAll] 前回の残骸を削除した: ${removed.join(', ')}`)

    const pairs = await pickUnusedPairs(api)
    testCustomer = pairs.customer
    seedSymbol = pairs.seed
    freshSymbol = pairs.fresh
    await api.dispose()
    console.log(
      `[beforeAll] 試験用の組: 口座 ${testCustomer.口座番号} × ` +
        `${seedSymbol.銘柄コード}（BAR-02）/ ${freshSymbol.銘柄コード}（BAR-09）× 特定`,
    )
  })

  test.afterAll(async ({ playwright }) => {
    // 試験用の行を有効なまま残さない（論理削除なので行自体は DB に残る）
    const api = await apiContext(playwright)
    const removed = await cleanupTestRows(api)
    if (removed.length > 0) console.log(`[afterAll] 試験用の行を削除した: ${removed.join(', ')}`)
    await api.dispose()
  })

  test('[BAR-01] 実データで一覧が表示される', async ({ page }) => {
    await openList(page)
    await expectListConsistent(page, { pageSize: PAGE_SIZE })
  })

  test('[BAR-02] 売却の停止と解除が実 API に受理され、行と API の値が往復する', async ({
    page,
    playwright,
  }) => {
    // 下ごしらえ: 試験用の保有（売却可）を API で登録する。実データの行は触らない
    const api = await apiContext(playwright)
    const seedRes = await api.post(API_PATH, {
      data: {
        口座番号: testCustomer.口座番号,
        銘柄コード: seedSymbol.銘柄コード,
        特定預り区分: DEPOSIT_SPECIFIC,
        残高: SEED_QUANTITY,
      },
    })
    // API を直接叩いた応答（APIResponse）は logExchange が受けられないので、ここで残す
    const seedBody = await seedRes.text()
    console.log(`[BAR-02 下ごしらえ] POST ${API_PATH}\n  status  : ${seedRes.status()}\n  response: ${seedBody}`)
    expect(seedRes.ok(), `下ごしらえの POST が通らない: ${seedBody}`).toBe(true)

    // 応答の形（BalanceAdjustmentResponse.balance）に頼らず、口座番号で引いて組から ID を特定する
    const seedRows = activeRowsOf(await fetchByAccount(api, testCustomer.口座番号), seedSymbol.銘柄コード)
    expect(seedRows, '下ごしらえの行が実 API の一覧に無い').toHaveLength(1)
    seedId = seedRows[0].ID
    expect(Number.isInteger(seedId), '実 API の一覧が ID を返していない').toBe(true)
    expect(seedRows[0].売却不可区分 ?? 0, '登録直後の行が売却可になっていない').toBe(0)

    await openPair(page, seedSymbol.銘柄コード)
    const row = rowById(page, seedId)
    await expect(row).toHaveCount(1)
    await expect(cellOf(row, '売却不可区分')).toHaveText('売却可')
    const button = page.getByTestId(`balance-adjustments-sell-${seedId}`)
    await expect(button).toHaveText('売却を停止')
    const label = symbolLabelOf(seedRows[0])

    // 停止
    const stopRes = await submitSell(page, seedId)
    const stopBody = await logExchange('BAR-02 停止', stopRes)
    expect(new URL(stopRes.url()).pathname).toBe(`${API_PATH}/${seedId}/sell-prohibited`)
    expect(stopRes.request().postDataJSON().売却不可区分).toBe(1)
    expect(stopRes.status(), `実 API が売却停止を受理しない: ${stopBody}`).toBe(200)

    await expect(sellDialogOf(page)).toBeHidden()
    const notice = page.getByTestId('balance-adjustments-notice')
    await expect(notice).toContainText(`${label} の売却を停止しました。`)
    await expect(cellOf(row, '売却不可区分')).toHaveText('売却不可')
    await expect(button).toHaveText('売却停止を解除')
    expect((await findById(api, seedId)).売却不可区分).toBe(1)

    // 解除
    const resumeRes = await submitSell(page, seedId)
    const resumeBody = await logExchange('BAR-02 解除', resumeRes)
    expect(resumeRes.request().postDataJSON().売却不可区分).toBe(0)
    expect(resumeRes.status(), `実 API が売却停止の解除を受理しない: ${resumeBody}`).toBe(200)

    await expect(sellDialogOf(page)).toBeHidden()
    await expect(notice).toContainText(`${label} の売却停止を解除しました。`)
    await expect(cellOf(row, '売却不可区分')).toHaveText('売却可')
    await expect(button).toHaveText('売却を停止')
    expect((await findById(api, seedId)).売却不可区分).toBe(0)
    await api.dispose()
  })

  test('[BAR-03] 口座番号で絞り込むと account_no が送られ、その口座だけが出る', async ({
    page,
    playwright,
  }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total === 0, '残高が 0 件なので絞り込みを確かめられない')

    const accountNumber = ((await columnOf(page, '口座番号').first().textContent()) ?? '').trim()
    test.skip(!/^\d+$/.test(accountNumber), `1 行目の口座番号が数字でない（${accountNumber}）`)

    const request = waitForListRequest(page, 'account_no', accountNumber)
    await page.getByTestId('balance-adjustments-account-number').fill(accountNumber)
    await page.getByTestId('balance-adjustments-search-submit').click()
    await request

    await expect(page).toHaveURL(new RegExp(`account_no=${accountNumber}(&|$)`))
    const filtered = await countOf(page)
    expect(filtered).toBeGreaterThan(0)
    expect(filtered).toBeLessThanOrEqual(total)

    // 件数表示は API の total と一致する
    const api = await apiContext(playwright)
    const res = await api.get(API_PATH, { params: { account_no: accountNumber, limit: 1, offset: 0 } })
    expect(res.ok()).toBe(true)
    expect((await res.json()).total).toBe(filtered)
    await api.dispose()

    // クエリ名が黙って無視されていれば他の口座が混ざる
    const shown = Math.min(filtered, PAGE_SIZE)
    await expect(rowsOf(page)).toHaveCount(shown)
    await expect(columnOf(page, '口座番号')).toHaveText(Array(shown).fill(accountNumber))
  })

  test('[BAR-04] ティッカーで絞り込むと symbol が送られ、銘柄コードか Ticker に当たる行だけが返る', async ({
    page,
    playwright,
  }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total === 0, '残高が 0 件なので絞り込みを確かめられない')

    // セルは Ticker、無ければ銘柄コード（BalanceAdjustmentListView.vue の #cell-ticker）
    const ticker = ((await columnOf(page, 'ティッカー').first().textContent()) ?? '').trim()
    test.skip(ticker === '' || ticker === '—', '1 行目にティッカーも銘柄コードも無い')

    const request = waitForListRequest(page, 'symbol', ticker)
    await page.getByTestId('balance-adjustments-ticker').fill(ticker)
    await page.getByTestId('balance-adjustments-search-submit').click()
    await request

    await expect(page).toHaveURL(/symbol=/)
    const filtered = await countOf(page)
    expect(filtered).toBeGreaterThan(0)
    expect(filtered).toBeLessThanOrEqual(total)
    await expect(rowsOf(page)).toHaveCount(Math.min(filtered, PAGE_SIZE))

    // 件数表示は API の total と一致し、返った行はすべて銘柄コードか Ticker に条件を含む（大文字小文字は問わない）
    const api = await apiContext(playwright)
    const matched = await fetchAll(api, API_PATH, LIST_KEY, { symbol: ticker })
    await api.dispose()
    expect(matched).toHaveLength(filtered)
    const needle = ticker.toUpperCase()
    for (const row of matched) {
      const haystack = `${row.銘柄コード ?? ''}\n${row.Ticker ?? ''}`.toUpperCase()
      expect(haystack, `symbol=${ticker} の結果に当たらない行がある: ${row.銘柄コード}`).toContain(
        needle,
      )
    }
  })

  test('[BAR-05] 顧客名で絞り込むと customer_name が送られ、名前かカナに当たる行だけが返る', async ({
    page,
    playwright,
  }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total === 0, '残高が 0 件なので絞り込みを確かめられない')

    // 顧客マスタに無い口座の行（開発 DB の手入力データ）は顧客名が空なので、1 ページ目から名前のある行を選ぶ
    const names = (await columnOf(page, '顧客名').allTextContents()).map((text) => text.trim())
    const name = names.find((text) => text !== '' && text !== '—') ?? ''
    test.skip(name === '', '1 ページ目に顧客名のある行が無い')

    const request = waitForListRequest(page, 'customer_name', name)
    await page.getByTestId('balance-adjustments-customer-name').fill(name)
    await page.getByTestId('balance-adjustments-search-submit').click()
    await request

    await expect(page).toHaveURL(/customer_name=/)
    const filtered = await countOf(page)
    expect(filtered).toBeGreaterThan(0)
    expect(filtered).toBeLessThanOrEqual(total)
    await expect(rowsOf(page)).toHaveCount(Math.min(filtered, PAGE_SIZE))

    const api = await apiContext(playwright)
    const matched = await fetchAll(api, API_PATH, LIST_KEY, { customer_name: name })
    await api.dispose()
    expect(matched).toHaveLength(filtered)
    for (const row of matched) {
      const haystack = `${row.顧客名 ?? ''}\n${row.顧客名カナ ?? ''}`
      expect(
        haystack,
        `customer_name=${name} の結果に当たらない行がある: ${row.口座番号}`,
      ).toContain(name)
    }
  })

  test('[BAR-06] 部店で絞り込むと branch_code が送られ、その部店の行だけが出る', async ({ page }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total === 0, '残高が 0 件なので絞り込みを確かめられない')

    /*
     * 選択肢は部店マスタ（GET /branches）から来る。開発 DB には部店マスタに無い部店コードの残高行がある
     * （2026-10-05 時点で 001。/branches は 100〜103 だけ）ので、1 ページ目から選択肢にある部店の行を選ぶ
     */
    const select = page.getByTestId('balance-adjustments-branch-code')
    const options = await select.locator('option').evaluateAll((els) => els.map((el) => el.value))
    const branchCodes = (await columnOf(page, '部店').allTextContents()).map((text) => text.trim())
    const branchCode = branchCodes.find((code) => code !== '' && options.includes(code)) ?? ''
    test.skip(branchCode === '', '1 ページ目に部店マスタの選択肢にある部店の行が無い')

    const request = waitForListRequest(page, 'branch_code', branchCode)
    await select.selectOption(branchCode)
    await page.getByTestId('balance-adjustments-search-submit').click()
    await request

    await expect(page).toHaveURL(new RegExp(`branch_code=${branchCode}(&|$)`))
    const filtered = await countOf(page)
    expect(filtered).toBeGreaterThan(0)
    expect(filtered).toBeLessThanOrEqual(total)

    const shown = Math.min(filtered, PAGE_SIZE)
    await expect(rowsOf(page)).toHaveCount(shown)
    await expect(columnOf(page, '部店')).toHaveText(Array(shown).fill(branchCode))
  })

  test('[BAR-07] 銘柄名で絞り込むと symbol_name_ja が送られ、銘柄名（日本語）に当たる行だけが返る', async ({
    page,
    playwright,
  }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total === 0, '残高が 0 件なので絞り込みを確かめられない')

    /*
     * 銘柄名列は API の 銘柄名（m_銘柄情報 の日本語名）をそのまま出す（BalanceAdjustmentListView.vue の
     * #cell-symbolName。英字名は出さない）。銘柄マスタに無い銘柄の行は空（—）なので、名前のある行を選ぶ
     */
    const names = (await columnOf(page, '銘柄名').allTextContents()).map((text) => text.trim())
    const name = names.find((text) => text !== '' && text !== '—') ?? ''
    test.skip(name === '', '1 ページ目に銘柄名のある行が無い')

    // 画面の URL は symbol_name、実 API へは symbol_name_ja で送る（src/api/balanceAdjustments.js の冒頭コメント 1 番）
    const request = waitForListRequest(page, 'symbol_name_ja', name)
    await page.getByTestId('balance-adjustments-symbol-name').fill(name)
    await page.getByTestId('balance-adjustments-search-submit').click()
    const sent = await request
    console.log(`[BAR-07] GET ${new URL(sent.url()).pathname}${new URL(sent.url()).search}`)

    await expect(page).toHaveURL(/symbol_name=/)
    const filtered = await countOf(page)
    expect(filtered).toBeGreaterThan(0)
    expect(filtered).toBeLessThanOrEqual(total)
    await expect(rowsOf(page)).toHaveCount(Math.min(filtered, PAGE_SIZE))

    // 件数表示は API の total と一致し、返った行はすべて銘柄名（日本語）に条件を含む
    const api = await apiContext(playwright)
    const matched = await fetchAll(api, API_PATH, LIST_KEY, { symbol_name_ja: name })
    await api.dispose()
    console.log(`[BAR-07] symbol_name_ja=${name}: 全件 ${total} → ${matched.length} 件`)
    expect(matched).toHaveLength(filtered)
    for (const row of matched) {
      expect(
        row.銘柄名 ?? '',
        `symbol_name_ja=${name} の結果に当たらない行がある: ${row.口座番号}/${row.銘柄コード}`,
      ).toContain(name)
    }
  })

  test('[BAR-08] 「次のページ」で 2 ページ目が実データで出る', async ({ page }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total <= PAGE_SIZE, '1 ページに収まるのでページ送りを確かめられない')

    const pagination = page.getByTestId('balance-adjustments-pagination')
    await pagination.getByRole('button', { name: '次のページ' }).click()

    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))
    await settleList(page)
    const last = Math.min(total, PAGE_SIZE * 2)
    await expect(rowsOf(page)).toHaveCount(last - PAGE_SIZE)
    await expect(pagination.getByTestId('pagination-range')).toHaveText(
      `${total} 件中 ${PAGE_SIZE + 1}–${last} 件`,
    )
  })

  test('[BAR-09] 新規保有の追加が受理され、件数が 1 増える', async ({ page, playwright }) => {
    await openList(page)
    const before = await countOf(page)

    await fillAddToConfirm(page, freshSymbol)
    const postResponse = waitForPost(page)
    await page.getByTestId('balance-adjustments-add-submit').click()
    const res = await postResponse
    const body = await logExchange('BAR-09', res)

    // 送った本文は 口座番号（integer）・銘柄コード・特定預り区分・残高 を持つ（BalanceAdjustmentRequest）
    const sent = res.request().postDataJSON()
    expect(sent.口座番号).toBe(testCustomer.口座番号)
    expect(sent.銘柄コード).toBe(freshSymbol.銘柄コード)
    expect(String(sent.特定預り区分)).toBe(DEPOSIT_SPECIFIC)
    expect(sent.残高).toBe(NEW_QUANTITY)
    expect(res.ok(), `実 API が新規保有の追加を受理しない: ${body}`).toBe(true)

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('balance-adjustments-notice')).toContainText(
      `${freshSymbol.銘柄コード} の保有を追加しました。`,
    )
    await expect(page.getByTestId('balance-adjustments-count')).toHaveText(`${before + 1} 件`)

    // API を直接引いても有効な行として存在する。以降のシナリオが使う ID をここで控える
    const api = await apiContext(playwright)
    const rows = activeRowsOf(await fetchByAccount(api, testCustomer.口座番号), freshSymbol.銘柄コード)
    await api.dispose()
    expect(rows, '登録した組の有効な行が 1 件でない').toHaveLength(1)
    const created = rows[0]
    expect(Number.isInteger(created.ID), '実 API の一覧が ID を返していない').toBe(true)
    createdId = created.ID
    expect(created.初期残高, '手動追加の行なのに 初期残高 が null でない').toBeNull()
    expect(created.ユーザー操作フラグ).toBe(1)
    expect(created.残高).toBe(NEW_QUANTITY)
  })

  test('[BAR-10] 同じ組をもう一度追加すると拒否され、件数は変わらない', async ({
    page,
    playwright,
  }) => {
    await openList(page)
    const before = await countOf(page)

    await fillAddToConfirm(page, freshSymbol)
    const postResponse = waitForPost(page)
    await page.getByTestId('balance-adjustments-add-submit').click()
    const res = await postResponse
    const body = await logExchange('BAR-10', res)

    expect(res.status(), `重複の登録が拒否されていない: ${body}`).toBeGreaterThanOrEqual(400)
    expect(res.status(), `重複がサーバ障害として返っている: ${body}`).toBeLessThan(500)

    // 文言はサーバが決めるので固定しない。確認ステップのまま通信・サーバ障害の枠に出ることだけを見る
    const dialog = addDialogOf(page, '残高更新の確認')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('balance-adjustments-add-error')).toBeVisible()
    await expect(dialog.getByTestId('balance-adjustments-add-confirm')).toBeVisible()
    await expect(page.getByTestId('balance-adjustments-notice')).toHaveCount(0)
    await expect(page.getByTestId('balance-adjustments-count')).toHaveText(`${before} 件`)

    const api = await apiContext(playwright)
    const rows = activeRowsOf(await fetchByAccount(api, testCustomer.口座番号), freshSymbol.銘柄コード)
    await api.dispose()
    expect(rows, '重複の登録で有効な行が増えている').toHaveLength(1)
  })

  test('[BAR-11] 数量の加算が補正後の絶対値で送られ、再読み込みしても残る', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright)
    const held = await findById(api, createdId)
    expect(held, `BAR-09 の行（ID ${createdId}）が実 API に無い`).toBeTruthy()
    const after = held.残高 + ADD_QUANTITY
    const label = symbolLabelOf(held)

    await openPair(page, freshSymbol.銘柄コード)
    const row = rowById(page, createdId)
    await expect(row).toHaveCount(1)
    await expect(cellOf(row, '現在数量')).toHaveText(shares(held.残高))

    await fillIncreaseToConfirm(page, createdId)
    const putResponse = waitForPut(page)
    await page.getByTestId('balance-adjustments-increase-submit').click()
    const res = await putResponse
    const body = await logExchange('BAR-11', res)

    expect(
      new URL(res.url()).pathname,
      'パスキーが行の ID になっていない（実 API が ID を返していない徴候）',
    ).toBe(`${API_PATH}/${createdId}`)
    // 送るのは加算数量ではなく補正後の絶対値（実 API に加算の概念は無い）
    expect(res.request().postDataJSON().残高).toBe(after)
    expect(res.status(), `実 API が数量の補正を受理しない: ${body}`).toBe(200)

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('balance-adjustments-notice')).toContainText(
      `${label} の残高を ${shares(after)} に更新しました。`,
    )
    await expect(cellOf(row, '現在数量')).toHaveText(shares(after))

    // URL に検索条件が載っているので、再読み込みしても同じ組に絞られる
    await page.reload()
    await expect(page.getByTestId('balance-adjustments-count')).toBeVisible({ timeout: OPEN_TIMEOUT })
    await settleList(page)
    await expect(cellOf(rowById(page, createdId), '現在数量')).toHaveText(shares(after))

    const now = await findById(api, createdId)
    await api.dispose()
    expect(now.残高).toBe(after)
  })

  test('[BAR-12] 別経路で先に補正された行は画面から補正できない', async ({ page, playwright }) => {
    const api = await apiContext(playwright)
    let held = await findById(api, createdId)
    expect(held, `BAR-09 の行（ID ${createdId}）が実 API に無い`).toBeTruthy()

    /*
     * 合札（更新日時）が null だとフロントは送らず、照合の経路を通らない。
     * そのときは API で一度補正して更新日時を付けてから画面を開く（残高は同じ値で上書きする）。
     */
    if (!held.更新日時) {
      const stamp = await api.put(`${API_PATH}/${createdId}`, { data: { 残高: held.残高 } })
      expect(stamp.ok(), `下ごしらえの PUT が通らない: ${stamp.status()} ${await stamp.text()}`).toBe(
        true,
      )
      held = await findById(api, createdId)
    }
    expect(held.更新日時, '実 API が PUT のあとも 更新日時 を返さない').toBeTruthy()

    // 画面を開いた時点の 更新日時 が、加算モーダルの握る合札になる
    await openPair(page, freshSymbol.銘柄コード)
    await expect(rowById(page, createdId)).toHaveCount(1)
    await fillIncreaseToConfirm(page, createdId)

    /*
     * 別経路で同じ行を補正する（合札は送らない = 照合させない）。
     * 更新日時の粒度が秒だと、直前の更新と同じ秒に収まって値が変わらないことがあるので、
     * 変わるまで更新し直す。
     */
    await expect(async () => {
      const res = await api.put(`${API_PATH}/${createdId}`, { data: { 残高: ALT_QUANTITY } })
      expect(res.ok(), `別経路の PUT が通らない: ${res.status()} ${await res.text()}`).toBe(true)
      const now = await findById(api, createdId)
      expect(now.更新日時).not.toBe(held.更新日時)
    }).toPass({ intervals: [500, 1000, 1000], timeout: 10_000 })

    const putResponse = waitForPut(page)
    await page.getByTestId('balance-adjustments-increase-submit').click()
    const res = await putResponse
    const body = await logExchange('BAR-12', res)

    expect(res.request().postDataJSON().更新日時).toBe(held.更新日時)
    expect(res.status(), `楽観ロックの衝突が拒否されていない: ${body}`).toBe(409)

    // 画面は 409 を特別扱いしない（確認ステップのまま通信・サーバ障害の枠に出す）
    const dialog = increaseDialogOf(page, '残高更新の確認')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('balance-adjustments-increase-error')).toBeVisible()
    await expect(dialog.getByTestId('balance-adjustments-increase-confirm')).toBeVisible()
    await expect(page.getByTestId('balance-adjustments-notice')).toHaveCount(0)

    // 画面からの上書きは入っていない
    const now = await findById(api, createdId)
    await api.dispose()
    expect(now.残高).toBe(ALT_QUANTITY)
  })
})
