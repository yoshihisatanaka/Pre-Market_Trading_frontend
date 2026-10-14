import { expect, test } from '@playwright/test'
import { formatQuantity } from '../src/utils/format'
import {
  API_LIMIT_MAX,
  apiContext,
  listHelpers,
  logExchange,
  skipUnlessRealApi,
  USER_CODE,
} from './helpers/realApi.js'

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
 * 既定では丸ごとスキップする。実 API に当てるときだけ次をそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   3. バックエンドのバッチ（premarket-scheduler）を止めておく（OIR-02 / OIR-12 のため。終わったら戻す）
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test order-inquiry.real-api
 *
 * OIR-01・03〜11 は実 DB に書き込まない（GET だけ。訂正・取消の画面は開いて初期値を見るだけ）。
 * OIR-02 / OIR-12 だけは試験注文を新規注文の画面から 1 件ずつ作り（POST /orders）、
 * OIR-02 は画面で取り消し、OIR-12 は画面で訂正したあと API で取り消す。
 * 1 回の実行につき取消済（034）の試験注文が 2 件残る（2026-10-09 にこの運用が認められた）。
 * 件数を開いた時点と比べる行（OIR-07 / OIR-08）と書き込みの行が並列に走ると件数が揺れるので、
 * このファイルは 1 つの worker で宣言順に流し、書き込みの 2 行は最後に置く。
 */

// 1 つの worker で宣言順に流す（理由は冒頭）。serial と違い、1 本落ちても残りは流れる
test.describe.configure({ mode: 'default' })

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

/** 指成区分 → 訂正画面の「価格」のボタン名（コードマスタ `指成区分` の名称） */
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

/*
 * ---- 書き込みの行（OIR-02 / OIR-12）の下ごしらえ ----
 *
 * 試験注文は新規注文の画面（/orders/new）から作る。API を直接叩かないのは 2 つの理由から。
 *   - 画面の操作者（.env の VITE_USER_CODE）で作れば、注文照会に必ず見える（部店の限定がそろう）
 *   - OrderRequest の区分値・有効期限（当日中の日付は休場日・受注不可日で決まる）を画面が組み立ててくれる
 * 口座・銘柄の選び方は e2e/order-entry.real-api.spec.js（NR-01 / NR-06）と同じ。
 * 入力から確定までの操作も NR-06 の写し（helpers/realApi.js は並行作業と衝突するので触らない。共通化の候補）。
 */
const ENTRY_PATH = '/orders/new'
const CUSTOMERS_API_PATH = '/api/masters/customers'
const SYMBOLS_API_PATH = '/api/masters/symbols'
const VALIDATE_API_PATH = '/api/orders/validate'
// 一覧の応答の配列キー（src/api/customers.js の fetchCustomers / src/api/symbols.js の fetchSymbols）
const CUSTOMERS_LIST_KEY = 'customers'
const SYMBOLS_LIST_KEY = 'stocks'
// src/utils/symbolTypes.js の取引可否（規制情報）の「禁止」。e2e/order-entry.real-api.spec.js と同じ扱い
const REGULATION_PROHIBITED = '1'

/** 書き込みの行が使う、画面の操作者（GET /auth/me の生の応答）。口座の選定と後始末の X-User-Code に使う */
let operator = null
/** 顧客マスタ・銘柄マスタの先頭 1 ページ（beforeAll で読む） */
let customers = []
let stocks = []
/** 試験注文の口座と銘柄（テストの中で操作者の部店に合わせて選ぶ） */
let account = null
let stock = null
/** 作って、まだ後始末を確かめていない試験注文の ID（afterAll / finally の取りこぼし防止） */
const createdOrderIds = new Set()

