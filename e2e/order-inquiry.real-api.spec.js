import { expect, test } from '@playwright/test'
import { formatQuantity } from '../src/utils/format'
import { listHelpers, skipUnlessRealApi } from './helpers/realApi.js'

/*
 * 注文照会と、そこから入る注文訂正・注文取消を「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/order-inquiry-real-api.md（タイトル先頭の [OIR-xx] が対応 ID）
 *
 * order-inquiry.spec.js（OI）/ order-amend.spec.js（OAM）/ order-cancel.spec.js（OCN）とは目的が違う。
 * あちらは MSW のモックに当てて画面の挙動を細かく固定する。こちらはフロントとバックエンドの噛み合わせ
 * （件数と行数の関係・クエリ名の変換・訂正/取消画面の初期値）だけを見るので、期待値に**データの中身を書かない**。
 * 絞り込みの値は、開いた時点（条件なし）に画面自身が受け取った GET /orders の応答から読む
 * （テストから API を直接引くと X-User-Code が画面と違い、部店の限定で見える注文が変わるため）。
 * 0 件・値が空ならその行はスキップする。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test order-inquiry.real-api
 *
 * このファイルは実 DB に書き込まない（GET だけ）。訂正・取消の画面は開いて初期値を見るだけで、
 * 「訂正を登録」「取消を確定」は押さない（書き込みの行 OIR-02 / OIR-12 は文書の理由で保留）。
 */

const PATH = '/orders/inquiry'
// 実 API のパス（openapi.json）。dev サーバの /api プロキシ越しに届く
const API_PATH = '/api/orders'
const AUTH_ME_PATH = '/api/auth/me'
// 注文詳細（GET /orders/{order_id}）。/api/orders/inquiry は画面の path であって API ではない
const DETAIL_PATH = /^\/api\/orders\/(\d+)$/

// src/stores/orderInquiry.js の ORDER_INQUIRY_PAGE_SIZE（= utils/pagination.js の DEFAULT_PAGE_SIZE）と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

/** 絞り込みのクエリ名（実 API 側。src/api/orderInquiry.js の fetchOrderInquiry） */
const FILTER_QUERIES = ['branch_code', 'account_no', 'symbol', 'status']

/** 列の並び（src/components/orders/OrderInquiryTable.vue の COLUMNS） */
const COLUMNS = [
  '注文ID',
  '部店',
  '口座番号',
  '顧客名',
  '銘柄',
  '売買',
  '数量',
  '指値／成行',
  '価格',
  '出来数量',
  '未出来残数量',
  '約定代金（USD）',
  '約定代金（円貨）',
  '市場区分',
  '出来状況',
  '強制',
  '送信日時',
  '受注日時',
  '操作',
]

/*
 * 取消・訂正を受け付ける 処理状況（src/api/orderInquiry.js の CANCELABLE / AMENDABLE の写し。
 * 出典は POST /orders/{order_id}/cancel・/amend の説明）。行の操作ボタンの出し分けと、
 * 訂正・取消画面を開く行の選定に使う。
 */
const CANCELABLE = new Set(['000', '003', '010', '131', '133', '101', '103', '141'])
const AMENDABLE = new Set(['000', '003', '010'])

/*
 * 処理状況コード → 名前。src/utils/orderTypes.js の ORDER_STATUS_NAMES の写し。
 * あのファイルは '@/utils/format' を import しており Playwright から読めないので再掲する。
 * 訂正・取消画面の状況バッジは、知らないコードをコードのまま出す。
 */
const STATUS_NAMES = {
  '000': '未発注',
  '002': 'IB発注中',
  '003': '注文中',
  '004': 'VWAP集計済み',
  '010': '一部出来',
  '011': '全部出来',
  '020': '不出来',
  '030': '未取消',
  '031': 'IB取消中',
  '032': 'IB取消済',
  '033': 'Dream取消中',
  '034': '取消済',
  101: 'Dream発注失敗',
  103: 'IB発注失敗',
  '040': '訂正待ち',
  131: 'IB取消失敗',
  133: 'Dream取消失敗',
  141: '訂正中断',
}

