import { expect, test } from '@playwright/test'
import { clickSideMenuLink } from './helpers/sideMenu'
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

/** 小数 4 桁の表示（画面 FxRateMasterView.vue の formatRate と同じ） */
function rateText(value) {
  return value.toFixed(4)
}

/** 成功メッセージ（画面 FxRateMasterView.vue の noticeMessage と同じ組み立て） */
function noticeText(rate, withholdingRate) {
  return (
    `USD/JPY の公示（社内）レートを ${rateText(rate)} 円、` +
    `源泉レートを ${rateText(withholdingRate)} 円に更新しました。`
  )
}

/**
 * 最新（latest）と詳細が、既定モックの最新行を `patch` で上書きした行を返すようにする差し替え。
 * ID と更新日時は既定モックの最新行のまま残すので、既定の PUT ハンドラがその行を見つけて
 * 楽観的ロックの照合も通る（変更の経路を既定ハンドラで通すため）。
 */
function latestRowOverrides(patch) {
  const row = { ...latestRow, ...patch }
  return [
    {
      path: LATEST_PATH,
      body: {
        ID: row.ID,
        基準日: row.基準日,
        通貨コード: row.通貨コード,
        為替レート: row.為替レート,
        源泉レート: row.源泉レート,
      },
    },
    { path: `*/api/masters/fx/${row.ID}`, body: { exchange_rate: row } },
  ]
}

