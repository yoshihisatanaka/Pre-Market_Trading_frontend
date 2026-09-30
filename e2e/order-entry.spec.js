import { expect, test } from '@playwright/test'
import { blackoutDates } from '../src/mocks/fixtures/blackoutDates'
import { noOperationOperator } from '../src/mocks/fixtures/currentOperator'
import { customers } from '../src/mocks/fixtures/customers'
import { fxRates } from '../src/mocks/fixtures/fxRates'

// GET /masters/fx/latest が返す行（基準日の昇順に並んだフィクスチャの末尾）
const latestUsdFxRate = fxRates.at(-1)
import { suspensionTargets } from '../src/mocks/fixtures/incidents'
import {
  FIRST_ORDER_ID,
  FLOCON_FX_RATE,
  orderCreateExamples,
  orderMessages,
} from '../src/mocks/fixtures/orderEntry'
import { symbols } from '../src/mocks/fixtures/symbols'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/order-entry.md（タイトル先頭の [NO-xx] が対応 ID）
// 新規注文（外株注文入力）は入力 → 確認 → 完了を 1 つのルートで切り替える。初期読み込みの 4 状態、
// 送信を受け付けない帯（権限なし・全体停止中）、口座番号・ティッカーの照会、止め方 3 種
// （画面の入力不備 / サーバの errors / サーバの warnings）、確定から次の注文までを実ブラウザで守る。
// 入口はサイドメニューに頼らず /orders/new を直接開く（メニュー項目は外す予定のため）。
// 既定モックは確定のたびに注文 ID を FIRST_ORDER_ID から採番する（ページを開くたびに初期化）。

const PATH = '/orders/new'

const SERVER_ERROR = 'サーバーでエラーが発生しました。'

const BRANCH = '123'

// フィクスチャはバックエンドの生の形（日本語キー・口座番号は integer）
const customerOf = (accountNumber) => customers.find((row) => row.口座番号 === accountNumber)
const symbolOf = (ticker) => symbols.find((row) => row.Ticker === ticker)

/** 警告の出ない顧客（コンプラ C・取引停止なし）。正常系はこれで通す */
const PLAIN = customerOf(1230004)
/** コンプラランク A（警告あり） */
const CAUTION = customerOf(1230001)
/** 全取引停止（警告あり） */
const SUSPENDED = customerOf(1230005)

const AAPL = symbolOf('AAPL')
const TSLA = symbolOf('TSLA')
const BRKB = symbolOf('BRK.B')

/** 確定の本文の前提が崩れていないか（フィクスチャが変わったらここで気づく） */
test.beforeAll(() => {
  expect(PLAIN.コンプラランク).toBe('C')
  expect(PLAIN.取引停止区分_全取引).toBe(0)
  expect(CAUTION.コンプラランク).toBe('A')
  expect(SUSPENDED.取引停止区分_全取引).toBe(1)
  expect(TSLA.VWAP対象区分).toBe('0')
  expect(BRKB.規制情報).toBe('1')
})

/** 'YYYYMMDD' の integer（端末のローカル日付。画面の「今日」と同じ時計で数える） */
function toApiDate(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return Number(`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`)
}

/** 画面を開き、入力フォームが描画されるまで待つ */
async function openForm(page) {
  await page.goto(PATH)
  await expect(page.getByTestId('order-entry-form')).toBeVisible()
}

function sideButton(page, name) {
  return page.getByTestId('order-entry-side').getByRole('button', { name, exact: true })
}

/** 部店・口座番号・ティッカー・売買・数量を入れる（ほかは既定値のまま） */
async function fillOrder(
  page,
  { account = String(PLAIN.口座番号), ticker = AAPL.Ticker, side = '買い', quantity = '10' } = {},
) {
  await page.getByTestId('order-entry-branch').fill(BRANCH)
  await page.getByTestId('order-entry-account').fill(account)
  await page.getByTestId('order-entry-ticker').fill(ticker)
  if (side) await sideButton(page, side).click()
  if (quantity) await page.getByTestId('order-entry-quantity').fill(quantity)
}

async function submitInput(page) {
  await page.getByTestId('order-entry-submit').click()
}

/** 正常系の注文を入れて確認画面まで進める */
async function goToConfirm(page, order) {
  await fillOrder(page, order)
  await submitInput(page)
  await expect(page.getByTestId('order-entry-confirm')).toBeVisible()
}