/** 指成区分 → 訂正画面の「価格」のボタン名（src/utils/orderTypes.js の ORDER_TYPE_OPTIONS） */
const ORDER_TYPE_LABELS = { MO: '成行', LO: '指値' }

// スライス子注文を表す 注文種別（src/api/orderInquiry.js の SLICE_CHILD）
const SLICE_CHILD = 'SLICE_CHILD'

// 値が無いときの表示
const EMPTY_CELL = '—'

const { openList, countOf, settleList } = listHelpers({
  path: PATH,
  testIdPrefix: 'order-inquiry',
})

/** 表の元注文の行。order-inquiry-row は表にスコープを切る（訂正履歴の行は別の testid） */
function rowsOf(page) {
  return page.getByTestId('order-inquiry-table').getByTestId('order-inquiry-row')
}

/** 行の中の、列名で指したセル */
function cellOf(row, column) {
  return row.getByRole('cell').nth(COLUMNS.indexOf(column))
}

/** 表の 1 列ぶんのセル（全行） */
function columnOf(page, column) {
  return rowsOf(page).locator(`td:nth-child(${COLUMNS.indexOf(column) + 1})`)
}

/** 行の 処理状況（文字列。無ければ空） */
const statusOf = (raw) => String(raw?.処理状況 ?? '')

/** 注文 ID の昇順に並べた新しい配列 */
const sortById = (rows) => [...rows].sort((a, b) => Number(a.ID) - Number(b.ID))

/**
 * 応答の生の行（OrderItemResponse）を元注文ごとのまとまりに畳む。
 * 規則は src/api/orderInquiry.js の groupOrders と同じ（api 層は Playwright から import できないので再掲）:
 *   - まとまりの鍵は `元注文ID`（無ければ自分の ID）。並びはまとまりが最初に現れた位置
 *   - 各まとまりの行は最新の版（ID が最大の非子注文）の内容を出す
 *   - 子注文（`注文種別` が 'SLICE_CHILD'）だけが当たったまとまりは、子注文を 1 件ずつ行にする
 *
 * @param {object[]} rows
 * @returns {{ id: string, latest: object }[]} 画面の行の並びで、id は注文ID 列に出る値
 */
function groupsOf(rows) {
  const groups = new Map()
  for (const raw of rows) {
    const rootId = String(raw?.元注文ID ?? raw?.ID ?? '')
    if (!groups.has(rootId)) groups.set(rootId, { versions: [], slices: [] })
    const group = groups.get(rootId)
    if (raw?.注文種別 === SLICE_CHILD) group.slices.push(raw)
    else group.versions.push(raw)
  }

  return [...groups].flatMap(([id, group]) => {
    if (group.versions.length === 0) {
      return sortById(group.slices).map((slice) => ({ id: String(slice.ID), latest: slice }))
    }
    const versions = sortById(group.versions)
    return [{ id, latest: versions.at(-1) }]
  })
}

/** 絞り込みのクエリが 1 つも載っていないか */
function isUnfiltered(url) {
  return FILTER_QUERIES.every((query) => !url.searchParams.has(query))
}

/** 実 API の GET のうち、パスが合い、条件（URL を受ける関数）を満たすものの応答を待つ */
function waitForApi(page, pathname, matches = () => true) {
  return page.waitForResponse((res) => {
    const url = new URL(res.url())
    return url.pathname === pathname && matches(url)
  })
}

/** クエリの値が合う GET /orders の応答を待つ */
function waitForList(page, query, value) {
  return waitForApi(page, API_PATH, (url) => url.searchParams.get(query) === value)
}

/** 注文詳細（GET /orders/{id}）の応答を待つ */
function waitForDetail(page, id) {
  return page.waitForResponse((res) => {
    const match = DETAIL_PATH.exec(new URL(res.url()).pathname)
    return match !== null && match[1] === String(id)
  })
}

/**
 * 注文照会を開き、画面が受け取った条件なしの GET /orders の応答を返す。
 * 絞り込みの値はここから読む（テストから API を直接引かない理由はファイル冒頭）
 */