/** 実 API の一覧の先頭 1 ページ（上限件数）を読む */
async function firstPage(api, path, listKey) {
  const res = await api.get(path, { params: { limit: API_LIMIT_MAX, offset: 0 } })
  expect(res.ok(), `実 API から ${path} を取得できない。api コンテナが動いているか確認する`).toBe(
    true,
  )
  const body = await res.json()
  expect(Array.isArray(body[listKey]), `${path} の応答に配列 ${listKey} が無い`).toBe(true)
  return body[listKey]
}

/** 注文に使える口座（NR と同じ条件）。部店・口座番号・顧客名がそろい、全取引停止でない */
function isUsableAccount(row) {
  return (
    Number.isInteger(row.口座番号) &&
    Boolean(row.部店コード) &&
    Boolean(row.顧客名) &&
    row.取引停止区分_全取引 !== 1 &&
    row.取消区分 !== 1
  )
}

/**
 * 試験注文（買い）を出せる口座。事前検証はエクイティ／リスク商品の買付停止も弾く（2026-10-09 実測）。
 * 区分は 0: 通常 / 1: 停止（openapi.json の CustomerItem）
 */
const BUY_STOP_FLAGS = [
  '取引停止区分_エクイティ商品取引_売買',
  '取引停止区分_エクイティ商品取引_買',
  '取引停止区分_リスク商品取引_売買',
  '取引停止区分_リスク商品取引_買',
]
const canBuy = (row) => BUY_STOP_FLAGS.every((key) => row[key] !== 1)

/** 注文に使える銘柄（NR と同じ条件）。Ticker と銘柄コードがあり、売買禁止でない */
function isUsableStock(row) {
  return (
    Boolean(row.Ticker) &&
    Boolean(row.銘柄コード) &&
    row.規制情報 !== REGULATION_PROHIBITED &&
    row.取消区分 !== 1
  )
}

/** ティッカーの横に出る名前（views/OrderEntryView.vue の symbolHint と同じ優先順） */
const stockLabel = (row) => row.銘柄名_英字 || row.銘柄名

const pathnameOf = (urlText) => new URL(urlText).pathname

/** 指定のパスへの POST の応答を待つ */
function waitForPost(page, pathname) {
  return page.waitForResponse(
    (res) => res.request().method() === 'POST' && pathnameOf(res.url()) === pathname,
  )
}

/**
 * 注文照会を開いて、画面が受け取った GET /auth/me（操作者）を読む。
 * 発注権限が無ければ書き込みの前提が成り立たないのでスキップする。
 * 口座は操作者の部店のもの（全部店の参照権限があれば先頭の有効な口座）を選ぶ。
 */
async function prepareOperatorAndAccount(page, playwright) {
  const me = waitForApi(page, AUTH_ME_PATH)
  await openList(page)
  const res = await me
  expect(res.ok(), `${AUTH_ME_PATH} が ${res.status()} を返した`).toBe(true)
  operator = await res.json()
  test.skip(!operator?.権限?.order, '操作者に発注権限が無い（VITE_USER_CODE の社員コードを見直す）')

  const branchAll = Boolean(operator?.権限?.branch_all)
  const operatorBranch = String(operator?.部店コード ?? '')
  const accounts = customers
    .filter(isUsableAccount)
    .filter(canBuy)
    .filter((row) => branchAll || String(row.部店コード) === operatorBranch)
  const usableStocks = stocks.filter(isUsableStock)
  test.skip(accounts.length === 0, `操作者の部店（${operatorBranch}）に注文に使える口座が無い（顧客マスタの先頭 1 ページ）`)
  test.skip(usableStocks.length === 0, '実 API に注文に使える銘柄が無い（銘柄マスタの先頭 1 ページ）')

  /*
   * 事前検証は「同一口座・同一銘柄・同一売買区分の注文が本日既にある」と valid:false で弾き、
   * 重複確認区分=1 での再送を求める（2026-10-09 実測）。画面には再送の操作が無いので、
   * 取消済でない注文の無い口座と銘柄の組を選ぶ
   */
  const pair = await findPairWithoutOrders(playwright, accounts, usableStocks)
  test.skip(!pair, `注文の無い口座と銘柄の組が見つからない（先頭 ${PAIR_SEARCH_ACCOUNTS} 口座を見た）`)
  ;({ account, stock } = pair)
}

