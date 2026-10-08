import { expect, test } from '@playwright/test'
import {
  API_LIMIT_MAX,
  apiContext,
  assertRealApi,
  logExchange,
  skipUnlessRealApi,
  USER_CODE,
} from './helpers/realApi.js'

/*
 * 新規注文（外株注文入力）を「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/order-entry-real-api.md（タイトル先頭の [NR-xx] が対応 ID）
 *
 * order-entry.spec.js（NO）とは目的が違う。NO は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせだけを見るので、
 * 期待値に**データの中身を書かない**。照会に使う口座・銘柄は実行時に API の先頭から 1 件ずつ選ぶ。
 * エラー応答・0 件・権限なし・停止中の再現は mockApi() が要るので NO の担当。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次をそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく（NR-06 は IB 発注のワーカーを止めておく）
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test order-entry.real-api
 *
 * NR-01〜05 は GET と POST /orders/validate（DB に書かない）だけ。
 * NR-06 は POST /orders で実 DB（d_注文）に注文を 1 件作り、直後に POST /orders/{order_id}/cancel で取り消す。
 * 1 回の実行につき取消済み（034）の注文が 1 件残る。ローカルの開発 DB 前提。
 */

const PATH = '/orders/new'
// 実 API のパス（openapi.json）。dev サーバの /api プロキシ越しに届く
const CUSTOMERS_API_PATH = '/api/masters/customers'
const SYMBOLS_API_PATH = '/api/masters/symbols'
const VALIDATE_API_PATH = '/api/orders/validate'
const ORDERS_API_PATH = '/api/orders'
const AUTH_ME_API_PATH = '/api/auth/me'
// 一覧の応答の配列キー（src/api/customers.js の fetchCustomers / src/api/symbols.js の fetchSymbols）
const CUSTOMERS_LIST_KEY = 'customers'
const SYMBOLS_LIST_KEY = 'stocks'

// src/utils/orderEntryForm.js の MESSAGES.tickerNotFound と同じ文言（MESSAGES は export されていないので再掲する）
const TICKER_NOT_FOUND = 'ティッカーが見つかりません。取扱銘柄を確認してください。'

// src/utils/symbolTypes.js の取引可否（規制情報）。コード値は仮置き（openapi.json に enum が無い）。
// 取引可の銘柄を選ぶときに「禁止（'1'）でない」ことだけに使う
const REGULATION_PROHIBITED = '1'

/** beforeAll で API から選ぶ口座と銘柄（実データ。見つからなければ null） */
let account = null
let stock = null

/** NR-06 で作り、まだ取り消していない注文 ID（afterAll の取りこぼし防止） */
const createdOrderIds = new Set()

/** 実 API の 口座番号（integer）を、画面の入力欄に打つ文字列にする */
const accountText = (row) => String(row.口座番号)

/** 実 API の一覧の先頭 1 ページ（上限件数）を読む */
async function firstPage(api, path, listKey, params = {}) {
  const res = await api.get(path, { params: { ...params, limit: API_LIMIT_MAX, offset: 0 } })
  expect(res.ok(), `実 API から ${path} を取得できない。api コンテナが動いているか確認する`).toBe(
    true,
  )
  const body = await res.json()
  expect(Array.isArray(body[listKey]), `${path} の応答に配列 ${listKey} が無い`).toBe(true)
  return body[listKey]
}

/** 注文に使える口座。部店・口座番号・顧客名がそろい、全取引停止でない */
function isUsableAccount(row) {
  return (
    Number.isInteger(row.口座番号) &&
    Boolean(row.部店コード) &&
    Boolean(row.顧客名) &&
    row.取引停止区分_全取引 !== 1 &&
    row.取消区分 !== 1
  )
}

/** 注文に使える銘柄。Ticker と銘柄コードがあり、売買禁止でない */
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