async function openAndCapture(page) {
  const response = waitForApi(page, API_PATH, isUnfiltered)
  await openList(page)
  const res = await response
  expect(res.ok(), `${API_PATH} が ${res.status()} を返した`).toBe(true)
  const body = await res.json()
  const rows = Array.isArray(body.orders) ? body.orders : []
  return { body, rows, groups: groupsOf(rows), total: await countOf(page), first: rows[0] ?? null }
}

/** 開いて、0 件ならスキップする */
async function openOrSkip(page) {
  const opened = await openAndCapture(page)
  test.skip(opened.total === 0 || !opened.first, '注文が 0 件なので絞り込みを確かめられない')
  return opened
}

/** 「検索」を押して、条件に合う応答と描画を待ち、応答の本文を返す */
async function submit(page, response) {
  await page.getByTestId('order-inquiry-search-submit').click()
  const res = await response
  expect(res.ok(), `${API_PATH} が ${res.status()} を返した`).toBe(true)
  await settleList(page)
  return res.json()
}

/** URL（画面）のクエリの値 */
function urlQuery(page, name) {
  return new URL(page.url()).searchParams.get(name)
}

/**
 * 表の行が応答と食い違わないことを見る。行数はまとまりの数で、注文ID 列は先頭から順に起点の ID。
 * '#3' が '#30' に当たらないよう、数字の続かない位置で止める
 */
async function expectRowsMatch(page, groups) {
  await expect(rowsOf(page)).toHaveCount(groups.length)
  for (const [index, group] of groups.entries()) {
    await expect(cellOf(rowsOf(page).nth(index), '注文ID')).toContainText(
      new RegExp(`#${group.id}(?!\\d)`),
    )
  }
}

/** 絞り込んだあとの共通の期待値。件数が 1 以上かつ全件以下で、エラーが出ていない */
async function expectNarrowed(page, total) {
  const filtered = await countOf(page)
  expect(filtered).toBeGreaterThan(0)
  expect(filtered).toBeLessThanOrEqual(total)
  await expect(page.getByTestId('order-inquiry-error')).toHaveCount(0)
  return filtered
}

/** 一覧の 1 行目から、訂正（または取消）のボタンが出る最初の行を選ぶ。無ければ -1 */
function firstActionableIndex(groups, allowed) {
  return groups.findIndex((group) => allowed.has(statusOf(group.latest)))
}

/** 数値か数値の文字列（decimal の直列化 '410.0000'）→ 数値。それ以外は null */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