/** 最新（latest）と詳細が「今日（JST）の基準日の行」を返すようにする差し替え */
function todayRowOverrides() {
  return latestRowOverrides({ 基準日: toApiDate(todayJst()) })
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

/** モーダルを開く。各引数は undefined なら初期値（現在レート）のまま触らない */
async function openUpdateWith(page, { rate, withholdingRate } = {}) {
  await page.getByTestId('fx-update').click()
  await expect(page.getByTestId('fx-update-form')).toBeVisible()
  if (rate !== undefined) await page.getByTestId('fx-rate-input').fill(rate)
  if (withholdingRate !== undefined) {
    await page.getByTestId('fx-withholding-rate-input').fill(withholdingRate)
  }
}

// シナリオ: docs/e2e/fx-rates.md（タイトル先頭の [FX-nn] が対応 ID）
// 公示（社内）レートと源泉レートの 2 カードの 4 状態、今日の行の有無による登録 / 変更の分岐、
// モーダルに出る拒否理由を守る。
// dev サーバ側で MSW が起動しているため、既定ではフィクスチャの応答が返る。
// モックの可変状態はページ単位なので、保存しても他のテストには持ち越さない。
test.describe('為替マスタ', () => {
  test('[FX-01] 公示レートのカードに現在レートと基準日・最終更新が表示される', async ({
    page,
  }) => {
    await page.goto(PAGE_PATH)

    const card = page.getByTestId('fx-public-card')
    await expect(page.getByTestId('fx-current')).toBeVisible()
    await expect(card.getByTestId('fx-rate')).toHaveText(rateText(latestRow.為替レート))
    await expect(card.getByTestId('fx-base-date')).toHaveText(toIsoDate(latestRow.基準日))
    await expect(card.getByTestId('fx-updated')).toContainText(latestRow.更新者)
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

    await openUpdateWith(page, { rate: '151' })
    await page.getByTestId('fx-update-submit').click()

    await expect(page.getByTestId('fx-update-form')).toHaveCount(0)
    await expect(page.getByTestId('fx-notice')).toHaveText(
      noticeText(151, latestRow.源泉レート),
    )
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(151))
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

    await openUpdateWith(page, { rate: '151' })
    await page.getByTestId('fx-update-submit').click()

    await expect(page.getByTestId('fx-update-form')).toHaveCount(0)
    await expect(page.getByTestId('fx-notice')).toHaveText(
      noticeText(151, latestRow.源泉レート),
    )
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(151))
    await expect(page.getByTestId('fx-base-date')).toHaveText(todayJst())
  })

  test('[FX-07] 公示レートを空にして更新すると入力を促す', async ({ page }) => {
    await openAndWaitCurrent(page)

    await openUpdateWith(page, { rate: '' })
    await page.getByTestId('fx-update-submit').click()

    await expect(page.getByTestId('fx-rate-input')).toHaveAccessibleDescription(
      'レートを入力してください。',
    )
    await expect(page.getByTestId('fx-update-form')).toBeVisible()
    await expect(page.getByTestId('fx-notice')).toHaveCount(0)
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(latestRow.為替レート))
  })

  test('[FX-08] 範囲外のレートは警告のあと「続行」で保存される', async ({ page }) => {
    await openAndWaitCurrent(page)

    await openUpdateWith(page, { rate: '350' })
    const submit = page.getByTestId('fx-update-submit')
    await submit.click()

    await expect(page.getByTestId('fx-update-validation-warning')).toBeVisible()
    await expect(submit).toHaveText('続行')
    await expect(page.getByTestId('fx-notice')).toHaveCount(0)
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(latestRow.為替レート))

    await submit.click()

    await expect(page.getByTestId('fx-update-form')).toHaveCount(0)
    await expect(page.getByTestId('fx-notice')).toContainText(`${rateText(350)} 円`)
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(350))
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

    await openUpdateWith(page, { rate: '151' })
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

    await openUpdateWith(page, { rate: '151' })
    await page.getByTestId('fx-update-submit').click()

    await expect(page.getByTestId('fx-update-error')).toContainText('更新されました')
    await expect(page.getByTestId('fx-notice')).toHaveCount(0)
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(latestRow.為替レート))
  })

  test('[FX-11] キャンセルするとモーダルが閉じ現在値は変わらない', async ({ page }) => {
    await openAndWaitCurrent(page)

    await openUpdateWith(page, { rate: '151' })
    await page.getByTestId('fx-update-cancel').click()

    await expect(page.getByTestId('fx-update-form')).toHaveCount(0)
    await expect(page.getByTestId('fx-notice')).toHaveCount(0)
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(latestRow.為替レート))
  })

  test('[FX-12] サイドメニューから遷移できる', async ({ page }) => {
    await page.goto('/')

    await clickSideMenuLink(page, '為替マスタ')

    await expect(page).toHaveURL(/\/masters\/fx$/)
    await expect(page.getByTestId('fx-current')).toBeVisible()
  })

  test('[FX-13] 未登録の状態から今日のレートを登録すると現在値が表示される', async ({ page }) => {
    await mockApi(page, [EMPTY_LATEST])
    await page.goto(PAGE_PATH)
    await expect(page.getByTestId('fx-empty')).toBeVisible()

    await page.getByTestId('fx-update').click()
    await expect(page.getByTestId('fx-rate-input')).toHaveValue('')
    await expect(page.getByTestId('fx-withholding-rate-input')).toHaveValue('')
    await page.getByTestId('fx-rate-input').fill('151')
    await page.getByTestId('fx-withholding-rate-input').fill('150.5')
    await page.getByTestId('fx-update-submit').click()

    await expect(page.getByTestId('fx-notice')).toHaveText(noticeText(151, 150.5))
    await expect(page.getByTestId('fx-empty')).toHaveCount(0)
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(151))
    await expect(page.getByTestId('fx-withholding-rate')).toHaveText(rateText(150.5))
    await expect(page.getByTestId('fx-base-date')).toHaveText(todayJst())
  })

  test('[FX-14] 源泉レートのカードに現在レートと基準日・最終更新が表示される', async ({
    page,
  }) => {
    await page.goto(PAGE_PATH)

    const card = page.getByTestId('fx-withholding-card')
    await expect(card.getByTestId('fx-withholding-rate')).toHaveText(
      rateText(latestRow.源泉レート),
    )
    await expect(card.getByTestId('fx-withholding-base-date')).toHaveText(
      toIsoDate(latestRow.基準日),
    )
    await expect(card.getByTestId('fx-withholding-updated')).toContainText(latestRow.更新者)
  })

  test('[FX-15] 源泉レートを変えて保存すると源泉カードだけが入れ替わる', async ({ page }) => {
    await openAndWaitCurrent(page)

    await openUpdateWith(page, { withholdingRate: '150.1234' })
    await page.getByTestId('fx-update-submit').click()

    await expect(page.getByTestId('fx-update-form')).toHaveCount(0)
    await expect(page.getByTestId('fx-notice')).toContainText(
      `源泉レートを ${rateText(150.1234)} 円`,
    )
    await expect(page.getByTestId('fx-withholding-rate')).toHaveText(rateText(150.1234))
    await expect(page.getByTestId('fx-withholding-base-date')).toHaveText(todayJst())
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(latestRow.為替レート))
  })

  test('[FX-16] 源泉レートを空にして更新すると入力を促す', async ({ page }) => {
    await openAndWaitCurrent(page)

    await openUpdateWith(page, { withholdingRate: '' })
    await page.getByTestId('fx-update-submit').click()

    await expect(page.getByTestId('fx-withholding-rate-input')).toHaveAccessibleDescription(
      'レートを入力してください。',
    )
    await expect(page.getByTestId('fx-rate-input')).toHaveAccessibleDescription('')
    await expect(page.getByTestId('fx-update-form')).toBeVisible()
    await expect(page.getByTestId('fx-notice')).toHaveCount(0)
    await expect(page.getByTestId('fx-withholding-rate')).toHaveText(
      rateText(latestRow.源泉レート),
    )
  })

  test('[FX-17] 源泉レートが未設定だと「—」が出て入力欄は空で開く', async ({ page }) => {
    await mockApi(page, latestRowOverrides({ 源泉レート: null }))
    await openAndWaitCurrent(page)

    await expect(page.getByTestId('fx-withholding-rate')).toHaveText('—')

    await openUpdateWith(page)
    await expect(page.getByTestId('fx-withholding-rate-input')).toHaveValue('')
  })

  test('[FX-18] 源泉レートが 0 だとサーバの拒否理由が出て保存されない', async ({ page }) => {
    await openAndWaitCurrent(page)

    await openUpdateWith(page, { withholdingRate: '0' })
    await page.getByTestId('fx-update-submit').click()

    await expect(page.getByTestId('fx-update-form')).toContainText('源泉レート: ')
    await expect(page.getByTestId('fx-notice')).toHaveCount(0)
    await expect(page.getByTestId('fx-withholding-rate')).toHaveText(
      rateText(latestRow.源泉レート),
    )
  })
})