/** 注文の無い組を探すときに見る口座の数（先頭から） */
const PAIR_SEARCH_ACCOUNTS = 5

/**
 * 口座は業務の制限（確認書類・コンプライアンスランク等）で弾かれやすく、マスタの項目だけでは見分けきれない。
 * NR と同じ先頭の口座を優先し、銘柄の方を変えて重複を避ける。口座ごとに注文を 1 回で読み、
 * まだ注文の無い銘柄を選ぶ（銘柄ごとに引くと、実行を重ねて使用済みの銘柄が増えるほど遅くなる）
 */
async function findPairWithoutOrders(playwright, accounts, usableStocks) {
  const api = await apiContext(playwright, { userCode: operator?.操作者コード || USER_CODE })
  try {
    for (const candidateAccount of accounts.slice(0, PAIR_SEARCH_ACCOUNTS)) {
      const res = await api.get(API_PATH, {
        params: { account_no: candidateAccount.口座番号, limit: API_LIMIT_MAX, offset: 0 },
      })
      expect(res.ok(), `GET /orders（組の下見）が ${res.status()}`).toBe(true)
      // 取消済（034）は重複に数えない（034 になった A0002 の後に同じ口座で A0002 を受け付けた。2026-10-09 実測）
      const used = new Set(
        ((await res.json()).orders ?? [])
          .filter((order) => statusOf(order) !== '034')
          .map((order) => order.銘柄コード),
      )
      const candidateStock = usableStocks.find((row) => !used.has(row.銘柄コード))
      if (candidateStock) return { account: candidateAccount, stock: candidateStock }
    }
    return null
  } finally {
    await api.dispose()
  }
}

/** 「送信」を押し、事前検証の応答が返るまで待つ */
async function submitAndWaitValidate(page) {
  const response = waitForPost(page, VALIDATE_API_PATH)
  await page.getByTestId('order-entry-submit').click()
  return response
}

/**
 * 送信して、確認画面へ進むか理由の帯が出るまで進める。フロコン警告が出たら強制区分を付けて送り直す
 * （e2e/order-entry.real-api.spec.js の submitUntilSettled と同じ）。確認画面へ進めたら true
 */
async function submitUntilConfirm(page) {
  const confirm = page.getByTestId('order-entry-confirm')
  const errors = page.getByTestId('order-entry-errors')
  const validateError = page.getByTestId('order-entry-validate-error')
  const warnings = page.getByTestId('order-entry-warnings')

  await logExchange('OIR validate', await submitAndWaitValidate(page))
  await expect(confirm.or(errors).or(validateError).or(warnings).first()).toBeVisible()

  if ((await warnings.count()) > 0 && (await errors.count()) === 0 && (await confirm.count()) === 0) {
    await page.getByTestId('order-entry-forced').check()
    await submitAndWaitValidate(page)
    await expect(confirm.or(errors).or(validateError).first()).toBeVisible()
  }
  return (await confirm.count()) > 0
}

/**
 * 新規注文の画面から試験注文を 1 件作り、注文 ID を返す（買い・数量 1・成行・当日中）。
 * 業務エラー（余力・規制・発注停止）で作れなければスキップする。
 */