async function confirmOrder(page) {
  await page.getByTestId('order-entry-final-check').check()
  await page.getByTestId('order-entry-confirm-submit').click()
}

/** 期間指定でいま選ばれている選択肢の表示名 */
function selectedExpiry(page) {
  return page.getByTestId('order-entry-expiry').locator('option:checked')
}

/** 入力画面に留まっている（確認・完了へ進んでいない） */
async function expectStillInput(page) {
  await expect(page.getByTestId('order-entry-form')).toBeVisible()
  await expect(page.getByTestId('order-entry-confirm')).toHaveCount(0)
  await expect(page.getByTestId('order-entry-complete')).toHaveCount(0)
}

test.describe('新規注文 表示', () => {
  test('[NO-01] 画面を開くと入力フォームが既定値で表示される', async ({ page }) => {
    await openForm(page)

    await expect(page.getByRole('heading', { name: '新規注文', exact: true })).toBeVisible()
    await expect(page.getByTestId('order-entry-submit')).toBeEnabled()
    await expect(page.getByTestId('order-entry-submit')).toHaveText('送信')

    await expect(page.getByTestId('order-entry-loading')).toHaveCount(0)
    await expect(page.getByTestId('order-entry-error')).toHaveCount(0)
    await expect(page.getByTestId('order-entry-empty')).toHaveCount(0)
    await expect(page.getByTestId('order-entry-no-permission')).toHaveCount(0)
    await expect(page.getByTestId('order-entry-suspended')).toHaveCount(0)

    await expect(
      page.getByTestId('order-entry-execution-scope').locator('option:checked'),
    ).toHaveText('レギュラー')
    await expect(selectedExpiry(page)).toHaveText(/^当日中（\d{1,2}\/\d{1,2}）$/)
  })

  test('[NO-02] 受注不可日の取得が失敗するとエラーと再試行ボタンが出てフォームは出ない', async ({
    page,
  }) => {
    await mockApi(page, [
      { path: '*/api/masters/blackout-dates', status: 500, body: { detail: SERVER_ERROR } },
    ])
    await page.goto(PATH)

    const error = page.getByTestId('order-entry-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText(SERVER_ERROR)
    await expect(page.getByTestId('order-entry-retry')).toHaveText('再試行')
    await expect(page.getByTestId('order-entry-form')).toHaveCount(0)
  })

  test('[NO-03] 発注停止の状態の取得が失敗するとエラーと再試行ボタンが出てフォームは出ない', async ({
    page,
  }) => {
    await mockApi(page, [
      { path: '*/api/operations/order-suspensions', status: 500, body: { detail: SERVER_ERROR } },
    ])
    await page.goto(PATH)

    const error = page.getByTestId('order-entry-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText(SERVER_ERROR)
    await expect(page.getByTestId('order-entry-retry')).toBeVisible()
    await expect(page.getByTestId('order-entry-form')).toHaveCount(0)
  })

  test('[NO-04] 受注不可日が先読みの範囲を埋め尽くすと空の案内が出てフォームは出ない', async ({
    page,
  }) => {
    // 昨日から 50 日を受注不可日にする（画面の先読みは今日から 45 日）
    const today = new Date()
    const rows = Array.from({ length: 50 }, (_, index) => ({
      ...blackoutDates[0],
      ID: 9000 + index,
      受注不可日: toApiDate(
        new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1 + index),
      ),
    }))
    await mockApi(page, [
      {
        path: '*/api/masters/blackout-dates',
        body: { total: rows.length, limit: 50, offset: 0, blackout_dates: rows },
      },
    ])
    await page.goto(PATH)

    const empty = page.getByTestId('order-entry-empty')
    await expect(empty).toBeVisible()
    await expect(empty).toContainText('期間指定に選べる営業日がありません。')
    await expect(page.getByTestId('order-entry-form')).toHaveCount(0)
  })

  test('[NO-05] 発注権限が無いと権限なしの帯が出て送信できない', async ({ page }) => {
    expect(noOperationOperator.権限.order).toBe(false)
    await mockApi(page, [{ path: '*/api/auth/me', body: noOperationOperator }])
    await openForm(page)

    const banner = page.getByTestId('order-entry-no-permission')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('このロールには発注権限がありません。')
    await expect(page.getByTestId('order-entry-submit')).toBeDisabled()
  })

  test('[NO-06] 全体が発注停止中だと停止中の帯が出て送信できない', async ({ page }) => {
    const targets = suspensionTargets.map((row) =>
      row.停止対象 === 'ALL' ? { ...row, 発注停止中: true } : { ...row },
    )
    await mockApi(page, [
      {
        path: '*/api/operations/order-suspensions',
        body: { 発注停止中: true, 全体停止中: true, 停止中の対象: ['ALL'], targets },
      },
    ])
    await openForm(page)

    const banner = page.getByTestId('order-entry-suspended')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText(
      '現在、システム障害対応のため、新規の注文入力を停止しています。',
    )
    await expect(page.getByTestId('order-entry-submit')).toBeDisabled()
  })
})

test.describe('新規注文 顧客・銘柄の照会', () => {
  test('[NO-07] 口座番号を入れると顧客名と顧客バーが出る', async ({ page }) => {
    await openForm(page)
    await page.getByTestId('order-entry-branch').fill(BRANCH)
    await page.getByTestId('order-entry-account').fill(String(PLAIN.口座番号))

    await expect(page.getByTestId('order-entry-account-hint')).toHaveText(PLAIN.顧客名)
    await expect(page.getByTestId('order-entry-customer-bar')).toBeVisible()
    await expect(page.getByTestId('order-entry-customer-name')).toHaveText(PLAIN.顧客名)
    await expect(page.getByTestId('order-entry-customer-compliance')).toHaveCount(0)
    await expect(page.getByTestId('order-entry-customer-suspended')).toHaveCount(0)
  })

  test('[NO-08] コンプラランク A の顧客は顧客バーに要注意が出る', async ({ page }) => {
    await openForm(page)
    await page.getByTestId('order-entry-branch').fill(BRANCH)
    await page.getByTestId('order-entry-account').fill(String(CAUTION.口座番号))

    await expect(page.getByTestId('order-entry-customer-name')).toHaveText(CAUTION.顧客名)
    await expect(page.getByTestId('order-entry-customer-compliance')).toHaveText(
      `コンプラ ${CAUTION.コンプラランク} 要注意`,
    )
  })

  test('[NO-09] 全取引停止の顧客は顧客バーに全取引停止が出る', async ({ page }) => {
    await openForm(page)
    await page.getByTestId('order-entry-branch').fill(BRANCH)
    await page.getByTestId('order-entry-account').fill(String(SUSPENDED.口座番号))

    await expect(page.getByTestId('order-entry-customer-name')).toHaveText(SUSPENDED.顧客名)
    await expect(page.getByTestId('order-entry-customer-suspended')).toHaveText('全取引停止')
  })

  test('[NO-10] 存在しない口座番号は「該当なし」で顧客バーは出ない', async ({ page }) => {
    expect(customerOf(1239999)).toBeUndefined()
    await openForm(page)
    await page.getByTestId('order-entry-branch').fill(BRANCH)
    await page.getByTestId('order-entry-account').fill('1239999')

    await expect(page.getByTestId('order-entry-account-hint')).toHaveText('該当なし')
    await expect(page.getByTestId('order-entry-customer-bar')).toHaveCount(0)
  })

  test('[NO-11] 小文字のティッカーは大文字になり英字の銘柄名が出る', async ({ page }) => {
    await openForm(page)
    await page.getByTestId('order-entry-ticker').fill(AAPL.Ticker.toLowerCase())

    await expect(page.getByTestId('order-entry-ticker')).toHaveValue(AAPL.Ticker)
    await expect(page.getByTestId('order-entry-ticker-hint')).toHaveText(AAPL.銘柄名_英字)
  })

  test('[NO-12] 存在しないティッカーは「銘柄なし」で送信すると項目の下に理由が出る', async ({
    page,
  }) => {
    expect(symbolOf('ZZZZ')).toBeUndefined()
    await openForm(page)
    await fillOrder(page, { ticker: 'ZZZZ' })
    await submitInput(page)

    await expect(page.getByTestId('order-entry-ticker-hint')).toHaveText('銘柄なし')
    await expect(
      page.getByTestId('order-entry-form').getByRole('alert').filter({
        hasText: orderMessages.symbolNotFound,
      }),
    ).toBeVisible()
    await expectStillInput(page)
  })
})

test.describe('新規注文 入力の不備とサーバの判定', () => {
  test('[NO-13] 何も入れずに送信すると必須項目の不備が各項目の下に出る', async ({ page }) => {
    await openForm(page)
    await submitInput(page)

    const alerts = page.getByTestId('order-entry-form').getByRole('alert')
    await expect(alerts.filter({ hasText: '部店コードを入力してください。' })).toBeVisible()
    await expect(alerts.filter({ hasText: '口座番号を入力してください。' })).toBeVisible()
    await expect(alerts.filter({ hasText: '銘柄コードを入力してください。' })).toBeVisible()
    await expect(alerts.filter({ hasText: '売買区分を選択してください。' })).toBeVisible()
    await expect(alerts.filter({ hasText: '注文数量を入力してください。' })).toBeVisible()

    await expectStillInput(page)
    await expect(page.getByTestId('order-entry-errors')).toHaveCount(0)
    await expect(page.getByTestId('order-entry-warnings')).toHaveCount(0)
  })

  test('[NO-14] 買いで成長投資枠を選ぶと預り売買区分の下に理由が出る', async ({ page }) => {
    await openForm(page)
    await fillOrder(page)
    await page
      .getByTestId('order-entry-deposit-category')
      .getByRole('button', { name: '成長投資枠', exact: true })
      .click()
    await submitInput(page)

    await expect(
      page.getByTestId('order-entry-form').getByRole('alert').filter({
        hasText: orderMessages.growthOnBuy,
      }),
    ).toBeVisible()
    await expectStillInput(page)
  })

  test('[NO-15] VWAP 対象外の銘柄で VWAP を選ぶと注文種別の下に理由が出る', async ({ page }) => {
    await openForm(page)
    await fillOrder(page, { ticker: TSLA.Ticker })
    await expect(page.getByTestId('order-entry-ticker-hint')).toHaveText(TSLA.銘柄名_英字)
    await page
      .getByTestId('order-entry-vwap')
      .getByRole('button', { name: 'VWAP', exact: true })
      .click()
    await submitInput(page)

    await expect(
      page.getByTestId('order-entry-form').getByRole('alert').filter({
        hasText: orderMessages.vwapNotTarget,
      }),
    ).toBeVisible()
    await expectStillInput(page)
  })

  test('[NO-16] 取引不可の銘柄はサーバの「入力エラー」の帯で止まる', async ({ page }) => {
    await openForm(page)
    await fillOrder(page, { ticker: BRKB.Ticker })
    await submitInput(page)

    const errors = page.getByTestId('order-entry-errors')
    await expect(errors).toBeVisible()
    await expect(errors).toContainText('入力エラー')
    await expect(errors).toContainText(orderMessages.prohibited)
    await expectStillInput(page)
  })

  test('[NO-17] コンプラランク A の顧客はフロコン警告の帯で止まる', async ({ page }) => {
    await openForm(page)
    await fillOrder(page, { account: String(CAUTION.口座番号) })
    await submitInput(page)

    const warnings = page.getByTestId('order-entry-warnings')
    await expect(warnings).toBeVisible()
    await expect(warnings).toContainText('フロコン警告')
    await expect(warnings).toContainText(orderMessages.complianceRank(CAUTION.コンプラランク))
    await expect(page.getByTestId('order-entry-forced-note')).toHaveText(
      'フロコン警告あり — 確認の上チェック',
    )
    await expectStillInput(page)
  })

  test('[NO-18] 警告のあと強制区分を付けて送り直すと確認へ進み警告が確認済で出る', async ({
    page,
  }) => {
    await openForm(page)
    await fillOrder(page, { account: String(CAUTION.口座番号) })
    await submitInput(page)
    await expect(page.getByTestId('order-entry-warnings')).toBeVisible()

    await page.getByTestId('order-entry-forced').check()
    await submitInput(page)

    await expect(page.getByTestId('order-entry-confirm')).toBeVisible()
    const confirmed = page.getByTestId('order-entry-confirmed-warnings')
    await expect(confirmed).toContainText('フロコン警告（確認済）')
    await expect(confirmed).toContainText(orderMessages.complianceRank(CAUTION.コンプラランク))
  })

  test('[NO-19] 概算が 5,000 万円を超える数量は大口取引の警告で止まる', async ({ page }) => {
    const quantity = 100000
    // モックのフロコン判定と同じ式（数量 × 前日終値 × 固定レート）
    const amount = Math.round(quantity * AAPL.前日終値 * FLOCON_FX_RATE)

    await openForm(page)
    await fillOrder(page, { quantity: String(quantity) })
    await submitInput(page)

    const warnings = page.getByTestId('order-entry-warnings')
    await expect(warnings).toBeVisible()
    await expect(warnings).toContainText(orderMessages.largeTrade(amount))
    await expectStillInput(page)
  })
})

test.describe('新規注文 確認', () => {
  test('[NO-20] 成行の注文を送信すると確認画面に注文内容と概算が読み上げられる', async ({
    page,
  }) => {
    const quantity = 10
    await openForm(page)
    const expiryLabel = (await selectedExpiry(page).textContent()).trim()
    await goToConfirm(page, { quantity: String(quantity) })

    await expect(page.getByTestId('order-readback-customer')).toHaveText(PLAIN.顧客名)
    await expect(page.getByTestId('order-readback-account')).toHaveText(
      `${BRANCH} / ${PLAIN.口座番号}`,
    )
    const symbol = page.getByTestId('order-readback-symbol')
    await expect(symbol).toContainText(AAPL.Ticker)
    await expect(symbol).toContainText(AAPL.銘柄名_英字)
    await expect(page.getByTestId('order-readback-side')).toHaveText('買（委託）')
    await expect(page.getByTestId('order-readback-price')).toHaveText('成行')
    await expect(page.getByTestId('order-readback-quantity')).toHaveText(`${quantity} 株`)
    await expect(page.getByTestId('order-readback-market-expiry')).toHaveText(
      `レギュラー ／ ${expiryLabel}`,
    )

    // 成行の概算は 前日終値 × 数量、円貨は為替マスタの直近レートを掛ける
    const usd = Math.round(quantity * AAPL.前日終値 * 100) / 100
    const jpy = Math.round(usd * latestUsdFxRate.為替レート)
    await expect(page.getByTestId('order-readback-estimate-usd')).toContainText(
      usd.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    )
    await expect(page.getByTestId('order-readback-estimate-jpy')).toHaveText(
      `${jpy.toLocaleString('ja-JP')} 円`,
    )
    await expect(page.getByTestId('order-readback-estimate-note')).toContainText(
      `参考価格（前日終値） × 数量 ／ USD/JPY ${latestUsdFxRate.為替レート.toFixed(2)}`,
    )
  })

  test('[NO-21] 指値の注文は確認画面の価格が指値になり概算の注記が指値価格になる', async ({
    page,
  }) => {
    await openForm(page)
    await fillOrder(page)
    await page
      .getByTestId('order-entry-order-type')
      .getByRole('button', { name: '指値', exact: true })
      .click()
    await page.getByTestId('order-entry-limit-price').fill('200')
    await submitInput(page)

    await expect(page.getByTestId('order-entry-confirm')).toBeVisible()
    await expect(page.getByTestId('order-readback-price')).toHaveText('指値 200.0000 ドル')
    await expect(page.getByTestId('order-readback-estimate-note')).toContainText('指値価格 × 数量')
  })

  test('[NO-22] 最終確認にチェックするまで「注文を確定」は押せない', async ({ page }) => {
    await openForm(page)
    await goToConfirm(page)

    const confirmButton = page.getByTestId('order-entry-confirm-submit')
    await expect(confirmButton).toHaveText('注文を確定')
    await expect(confirmButton).toBeDisabled()

    await page.getByTestId('order-entry-final-check').check()
    await expect(confirmButton).toBeEnabled()
  })

  test('[NO-23] 「入力へ戻る」で入力画面に戻り入力が残っている', async ({ page }) => {
    await openForm(page)
    await goToConfirm(page)

    await page.getByTestId('order-entry-back').click()

    await expect(page.getByTestId('order-entry-form')).toBeVisible()
    await expect(page.getByTestId('order-entry-confirm')).toHaveCount(0)
    await expect(page.getByTestId('order-entry-account')).toHaveValue(String(PLAIN.口座番号))
    await expect(page.getByTestId('order-entry-ticker')).toHaveValue(AAPL.Ticker)
    await expect(page.getByTestId('order-entry-quantity')).toHaveValue('10')
  })
})

test.describe('新規注文 確定と次の注文', () => {
  test('[NO-24] 注文を確定すると完了画面に受付の文言と注文 ID が出る', async ({ page }) => {
    await openForm(page)
    await goToConfirm(page)
    await confirmOrder(page)

    await expect(page.getByTestId('order-entry-complete')).toBeVisible()
    await expect(page.getByTestId('order-entry-complete-message')).toContainText(
      orderMessages.created,
    )
    await expect(page.getByTestId('order-entry-order-id')).toHaveText(`注文ID #${FIRST_ORDER_ID}`)
  })

  test('[NO-25] 「同じ顧客で新規注文」は部店・口座番号を残し、2 件目は次の注文 ID になる', async ({
    page,
  }) => {
    await openForm(page)
    await goToConfirm(page)
    await confirmOrder(page)
    await expect(page.getByTestId('order-entry-order-id')).toHaveText(`注文ID #${FIRST_ORDER_ID}`)

    await page.getByTestId('order-entry-new-same-customer').click()

    await expect(page.getByTestId('order-entry-form')).toBeVisible()
    await expect(page.getByTestId('order-entry-branch')).toHaveValue(BRANCH)
    await expect(page.getByTestId('order-entry-account')).toHaveValue(String(PLAIN.口座番号))
    await expect(page.getByTestId('order-entry-ticker')).toHaveValue('')
    await expect(page.getByTestId('order-entry-quantity')).toHaveValue('')

    await page.getByTestId('order-entry-ticker').fill(AAPL.Ticker)
    await sideButton(page, '買い').click()
    await page.getByTestId('order-entry-quantity').fill('10')
    await submitInput(page)
    await expect(page.getByTestId('order-entry-confirm')).toBeVisible()
    await confirmOrder(page)

    await expect(page.getByTestId('order-entry-order-id')).toHaveText(
      `注文ID #${FIRST_ORDER_ID + 1}`,
    )
  })

  test('[NO-26] 「別の顧客で新規注文」は部店・口座番号も空にして入力へ戻る', async ({ page }) => {
    await openForm(page)
    await goToConfirm(page)
    await confirmOrder(page)
    await expect(page.getByTestId('order-entry-complete')).toBeVisible()

    await page.getByTestId('order-entry-new-order').click()

    await expect(page.getByTestId('order-entry-form')).toBeVisible()
    await expect(page.getByTestId('order-entry-branch')).toHaveValue('')
    await expect(page.getByTestId('order-entry-account')).toHaveValue('')
    await expect(page.getByTestId('order-entry-customer-bar')).toHaveCount(0)
  })

  test('[NO-27] 「注文照会へ」で注文照会の画面へ移る', async ({ page }) => {
    await openForm(page)
    await goToConfirm(page)
    await confirmOrder(page)
    await expect(page.getByTestId('order-entry-complete')).toBeVisible()

    await page.getByTestId('order-entry-to-inquiry').click()

    await expect(page).toHaveURL(/\/orders\/inquiry$/)
  })
})

test.describe('新規注文 通信・サーバの障害', () => {
  test('[NO-28] 事前検証が 500 だと入力画面のまま理由の帯が出て入力が残る', async ({ page }) => {
    await mockApi(page, [
      {
        method: 'post',
        path: '*/api/orders/validate',
        status: 500,
        body: { detail: SERVER_ERROR },
      },
    ])
    await openForm(page)
    await fillOrder(page)
    await submitInput(page)

    const error = page.getByTestId('order-entry-validate-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText(SERVER_ERROR)
    await expectStillInput(page)
    await expect(page.getByTestId('order-entry-account')).toHaveValue(String(PLAIN.口座番号))
    await expect(page.getByTestId('order-entry-quantity')).toHaveValue('10')
  })

  test('[NO-29] 登録が 500 だと確認画面のまま理由の帯が出る', async ({ page }) => {
    await mockApi(page, [
      { method: 'post', path: '*/api/orders', status: 500, body: { detail: SERVER_ERROR } },
    ])
    await openForm(page)
    await goToConfirm(page)
    await confirmOrder(page)

    const error = page.getByTestId('order-entry-submit-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText(SERVER_ERROR)
    await expect(page.getByTestId('order-entry-confirm')).toBeVisible()
    await expect(page.getByTestId('order-entry-complete')).toHaveCount(0)
  })

  test('[NO-30] 登録が不受付（success:false）だと確認画面のままサーバの文言と理由が出る', async ({
    page,
  }) => {
    const rejected = orderCreateExamples.find((example) => !example.success)
    await mockApi(page, [{ method: 'post', path: '*/api/orders', body: rejected }])
    await openForm(page)
    await goToConfirm(page)
    await confirmOrder(page)

    const banner = page.getByTestId('order-entry-rejected')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText(rejected.message)
    for (const reason of rejected.errors) await expect(banner).toContainText(reason)
    await expect(page.getByTestId('order-entry-confirm')).toBeVisible()
    await expect(page.getByTestId('order-entry-complete')).toHaveCount(0)
  })
})
