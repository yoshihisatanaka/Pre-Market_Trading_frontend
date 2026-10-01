import { expect, test } from '@playwright/test'
import {
  apiContext,
  assertRealApi,
  fetchAll,
  logExchange,
  skipUnlessRealApi,
  toIsoDate,
} from './helpers/realApi.js'

/*
 * 為替マスタを「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/fx-rates-real-api.md（タイトル先頭の [FXR-xx] が対応 ID）
 *
 * fx-rates.spec.js（FX）とは目的が違う。FX は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせ（latest → 詳細 → 事前検証 →
 * 登録 / 変更、今日の行の有無による POST / PUT の分岐、楽観的ロックの合札）だけを見るので、
 * 期待値に**データの中身を書かない**（現在レート・基準日は実行時に API から読む）。
 *
 * 一覧ではなく現在レート 1 件のカードなので、listHelpers（件数・表・ページ送り）は使わない。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test fx-rates.real-api
 *
 * FXR-02 以降は実 DB の「今日（JST）の USD のレート」を書き換える。ローカルの開発 DB 前提。
 * 基準日を選ばせない画面なので 2035 年へ逃がせない。beforeAll で今日の行の状態を控え、
 * afterAll で元のレートに戻す（無かった行は論理削除する）。戻せないもの（ユーザー操作フラグ・
 * 更新者・履歴）はシナリオ文書の「実データを書き換える」に書いてある。
 */

const PATH = '/masters/fx'
const API_PATH = '/api/masters/fx'
// 一覧の応答の配列キー（openapi.json の FxListResponse）
const LIST_KEY = 'exchange_rates'
// src/stores/fxRates.js の CURRENCY_CODE と同じ値（ストアは Playwright から import できない）
const CURRENCY_CODE = 'USD'

/*
 * 試験用に書くレート。50〜300 円の範囲内（警告が出ない）で、途中で落ちたときに人が残骸と
 * 見分けられる値に寄せる。開始時の現在レートと同じ値は使わない（変わったことを確かめられない）。
 */
const RATE_CANDIDATES = [123.41, 123.42, 123.43, 123.44, 123.45, 123.46]
// 範囲外の警告を出す値（src/api/fxRates.js の validateFxRate の注記: 一般的な範囲 50〜300 円）
const OUT_OF_RANGE_RATE = '350'
// FxRequest の 為替レート は exclusiveMinimum: 0 なので実 API が拒否する値
const NON_POSITIVE_RATE = '0'

/**
 * 今日（JST）の 'YYYY-MM-DD'。src/stores/fxRates.js の todayJst と同じ決めかた。
 * ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
 */
function todayJst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' → 20261001（実 API の基準日の形） */
function toApiDate(isoDate) {
  return Number(isoDate.replaceAll('-', ''))
}

/** 小数 2 桁の表示（FxRateMasterView.vue の formatRate と同じ） */
function rateText(value) {
  return Number(value).toFixed(2)
}

/** 開始時に控えた日付。日付をまたいだ実行で戻す対象を取り違えないよう、以降はこれだけを使う */
const TODAY = todayJst()
const TODAY_API = toApiDate(TODAY)

/** beforeAll で控える開始時の状態 */
let snapshotTaken = false
/** 開始時の latest（今日以前の最新。404 なら null） */
let originalLatest = null
/** 開始時の今日の USD の行（取消済みも含む。無ければ null） */
let originalToday = null
/** 試験用のレート（beforeAll が開始時の現在レートを除いて選ぶ） */
const RATE = { smoke: 0, change: 0, alt: 0, screen: 0 }

/** 今日以前の最新レート（LatestFxResponse）。404 なら null */
async function fetchLatest(api) {
  const res = await api.get(`${API_PATH}/latest`, {
    params: { currency_code: CURRENCY_CODE, target_date: TODAY_API },
  })
  if (res.status() === 404) return null
  expect(res.ok(), `latest を取得できない: ${res.status()} ${await res.text()}`).toBe(true)
  return res.json()
}

/** ID で 1 件引く（FxDetailResponse の exchange_rate） */
async function fetchDetail(api, id) {
  const res = await api.get(`${API_PATH}/${id}`)
  expect(
    res.ok(),
    `詳細を取得できない: ${API_PATH}/${id} ${res.status()} ${await res.text()}`,
  ).toBe(true)
  return (await res.json()).exchange_rate
}

/** 今日の USD の行（取消済みも含む） */
async function fetchTodayRows(api) {
  const rows = await fetchAll(api, API_PATH, LIST_KEY, {
    base_date: TODAY_API,
    currency_code: CURRENCY_CODE,
    include_deleted: true,
  })
  // クエリが黙って無視されても取り違えないよう、手元でも絞る
  return rows.filter((row) => row.基準日 === TODAY_API && row.通貨コード === CURRENCY_CODE)
}