async function createTestOrder(page) {
  const query = new URLSearchParams({
    branch_code: account.部店コード,
    account_number: String(account.口座番号),
  })
  const operatorLoaded = page
    .waitForResponse((res) => pathnameOf(res.url()) === AUTH_ME_PATH, { timeout: 10_000 })
    .catch(() => null)
  await page.goto(`${ENTRY_PATH}?${query}`)
  await expect(page.getByTestId('order-entry-form')).toBeVisible()
  await operatorLoaded
  test.skip(
    (await page.getByTestId('order-entry-suspended').count()) > 0,
    '実 API が全体の発注停止中で試験注文を作れない',
  )

  await page.getByTestId('order-entry-branch').fill(account.部店コード)
  await page.getByTestId('order-entry-account').fill(String(account.口座番号))
  await page.getByTestId('order-entry-ticker').fill(stock.Ticker)
  await expect(page.getByTestId('order-entry-ticker-hint')).toHaveText(stockLabel(stock))
  await page.getByTestId('order-entry-side').getByRole('button', { name: '買', exact: true }).click()
  // 画面の既定は指値・外決（画面モックの 2026-09-30 版）。単価を要らなくし外貨の余力に左右されないよう成行・円決にする
  await page.getByTestId('order-entry-order-type').getByRole('button', { name: '成行', exact: true }).click()
  await page
    .getByTestId('order-entry-settlement-currency')
    .getByRole('button', { name: '円決', exact: true })
    .click()
  await page.getByTestId('order-entry-quantity').fill('1')
  // 受注者は /auth/me の受注者コードが既定で入る（#51）。未設定のときだけ試験用のコードで埋める
  const orderPerson = page.getByTestId('order-entry-order-person')
  if ((await orderPerson.inputValue()) === '') await orderPerson.fill(USER_CODE)

  test.skip(
    !(await submitUntilConfirm(page)),
    '事前検証で確認画面へ進めなかった（実データの残高・余力・規制）。試験注文を作れない',
  )

  await page.getByTestId('order-entry-final-check').check()
  const created = waitForPost(page, API_PATH)
  await page.getByTestId('order-entry-confirm-submit').click()
  const res = await created
  const body = JSON.parse(await logExchange('OIR create', res))
  // 応答を読んだらすぐ控える（以降の期待が落ちても後始末が取り消す）
  if (Number.isInteger(body.order_id)) createdOrderIds.add(String(body.order_id))
  expect(res.ok(), `POST /orders が ${res.status()}`).toBe(true)
  test.skip(body.success !== true, `試験注文の登録が success:false: ${JSON.stringify(body.errors)}`)
  expect(Number.isInteger(body.order_id), 'success:true なのに order_id が integer でない').toBe(true)
  await expect(page.getByTestId('order-entry-complete')).toBeVisible()
  return String(body.order_id)
}

/** 試験注文の口座・銘柄で絞った GET /orders の応答を待つ */
function waitForAccountList(page) {
  return waitForApi(
    page,
    API_PATH,
    (url) =>
      url.searchParams.get('account_no') === String(account.口座番号) &&
      url.searchParams.get('symbol') === stock.銘柄コード,
  )
}

/**
 * 表の、注文ID 列が #<id> の行。行の textContent はセルの間に区切りが無く、注文ID の直後に
 * 部店の数字が続く（'#1964100'）ので、行の文字列ではなく `#<id>` だけを持つ要素で絞る
 */
function rowOf(page, id) {
  return rowsOf(page).filter({ has: page.getByText(`#${id}`, { exact: true }) })
}

/**
 * 注文照会を試験注文の口座・銘柄で絞って開き、その注文の行を返す。
 * 条件なしだと 1 ページ目に出る保証が無い（並び順は openapi.json に書かれていない）ので絞る
 */
async function openRowOf(page, id) {
  const query = new URLSearchParams({
    account_number: String(account.口座番号),
    symbol: stock.銘柄コード,
  })
  const response = waitForAccountList(page)
  await openList(page, `?${query}`)
  expect((await response).ok()).toBe(true)
  const row = rowOf(page, id)
  await expect(row, `試験注文 #${id} が注文照会に出ない（部店の限定・並び順を疑う）`).toHaveCount(1)
  return row
}

/**
 * 作った試験注文を後始末する。まだ取消できる処理状況のものだけ POST /orders/{id}/cancel で取り消す
 * （画面で取り消し済みなら何もしない）。X-User-Code は画面の操作者にそろえる
 */
