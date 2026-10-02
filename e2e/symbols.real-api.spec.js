import { expect, test } from '@playwright/test'
import {
  apiContext,
  cleanupMarked,
  fetchAll,
  listHelpers,
  logExchange,
  marker,
  skipUnlessRealApi,
} from './helpers/realApi.js'

/*
 * 銘柄マスタを「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/symbols-real-api.md（タイトル先頭の [SMR-xx] が対応 ID）
 *
 * symbols.spec.js（SM）とは目的が違う。SM は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせだけを見るので、
 * 期待値に**データの中身を書かない**（件数・銘柄コードは実行時に画面か API から読む）。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test symbols.real-api
 *
 * SMR-02 以降は実 DB に登録・更新・削除を行う。ローカルの開発 DB 前提。
 * 試験用の行は銘柄コードの接頭辞（CODE_PREFIX）で見分け、開始時と終了時に有効なものを削除する。
 */

const PATH = '/masters/symbols'
// 実 API のパス（openapi.json）。編集・削除のパスキーは integer の symbol_id（行の ID）
const API_PATH = '/api/masters/symbols'
// 一覧の応答の配列キー（openapi.json の SymbolListResponse.stocks）
const LIST_KEY = 'stocks'

// src/stores/symbols.js の SYMBOLS_PAGE_SIZE（= utils/pagination.js の DEFAULT_PAGE_SIZE）と同じ値。
// ストアは import.meta を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

// DataTable の列順（SymbolListView.vue の columns）。取引可否の列の位置
const REGULATION_COLUMN = 7

/*
 * 試験用の銘柄。銘柄コードは一意な業務コードで削除は論理削除なので、
 * 一度使ったコードを再登録したときの挙動（重複か再有効化か）に入らないよう実行ごとに新しく作る。
 * SymbolRequest の上限は 銘柄コード 14 文字 / Ticker 10 文字。
 * ティッカーコードには '-' を入れない（検索欄は銘柄コードか Ticker の部分一致なので、
 * 'E2E-<値>' で検索したとき試験用の行だけに当たるようにする）。
 */
const CODE_PREFIX = 'E2E-'
const RUN_ID = Date.now().toString(36).toUpperCase().slice(-8)
const TEST_SYMBOL = {
  symbolCode: `${CODE_PREFIX}${RUN_ID}`,
  ticker: `E2E${RUN_ID.slice(-7)}`,
  name: '実 API 接続確認銘柄',
}

// 備考の目印。編集（SMR-09 / 10 / 11）でも接頭辞は保つ
const { value: TEST_NOTE } = marker('銘柄マスタ 実 API 接続確認')
const EDITED_NOTE = `${TEST_NOTE}（変更後）`
const KEEP_NOTE = `${TEST_NOTE}（保持の確認）`
const ALT_NOTE = `${TEST_NOTE}（別経路）`
const CONFLICT_NOTE = `${TEST_NOTE}（画面）`

// SMR-10 の下ごしらえで API から入れる値（画面のフォームが持たない項目。市場名は最大 20 文字）
const SEEDED = { 市場名: 'E2E', 前日出来高: 12345 }

const { settleList, openList, countOf, rowsOf, expectListConsistent } = listHelpers({
  path: PATH,
  testIdPrefix: 'symbols',
})

/** SMR-02 で登録した行の ID（実 API の採番）。SMR-07〜12 が使う */
let createdId = 0

/** 試験用の行（取消済みも含む）。銘柄コードの部分一致で絞ってから接頭辞で選ぶ */
async function fetchTestRows(api) {
  const rows = await fetchAll(api, API_PATH, LIST_KEY, {
    symbol: CODE_PREFIX,
    include_deleted: true,
  })
  return rows.filter((row) => (row.銘柄コード ?? '').startsWith(CODE_PREFIX))
}

/** ID から SymbolItem を引く（取消済みも含む）。無ければ null */
async function findSymbolById(api, id) {
  return (await fetchTestRows(api)).find((row) => row.ID === id) ?? null
}

/** 同じ条件で実 API を直接引いたときの total（画面の件数と突き合わせる） */
async function apiTotal(api, params) {
  const res = await api.get(API_PATH, { params: { ...params, limit: 1, offset: 0 } })
  expect(res.ok(), `実 API から ${API_PATH} を取得できない: ${res.status()}`).toBe(true)
  return (await res.json()).total
}