test.describe('注文照会・注文訂正・注文取消（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test('[OIR-01] 開くと条件なしで GET /orders が送られ、件数は total・行数はまとまりの数と一致する', async ({
    page,
  }) => {
    const { body, groups, total } = await openAndCapture(page)

    // 件数表示はサーバの total（注文の行数）。表の行は元注文ごとのまとまりなので、行数とは一致しない
    expect(body.total).toBe(total)
    await expect(page.getByTestId('order-inquiry-error')).toHaveCount(0)

    if (total === 0) {
      await expect(page.getByTestId('order-inquiry-empty')).toBeVisible()
      await expect(page.getByTestId('order-inquiry-table')).toHaveCount(0)
      return
    }

    await expect(page.getByTestId('order-inquiry-table')).toBeVisible()
    await expect(page.getByTestId('order-inquiry-pagination')).toBeVisible()
    expect(groups.length).toBeGreaterThan(0)
    expect(groups.length).toBeLessThanOrEqual(Math.min(total, PAGE_SIZE))
    await expectRowsMatch(page, groups)
  })

  test('[OIR-03] 1 行目の銘柄で絞り込むと、その銘柄の注文だけが出る', async ({ page }) => {
    const { total } = await openOrSkip(page)

    // 銘柄の列は 銘柄コード（src/api/orderInquiry.js の toOrder）。symbol は銘柄コードか Ticker の一致
    const symbol = ((await columnOf(page, '銘柄').first().textContent()) ?? '').trim()
    test.skip(symbol === '' || symbol === EMPTY_CELL, '1 行目の銘柄が空')

    await page.getByTestId('order-inquiry-symbol').fill(symbol)
    const body = await submit(page, waitForList(page, 'symbol', symbol))

    expect(urlQuery(page, 'symbol')).toBe(symbol)
    await expectNarrowed(page, total)
    // クエリが黙って無視されていれば他の銘柄が混ざる
    for (const raw of body.orders) expect(raw.銘柄コード, `応答に ${symbol} 以外の行がある`).toBe(symbol)
    const groups = groupsOf(body.orders)
    await expect(rowsOf(page)).toHaveCount(groups.length)
    await expect(columnOf(page, '銘柄')).toHaveText(Array(groups.length).fill(symbol))
  })

  test('[OIR-04] 1 行目の口座番号で絞り込むと account_no が送られ、その口座だけが出る', async ({
    page,
  }) => {
    const { total } = await openOrSkip(page)

    const accountNumber = ((await columnOf(page, '口座番号').first().textContent()) ?? '').trim()
    test.skip(!/^\d+$/.test(accountNumber), `1 行目の口座番号が数字でない（${accountNumber}）`)

    // 画面の URL は account_number、実 API へは account_no（src/api/orderInquiry.js が変換する）
    await page.getByTestId('order-inquiry-account-number').fill(accountNumber)
    const body = await submit(page, waitForList(page, 'account_no', accountNumber))

    expect(urlQuery(page, 'account_number')).toBe(accountNumber)
    await expectNarrowed(page, total)
    const groups = groupsOf(body.orders)
    await expect(rowsOf(page)).toHaveCount(groups.length)
    await expect(columnOf(page, '口座番号')).toHaveText(Array(groups.length).fill(accountNumber))
  })

  test('[OIR-05] 先頭の注文の部店で絞り込むと、実 API へ branch_code が送られ、その部店だけが出る', async ({
    page,
  }) => {
    const { total, first } = await openOrSkip(page)

    const branchCode = String(first.部店 ?? '')
    test.skip(branchCode === '', '先頭の注文の部店が空')

    await page.getByTestId('order-inquiry-branch-code').fill(branchCode)
    const body = await submit(page, waitForList(page, 'branch_code', branchCode))

    expect(urlQuery(page, 'branch_code')).toBe(branchCode)
    // 他店の指定は 403 になるが、見えている注文の部店なので通る
    await expectNarrowed(page, total)
    const groups = groupsOf(body.orders)
    await expect(rowsOf(page)).toHaveCount(groups.length)
    await expect(columnOf(page, '部店')).toHaveText(Array(groups.length).fill(branchCode))
  })

  test('[OIR-06] 先頭の注文の処理状況で絞り込むと、その処理状況の行だけが返り、まとまりの数と行数が合う', async ({
    page,
  }) => {
    const { total, first } = await openOrSkip(page)

    const code = statusOf(first)
    // 選択肢はコードマスタ `注文照会出来状況` から来る（2026-10-06 に実 API の /codes に入った）。無ければ選べない
    const select = page.getByTestId('order-inquiry-status')
    const options = await select.locator('option').evaluateAll((els) => els.map((el) => el.value))
    test.skip(code === '' || !options.includes(code), `出来状況のプルダウンに ${code} が無い`)

    await select.selectOption(code)
    const body = await submit(page, waitForList(page, 'status', code))

    expect(urlQuery(page, 'status')).toBe(code)
    await expectNarrowed(page, total)
    // 絞り込みは行単位（最新の版ではない）。当たった行だけが元注文ごとにまとめ直される
    for (const raw of body.orders) expect(statusOf(raw), `応答に ${code} 以外の行がある`).toBe(code)
    await expectRowsMatch(page, groupsOf(body.orders))
  })

  test('[OIR-07] 51 件以上あるとき「次のページ」で 2 ページ目が実 API から読まれる', async ({
    page,
  }) => {
    const { total } = await openAndCapture(page)
    test.skip(total <= PAGE_SIZE, `注文が ${total} 件で 2 ページ目が無い`)

    const response = waitForList(page, 'offset', String(PAGE_SIZE))
    await page
      .getByTestId('order-inquiry-pagination')
      .getByRole('button', { name: '次のページ' })
      .click()
    const res = await response
    expect(res.ok()).toBe(true)
    await settleList(page)

    expect(urlQuery(page, 'offset')).toBe(String(PAGE_SIZE))
    await expect(page.getByTestId('order-inquiry-count')).toHaveText(`${total} 件`)
    // 2 ページ目も行単位で切られるので、まとまりの数は応答から計算する
    await expectRowsMatch(page, groupsOf((await res.json()).orders))
  })

  test('[OIR-08] 絞り込んだあと「クリア」で条件なしの一覧に戻る', async ({ page }) => {
    const { total } = await openOrSkip(page)

    const symbol = ((await columnOf(page, '銘柄').first().textContent()) ?? '').trim()
    test.skip(symbol === '' || symbol === EMPTY_CELL, '1 行目の銘柄が空')

    await page.getByTestId('order-inquiry-symbol').fill(symbol)
    await submit(page, waitForList(page, 'symbol', symbol))

    const response = waitForApi(page, API_PATH, isUnfiltered)
    await page.getByTestId('order-inquiry-search-clear').click()
    expect((await response).ok()).toBe(true)
    await settleList(page)

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('order-inquiry-count')).toHaveText(`${total} 件`)
    await expect(page.getByTestId('order-inquiry-symbol')).toHaveValue('')
  })

  test('[OIR-09] ヘッダと操作列が /auth/me の発注権限と最新の版の処理状況に従って出し分けられる', async ({
    page,
  }) => {
    // /auth/me は起動時に main.js が引く。goto の前から待ち受ける
    const me = waitForApi(page, AUTH_ME_PATH)
    const { groups } = await openAndCapture(page)
    const res = await me
    expect(res.ok(), `${AUTH_ME_PATH} が ${res.status()} を返した`).toBe(true)
    const canOrder = Boolean((await res.json())?.権限?.order)

    // ヘッダ（Teleport 先）。読み終えるまではどちらも出ないので、出るほうを待つ
    await expect(page.getByTestId('order-inquiry-new-order')).toHaveCount(canOrder ? 1 : 0)
    await expect(page.getByTestId('order-inquiry-no-permission')).toHaveCount(canOrder ? 0 : 1)

    await expect(rowsOf(page)).toHaveCount(groups.length)
    if (!canOrder) {
      await expect(page.getByTestId('order-inquiry-view-only')).toHaveCount(groups.length)
      await expect(page.getByTestId('order-inquiry-amend')).toHaveCount(0)
      await expect(page.getByTestId('order-inquiry-cancel')).toHaveCount(0)
      return
    }

    await expect(page.getByTestId('order-inquiry-view-only')).toHaveCount(0)
    for (const [index, group] of groups.entries()) {
      const status = statusOf(group.latest)
      const row = rowsOf(page).nth(index)
      await expect(
        row.getByTestId('order-inquiry-amend'),
        `#${group.id}（処理状況 ${status}）の「訂正」の有無`,
      ).toHaveCount(AMENDABLE.has(status) ? 1 : 0)
      await expect(
        row.getByTestId('order-inquiry-cancel'),
        `#${group.id}（処理状況 ${status}）の「取消」の有無`,
      ).toHaveCount(CANCELABLE.has(status) ? 1 : 0)
    }
  })

  test('[OIR-10] 「訂正」で開いた訂正画面の初期値が GET /orders/{id} の値と一致する（登録は押さない）', async ({
    page,
  }) => {
    const { groups } = await openOrSkip(page)
    test.skip((await page.getByTestId('order-inquiry-amend').count()) === 0, '「訂正」の出る行が無い')

    const index = firstActionableIndex(groups, AMENDABLE)
    expect(index, '応答に訂正できる処理状況の行が無いのに「訂正」が出ている').toBeGreaterThanOrEqual(0)
    const id = String(groups[index].latest.ID)

    const detail = waitForDetail(page, id)
    await rowsOf(page).nth(index).getByTestId('order-inquiry-amend').click()
    await expect(page).toHaveURL(new RegExp(`/orders/${id}/amend$`), { timeout: 15_000 })
    const res = await detail
    expect(res.ok(), `GET /orders/${id} が ${res.status()} を返した`).toBe(true)
    const order = (await res.json())?.order ?? {}
    const status = statusOf(order)

    await expect(page.getByTestId('order-amend-status')).toHaveText(STATUS_NAMES[status] ?? status)
    await expect(page.getByTestId('order-amend-summary').getByRole('definition').first()).toHaveText(
      `#${id}`,
    )
    // 入力欄は対象注文の現在値で洗い替えられる（数量は integer、指値単価は decimal の文字列で来うる）
    await expect(page.getByTestId('order-amend-quantity')).toHaveValue(String(toNumber(order.数量)))
    await expect(page.getByTestId('order-amend-market-scope')).toHaveValue(String(order.発注範囲 ?? ''))
    const orderType = String(order.指成区分 ?? '')
    expect(ORDER_TYPE_LABELS[orderType], `指成区分が LO / MO でない（${orderType}）`).toBeTruthy()
    await expect(
      page.getByTestId('order-amend-order-type').getByRole('button', { name: ORDER_TYPE_LABELS[orderType] }),
    ).toHaveAttribute('aria-pressed', 'true')
    if (orderType === 'LO') {
      await expect(page.getByTestId('order-amend-limit-price')).toHaveValue(
        String(toNumber(order.指値単価)),
      )
    } else {
      await expect(page.getByTestId('order-amend-limit-price')).toHaveCount(0)
    }

    // 一覧が訂正可と判断した注文は、詳細でも訂正可（画面と API の処理状況が食い違っていない）
    await expect(page.getByTestId('order-amend-locked')).toHaveCount(0)
    await expect(page.getByTestId('order-amend-submit')).toBeVisible()

    // 登録は押さない。「戻る」で注文照会へ戻る
    await page.getByTestId('order-amend-back').click()
    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
  })

  test('[OIR-11] 「取消」で開いた取消画面の要約が GET /orders/{id} の値と一致する（確定は押さない）', async ({
    page,
  }) => {
    const { groups } = await openOrSkip(page)
    test.skip((await page.getByTestId('order-inquiry-cancel').count()) === 0, '「取消」の出る行が無い')

    const index = firstActionableIndex(groups, CANCELABLE)
    expect(index, '応答に取消できる処理状況の行が無いのに「取消」が出ている').toBeGreaterThanOrEqual(0)
    const id = String(groups[index].latest.ID)

    const detail = waitForDetail(page, id)
    await rowsOf(page).nth(index).getByTestId('order-inquiry-cancel').click()
    await expect(page).toHaveURL(new RegExp(`/orders/${id}/cancel$`), { timeout: 15_000 })
    const res = await detail
    expect(res.ok(), `GET /orders/${id} が ${res.status()} を返した`).toBe(true)
    const body = await res.json()
    const order = body?.order ?? {}
    const status = statusOf(order)
    const quantity = toNumber(order.数量) ?? 0
    // 約定済数量は executions の 約定数量 の合計（src/api/orderInquiry.js の toOrderDetail）
    const filled = (Array.isArray(body?.executions) ? body.executions : []).reduce(
      (sum, execution) => sum + (toNumber(execution?.約定数量) ?? 0),
      0,
    )

    await expect(page.getByTestId('order-cancel-order-id')).toHaveText(`注文ID #${id}`)
    await expect(page.getByTestId('order-cancel-status')).toHaveText(STATUS_NAMES[status] ?? status)
    // 要約の並び（src/views/OrderCancelView.vue の summaryItems）: 銘柄 / 売買 / 口座番号 / 注文数量 / 約定済数量 / 取消対象 / 価格 / 市場区分
    const definitions = page.getByTestId('order-cancel-summary').getByRole('definition')
    await expect(definitions.nth(2)).toHaveText(String(order.口座番号 ?? ''))
    await expect(definitions.nth(3)).toHaveText(`${formatQuantity(quantity)}株`)
    await expect(definitions.nth(4)).toHaveText(`${formatQuantity(filled)}株`)
    await expect(page.getByTestId('order-cancel-quantity')).toHaveText(
      `${formatQuantity(Math.max(quantity - filled, 0))}株`,
    )

    await expect(page.getByTestId('order-cancel-locked')).toHaveCount(0)
    await expect(page.getByTestId('order-cancel-submit')).toBeVisible()

    // 確定は押さない。「戻る」で注文照会へ戻る
    await page.getByTestId('order-cancel-back').click()
    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
  })
})
