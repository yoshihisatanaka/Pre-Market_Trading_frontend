import { expect, test } from '@playwright/test'
import { noOperationOperator } from '../src/mocks/fixtures/currentOperator'
import { formatQuantity } from '../src/utils/format'
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

// シナリオ: docs/e2e/order-cancel.md（タイトル先頭の [OCN-nn] が対応 ID）
// 注文照会の「取消」から入る注文取消の画面。対象注文の要約と取消後の扱い、4 状態（エラー / 注文が無い /
// 取消不可 / データあり）、発注権限なしの門前払い、取消の受付（即時取消 / 取消依頼）と一覧への反映、戻る導線を守る。
// 既定ハンドラ（src/mocks/handlers/orders.js）は取消の結果を保持するが、ページを読み込むたびに初期化される。
// 結果の反映は画面内の遷移（「注文照会へ戻る」）で一覧に戻って確かめる（page.goto し直すと消える）。

const AUTH_ME_PATH = '*/api/auth/me'
const SERVER_ERROR = 'サーバーでエラーが発生しました。'

/** 売買区分コード → 取消画面の表記（src/views/OrderCancelView.vue の sideLabels。一覧より一語長い） */
const SIDE_LABELS = { 1: '売り', 3: '買い' }

/*
 * 処理状況コード → 名前。src/utils/orderTypes.js の ORDER_STATUS_NAMES の写し（使う分だけ）。
 * あのファイルは '@/utils/format' を import しており Playwright から読めないので再掲する。
 */
const STATUS_LABELS = { '000': '未発注', '010': '一部出来', '011': '全部出来' }

// 使う注文。#36 は #30 の最新版（未発注）、#35 は一部出来、#41 は全部出来
const PENDING = latestVersionOf(30)
const PARTIAL = fixtureRow(35)
const FILLED = fixtureRow(41)

const cancelPath = (id) => `/orders/${id}/cancel`

/** 取消対象（未約定残）の株数 */
const cancelQuantityOf = (row) => row.数量 - row.出来数量

/** 画面の要約で出す価格（「成行」「指値 143.50 ドル」） */
function priceLabel(row) {
  if (row.指成区分 === 'MO') return '成行'
  return `指値 ${row.指値単価.toFixed(2)} ドル`
}