/** 銘柄名の前に出る 1 行（views/OrderEntryView.vue の symbolHint.code と同じ形） */
const stockCodeLine = (row) => `ティッカー：${row.Ticker} ／ 銘柄コード：${row.銘柄コード}`

function skipWithoutData() {
  test.skip(!account, '実 API に注文に使える口座が無い（顧客マスタの先頭 1 ページ）')
  test.skip(!stock, '実 API に注文に使える銘柄が無い（銘柄マスタの先頭 1 ページ）')
}

const pathnameOf = (urlText) => new URL(urlText).pathname

/** 送信された POST のうち、パスが一致するものを集める（本文の確認と「送られない」の確認に使う） */
function collectPosts(page, pathname) {
  const requests = []
  page.on('request', (req) => {
    if (req.method() === 'POST' && pathnameOf(req.url()) === pathname) requests.push(req)
  })
  return requests
}

/**
 * beforeAll で選んだ口座の部店・口座番号のクエリ。
 * /orders/new は account_number が無いと顧客検索へ回る（router/index.js の beforeEnter）
 */
const accountQuery = () =>
  `?${new URLSearchParams({ branch_code: account.部店コード, account_number: accountText(account) })}`

/**
 * 画面を開いて入力フォームが出るまで待ち、実 API に当たっていることを確かめる。
 * 操作者（/auth/me）の読み込みを待ってから返す（権限なしの帯は読み終えてから出るため）。
 */
async function openForm(page, query = accountQuery()) {
  const operatorLoaded = page
    .waitForResponse((res) => pathnameOf(res.url()) === AUTH_ME_API_PATH, { timeout: 10_000 })
    .catch(() => null)
  await page.goto(`${PATH}${query}`)
  await expect(page.getByTestId('order-entry-form')).toBeVisible()
  await assertRealApi(page)
  await operatorLoaded
}

/** 送信を受け付けない状態（権限なし・全体停止中）なら、書き込み系の前提が成り立たないのでスキップする */
async function skipIfBlocked(page) {
  const noPermission = await page.getByTestId('order-entry-no-permission').count()
  const suspended = await page.getByTestId('order-entry-suspended').count()
  test.skip(noPermission > 0, '操作者に発注権限が無い（VITE_USER_CODE の社員コードを見直す）')
  test.skip(suspended > 0, '実 API が全体の発注停止中')
}

function sideButton(page, name) {
  return page.getByTestId('order-entry-side').getByRole('button', { name, exact: true })
}

/** 部店・口座番号・ティッカー・買い・数量 1 を入れる（ほかは既定値。成行・当日中・レギュラー） */
async function fillOrder(page, { ticker = stock.Ticker } = {}) {
  await page.getByTestId('order-entry-branch').fill(account.部店コード)
  await page.getByTestId('order-entry-account').fill(accountText(account))
  await page.getByTestId('order-entry-ticker').fill(ticker)
  await sideButton(page, '買い').click()
  await page.getByTestId('order-entry-quantity').fill('1')
  // 受注者は操作者の社員コードが既定で入る。読めなかったときだけ試験用のコードで埋める
  const orderPerson = page.getByTestId('order-entry-order-person')
  if ((await orderPerson.inputValue()) === '') await orderPerson.fill(USER_CODE)
}

/** 「送信」を押し、事前検証の応答が返るまで待つ */
async function submitAndWaitValidate(page) {
  const response = page.waitForResponse(
    (res) => res.request().method() === 'POST' && pathnameOf(res.url()) === VALIDATE_API_PATH,
  )
  await page.getByTestId('order-entry-submit').click()
  return response
}

/**
 * 送信して、確認画面へ進むか理由の帯が出るまで進める。フロコン警告が出たら強制区分を付けて送り直す。
 * 'confirm'（確認画面）か 'stopped'（入力エラー / 通信エラーの帯）を返す。
 */