/**
 * 試験用の有効な行を消す。前回が途中で落ちた残骸もここで片付く。消した銘柄コードを返す（報告用）。
 * パスキーは openapi.json に従って ID。
 */
async function cleanupTestRows(api) {
  const removed = await cleanupMarked(api, {
    list: () => fetchTestRows(api),
    isMarked: (row) => row.取消区分 === 0,
    deletePathOf: (row) => `${API_PATH}/${row.ID}`,
  })
  return removed.map((row) => `${row.銘柄コード}(ID ${row.ID})`)
}

function addDialogOf(page) {
  return page.getByRole('dialog', { name: '銘柄 新規追加' })
}

function editDialogOf(page) {
  return page.getByRole('dialog', { name: '銘柄 編集' })
}

function deleteDialogOf(page) {
  return page.getByRole('dialog', { name: '削除確認' })
}

/** 追加モーダルを開いて必須 3 項目と備考を入れ、送信する */
async function submitAdd(page) {
  await page.getByTestId('symbols-add').click()
  await expect(addDialogOf(page)).toBeVisible()
  await page.getByTestId('symbols-add-symbol-code').fill(TEST_SYMBOL.symbolCode)
  await page.getByTestId('symbols-add-ticker').fill(TEST_SYMBOL.ticker)
  await page.getByTestId('symbols-add-name').fill(TEST_SYMBOL.name)
  await page.getByTestId('symbols-add-note').fill(TEST_NOTE)
  await page.getByTestId('symbols-add-submit').click()
}

/**
 * 試験用の銘柄コードで検索して 1 件に絞る。一覧は銘柄コードの昇順なので、
 * 'E2E-' の行が 1 ページ目に出るとは限らない。行を追いかけずに検索で引く。
 */
async function searchTestSymbol(page) {
  await page.getByTestId('symbols-symbol-code').fill(TEST_SYMBOL.symbolCode)
  await page.getByTestId('symbols-search-submit').click()
  await expect(page).toHaveURL(/symbol_code=/)
  await expect(page.getByTestId('symbols-count')).toHaveText('1 件')
}

/** 一覧を開き、試験用の行だけに絞った状態にする */
async function openTestSymbol(page) {
  await openList(page)
  await searchTestSymbol(page)
}

/** SMR-02 で登録した行（編集ボタンの testid が ID を持つので、それで絞る） */
function createdRowOf(page) {
  return rowsOf(page).filter({ has: page.getByTestId(`symbols-edit-${createdId}`) })
}

/** 編集モーダルを開く */
async function openEdit(page) {
  await page.getByTestId(`symbols-edit-${createdId}`).click()
  await expect(editDialogOf(page)).toBeVisible()
}

/*
 * 画面から送られる更新系の応答を待つ。パスキーの部分は数字に限らず拾う
 * （ID が空なら '/api/masters/symbols/' で終わる。それも捕まえて、原因の判る形で落とす）。
 * 事前検証は POST /api/masters/symbols/validate なので method で分かれる。
 */
function waitForWrite(page, method) {
  return page.waitForResponse(
    (res) =>
      res.request().method() === method && /\/api\/masters\/symbols\/[^/?]*$/.test(res.url()),
  )
}

/** パスキーが行の ID（数字）になっていることを確かめる */
function expectIdPath(res) {
  expect(
    new URL(res.url()).pathname,
    'パスキーが行の ID になっていない（実 API が ID を返していない徴候）',
  ).toBe(`${API_PATH}/${createdId}`)
}

// 登録 → 重複 → 編集 → 項目の保持 → 競合 → 削除 は 1 本の流れなので順に実行する
test.describe.configure({ mode: 'serial' })