/** 今日の USD の有効な行（1 件のはず）。無ければ null */
async function fetchTodayActive(api) {
  const active = (await fetchTodayRows(api)).filter((row) => row.取消区分 === 0)
  expect(active.length, '今日の USD の有効な行が複数ある').toBeLessThanOrEqual(1)
  return active[0] ?? null
}

/** 画面を開いて、4 状態のどれかに落ちるまで待ち、実 API に当たっていることを確かめる */
async function openPage(page) {
  await page.goto(PATH)
  await expect(
    page
      .getByTestId('fx-current')
      .or(page.getByTestId('fx-empty'))
      .or(page.getByTestId('fx-error')),
  ).toBeVisible()
  await expect(page.getByTestId('fx-loading')).toHaveCount(0)
  await assertRealApi(page)
}

async function openUpdateWith(page, value) {
  await page.getByTestId('fx-update').click()
  await expect(page.getByTestId('fx-update-form')).toBeVisible()
  await page.getByTestId('fx-rate-input').fill(value)
}

/** 画面から送られる登録（POST /api/masters/fx）か変更（PUT /api/masters/fx/{id}）の応答を待つ */
function waitForSave(page) {
  return page.waitForResponse((res) => {
    const method = res.request().method()
    const { pathname } = new URL(res.url())
    if (method === 'POST') return pathname === API_PATH
    if (method === 'PUT') return new RegExp(`^${API_PATH}/\\d+$`).test(pathname)
    return false
  })
}

/** 画面から送られる事前検証（POST /api/masters/fx/validate）の応答を待つ */
function waitForValidate(page) {
  return page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' && new URL(res.url()).pathname === `${API_PATH}/validate`,
  )
}

async function expectApiRate(api, rate) {
  const latest = await fetchLatest(api)
  expect(latest, '実 API の latest が 404 になった').toBeTruthy()
  expect(latest.基準日).toBe(TODAY_API)
  expect(latest.為替レート).toBeCloseTo(rate, 2)
}

/**
 * 開始時の状態に戻す。今日の行が有効だったならレートを書き戻し、無かった（か取消済みだった）なら
 * 論理削除する。合札（更新日時）は送らない（照合させずに確実に戻す）。
 */
async function restoreToday(api) {
  const current = await fetchTodayActive(api)

  if (originalToday && originalToday.取消区分 === 0) {
    if (!current) {
      console.log(`[afterAll] 今日の行（ID ${originalToday.ID}）が有効でなくなっている。戻せない`)
      return
    }
    const res = await api.put(`${API_PATH}/${current.ID}`, {
      data: {
        基準日: TODAY_API,
        通貨コード: CURRENCY_CODE,
        為替レート: originalToday.為替レート,
        源泉レート: originalToday.源泉レート ?? null,
      },
    })
    expect(res.ok(), `元のレートに戻せない: ${res.status()} ${await res.text()}`).toBe(true)
    console.log(
      `[afterAll] 今日の行（ID ${current.ID}）を ${originalToday.為替レート} に書き戻した`,
    )
    return
  }

  if (current) {
    const res = await api.delete(`${API_PATH}/${current.ID}`)
    expect(
      res.ok(),
      `試験で作った今日の行を削除できない: ${res.status()} ${await res.text()}`,
    ).toBe(true)
    console.log(`[afterAll] 試験で作った今日の行（ID ${current.ID}）を論理削除した`)
  }
}

// 登録または変更 → 再読み込み → 変更 → 警告 → 拒否 → 競合 は 1 本の流れなので順に実行する
test.describe.configure({ mode: 'serial' })

