import { expect, test } from '@playwright/test'
import { noOperationOperator } from '../src/mocks/fixtures/currentOperator'
import { orderInquiryRows } from '../src/mocks/fixtures/orderInquiry'
import { formatQuantity, formatUsd } from '../src/utils/format'
import { mockApi } from './helpers/mockApi'
import {
  INQUIRY_PATH,
  MARKET_SCOPE_LABELS,
  cellOf,
  fixtureRow,
  latestVersionOf,
  rowOf,
  rowsOf,
} from './helpers/orderInquiry'

// シナリオ: docs/e2e/order-amend.md（タイトル先頭の [OAM-nn] が対応 ID）
// 注文照会の「訂正」から入る外株注文訂正の画面。対象注文の表示、4 状態（エラー / 注文が無い / 訂正不可 /
// データあり）、発注権限なしの門前払い、入力検査、訂正の受付（その場で書き換え / 取消して訂正注文を作る）と
// 一覧への反映、戻る導線を守る。
// 既定ハンドラ（src/mocks/handlers/orders.js）は訂正の結果を保持するが、ページを読み込むたびに初期化される。
// 結果の反映は画面内の遷移（「注文照会へ戻る」）で一覧に戻って確かめる（page.goto し直すと消える）。

const AUTH_ME_PATH = '*/api/auth/me'
const SERVER_ERROR = 'サーバーでエラーが発生しました。'

/** 売買区分コード → 訂正画面の表記（src/views/OrderAmendView.vue の sideLabels） */
const SIDE_LABELS = { 1: '売', 3: '買' }

/*
 * 処理状況コード → 名前。src/utils/orderTypes.js の ORDER_STATUS_NAMES の写し（使う分だけ）。
 * あのファイルは '@/utils/format' を import しており Playwright から読めないので再掲する。
 */
const STATUS_LABELS = { '000': '未発注', '003': '注文中', '010': '一部出来', '011': '全部出来' }

// 使う注文。#36 は #30 の最新版（未発注）、#34 は注文中、#35 は一部出来、#41 は全部出来
const PENDING = latestVersionOf(30)
const WORKING = fixtureRow(34)
const PARTIAL = fixtureRow(35)
const FILLED = fixtureRow(41)

/** 訂正注文に振られる ID（既定ハンドラは既存の最大 ID + 1 を振る） */
const NEXT_ORDER_ID = Math.max(...orderInquiryRows.map((row) => row.ID)) + 1

const amendPath = (id) => `/orders/${id}/amend`

/** 原注文の要約（「25株 ／ 指値 143.50 ドル」「3,000株 ／ 成行」） */
function originalLabel(row) {
  const price = row.指成区分 === 'LO' ? `指値 ${formatUsd(row.指値単価)}` : '成行'
  return `${formatQuantity(row.数量)}株 ／ ${price}`
}

/** フォームの中で、項目の下に出る入力検査の文言 */
function fieldError(page, message) {
  return page.getByTestId('order-amend-form').getByText(message, { exact: true })
}

/** 入力検査で止まったこと（完了表示に切り替わらず、フォームが残る） */
async function expectNotSubmitted(page) {
  await expect(page.getByTestId('order-amend-complete')).toHaveCount(0)
  await expect(page.getByTestId('order-amend-form')).toBeVisible()
}

/** 対象注文の読み込みを待つ（入力欄が現在値で埋まるまで） */
async function openAmend(page, row) {
  await page.goto(amendPath(row.ID))
  await expect(page.getByTestId('order-amend-quantity')).toHaveValue(String(row.数量))
}