test.describe('注文取消', () => {
  test('[OCN-01] 注文照会の「取消」から開くと対象注文と取消後の扱いが出る', async ({ page }) => {
    await page.goto(INQUIRY_PATH)
    await rowOf(page, PARTIAL.ID).getByTestId('order-inquiry-cancel').click()

    await expect(page).toHaveURL(new RegExp(`${cancelPath(PARTIAL.ID)}$`))
    await expect(page.getByRole('heading', { name: '注文取消', exact: true })).toBeVisible()
    await expect(page.getByTestId('order-cancel-order-id')).toHaveText(`注文ID #${PARTIAL.ID}`)
    await expect(page.getByTestId('order-cancel-status')).toHaveText(
      STATUS_LABELS[PARTIAL.処理状況],
    )
    await expect(page.getByTestId('order-cancel-summary').getByRole('definition')).toHaveText([
      PARTIAL.銘柄コード,
      SIDE_LABELS[PARTIAL.売買区分],
      String(PARTIAL.口座番号),
      `${formatQuantity(PARTIAL.数量)}株`,
      `${formatQuantity(PARTIAL.出来数量)}株`,
      `${formatQuantity(cancelQuantityOf(PARTIAL))}株`,
      priceLabel(PARTIAL),
      MARKET_SCOPE_LABELS[PARTIAL.発注範囲],
    ])
    await expect(page.getByTestId('order-cancel-effect')).toHaveText(
      `約定済 ${formatQuantity(PARTIAL.出来数量)} 株は取り消されず、未約定残 ${formatQuantity(
        cancelQuantityOf(PARTIAL),
      )} 株だけを取消対象にします。`,
    )
    // 取消理由は持たせない（2026-09-29 決定）
    await expect(page.getByLabel(/理由/)).toHaveCount(0)
    await expect(page.getByTestId('order-cancel-submit')).toHaveText('取消を確定')
  })

  test('[OCN-02] URL を直接開いても表示でき、約定の無い注文は全数量が取消対象になる', async ({
    page,
  }) => {
    await page.goto(cancelPath(PENDING.ID))

    await expect(page.getByTestId('order-cancel-order-id')).toHaveText(`注文ID #${PENDING.ID}`)
    await expect(page.getByTestId('order-cancel-quantity')).toHaveText(
      `${formatQuantity(cancelQuantityOf(PENDING))}株`,
    )
    await expect(page.getByTestId('order-cancel-effect')).toHaveText(
      '約定済みの数量はなく、注文数量全体を取消対象にします。',
    )
  })

  test('[OCN-03] 存在しない注文は「見つかりません」になり、確定ボタンは無い', async ({ page }) => {
    await page.goto(cancelPath(999))

    const notFound = page.getByTestId('order-cancel-not-found')
    await expect(notFound).toContainText('注文が見つかりませんでした。')
    await expect(notFound.getByRole('button', { name: '注文照会へ戻る' })).toBeVisible()
    await expect(page.getByTestId('order-cancel-submit')).toHaveCount(0)
  })

  test('[OCN-04] 対象注文の取得に失敗するとエラーと再試行が出る', async ({ page }) => {
    await mockApi(page, [
      { path: `*/api/orders/${PENDING.ID}`, status: 500, body: { detail: SERVER_ERROR } },
    ])
    await page.goto(cancelPath(PENDING.ID))

    const error = page.getByTestId('order-cancel-error')
    await expect(error).toContainText(SERVER_ERROR)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('order-cancel-submit')).toHaveCount(0)
  })

  test('[OCN-05] 発注権限が無いと権限なしの画面へ回される', async ({ page }) => {
    expect(noOperationOperator.権限.order).toBe(false)
    await mockApi(page, [{ path: AUTH_ME_PATH, body: noOperationOperator }])
    await page.goto(cancelPath(PENDING.ID))

    // URL はガードが /auth/me を読み、遷移先（遅延 import の ForbiddenView）を読み終えてから変わる。
    // 並列実行で dev サーバの初回変換が重なると 5 秒を越えることがあるので猶予を延ばす
    await expect(page).toHaveURL(/\/forbidden$/, { timeout: 15_000 })
    await expect(
      page.getByRole('heading', { name: 'アクセス権限がありません', exact: true }),
    ).toBeVisible()
    await expect(page.getByTestId('forbidden-message')).toHaveText(
      'この画面を開く権限がありません。',
    )
    await expect(page.getByTestId('order-cancel-submit')).toHaveCount(0)
  })

  test('[OCN-06] 取消できない状況の注文は確定ボタンを出さない', async ({ page }) => {
    await page.goto(cancelPath(FILLED.ID))

    await expect(page.getByTestId('order-cancel-locked')).toHaveText(
      `この注文は取消できません（処理状況: ${STATUS_LABELS[FILLED.処理状況]}）。`,
    )
    await expect(page.getByTestId('order-cancel-submit')).toHaveCount(0)
    await expect(page.getByTestId('order-cancel-back')).toBeVisible()
  })

  test('[OCN-07] 未発注の注文は即時に取消済になり、一覧から操作が消える', async ({ page }) => {
    const ROOT = 30
    await page.goto(INQUIRY_PATH)
    await rowOf(page, ROOT).getByTestId('order-inquiry-cancel').click()
    await expect(page).toHaveURL(new RegExp(`${cancelPath(PENDING.ID)}$`))

    await page.getByTestId('order-cancel-submit').click()

    // 文言はサーバ（既定ハンドラ）が決め、画面はそのまま出す
    await expect(page.getByTestId('order-cancel-complete-message')).toHaveText(
      `注文を取り消しました（注文ID: ${PENDING.ID}）`,
    )

    await page.getByTestId('order-cancel-back-to-list').click()

    await expect(page).toHaveURL(new RegExp(`${INQUIRY_PATH}$`))
    const row = rowOf(page, ROOT)
    await expect(cellOf(row, '出来状況')).toHaveText('取消済')
    await expect(row.getByTestId('order-inquiry-amend')).toHaveCount(0)
    await expect(row.getByTestId('order-inquiry-cancel')).toHaveCount(0)
  })

  test('[OCN-08] 一部出来の注文は取消依頼になり、一覧で「取消中」になる', async ({ page }) => {
    await page.goto(INQUIRY_PATH)
    await rowOf(page, PARTIAL.ID).getByTestId('order-inquiry-cancel').click()
    await expect(page).toHaveURL(new RegExp(`${cancelPath(PARTIAL.ID)}$`))

    await page.getByTestId('order-cancel-submit').click()

    await expect(page.getByTestId('order-cancel-complete-message')).toHaveText(
      `取消依頼を受け付けました（注文ID: ${PARTIAL.ID}）`,
    )

    await page.getByTestId('order-cancel-back-to-list').click()

    await expect(page).toHaveURL(new RegExp(`${INQUIRY_PATH}$`))
    await expect(cellOf(rowOf(page, PARTIAL.ID), '出来状況')).toHaveText('取消中')
  })

  test('[OCN-09] サーバが取消を拒否すると理由が出て、確定ボタンは残る', async ({ page }) => {
    const REJECTED = 'この注文は取消できません（テスト）'
    await mockApi(page, [
      {
        method: 'post',
        path: `*/api/orders/${PENDING.ID}/cancel`,
        status: 400,
        body: { detail: REJECTED },
      },
    ])
    await page.goto(cancelPath(PENDING.ID))
    await expect(page.getByTestId('order-cancel-order-id')).toHaveText(`注文ID #${PENDING.ID}`)

    await page.getByTestId('order-cancel-submit').click()

    await expect(page.getByTestId('order-cancel-submit-error')).toHaveText(REJECTED)
    await expect(page.getByTestId('order-cancel-complete')).toHaveCount(0)
    await expect(page.getByTestId('order-cancel-submit')).toBeVisible()
  })

  test('[OCN-10] 「戻る」で検索条件の付いた注文照会へ戻る', async ({ page }) => {
    const SYMBOL = PARTIAL.銘柄コード
    await page.goto(`${INQUIRY_PATH}?symbol=${SYMBOL}`)
    await expect(rowsOf(page)).toHaveCount(1)
    await rowOf(page, PARTIAL.ID).getByTestId('order-inquiry-cancel').click()
    await expect(page).toHaveURL(new RegExp(`${cancelPath(PARTIAL.ID)}$`))

    await page.getByTestId('order-cancel-back').click()

    await expect(page).toHaveURL(new RegExp(`${INQUIRY_PATH}\\?symbol=${SYMBOL}$`))
    await expect(page.getByTestId('order-inquiry-symbol')).toHaveValue(SYMBOL)
    await expect(rowsOf(page)).toHaveCount(1)
  })
})