async function cleanupOrders(playwright) {
  if (createdOrderIds.size === 0) return
  const api = await apiContext(playwright, { userCode: operator?.操作者コード || USER_CODE })
  try {
    for (const id of [...createdOrderIds]) {
      const detail = await api.get(`${API_PATH}/${id}`)
      expect(detail.ok(), `試験注文 #${id} を GET できない（${detail.status()}）`).toBe(true)
      const status = statusOf((await detail.json())?.order)
      if (CANCELABLE.has(status)) {
        const res = await api.post(`${API_PATH}/${id}/cancel`, { data: {} })
        const text = await logExchange(`OIR cleanup ${id}`, res)
        expect(res.ok(), `試験注文 #${id} を取り消せない: ${res.status()} ${text}`).toBe(true)
        expect(JSON.parse(text).success, `試験注文 #${id} の取消が success:false: ${text}`).toBe(true)
      }
      createdOrderIds.delete(id)
    }
  } finally {
    await api.dispose()
  }
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

  /*
   * 書き込みの行。試験注文を作って訂正・取消まで流す。バッチ（premarket-scheduler）を止めた状態が前提
   * （動いていると作った直後に IB 発注・Dream 登録へ進み、即時取消（000 → 034）にならない）。
   */
  test.describe('試験注文の取消・訂正（書き込み）', () => {
    test.beforeAll(async ({ playwright }) => {
      // マスタの読み出しだけなので試験用の X-User-Code でよい（NR と同じ）
      const api = await apiContext(playwright)
      try {
        customers = await firstPage(api, CUSTOMERS_API_PATH, CUSTOMERS_LIST_KEY)
        stocks = await firstPage(api, SYMBOLS_API_PATH, SYMBOLS_LIST_KEY)
      } finally {
        await api.dispose()
      }
    })

    test.afterAll(async ({ playwright }) => {
      // テストが途中で落ちても、作った試験注文を未発注のまま残さない
      await cleanupOrders(playwright)
    })

    test('[OIR-02] 試験注文を一覧の「取消」→「取消を確定」で取り消すと、一覧で取消済になりボタンが消える', async ({
      page,
      playwright,
    }) => {
      // 注文の作成（新規注文の画面）・一覧・取消の 3 画面を往復するので既定の 30 秒では足りない
      test.setTimeout(90_000)
      await prepareOperatorAndAccount(page, playwright)
      const id = await createTestOrder(page)

      try {
        const row = await openRowOf(page, id)
        const detail = waitForDetail(page, id)
        await row.getByTestId('order-inquiry-cancel').click()
        await expect(page).toHaveURL(new RegExp(`/orders/${id}/cancel$`), { timeout: 15_000 })
        expect((await detail).ok()).toBe(true)

        const canceled = waitForPost(page, `${API_PATH}/${id}/cancel`)
        await page.getByTestId('order-cancel-submit').click()
        const res = await canceled
        const body = JSON.parse(await logExchange('OIR-02 cancel', res))

        expect(res.status(), `POST /orders/${id}/cancel が ${res.status()}`).toBe(200)
        expect(body.success, `取消が success:false: ${JSON.stringify(body)}`).toBe(true)
        // 本文は空（理由・取消者は送らない。src/api/orderInquiry.js の cancelOrder）
        expect(JSON.parse(res.request().postData() ?? '{}')).toEqual({})

        // 完了表示の文言はサーバが決める（空なら画面の既定文言）
        await expect(page.getByTestId('order-cancel-complete')).toBeVisible()
        await expect(page.getByTestId('order-cancel-complete-message')).toHaveText(
          body.message || '取消を受け付けました。',
        )

        // 「注文照会へ戻る」で、絞った一覧へ戻って読み直される
        const reloaded = waitForAccountList(page)
        await page.getByTestId('order-cancel-back-to-list').click()
        const listRes = await reloaded
        expect(listRes.ok()).toBe(true)
        await settleList(page)

        const group = groupsOf((await listRes.json()).orders).find((item) => item.id === id)
        expect(group, `戻った一覧の応答に #${id} が無い`).toBeTruthy()
        // バッチを止めていれば未発注（000）の取消は即時に取消済（034）になる
        expect(statusOf(group.latest), `#${id} が取消済（034）になっていない`).toBe('034')
        const canceledRow = rowOf(page, id)
        await expect(cellOf(canceledRow, '出来状況')).toHaveText(
          group.latest.表示状況名 ?? group.latest.処理状況名 ?? STATUS_NAMES['034'],
        )
        await expect(canceledRow.getByTestId('order-inquiry-amend')).toHaveCount(0)
        await expect(canceledRow.getByTestId('order-inquiry-cancel')).toHaveCount(0)
      } finally {
        // 画面での取消が途中で落ちても残さない（取消済なら何もしない）
        await cleanupOrders(playwright)
      }
    })

    test('[OIR-12] 試験注文を「訂正」で数量 +1 して登録すると IN_PLACE で受け付けられ、一覧の数量が変わる', async ({
      page,
      playwright,
    }) => {
      // 注文の作成・一覧・訂正の 3 画面を往復するので既定の 30 秒では足りない
      test.setTimeout(90_000)
      await prepareOperatorAndAccount(page, playwright)
      const id = await createTestOrder(page)

      try {
        const row = await openRowOf(page, id)
        const detail = waitForDetail(page, id)
        await row.getByTestId('order-inquiry-amend').click()
        await expect(page).toHaveURL(new RegExp(`/orders/${id}/amend$`), { timeout: 15_000 })
        const detailRes = await detail
        expect(detailRes.ok()).toBe(true)
        const quantity = toNumber((await detailRes.json())?.order?.数量)
        expect(quantity, `GET /orders/${id} の 数量 が数値でない`).not.toBeNull()
        const nextQuantity = quantity + 1

        await expect(page.getByTestId('order-amend-quantity')).toHaveValue(String(quantity))
        await page.getByTestId('order-amend-quantity').fill(String(nextQuantity))
        const amended = waitForPost(page, `${API_PATH}/${id}/amend`)
        await page.getByTestId('order-amend-submit').click()
        const res = await amended
        const body = JSON.parse(await logExchange('OIR-12 amend', res))
        // 訂正注文が別 ID で採番されたら、それも後始末の対象にする
        if (Number.isInteger(body.amendment_order_id)) {
          createdOrderIds.add(String(body.amendment_order_id))
        }

        expect(res.status(), `POST /orders/${id}/amend が ${res.status()}`).toBe(200)
        expect(body.success, `訂正が success:false: ${JSON.stringify(body)}`).toBe(true)
        // 未発注・Dream 未登録の注文はその場で訂正される
        expect(body.mode, `訂正の mode が IN_PLACE でない: ${JSON.stringify(body)}`).toBe('IN_PLACE')
        // 部分更新なので、変えた 数量 だけを送る（src/api/orderInquiry.js の amendOrder）
        expect(JSON.parse(res.request().postData() ?? '{}')).toEqual({ 数量: nextQuantity })

        await expect(page.getByTestId('order-amend-complete')).toBeVisible()
        await expect(page.getByTestId('order-amend-complete-message')).toHaveText(
          body.message || '訂正を受け付けました。',
        )
        await expect(page.getByTestId('order-amend-complete-detail')).toContainText(`#${id}`)

        const reloaded = waitForAccountList(page)
        await page.getByTestId('order-amend-back-to-list').click()
        expect((await reloaded).ok()).toBe(true)
        await settleList(page)
        await expect(cellOf(rowOf(page, id), '数量')).toHaveText(formatQuantity(nextQuantity))
      } finally {
        // 訂正の成否にかかわらず、必ず取り消して後始末する（1 回の実行で残すのは取消済だけ）
        await cleanupOrders(playwright)
      }
    })
  })
})