test.describe('為替マスタ（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test.beforeAll(async ({ playwright }) => {
    const api = await apiContext(playwright)
    originalLatest = await fetchLatest(api)
    // (基準日, 通貨) で 1 行のはずだが、念のため有効な行を優先する
    const todayRows = await fetchTodayRows(api)
    originalToday = todayRows.find((row) => row.取消区分 === 0) ?? todayRows[0] ?? null
    await api.dispose()
    snapshotTaken = true

    const current = originalLatest ? rateText(originalLatest.為替レート) : ''
    const [smoke, change, alt, screen] = RATE_CANDIDATES.filter((v) => rateText(v) !== current)
    Object.assign(RATE, { smoke, change, alt, screen })

    console.log(
      `[beforeAll] 今日=${TODAY} latest=${JSON.stringify(originalLatest)} ` +
        `今日の行=${JSON.stringify(originalToday)}`,
    )
  })

  test.afterAll(async ({ playwright }) => {
    // 開始時の状態を控えられなかったなら、何に戻すか判らないので触らない
    if (!snapshotTaken) return

    const api = await apiContext(playwright)
    await restoreToday(api)

    // 画面に出る現在レートが開始時と同じに戻っている
    const latest = await fetchLatest(api)
    await api.dispose()
    expect(latest?.基準日 ?? null, '終了時の latest の基準日が開始時と違う').toBe(
      originalLatest?.基準日 ?? null,
    )
    expect(latest?.為替レート ?? null, '終了時の latest のレートが開始時と違う').toBe(
      originalLatest?.為替レート ?? null,
    )
  })

  test('[FXR-01] 実データで現在レートが表示される', async ({ page, playwright }) => {
    const api = await apiContext(playwright)
    const latest = await fetchLatest(api)
    const detail = latest ? await fetchDetail(api, latest.ID) : null
    await api.dispose()

    await openPage(page)
    await expect(page.getByTestId('fx-error')).toHaveCount(0)
    await expect(page.getByTestId('fx-update')).toBeEnabled()

    if (!latest) {
      // 実 DB に今日以前の USD のレートが 1 件も無いときだけ、未登録の表示に落ちる
      await expect(page.getByTestId('fx-empty')).toBeVisible()
      await expect(page.getByTestId('fx-current')).toHaveCount(0)
      return
    }

    expect(latest.基準日, 'latest が今日より先の基準日を返した').toBeLessThanOrEqual(TODAY_API)
    await expect(page.getByTestId('fx-current')).toBeVisible()
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(latest.為替レート))
    await expect(page.getByTestId('fx-base-date')).toHaveText(toIsoDate(latest.基準日))
    if (detail.更新者) {
      await expect(page.getByTestId('fx-updated')).toContainText(detail.更新者)
    }
  })

  test('[FXR-02] レート更新が受理され、今日の基準日で現在値に反映される', async ({
    page,
    playwright,
  }) => {
    await openPage(page)

    await openUpdateWith(page, String(RATE.smoke))
    const saveResponse = waitForSave(page)
    await page.getByTestId('fx-update-submit').click()
    const res = await saveResponse
    const body = await logExchange('FXR-02', res)
    expect(res.ok(), `実 API がレート更新を受理しない: ${body}`).toBe(true)

    await expect(page.getByTestId('fx-update-form')).toHaveCount(0)
    await expect(page.getByTestId('fx-notice')).toHaveText(
      `USD/JPY のレートを ${rateText(RATE.smoke)} 円に更新しました。`,
    )
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(RATE.smoke))
    await expect(page.getByTestId('fx-base-date')).toHaveText(TODAY)

    const api = await apiContext(playwright)
    await expectApiRate(api, RATE.smoke)
    await api.dispose()
  })

  test('[FXR-03] 再読み込みしても保存した値が残る', async ({ page, playwright }) => {
    const api = await apiContext(playwright)
    const active = await fetchTodayActive(api)
    expect(active, 'FXR-02 で保存した今日の行が実 API に無い').toBeTruthy()
    const detail = await fetchDetail(api, active.ID)
    await api.dispose()

    await openPage(page)

    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(RATE.smoke))
    await expect(page.getByTestId('fx-base-date')).toHaveText(TODAY)
    if (detail.更新者) {
      await expect(page.getByTestId('fx-updated')).toContainText(detail.更新者)
    }
  })

  test('[FXR-04] 今日の行があると変更（PUT）で受理され、行は増えない', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright)
    const before = await fetchTodayRows(api)
    const active = await fetchTodayActive(api)
    expect(active, 'FXR-02 で保存した今日の行が実 API に無い').toBeTruthy()
    // 画面は latest → 詳細 の順に引き、詳細の 更新日時 を合札として握る
    const held = await fetchDetail(api, active.ID)
    console.log(`[FXR-04] 詳細の 更新日時: ${held.更新日時}`)

    await openPage(page)
    await expect(page.getByTestId('fx-base-date')).toHaveText(TODAY)

    await openUpdateWith(page, String(RATE.change))
    const saveResponse = waitForSave(page)
    await page.getByTestId('fx-update-submit').click()
    const res = await saveResponse
    const body = await logExchange('FXR-04', res)

    expect(res.request().method(), '今日の行があるのに登録（POST）が送られた').toBe('PUT')
    expect(new URL(res.url()).pathname).toBe(`${API_PATH}/${held.ID}`)
    // 詳細で受け取った 更新日時 を、書式を変えずに合札として送っている（空ならキーごと送らない）
    const sent = res.request().postDataJSON()
    if (held.更新日時) {
      expect(sent.更新日時).toBe(held.更新日時)
    } else {
      expect(sent).not.toHaveProperty('更新日時')
    }
    expect(res.status(), `実 API が変更を受理しない: ${body}`).toBe(200)

    await expect(page.getByTestId('fx-update-form')).toHaveCount(0)
    await expect(page.getByTestId('fx-notice')).toHaveText(
      `USD/JPY のレートを ${rateText(RATE.change)} 円に更新しました。`,
    )
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(RATE.change))
    await expect(page.getByTestId('fx-base-date')).toHaveText(TODAY)

    // 今日の行は増えず、同じ ID のまま値だけが変わる
    const after = await fetchTodayRows(api)
    await expectApiRate(api, RATE.change)
    await api.dispose()
    expect(after).toHaveLength(before.length)
    expect(after.filter((row) => row.取消区分 === 0).map((row) => row.ID)).toEqual([held.ID])
  })

  test('[FXR-05] 範囲外のレートは警告が出て、キャンセルすれば保存されない', async ({
    page,
    playwright,
  }) => {
    await openPage(page)

    await openUpdateWith(page, OUT_OF_RANGE_RATE)
    const validateResponse = waitForValidate(page)
    const submit = page.getByTestId('fx-update-submit')
    await submit.click()
    await logExchange('FXR-05', await validateResponse)

    // 文言はサーバが決めるので固定しない。出し先が事前検証の警告の枠であることだけを見る
    await expect(page.getByTestId('fx-update-validation-warning')).toBeVisible()
    await expect(submit).toHaveText('続行')
    await expect(page.getByTestId('fx-notice')).toHaveCount(0)

    await page.getByTestId('fx-update-cancel').click()
    await expect(page.getByTestId('fx-update-form')).toHaveCount(0)
    await expect(page.getByTestId('fx-rate')).toHaveText(rateText(RATE.change))

    const api = await apiContext(playwright)
    await expectApiRate(api, RATE.change)
    await api.dispose()
  })

  test('[FXR-06] 正でないレートは実 API に拒否され、理由がモーダルに出る', async ({
    page,
    playwright,
  }) => {
    await openPage(page)

    await openUpdateWith(page, NON_POSITIVE_RATE)
    const validateResponse = waitForValidate(page)
    await page.getByTestId('fx-update-submit').click()
    // 422（FxRequest の exclusiveMinimum）か valid: false のどちらで返るかを報告の材料に残す
    await logExchange('FXR-06', await validateResponse)

    await expect(
      page.getByTestId('fx-update-validation-error').or(page.getByTestId('fx-update-error')),
    ).toBeVisible()
    await expect(page.getByTestId('fx-update-form')).toBeVisible()
    await expect(page.getByTestId('fx-notice')).toHaveCount(0)

    const api = await apiContext(playwright)
    await expectApiRate(api, RATE.change)
    await api.dispose()
  })

  test('[FXR-07] 別経路で先に更新された今日の行は画面から更新できない', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright)
    const active = await fetchTodayActive(api)
    expect(active, 'FXR-02 で保存した今日の行が実 API に無い').toBeTruthy()
    const held = await fetchDetail(api, active.ID)

    // 画面を開いた時点の 更新日時 が、モーダルの握る合札になる
    await openPage(page)
    await openUpdateWith(page, String(RATE.screen))

    /*
     * 別経路で同じ行を更新する（合札は送らない = 照合させない）。
     * 更新日時の粒度が秒だと、直前の更新と同じ秒に収まって値が変わらないことがあるので、
     * 変わるまで更新し直す。
     */
    await expect(async () => {
      const res = await api.put(`${API_PATH}/${held.ID}`, {
        data: { 基準日: TODAY_API, 通貨コード: CURRENCY_CODE, 為替レート: RATE.alt },
      })
      expect(res.ok(), `別経路の PUT が通らない: ${res.status()} ${await res.text()}`).toBe(true)
      const now = await fetchDetail(api, held.ID)
      expect(now.更新日時).not.toBe(held.更新日時)
    }).toPass({ intervals: [500, 1000, 1000], timeout: 10_000 })
    const afterAlt = await fetchDetail(api, held.ID)
    console.log(
      `[FXR-07] 画面が握る 更新日時: ${held.更新日時} / 別経路の更新後: ${afterAlt.更新日時}`,
    )

    const saveResponse = waitForSave(page)
    await page.getByTestId('fx-update-submit').click()
    const res = await saveResponse
    const body = await logExchange('FXR-07', res)

    expect(res.request().method()).toBe('PUT')
    expect(res.status(), `楽観ロックの衝突が拒否されていない: ${body}`).toBe(409)

    await expect(page.getByTestId('fx-update-error')).toBeVisible()
    await expect(page.getByTestId('fx-update-form')).toBeVisible()
    await expect(page.getByTestId('fx-notice')).toHaveCount(0)

    // 画面からの上書きは入っていない
    const now = await fetchDetail(api, held.ID)
    await api.dispose()
    expect(now.為替レート).toBeCloseTo(RATE.alt, 2)
  })
})