test.describe('注文訂正', () => {
  test('[OAM-01] 注文照会の「訂正」から開くと対象注文と現在値が出る', async ({ page }) => {
    await page.goto(INQUIRY_PATH)
    await rowOf(page, 30).getByTestId('order-inquiry-amend').click()

    await expect(page).toHaveURL(new RegExp(`${amendPath(PENDING.ID)}$`))
    await expect(page.getByRole('heading', { name: '外株注文訂正', exact: true })).toBeVisible()
    await expect(page.getByTestId('order-amend-status')).toHaveText(STATUS_LABELS[PENDING.処理状況])
    await expect(page.getByTestId('order-amend-summary').getByRole('definition')).toHaveText([
      `#${PENDING.ID}`,
      `部店 ${PENDING.部店} ／ 口座 ${PENDING.口座番号}`,
      PENDING.銘柄コード,
      SIDE_LABELS[PENDING.売買区分],
      originalLabel(PENDING),
      MARKET_SCOPE_LABELS[PENDING.発注範囲],
      `${formatQuantity(PENDING.出来数量)}株`,
      new RegExp(PENDING.受注時刻.slice(0, 5)),
    ])

    await expect(page.getByTestId('order-amend-quantity')).toHaveValue(String(PENDING.数量))
    await expect(page.getByTestId('order-amend-limit-price')).toHaveValue(
      String(PENDING.指値単価),
    )
    await expect(page.getByTestId('order-amend-market-scope')).toHaveValue(PENDING.発注範囲)
    await expect(
      page.getByTestId('order-amend-order-type').getByRole('button', { name: '指値' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  test('[OAM-02] URL を直接開いても表示でき、一部出来は出来分を含む総数量を求める', async ({
    page,
  }) => {
    await openAmend(page, PARTIAL)

    await expect(page.getByTestId('order-amend-status')).toHaveText(STATUS_LABELS[PARTIAL.処理状況])
    const summary = page.getByTestId('order-amend-summary')
    await expect(summary).toContainText(PARTIAL.銘柄コード)
    await expect(page.getByTestId('order-amend-original')).toHaveText(originalLabel(PARTIAL))
    await expect(summary).toContainText(`${formatQuantity(PARTIAL.出来数量)}株`)
    await expect(
      page.getByText(`出来数量 ${formatQuantity(PARTIAL.出来数量)}株を含む総数量`),
    ).toBeVisible()
    await expect(page.getByTestId('order-amend-limit-price')).toHaveCount(0)
  })

  test('[OAM-03] 存在しない注文は「見つかりません」になり、注文照会へ戻れる', async ({ page }) => {
    await page.goto(amendPath(999))

    const notFound = page.getByTestId('order-amend-not-found')
    await expect(notFound).toContainText('注文が見つかりませんでした。')
    await expect(page.getByTestId('order-amend-form')).toHaveCount(0)

    await notFound.getByRole('button', { name: '注文照会へ戻る' }).click()
    await expect(page).toHaveURL(new RegExp(`${INQUIRY_PATH}$`))
  })

  test('[OAM-04] 対象注文の取得に失敗するとエラーと再試行が出る', async ({ page }) => {
    await mockApi(page, [
      { path: `*/api/orders/${PENDING.ID}`, status: 500, body: { detail: SERVER_ERROR } },
    ])
    await page.goto(amendPath(PENDING.ID))

    const error = page.getByTestId('order-amend-error')
    await expect(error).toContainText(SERVER_ERROR)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('order-amend-form')).toHaveCount(0)
  })

  test('[OAM-05] 発注権限が無いと権限なしの画面へ回される', async ({ page }) => {
    expect(noOperationOperator.権限.order).toBe(false)
    await mockApi(page, [{ path: AUTH_ME_PATH, body: noOperationOperator }])
    await page.goto(amendPath(PENDING.ID))

    // URL はガードが /auth/me を読み、遷移先（遅延 import の ForbiddenView）を読み終えてから変わる。
    // 並列実行で dev サーバの初回変換が重なると 5 秒を越えることがあるので猶予を延ばす
    await expect(page).toHaveURL(/\/forbidden$/, { timeout: 15_000 })
    await expect(
      page.getByRole('heading', { name: 'アクセス権限がありません', exact: true }),
    ).toBeVisible()
    await expect(page.getByTestId('forbidden-message')).toHaveText(
      'この画面を開く権限がありません。',
    )
    await expect(page.getByTestId('order-amend-form')).toHaveCount(0)
  })

  test('[OAM-06] 訂正できない状況の注文はフォームを出さない', async ({ page }) => {
    await page.goto(amendPath(FILLED.ID))

    await expect(page.getByTestId('order-amend-locked')).toHaveText(
      `この注文は訂正できません（処理状況: ${STATUS_LABELS[FILLED.処理状況]}）。`,
    )
    await expect(page.getByTestId('order-amend-form')).toHaveCount(0)
    await expect(page.getByTestId('order-amend-submit')).toHaveCount(0)
    await expect(page.getByTestId('order-amend-back')).toBeVisible()
  })

  test('[OAM-08] 数量が整数でないと止める', async ({ page }) => {
    await openAmend(page, PENDING)

    await page.getByTestId('order-amend-quantity').fill('1.5')
    await page.getByTestId('order-amend-submit').click()

    await expect(fieldError(page, '注文数量を整数で入力してください。')).toBeVisible()
    await expectNotSubmitted(page)
  })

  test('[OAM-09] 数量が 1 未満だと止める', async ({ page }) => {
    await openAmend(page, PENDING)

    await page.getByTestId('order-amend-quantity').fill('0')
    await page.getByTestId('order-amend-submit').click()

    await expect(fieldError(page, '注文数量は1以上で入力してください。')).toBeVisible()
    await expectNotSubmitted(page)
  })

  test('[OAM-10] 数量が出来数量以下だと止める', async ({ page }) => {
    await openAmend(page, PARTIAL)

    await page.getByTestId('order-amend-quantity').fill(String(PARTIAL.出来数量))
    await page.getByTestId('order-amend-submit').click()

    await expect(
      fieldError(
        page,
        `注文数量は出来数量（${formatQuantity(PARTIAL.出来数量)}株）より大きい数を入力してください。`,
      ),
    ).toBeVisible()
    await expectNotSubmitted(page)
  })

  test('[OAM-12] 指値価格が 0 以下だと止める', async ({ page }) => {
    await openAmend(page, PENDING)

    await page.getByTestId('order-amend-limit-price').fill('0')
    await page.getByTestId('order-amend-submit').click()

    await expect(fieldError(page, '指値価格は0より大きい数値を入力してください。')).toBeVisible()
    await expectNotSubmitted(page)
  })

  test('[OAM-13] 指値価格が小数第 5 位以下まであると止める', async ({ page }) => {
    await openAmend(page, PENDING)

    await page.getByTestId('order-amend-limit-price').fill('143.12345')
    await page.getByTestId('order-amend-submit').click()

    await expect(
      fieldError(page, '指値には、「小数点第４位以内」で入力してください。'),
    ).toBeVisible()
    await expectNotSubmitted(page)
  })

  test('[OAM-14] 何も変えずに登録すると止める', async ({ page }) => {
    await openAmend(page, PENDING)

    await page.getByTestId('order-amend-submit').click()

    await expect(page.getByTestId('order-amend-form-error')).toHaveText(
      '変更された項目がありません。',
    )
    await expectNotSubmitted(page)
  })

  test('[OAM-15] 未発注の注文はその場で訂正され、一覧の数量が変わる', async ({ page }) => {
    const NEW_QUANTITY = PENDING.数量 + 5
    await page.goto(INQUIRY_PATH)
    await rowOf(page, 30).getByTestId('order-inquiry-amend').click()
    await expect(page.getByTestId('order-amend-quantity')).toHaveValue(String(PENDING.数量))

    await page.getByTestId('order-amend-quantity').fill(String(NEW_QUANTITY))
    await page.getByTestId('order-amend-submit').click()

    // 文言はサーバ（既定ハンドラ）が決め、画面はそのまま出す
    await expect(page.getByTestId('order-amend-complete-message')).toHaveText(
      `注文を訂正しました（注文ID: ${PENDING.ID}）`,
    )
    await expect(page.getByTestId('order-amend-complete-detail')).toHaveText(
      `未発注の注文 #${PENDING.ID} をその場で訂正しました。`,
    )

    await page.getByTestId('order-amend-back-to-list').click()

    await expect(page).toHaveURL(new RegExp(`${INQUIRY_PATH}$`))
    await expect(cellOf(rowOf(page, 30), '数量')).toHaveText(formatQuantity(NEW_QUANTITY))
  })

  test('[OAM-16] 注文中の注文は取消して訂正注文を作り、一覧は訂正注文を最新版として出す', async ({
    page,
  }) => {
    const NEW_PRICE = 230
    await page.goto(INQUIRY_PATH)
    await rowOf(page, WORKING.ID).getByTestId('order-inquiry-amend').click()
    await expect(page.getByTestId('order-amend-quantity')).toHaveValue(String(WORKING.数量))

    await page.getByTestId('order-amend-order-type').getByRole('button', { name: '指値' }).click()
    await page.getByTestId('order-amend-limit-price').fill(String(NEW_PRICE))
    await page.getByTestId('order-amend-submit').click()

    await expect(page.getByTestId('order-amend-complete-message')).toHaveText(
      `訂正注文を受け付けました（訂正注文ID: ${NEXT_ORDER_ID}）`,
    )
    await expect(page.getByTestId('order-amend-complete-detail')).toContainText(
      `原注文 #${WORKING.ID} の取消を依頼し、訂正注文 #${NEXT_ORDER_ID} を受け付けました。`,
    )

    await page.getByTestId('order-amend-back-to-list').click()

    await expect(page).toHaveURL(new RegExp(`${INQUIRY_PATH}$`))
    const row = rowOf(page, WORKING.ID)
    await expect(cellOf(row, '注文ID')).toContainText('訂正 1回')
    await expect(cellOf(row, '指値／成行')).toHaveText('指値')
    await expect(cellOf(row, '価格')).toHaveText(formatUsd(NEW_PRICE))
    await expect(cellOf(row, '出来状況')).toHaveText('訂正待ち')

    await row.getByTestId('order-inquiry-history-toggle').click()
    const original = page.getByTestId('order-inquiry-history-row')
    await expect(original).toHaveCount(1)
    await expect(original).toContainText(`#${WORKING.ID}`)
    await expect(original).toContainText('取消中')
  })

  test('[OAM-17] サーバが訂正を拒否すると理由が出て、入力は残る', async ({ page }) => {
    const REJECTED = 'この注文は訂正できません（テスト）'
    const NEW_QUANTITY = String(PENDING.数量 + 5)
    await mockApi(page, [
      {
        method: 'post',
        path: `*/api/orders/${PENDING.ID}/amend`,
        status: 400,
        body: { detail: REJECTED },
      },
    ])
    await openAmend(page, PENDING)

    await page.getByTestId('order-amend-quantity').fill(NEW_QUANTITY)
    await page.getByTestId('order-amend-submit').click()

    await expect(page.getByTestId('order-amend-submit-error')).toHaveText(REJECTED)
    await expectNotSubmitted(page)
    await expect(page.getByTestId('order-amend-quantity')).toHaveValue(NEW_QUANTITY)
  })

  test('[OAM-18] 「戻る」で検索条件の付いた注文照会へ戻る', async ({ page }) => {
    const SYMBOL = PENDING.銘柄コード
    await page.goto(`${INQUIRY_PATH}?symbol=${SYMBOL}`)
    await expect(rowsOf(page)).toHaveCount(1)
    await rowOf(page, 30).getByTestId('order-inquiry-amend').click()
    await expect(page).toHaveURL(new RegExp(`${amendPath(PENDING.ID)}$`))

    await page.getByTestId('order-amend-back').click()

    await expect(page).toHaveURL(new RegExp(`${INQUIRY_PATH}\\?symbol=${SYMBOL}$`))
    await expect(page.getByTestId('order-inquiry-symbol')).toHaveValue(SYMBOL)
    await expect(rowsOf(page)).toHaveCount(1)
  })
})