test.describe('銘柄マスタ（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test.beforeAll(async ({ playwright }) => {
    const api = await apiContext(playwright)
    const removed = await cleanupTestRows(api)
    if (removed.length > 0) console.log(`[beforeAll] 前回の残骸を削除した: ${removed.join(', ')}`)

    // 実行ごとに作るコードだが、念のため一度も使われていないことを確かめる（論理削除の行も含めて）
    const used = (await fetchTestRows(api)).some((row) => row.銘柄コード === TEST_SYMBOL.symbolCode)
    await api.dispose()
    expect(used, `試験用の銘柄コード ${TEST_SYMBOL.symbolCode} が既に使われている`).toBe(false)
  })

  test.afterAll(async ({ playwright }) => {
    // 試験用の行を有効なまま残さない（論理削除なので行自体は DB に残る）
    const api = await apiContext(playwright)
    const removed = await cleanupTestRows(api)
    if (removed.length > 0) console.log(`[afterAll] 試験用の行を削除した: ${removed.join(', ')}`)
    await api.dispose()
  })

  test('[SMR-01] 実データで一覧が表示される', async ({ page }) => {
    await openList(page)
    await expectListConsistent(page, { pageSize: PAGE_SIZE })
  })

  test('[SMR-02] 新規追加が受理され、件数が 1 増える', async ({ page, playwright }) => {
    await openList(page)
    const before = await countOf(page)

    await submitAdd(page)

    await expect(addDialogOf(page)).toBeHidden()
    const notice = page.getByTestId('symbols-notice')
    await expect(notice).toContainText(TEST_SYMBOL.symbolCode)
    await expect(notice).toContainText('を追加しました。')
    await expect(page.getByTestId('symbols-count')).toHaveText(`${before + 1} 件`)

    // 昇順のどこに入ったかは追わず、銘柄コードで検索して内容を見る
    await searchTestSymbol(page)
    const row = rowsOf(page).first()
    await expect(row).toContainText(TEST_SYMBOL.symbolCode)
    await expect(row).toContainText(TEST_SYMBOL.ticker)
    await expect(row).toContainText(TEST_SYMBOL.name)
    await expect(row).toContainText(TEST_NOTE)

    // API を直接引いても有効な行として存在する。以降のシナリオが使う ID をここで控える
    const api = await apiContext(playwright)
    const created = (await fetchTestRows(api)).find(
      (symbol) => symbol.銘柄コード === TEST_SYMBOL.symbolCode,
    )
    await api.dispose()
    expect(created, '登録した行が実 API の一覧に無い').toBeTruthy()
    expect(created.取消区分).toBe(0)
    expect(Number.isInteger(created.ID), '実 API の一覧が ID を返していない').toBe(true)
    createdId = created.ID
    await expect(createdRowOf(page)).toHaveCount(1)
  })

  test('[SMR-03] 銘柄コードで絞り込むと、実 API と同じ件数になる', async ({ page, playwright }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total === 0, '実 DB に銘柄が 1 件も無いので絞り込みを確かめられない')

    // 期待値は書かず、1 行目に実際に出ている銘柄コードをそのまま条件にする
    const code = (await rowsOf(page).first().locator('td').first().innerText()).trim()
    test.skip(code === '' || code === '—', '1 行目に銘柄コードが無い')

    await page.getByTestId('symbols-symbol-code').fill(code)
    await page.getByTestId('symbols-search-submit').click()

    await expect(page).toHaveURL(/symbol_code=/)
    const filtered = await countOf(page)
    expect(filtered).toBeGreaterThanOrEqual(1)
    expect(filtered).toBeLessThanOrEqual(total)

    // 画面が実 API の `symbol` に載せている（旧名なら無視されて全件になり、ここで食い違う）
    const api = await apiContext(playwright)
    const expected = await apiTotal(api, { symbol: code })
    await api.dispose()
    expect(filtered).toBe(expected)
    await expect(rowsOf(page)).toHaveCount(Math.min(filtered, PAGE_SIZE))

    // 表示された行はすべて銘柄コードかティッカーコードにその値を含む（部分一致・大小は問わない）
    const rows = await rowsOf(page).all()
    for (const row of rows) {
      const cells = row.locator('td')
      const text = `${await cells.nth(0).innerText()} ${await cells.nth(1).innerText()}`
      expect(text.toUpperCase()).toContain(code.toUpperCase())
    }
  })

  test('[SMR-04] 取引可否で絞り込むと、実 API と同じ件数になる', async ({ page, playwright }) => {
    await openList(page)
    const total = await countOf(page)

    // src/utils/symbolTypes.js の REGULATION_OPTIONS（1: 取引不可）
    await page.getByTestId('symbols-regulation').selectOption('1')
    await page.getByTestId('symbols-search-submit').click()

    await expect(page).toHaveURL(/regulation=1/)
    const filtered = await countOf(page)
    expect(filtered).toBeLessThanOrEqual(total)

    const api = await apiContext(playwright)
    const expected = await apiTotal(api, { restriction: '1' })
    await api.dispose()
    expect(filtered).toBe(expected)

    if (filtered === 0) {
      await expect(page.getByTestId('symbols-empty')).toBeVisible()
      return
    }

    // 表示名はサーバが付けて返す（無ければ画面が補う）ので文言は固定せず、全行で揃っていることを見る
    await expect(rowsOf(page)).toHaveCount(Math.min(filtered, PAGE_SIZE))
    const labels = await rowsOf(page).locator(`td:nth-child(${REGULATION_COLUMN + 1})`).allInnerTexts()
    expect(new Set(labels.map((text) => text.trim())).size).toBe(1)
  })

  test('[SMR-05] 預託先区分と VWAP対象区分は組み合わせて効く', async ({ page, playwright }) => {
    await openList(page)
    const total = await countOf(page)

    // src/utils/symbolTypes.js の ORDER_ROUTE_OPTIONS（0: みずほ証券）/ VWAP_TARGET_OPTIONS（0: 対象外）
    await page.getByTestId('symbols-order-route').selectOption('0')
    await page.getByTestId('symbols-vwap-target').selectOption('0')
    await page.getByTestId('symbols-search-submit').click()

    await expect(page).toHaveURL(/order_route=0/)
    await expect(page).toHaveURL(/vwap_target=0/)
    const filtered = await countOf(page)
    expect(filtered).toBeLessThanOrEqual(total)

    const api = await apiContext(playwright)
    const expected = await apiTotal(api, { route: '0', vwap_target: '0' })
    await api.dispose()
    expect(filtered).toBe(expected)

    if (filtered === 0) {
      await expect(page.getByTestId('symbols-empty')).toBeVisible()
    } else {
      await expect(rowsOf(page)).toHaveCount(Math.min(filtered, PAGE_SIZE))
    }
  })

  test('[SMR-06] 「次のページ」で 2 ページ目が実データで出る', async ({ page }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total <= PAGE_SIZE, '1 ページに収まるのでページ送りを確かめられない')

    const pagination = page.getByTestId('symbols-pagination')
    await pagination.getByRole('button', { name: '次のページ' }).click()

    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))
    await settleList(page)
    const last = Math.min(total, PAGE_SIZE * 2)
    await expect(rowsOf(page)).toHaveCount(last - PAGE_SIZE)
    await expect(pagination.getByTestId('pagination-range')).toHaveText(
      `${total} 件中 ${PAGE_SIZE + 1}–${last} 件`,
    )
  })

  test('[SMR-07] 同じ銘柄コードをもう一度追加すると事前検証で弾かれる', async ({ page }) => {
    await openList(page)
    const before = await countOf(page)

    await submitAdd(page)

    // 文言はサーバが決めるので固定しない。出し先が事前検証の枠であることだけを見る
    await expect(page.getByTestId('symbols-add-validation-error')).toBeVisible()
    await expect(page.getByTestId('symbols-add-error')).toHaveCount(0)

    await expect(addDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('symbols-notice')).toHaveCount(0)
    await expect(page.getByTestId('symbols-count')).toHaveText(`${before} 件`)
  })

  test('[SMR-08] 編集フォームの初期値が実 API の値と一致する', async ({ page, playwright }) => {
    const api = await apiContext(playwright)
    const symbol = await findSymbolById(api, createdId)
    await api.dispose()
    expect(symbol, `SMR-02 の行（ID ${createdId}）が実 API に無い`).toBeTruthy()

    await openTestSymbol(page)

    // 行の指定は ID。ここが 'symbols-edit-'（id が空）なら実 API が ID を返していない
    const editButton = rowsOf(page).first().getByRole('button', { name: '編集' })
    await expect(editButton).toHaveAttribute('data-testid', `symbols-edit-${createdId}`)
    await openEdit(page)

    await expect(page.getByTestId('symbols-edit-symbol-code')).toHaveValue(symbol.銘柄コード)
    await expect(page.getByTestId('symbols-edit-ticker')).toHaveValue(symbol.Ticker ?? '')
    await expect(page.getByTestId('symbols-edit-name')).toHaveValue(symbol.銘柄名 ?? '')
    await expect(page.getByTestId('symbols-edit-name-en')).toHaveValue(symbol.銘柄名_英字 ?? '')
    await expect(page.getByTestId('symbols-edit-regulation')).toHaveValue(symbol.規制情報 ?? '')
    await expect(page.getByTestId('symbols-edit-order-route')).toHaveValue(symbol.注文ルート ?? '')
    await expect(page.getByTestId('symbols-edit-vwap-target')).toHaveValue(
      symbol.VWAP対象区分 ?? '',
    )
    await expect(page.getByTestId('symbols-edit-note')).toHaveValue(symbol.備考 ?? '')

    // 業務キーは編集で変えられない（SymbolUpdateRequest が 銘柄コード を持たない）
    await expect(page.getByTestId('symbols-edit-symbol-code')).toHaveJSProperty('readOnly', true)
  })

  test('[SMR-09] 編集が受理され、再読み込みしても残る', async ({ page, playwright }) => {
    const api = await apiContext(playwright)
    let symbol = await findSymbolById(api, createdId)
    expect(symbol, `SMR-02 の行（ID ${createdId}）が実 API に無い`).toBeTruthy()

    /*
     * 合札（更新日時）が null だとフロントは送らず、照合の経路を通らない。
     * そのときは API で一度更新して更新日時を付けてから画面を開く（備考は同じ値で上書きする）。
     */
    if (!symbol.更新日時) {
      const stamp = await api.put(`${API_PATH}/${createdId}`, { data: { 備考: symbol.備考 } })
      expect(stamp.ok(), `下ごしらえの PUT が通らない: ${stamp.status()} ${await stamp.text()}`).toBe(
        true,
      )
      symbol = await findSymbolById(api, createdId)
    }
    await api.dispose()
    expect(symbol.更新日時, '実 API が PUT のあとも 更新日時 を返さない').toBeTruthy()
    const heldUpdatedAt = symbol.更新日時
    console.log(`[SMR-09] 一覧の 更新日時: ${heldUpdatedAt}`)

    await openTestSymbol(page)
    await openEdit(page)
    await page.getByTestId('symbols-edit-note').fill(EDITED_NOTE)

    const putResponse = waitForWrite(page, 'PUT')
    await page.getByTestId('symbols-edit-submit').click()
    const res = await putResponse
    const body = await logExchange('SMR-09', res)

    expectIdPath(res)
    // 一覧で受け取った 更新日時 を、書式を変えずに合札として送っている
    expect(res.request().postDataJSON().更新日時).toBe(heldUpdatedAt)
    expect(res.status(), `実 API が編集を受理しない: ${body}`).toBe(200)

    await expect(editDialogOf(page)).toBeHidden()
    const notice = page.getByTestId('symbols-notice')
    await expect(notice).toContainText(TEST_SYMBOL.symbolCode)
    await expect(notice).toContainText('を更新しました。')
    await expect(page.getByTestId('symbols-count')).toHaveText('1 件')
    await expect(createdRowOf(page)).toContainText(EDITED_NOTE)

    // URL に検索条件が載っているので、再読み込みしても同じ 1 件に絞られる
    await page.reload()
    await settleList(page)
    await expect(createdRowOf(page)).toContainText(EDITED_NOTE)
  })

  test('[SMR-10] 画面が送らない項目は更新しても消えない', async ({ page, playwright }) => {
    const api = await apiContext(playwright)

    // 画面のフォームが持たない 2 項目に、比べられる値を API から入れておく
    const seed = await api.put(`${API_PATH}/${createdId}`, { data: SEEDED })
    expect(seed.ok(), `下ごしらえの PUT が通らない: ${seed.status()} ${await seed.text()}`).toBe(true)
    const before = await findSymbolById(api, createdId)
    expect(before, `SMR-02 の行（ID ${createdId}）が実 API に無い`).toBeTruthy()
    console.log(
      `[SMR-10] 編集前: 市場名=${before.市場名} 前日出来高=${before.前日出来高} Pre区分=${before.Pre区分}`,
    )

    await openTestSymbol(page)
    await openEdit(page)
    await page.getByTestId('symbols-edit-note').fill(KEEP_NOTE)

    const putResponse = waitForWrite(page, 'PUT')
    await page.getByTestId('symbols-edit-submit').click()
    const res = await putResponse
    const body = await logExchange('SMR-10', res)
    expect(res.status(), `実 API が編集を受理しない: ${body}`).toBe(200)
    await expect(editDialogOf(page)).toBeHidden()

    const after = await findSymbolById(api, createdId)
    await api.dispose()
    expect(after.備考).toBe(KEEP_NOTE)
    // 部分更新（SymbolUpdateRequest）なので、本文に無い項目は既存値のまま
    expect(after.市場名, '画面から更新すると 市場名 が消える').toBe(before.市場名)
    expect(after.前日出来高, '画面から更新すると 前日出来高 が消える').toBe(before.前日出来高)
    expect(after.Pre区分, '画面から更新すると Pre区分 が変わる').toBe(before.Pre区分)
  })

  test('[SMR-11] 別経路で先に更新された行は画面から更新できない', async ({ page, playwright }) => {
    const api = await apiContext(playwright)
    const held = await findSymbolById(api, createdId)
    expect(held, `SMR-02 の行（ID ${createdId}）が実 API に無い`).toBeTruthy()

    // 画面を開いた時点の 更新日時 が、編集モーダルの握る合札になる
    await openTestSymbol(page)
    await openEdit(page)

    /*
     * 別経路で同じ行を更新する（合札は送らない = 照合させない）。
     * 更新日時の粒度が秒だと、直前の更新と同じ秒に収まって値が変わらないことがあるので、
     * 変わるまで更新し直す。
     */
    await expect(async () => {
      const res = await api.put(`${API_PATH}/${createdId}`, { data: { 備考: ALT_NOTE } })
      expect(res.ok(), `別経路の PUT が通らない: ${res.status()} ${await res.text()}`).toBe(true)
      const now = await findSymbolById(api, createdId)
      expect(now.更新日時).not.toBe(held.更新日時)
    }).toPass({ intervals: [500, 1000, 1000], timeout: 10_000 })
    const afterAlt = await findSymbolById(api, createdId)
    console.log(`[SMR-11] 画面が握る 更新日時: ${held.更新日時} / 別経路の更新後: ${afterAlt.更新日時}`)

    await page.getByTestId('symbols-edit-note').fill(CONFLICT_NOTE)
    const putResponse = waitForWrite(page, 'PUT')
    await page.getByTestId('symbols-edit-submit').click()
    const res = await putResponse
    const body = await logExchange('SMR-11', res)

    expect(res.status(), `楽観ロックの衝突が拒否されていない: ${body}`).toBe(409)

    // 画面は 409 を特別扱いしない（通信・サーバ障害の枠に出す）
    await expect(page.getByTestId('symbols-edit-error')).toBeVisible()
    await expect(page.getByTestId('symbols-edit-validation-error')).toHaveCount(0)
    await expect(editDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('symbols-notice')).toHaveCount(0)

    // 画面からの上書きは入っていない
    const now = await findSymbolById(api, createdId)
    await api.dispose()
    expect(now.備考).toBe(ALT_NOTE)
  })

  test('[SMR-12] 削除は論理削除で、一覧から消えて取消区分=1 で残る', async ({ page, playwright }) => {
    // 全件の件数を控えてから試験用の行に絞る
    await openList(page)
    const before = await countOf(page)
    await searchTestSymbol(page)

    const deleteButton = rowsOf(page).first().getByRole('button', { name: '削除' })
    await expect(deleteButton).toHaveAttribute('data-testid', `symbols-delete-${createdId}`)
    await deleteButton.click()
    await expect(deleteDialogOf(page)).toBeVisible()

    const deleteResponse = waitForWrite(page, 'DELETE')
    await page.getByTestId('symbols-delete-submit').click()
    const res = await deleteResponse
    const body = await logExchange('SMR-12', res)
    expectIdPath(res)
    expect(res.ok(), `実 API が削除を受理しない: ${body}`).toBe(true)

    await expect(deleteDialogOf(page)).toBeHidden()
    const notice = page.getByTestId('symbols-notice')
    await expect(notice).toContainText(TEST_SYMBOL.symbolCode)
    await expect(notice).toContainText('を削除しました。')
    await expect(page.getByTestId(`symbols-delete-${createdId}`)).toHaveCount(0)

    // 絞り込みを外すと全件が 1 減っている
    await page.getByTestId('symbols-search-clear').click()
    await expect(page.getByTestId('symbols-count')).toHaveText(`${before - 1} 件`)

    const api = await apiContext(playwright)
    const deleted = await findSymbolById(api, createdId)
    const active = await fetchAll(api, API_PATH, LIST_KEY, { symbol: TEST_SYMBOL.symbolCode })
    await api.dispose()

    // 既定の一覧からは消え、include_deleted=true では取消済みとして残る
    expect(active.some((symbol) => symbol.ID === createdId)).toBe(false)
    expect(deleted, 'include_deleted=true でも行が見つからない（物理削除されている）').toBeTruthy()
    expect(deleted.取消区分).toBe(1)
  })
})