async function submitUntilSettled(page) {
  const confirm = page.getByTestId('order-entry-confirm')
  const errors = page.getByTestId('order-entry-errors')
  const validateError = page.getByTestId('order-entry-validate-error')
  const warnings = page.getByTestId('order-entry-warnings')

  await logExchange('NR validate', await submitAndWaitValidate(page))
  await expect(confirm.or(errors).or(validateError).or(warnings).first()).toBeVisible()

  if ((await warnings.count()) > 0 && (await errors.count()) === 0 && (await confirm.count()) === 0) {
    await page.getByTestId('order-entry-forced').check()
    await submitAndWaitValidate(page)
    await expect(confirm.or(errors).or(validateError).first()).toBeVisible()
  }

  if ((await confirm.count()) > 0) return 'confirm'

  // 無言で止まっていない（帯に理由の文が入っている）
  const banner = (await errors.count()) > 0 ? errors : validateError
  await expect(banner).toBeVisible()
  const reason = ((await banner.textContent()) ?? '').trim()
  // 確認へ進めなかった理由を報告用に残す（NR-06 の前提が成り立つかの判断に使う）
  console.log(`[NR] 帯の文言: ${reason}`)
  expect(reason, '理由の帯が空').not.toBe('')
  return 'stopped'
}

/** 注文を取り消す（未発注 000 は即時取消 034）。応答の status は報告用に残す */
async function cancelOrder(api, orderId) {
  const res = await api.post(`${ORDERS_API_PATH}/${orderId}/cancel`, { data: {} })
  const body = await logExchange(`NR cancel ${orderId}`, res)
  expect(res.ok(), `試験用の注文を取り消せない: ${orderId} ${res.status()} ${body}`).toBe(true)
  expect(JSON.parse(body).success, `取消が success:false: ${body}`).toBe(true)
  createdOrderIds.delete(orderId)
}

// 各行は独立しているが、並列だと初期読み込み（受注不可日・休場日・発注停止）の応答が 5 秒を超えて
// 入力フォームが出ない（2026-10-02 実測。4 並列で 3 本落ち、直列で全件通過）。
// 1 つの worker で順に流す。serial と違い、1 本落ちても残りは流れる
test.describe.configure({ mode: 'default' })

