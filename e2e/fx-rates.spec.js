import { expect, test } from '@playwright/test'
import { fxRates } from '../src/mocks/fixtures/fxRates'
import { mockApi } from './helpers/mockApi'

const PAGE_PATH = '/masters/fx'
const LATEST_PATH = '*/api/masters/fx/latest'
const VALIDATE_PATH = '*/api/masters/fx/validate'

/** 既定モックで latest が返す行（取消済みを除いた基準日の最大） */
const latestRow = [...fxRates].sort((a, b) => b.基準日 - a.基準日)[0]

/**
 * 今日（JST）の 'YYYY-MM-DD'。画面の store（src/stores/fxRates.js の todayJst）と同じ決めかた。
 * store は import.meta.env を辿るので Playwright から import できず、ここに再掲する。
 */
function todayJst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' → 20260731（実 API の基準日の形） */
function toApiDate(isoDate) {
  return Number(isoDate.replaceAll('-', ''))
}

/** 20260731 → '2026-07-31' */
function toIsoDate(apiDate) {
  const digits = String(apiDate)
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

/** 小数 2 桁の表示（画面の formatRate と同じ） */
function rateText(value) {
  return value.toFixed(2)
}

/**
 * 最新（latest）と詳細が「今日（JST）の基準日の行」を返すようにする差し替え。
 * ID と更新日時は既定モックの最新行のまま残すので、既定の PUT ハンドラがその行を見つけて
 * 楽観的ロックの照合も通る（変更の経路を既定ハンドラで通すため）。
 */
function todayRowOverrides() {
  const todayRow = { ...latestRow, 基準日: toApiDate(todayJst()) }
  return [
    {
      path: LATEST_PATH,
      body: {
        ID: todayRow.ID,
        基準日: todayRow.基準日,
        通貨コード: todayRow.通貨コード,
        為替レート: todayRow.為替レート,
      },
    },
    { path: `*/api/masters/fx/${todayRow.ID}`, body: { exchange_rate: todayRow } },
  ]
}

/** 最新レートが 1 件も無い（404）差し替え */
const EMPTY_LATEST = {
  path: LATEST_PATH,
  status: 404,
  body: { detail: '有効な為替レートが存在しません' },
}

async function openAndWaitCurrent(page) {
  await page.goto(PAGE_PATH)
  await expect(page.getByTestId('fx-rate')).toHaveText(rateText(latestRow.為替レート))
}

async function openUpdateWith(page, value) {
  await page.getByTestId('fx-update').click()
  await expect(page.getByTestId('fx-update-form')).toBeVisible()
  await page.getByTestId('fx-rate-input').fill(value)
}

// シナリオ: docs/e2e/fx-rates.md（タイトル先頭の [FX-nn] が対応 ID）
// 現在レートの 4 状態、今日の行の有無による登録 / 変更の分岐、モーダルに出る拒否理由を守る。
// dev サーバ側で MSW が起動しているため、既定ではフィクスチャの応答が返る。
// モックの可変状態はページ単位なので、保存しても他のテストには持ち越さない。
test.describe('為替マスタ', () => {
  test('[FX-01] 現在レートと基準日・最終更新が表示される', async ({ page }) => {
    await page.goto(PAGE_PATH)

    await expect(page.getByTestId('fx-current')).toBeVisible()
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(latestRow.為替レート))
    await expect(page.getByTestId('fx-base-date')).toHaveText(toIsoDate(latestRow.基準日))
    await expect(page.getByTestId('fx-updated')).toContainText(latestRow.更新者)
  })

  test('[FX-02] 応答が返るまで読み込み中の表示が出る', async ({ page }) => {
    // ?mockDelay=<ミリ秒> を付けた URL だけ /api/* の応答が遅れる（src/mocks/handlers/index.js）
    await page.goto(`${PAGE_PATH}?mockDelay=1000`)

    await expect(page.getByTestId('fx-loading')).toBeVisible()
    await expect(page.getByTestId('fx-current')).toHaveCount(0)

    await expect(page.getByTestId('fx-loading')).toHaveCount(0)
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(latestRow.為替レート))
  })

  test('[FX-03] 取得が 500 だとエラーと再試行ボタンが出て更新できない', async ({ page }) => {
    await mockApi(page, [
      { path: LATEST_PATH, status: 500, body: { detail: 'サーバーでエラーが発生しました。' } },
    ])
    await page.goto(PAGE_PATH)

    const error = page.getByTestId('fx-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('サーバーでエラーが発生しました。')
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('fx-current')).toHaveCount(0)
    await expect(page.getByTestId('fx-update')).toBeDisabled()
  })

  test('[FX-04] レートが 1 件も無いと未登録の表示が出る', async ({ page }) => {
    await mockApi(page, [EMPTY_LATEST])
    await page.goto(PAGE_PATH)

    await expect(page.getByTestId('fx-empty')).toContainText(
      'USD/JPY の為替レートが登録されていません。',
    )
    await expect(page.getByTestId('fx-current')).toHaveCount(0)
    await expect(page.getByTestId('fx-update')).toBeEnabled()
  })

  test('[FX-05] 今日の行が無いとき、更新すると今日の基準日で登録され現在値に反映される', async ({
    page,
  }) => {
    await openAndWaitCurrent(page)

    await openUpdateWith(page, '151')
    await page.getByTestId('fx-update-submit').click()

    await expect(page.getByTestId('fx-update-form')).toHaveCount(0)
    await expect(page.getByTestId('fx-notice')).toHaveText(
      'USD/JPY のレートを 151.00 円に更新しました。',
    )
    await expect(page.getByTestId('fx-rate')).toHaveText('151.00')
    await expect(page.getByTestId('fx-base-date')).toHaveText(todayJst())
  })

  test('[FX-06] 今日の行があるとき、更新は変更として受理され現在値に反映される', async ({
    page,
  }) => {
    // 登録（POST）を 500 にしておき、成功したなら変更（PUT）の経路を通ったと判る
    await mockApi(page, [
      ...todayRowOverrides(),
      {
        method: 'post',
        path: '*/api/masters/fx',
        status: 500,
        body: { detail: '登録の経路を通りました（変更のはず）' },
      },
    ])
    await page.goto(PAGE_PATH)
    await expect(page.getByTestId('fx-base-date')).toHaveText(todayJst())

    await openUpdateWith(page, '151')
    await page.getByTestId('fx-update-submit').click()

    await expect(page.getByTestId('fx-update-form')).toHaveCount(0)
    await expect(page.getByTestId('fx-notice')).toHaveText(
      'USD/JPY のレートを 151.00 円に更新しました。',
    )
    await expect(page.getByTestId('fx-rate')).toHaveText('151.00')
    await expect(page.getByTestId('fx-base-date')).toHaveText(todayJst())
  })

  test('[FX-07] レートを空にして更新すると入力を促す', async ({ page }) => {
    await openAndWaitCurrent(page)

    await openUpdateWith(page, '')
    await page.getByTestId('fx-update-submit').click()

    await expect(page.getByTestId('fx-update-form')).toContainText('レートを入力してください。')
    await expect(page.getByTestId('fx-notice')).toHaveCount(0)
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(latestRow.為替レート))
  })

  test('[FX-08] 範囲外のレートは警告のあと「続行」で保存される', async ({ page }) => {
    await openAndWaitCurrent(page)

    await openUpdateWith(page, '350')
    const submit = page.getByTestId('fx-update-submit')
    await submit.click()

    await expect(page.getByTestId('fx-update-validation-warning')).toBeVisible()
    await expect(submit).toHaveText('続行')
    await expect(page.getByTestId('fx-notice')).toHaveCount(0)
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(latestRow.為替レート))

    await submit.click()

    await expect(page.getByTestId('fx-update-form')).toHaveCount(0)
    await expect(page.getByTestId('fx-notice')).toContainText('350.00 円に更新しました。')
    await expect(page.getByTestId('fx-rate')).toHaveText('350.00')
  })

  test('[FX-09] 事前検証で不合格になると理由が出て保存されない', async ({ page }) => {
    const reason = '基準日 20990101 の USD は既に登録されています'
    await mockApi(page, [
      {
        method: 'post',
        path: VALIDATE_PATH,
        body: { valid: false, errors: [reason], warnings: [], details: null },
      },
    ])
    await openAndWaitCurrent(page)

    await openUpdateWith(page, '151')
    await page.getByTestId('fx-update-submit').click()

    await expect(page.getByTestId('fx-update-validation-error')).toContainText(reason)
    await expect(page.getByTestId('fx-update-form')).toBeVisible()
    await expect(page.getByTestId('fx-notice')).toHaveCount(0)
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(latestRow.為替レート))
  })

  test('[FX-10] 他の担当者が先に変更していると競合が出て現在値は変わらない', async ({ page }) => {
    await mockApi(page, [
      ...todayRowOverrides(),
      {
        method: 'put',
        path: `*/api/masters/fx/${latestRow.ID}`,
        status: 409,
        body: {
          detail: '他のユーザーによって為替レートが更新されました。最新情報を再取得してください。',
        },
      },
    ])
    await page.goto(PAGE_PATH)
    await expect(page.getByTestId('fx-base-date')).toHaveText(todayJst())

    await openUpdateWith(page, '151')
    await page.getByTestId('fx-update-submit').click()

    await expect(page.getByTestId('fx-update-error')).toContainText('更新されました')
    await expect(page.getByTestId('fx-notice')).toHaveCount(0)
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(latestRow.為替レート))
  })

  test('[FX-11] キャンセルするとモーダルが閉じ現在値は変わらない', async ({ page }) => {
    await openAndWaitCurrent(page)

    await openUpdateWith(page, '151')
    await page.getByTestId('fx-update-cancel').click()

    await expect(page.getByTestId('fx-update-form')).toHaveCount(0)
    await expect(page.getByTestId('fx-notice')).toHaveCount(0)
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(latestRow.為替レート))
  })

  test('[FX-12] サイドメニューから遷移できる', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('link', { name: '為替マスタ', exact: true }).click()

    await expect(page).toHaveURL(/\/masters\/fx$/)
    await expect(page.getByTestId('fx-current')).toBeVisible()
  })

  test('[FX-13] 未登録の状態から今日のレートを登録すると現在値が表示される', async ({ page }) => {
    await mockApi(page, [EMPTY_LATEST])
    await page.goto(PAGE_PATH)
    await expect(page.getByTestId('fx-empty')).toBeVisible()

    await page.getByTestId('fx-update').click()
    await expect(page.getByTestId('fx-rate-input')).toHaveValue('')
    await page.getByTestId('fx-rate-input').fill('151')
    await page.getByTestId('fx-update-submit').click()

    await expect(page.getByTestId('fx-notice')).toHaveText(
      'USD/JPY のレートを 151.00 円に更新しました。',
    )
    await expect(page.getByTestId('fx-empty')).toHaveCount(0)
    await expect(page.getByTestId('fx-rate')).toHaveText('151.00')
    await expect(page.getByTestId('fx-base-date')).toHaveText(todayJst())
  })
})