test.describe('新規注文（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test.beforeAll(async ({ playwright }) => {
    const api = await apiContext(playwright)
    const customers = await firstPage(api, CUSTOMERS_API_PATH, CUSTOMERS_LIST_KEY)
    const stocks = await firstPage(api, SYMBOLS_API_PATH, SYMBOLS_LIST_KEY)
    await api.dispose()

    account = customers.find(isUsableAccount) ?? null
    stock = stocks.find(isUsableStock) ?? null
  })

  test.afterAll(async ({ playwright }) => {
    // NR-06 が取消の前に落ちても、作った注文を未発注のまま残さない
    if (createdOrderIds.size === 0) return
    const api = await apiContext(playwright)
    for (const orderId of [...createdOrderIds]) await cancelOrder(api, orderId)
    await api.dispose()
  })

  test('[NR-01] 実データの口座番号・銘柄コードで照会でき、入力フォームが出る', async ({ page }) => {
    skipWithoutData()
    await openForm(page)

    await expect(page.getByTestId('order-entry-loading')).toHaveCount(0)
    await expect(page.getByTestId('order-entry-error')).toHaveCount(0)
    await expect(page.getByTestId('order-entry-empty')).toHaveCount(0)
    await expect(
      page.getByTestId('order-entry-expiry').locator('option:checked'),
    ).toHaveText(/^当日中（\d{1,2}\/\d{1,2}）$/)

    await page.getByTestId('order-entry-branch').fill(account.部店コード)
    await page.getByTestId('order-entry-account').fill(accountText(account))
    // Ticker ではなく銘柄コードで引く（Ticker での照会は NR-02 / NR-05 が通る）
    await page.getByTestId('order-entry-ticker').fill(stock.銘柄コード)

    await expect(page.getByTestId('order-entry-account-hint')).toHaveText(account.顧客名)
    await expect(page.getByTestId('order-entry-customer-bar')).toBeVisible()
    await expect(page.getByTestId('order-entry-ticker-code')).toHaveText(stockCodeLine(stock))
    await expect(page.getByTestId('order-entry-ticker-hint')).toHaveText(stockLabel(stock))
  })

  test('[NR-02] 送信すると事前検証が銘柄コードで送られ、確認画面か理由の帯に落ちる（確定はしない）', async ({
    page,
  }) => {
    skipWithoutData()
    const validates = collectPosts(page, VALIDATE_API_PATH)
    const creates = collectPosts(page, ORDERS_API_PATH)

    await openForm(page)
    await skipIfBlocked(page)
    await fillOrder(page)
    await expect(page.getByTestId('order-entry-ticker-hint')).toHaveText(stockLabel(stock))

    const outcome = await submitUntilSettled(page)
    // 実 API の判定結果を報告用に残す（確認画面へ進んだか、帯で止まったか）
    console.log(`[NR-02] 事前検証の結果: ${outcome}`)

    expect(validates.length).toBeGreaterThanOrEqual(1)
    for (const req of validates) {
      const body = JSON.parse(req.postData() ?? '{}')
      // 画面で打つのは Ticker だが、本文には銘柄マスタの 銘柄コード を載せる
      expect(body.銘柄コード).toBe(stock.銘柄コード)
      expect(body.口座番号).toBe(account.口座番号)
      expect(body.部店).toBe(account.部店コード)
    }
    expect(creates, '事前検証のスモークなのに POST /orders が送られた').toHaveLength(0)
  })

  test('[NR-03] 実 API に無い口座番号は「該当なし」で顧客バーは出ない', async ({
    page,
    playwright,
  }) => {
    skipWithoutData()

    // 9999999 から下へ、実 API の一致が無い口座番号を探す（固定値だと将来の行と衝突しうる）
    const api = await apiContext(playwright)
    let missing = null
    for (let candidate = 9999999; candidate > 9999899 && missing === null; candidate -= 1) {
      const rows = await firstPage(api, CUSTOMERS_API_PATH, CUSTOMERS_LIST_KEY, {
        branch_code: account.部店コード,
        account_no: candidate,
      })
      if (!rows.some((row) => row.口座番号 === candidate)) missing = String(candidate)
    }
    await api.dispose()
    test.skip(missing === null, '実 API に無い口座番号を選べなかった')

    await openForm(page)
    const lookup = page.waitForResponse(
      (res) =>
        pathnameOf(res.url()) === CUSTOMERS_API_PATH &&
        new URL(res.url()).searchParams.get('account_no') === missing,
    )
    await page.getByTestId('order-entry-branch').fill(account.部店コード)
    await page.getByTestId('order-entry-account').fill(missing)

    expect((await lookup).status(), '口座番号の照会が 200 で返っていない').toBe(200)
    await expect(page.getByTestId('order-entry-account-hint')).toHaveText('該当なし')
    await expect(page.getByTestId('order-entry-customer-bar')).toHaveCount(0)
  })

  test('[NR-04] 実 API に無いティッカーは「銘柄なし」で、送信しても事前検証へ進まない', async ({
    page,
    playwright,
  }) => {
    skipWithoutData()

    // 実在しそうにない綴りから、Ticker にも銘柄コードにも一致が無いものを選ぶ
    // （画面の照会と同じ ?symbol= で引く。stores/orderEntry.js の findSymbol）
    const api = await apiContext(playwright)
    let missing = null
    for (const candidate of ['ZZZZ', 'ZZZZZ', 'QZQZ', 'XZXZX', 'ZQZQZ']) {
      const rows = await firstPage(api, SYMBOLS_API_PATH, SYMBOLS_LIST_KEY, { symbol: candidate })
      const hit = (value) => (value ?? '').toUpperCase() === candidate
      if (!rows.some((row) => hit(row.Ticker) || hit(row.銘柄コード))) {
        missing = candidate
        break
      }
    }
    await api.dispose()
    test.skip(missing === null, '実 API に無いティッカーを選べなかった')

    const validates = collectPosts(page, VALIDATE_API_PATH)
    await openForm(page)
    await fillOrder(page, { ticker: missing })
    await expect(page.getByTestId('order-entry-ticker-hint')).toHaveText('銘柄なし')
    await page.getByTestId('order-entry-submit').click()

    await expect(
      page.getByTestId('order-entry-form').getByRole('alert').filter({ hasText: TICKER_NOT_FOUND }),
    ).toBeVisible()
    await expect(page.getByTestId('order-entry-confirm')).toHaveCount(0)
    expect(validates, '銘柄が無いのに事前検証が送られた').toHaveLength(0)
  })

  test('[NR-05] 顧客詳細からの引き継ぎクエリで開くと、入力欄に値が入り照会が走る', async ({
    page,
  }) => {
    skipWithoutData()
    // クエリ名は src/utils/orderEntryQuery.js の buildOrderEntryQuery と同じ
    const query = new URLSearchParams({
      branch_code: account.部店コード,
      account_number: accountText(account),
      ticker: stock.Ticker,
      side: 'buy',
    })
    await openForm(page, `?${query}`)

    await expect(page.getByTestId('order-entry-branch')).toHaveValue(account.部店コード)
    await expect(page.getByTestId('order-entry-account')).toHaveValue(accountText(account))
    await expect(page.getByTestId('order-entry-ticker')).toHaveValue(stock.Ticker.toUpperCase())
    await expect(sideButton(page, '買い')).toHaveAttribute('aria-pressed', 'true')

    await expect(page.getByTestId('order-entry-account-hint')).toHaveText(account.顧客名)
    await expect(page.getByTestId('order-entry-ticker-hint')).toHaveText(stockLabel(stock))
  })

  test('[NR-06] 注文を確定すると実 API が採番した注文 ID が完了画面に出て、取り消せる', async ({
    page,
    playwright,
  }) => {
    skipWithoutData()
    const creates = collectPosts(page, ORDERS_API_PATH)

    await openForm(page)
    await skipIfBlocked(page)
    await fillOrder(page)
    const outcome = await submitUntilSettled(page)
    test.skip(
      outcome !== 'confirm',
      '事前検証で確認画面へ進めなかった（実データの残高・余力・規制）。確定の前提が成り立たない',
    )

    await page.getByTestId('order-entry-final-check').check()
    const created = page.waitForResponse(
      (res) => res.request().method() === 'POST' && pathnameOf(res.url()) === ORDERS_API_PATH,
    )
    await page.getByTestId('order-entry-confirm-submit').click()
    const res = await created
    const body = JSON.parse(await logExchange('NR-06 create', res))

    // 応答を読んだらすぐ控える（以降の期待が落ちても afterAll が取り消す）
    if (Number.isInteger(body.order_id)) createdOrderIds.add(body.order_id)
    expect(res.ok(), `POST /orders が ${res.status()}`).toBe(true)
    expect(body.success, `登録が success:false: ${JSON.stringify(body)}`).toBe(true)
    expect(Number.isInteger(body.order_id), 'success:true なのに order_id が integer でない').toBe(
      true,
    )
    const orderId = body.order_id

    await expect(page.getByTestId('order-entry-complete')).toBeVisible()
    await expect(page.getByTestId('order-entry-complete')).toContainText('注文を受け付けました')
    await expect(page.getByTestId('order-entry-order-id')).toHaveText(`注文ID #${orderId}`)
    expect(creates).toHaveLength(1)

    const api = await apiContext(playwright)
    const detail = await api.get(`${ORDERS_API_PATH}/${orderId}`)
    expect(detail.ok(), `作った注文を GET /orders/${orderId} で読めない（${detail.status()}）`).toBe(
      true,
    )
    await cancelOrder(api, orderId)
    await api.dispose()
  })
})
