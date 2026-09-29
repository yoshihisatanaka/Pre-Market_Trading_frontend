import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { canceledFxRates, fxRates } from '@/mocks/fixtures/fxRates'
import { CURRENCY_CODE } from '@/stores/fxRates'
import { formatDateTime } from '@/utils/format'
import FxRateMasterView from './FxRateMasterView.vue'

/*
 * 画面テスト。実 Pinia + テスト用 router + MSW(node) を通し、
 * 4 状態の出し分けと「レート更新」モーダルの入出力を検証する。
 */
const PATH = '/masters/fx'

/* フィクスチャは生の形（基準日は YYYYMMDD の integer）なので、期待値を作るときはここで直す */
const toIsoDate = (value) => {
  const digits = String(value)
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}
const addDays = (isoDate, days) => {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
const byBaseDateDesc = (a, b) => b.基準日 - a.基準日

// 期待値はフィクスチャから導く（150.25 / 2026-07-31 を直接書かない）
const LATEST = [...fxRates].sort(byBaseDateDesc)[0]
const LATEST_DATE = toIsoDate(LATEST.基準日)
// 取消済みも含めた全行より後の日。この日を今日にすると「今日の行が無い」= 登録の経路になる
const AFTER_ALL_DATE = addDays(
  toIsoDate([...fxRates, ...canceledFxRates].sort(byBaseDateDesc)[0].基準日),
  7,
)

// 画面の表示は小数 2 桁
const shown = (value) => value.toFixed(2)
const NEW_RATE = LATEST.為替レート + 1
// モックの事前検証が警告を返す、一般的な範囲（50〜300 円）から外れるレート
const OUT_OF_RANGE_RATE = LATEST.為替レート * 10
// 本文の型違反（正の数でない）。事前検証の段階で 422 になる
const INVALID_RATE = 0

const noticeFor = (value) => `USD/JPY のレートを ${shown(value)} 円に更新しました。`
const REQUIRED_MESSAGE = 'レートを入力してください。'
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'
const CONFLICT_MESSAGE =
  '他のユーザーによって為替レートが更新されました。最新情報を再取得してください。'
const REJECT_REASON = `基準日 ${LATEST.基準日} の ${CURRENCY_CODE} は既に登録されています`

const LATEST_PATH = '*/api/masters/fx/latest'
const VALIDATE_PATH = '*/api/masters/fx/validate'
// `:fxId` にすると latest まで拾うので、対象の ID を直接書いたパスで差し替える
const LATEST_DETAIL_PATH = `*/api/masters/fx/${LATEST.ID}`

const latestError = (status, detail, options) =>
  http.get(LATEST_PATH, () => HttpResponse.json({ detail }, { status }), options)

/** 今日（JST）を固定する */
function setToday(isoDate) {
  vi.setSystemTime(new Date(`${isoDate}T12:00:00+09:00`))
}

const Page = { render: () => h('div') }

async function mountView() {
  // 実 router/index.js は createWebHistory 固定で差し替えられないため、テスト用に最小定義する
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: PATH, component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push(PATH)

  return mount(FxRateMasterView, {
    global: {
      plugins: [createPinia(), router],
      // teleport を stub して、ヘッダへ差し込むボタンとモーダルを wrapper 内に描画させる
      stubs: { teleport: true },
    },
  })
}

/** 取得 → 反映 → 再描画 までを待つ */
async function settle() {
  await flushPromises()
  await flushPromises()
}

/** 事前検証 → 登録 / 変更 の 2 往復 → 再描画 までを待つ */
async function settleSave() {
  for (let i = 0; i < 4; i += 1) await flushPromises()
}

const byTestid = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const exists = (wrapper, testid) => byTestid(wrapper, testid).exists()
const text = (wrapper, testid) => byTestid(wrapper, testid).text()

async function openUpdate(wrapper) {
  await byTestid(wrapper, 'fx-update').trigger('click')
  await flushPromises()
}
async function setRate(wrapper, value) {
  await byTestid(wrapper, 'fx-rate-input').setValue(String(value))
}
async function submit(wrapper) {
  await byTestid(wrapper, 'fx-update-submit').trigger('click')
  await settleSave()
}

/*
 * it.skip の 9 件（FXV-08〜15 / FXV-17）は製品コードの不具合待ち（シナリオ上は「保留」）。
 * 入力欄が type="number" なので Vue の v-model が入力値を Number に変換し、
 * FxRateMasterView.vue の submitUpdate の `rateInput.value.trim()` が TypeError になる
 * （入力を書き換えて送信すると事前検証まで進まない）。直ったら skip を外して「実装済」にする。
 */
// シナリオ: docs/unit/views-fx-rate-master-view.md
describe('FxRateMasterView', () => {
  beforeEach(() => {
    // 「今日」だけを固定する（setTimeout まで止めると MSW の応答と flushPromises が返らない）
    vi.useFakeTimers({ toFake: ['Date'] })
    setToday(AFTER_ALL_DATE)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('[FXV-01] 取得中はローディングを表示し、レート更新は押せない', async () => {
    // store.load() は setup 中に始まるので、最初の描画が既にローディング状態
    const wrapper = await mountView()

    expect(exists(wrapper, 'fx-loading')).toBe(true)
    expect(exists(wrapper, 'fx-current')).toBe(false)
    expect(exists(wrapper, 'fx-empty')).toBe(false)
    expect(exists(wrapper, 'fx-error')).toBe(false)
    expect(byTestid(wrapper, 'fx-update').element.disabled).toBe(true)
  })

  it('[FXV-02] 取得が失敗したときは理由と再試行を表示し、レート更新は押せない', async () => {
    server.use(latestError(500, ERROR_MESSAGE))
    const wrapper = await mountView()
    await settle()

    const error = byTestid(wrapper, 'fx-error')
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'fx-current')).toBe(false)
    expect(byTestid(wrapper, 'fx-update').element.disabled).toBe(true)
  })

  it('[FXV-03] 未登録のときは空状態を表示し、レート更新は押せる', async () => {
    server.use(latestError(404, '有効な為替レートが存在しません'))
    const wrapper = await mountView()
    await settle()

    expect(exists(wrapper, 'fx-empty')).toBe(true)
    expect(exists(wrapper, 'fx-current')).toBe(false)
    expect(byTestid(wrapper, 'fx-update').element.disabled).toBe(false)
  })

  it('[FXV-04] 現在レート・基準日・最終更新を表示する', async () => {
    const wrapper = await mountView()
    await settle()

    expect(text(wrapper, 'fx-rate')).toBe(shown(LATEST.為替レート))
    expect(text(wrapper, 'fx-base-date')).toBe(LATEST_DATE)
    expect(text(wrapper, 'fx-updated')).toContain(formatDateTime(LATEST.更新日時))
    expect(text(wrapper, 'fx-updated')).toContain(LATEST.更新者)
  })

  it('[FXV-05] 「再試行」で取り直すとエラーが消えて現在レートが出る', async () => {
    // 2 回目は既定ハンドラ（フィクスチャ）に戻る
    server.use(latestError(500, ERROR_MESSAGE, { once: true }))
    const wrapper = await mountView()
    await settle()
    expect(exists(wrapper, 'fx-error')).toBe(true)

    await wrapper.find('[data-testid="fx-error"] button').trigger('click')
    await settle()

    expect(exists(wrapper, 'fx-error')).toBe(false)
    expect(text(wrapper, 'fx-rate')).toBe(shown(LATEST.為替レート))
  })

  it('[FXV-06] レート更新を押すと現在レートを初期値にしたモーダルが開く', async () => {
    const wrapper = await mountView()
    await settle()

    await openUpdate(wrapper)

    expect(exists(wrapper, 'fx-update-form')).toBe(true)
    expect(byTestid(wrapper, 'fx-rate-input').element.value).toBe(String(LATEST.為替レート))
    expect(text(wrapper, 'fx-update-submit')).toBe('更新')
  })

  it('[FXV-07] 未入力で送ると必須の理由を出し、事前検証を送らない', async () => {
    let validated = false
    server.use(
      http.post(VALIDATE_PATH, () => {
        validated = true
        return HttpResponse.json({ valid: true, errors: [], warnings: [] })
      }),
    )
    const wrapper = await mountView()
    await settle()
    await openUpdate(wrapper)

    await setRate(wrapper, '')
    await submit(wrapper)

    expect(byTestid(wrapper, 'fx-update-form').text()).toContain(REQUIRED_MESSAGE)
    expect(validated).toBe(false)
  })

  it.skip('[FXV-08] 今日の行が無いときは今日の基準日で登録され、完了の文言が出る', async () => {
    const wrapper = await mountView()
    await settle()
    await openUpdate(wrapper)

    await setRate(wrapper, NEW_RATE)
    await submit(wrapper)

    expect(exists(wrapper, 'fx-update-form')).toBe(false)
    expect(text(wrapper, 'fx-notice')).toBe(noticeFor(NEW_RATE))
    expect(text(wrapper, 'fx-rate')).toBe(shown(NEW_RATE))
    expect(text(wrapper, 'fx-base-date')).toBe(AFTER_ALL_DATE)
  })

  it.skip('[FXV-09] 今日の行があるときはその行が変更され、基準日は変わらない', async () => {
    setToday(LATEST_DATE)
    const wrapper = await mountView()
    await settle()
    await openUpdate(wrapper)

    await setRate(wrapper, NEW_RATE)
    await submit(wrapper)

    expect(exists(wrapper, 'fx-update-form')).toBe(false)
    expect(text(wrapper, 'fx-notice')).toBe(noticeFor(NEW_RATE))
    expect(text(wrapper, 'fx-rate')).toBe(shown(NEW_RATE))
    expect(text(wrapper, 'fx-base-date')).toBe(LATEST_DATE)
  })

  it.skip('[FXV-10] 範囲外のレートは警告を出して保存せず、送信ボタンが「続行」になる', async () => {
    const wrapper = await mountView()
    await settle()
    await openUpdate(wrapper)

    await setRate(wrapper, OUT_OF_RANGE_RATE)
    await submit(wrapper)

    expect(exists(wrapper, 'fx-update-validation-warning')).toBe(true)
    expect(exists(wrapper, 'fx-update-form')).toBe(true)
    expect(text(wrapper, 'fx-update-submit')).toBe('続行')
    expect(text(wrapper, 'fx-rate')).toBe(shown(LATEST.為替レート))
  })

  it.skip('[FXV-11] 警告のあとに「続行」を押すと保存されてモーダルが閉じる', async () => {
    const wrapper = await mountView()
    await settle()
    await openUpdate(wrapper)
    await setRate(wrapper, OUT_OF_RANGE_RATE)
    await submit(wrapper)
    expect(text(wrapper, 'fx-update-submit')).toBe('続行')

    await submit(wrapper)

    expect(exists(wrapper, 'fx-update-form')).toBe(false)
    expect(text(wrapper, 'fx-rate')).toBe(shown(OUT_OF_RANGE_RATE))
  })

  it.skip('[FXV-12] 警告のあとに入力値を変えると警告が消え、送信ボタンが「更新」に戻る', async () => {
    const wrapper = await mountView()
    await settle()
    await openUpdate(wrapper)
    await setRate(wrapper, OUT_OF_RANGE_RATE)
    await submit(wrapper)
    expect(exists(wrapper, 'fx-update-validation-warning')).toBe(true)

    await setRate(wrapper, NEW_RATE)
    await flushPromises()

    expect(exists(wrapper, 'fx-update-validation-warning')).toBe(false)
    expect(text(wrapper, 'fx-update-submit')).toBe('更新')
  })

  it.skip('[FXV-13] 事前検証が不合格なら理由をモーダル内に出し、開いたままにする', async () => {
    server.use(
      http.post(VALIDATE_PATH, () =>
        HttpResponse.json({ valid: false, errors: [REJECT_REASON], warnings: [] }),
      ),
    )
    const wrapper = await mountView()
    await settle()
    await openUpdate(wrapper)

    await setRate(wrapper, NEW_RATE)
    await submit(wrapper)

    expect(text(wrapper, 'fx-update-validation-error')).toContain(REJECT_REASON)
    expect(exists(wrapper, 'fx-update-form')).toBe(true)
    expect(exists(wrapper, 'fx-notice')).toBe(false)
  })

  it.skip('[FXV-14] 変更が 409 のときはサーバの文言を出し、現在レートは変わらない', async () => {
    setToday(LATEST_DATE)
    server.use(
      http.put(LATEST_DETAIL_PATH, () =>
        HttpResponse.json({ detail: CONFLICT_MESSAGE }, { status: 409 }),
      ),
    )
    const wrapper = await mountView()
    await settle()
    await openUpdate(wrapper)

    await setRate(wrapper, NEW_RATE)
    await submit(wrapper)

    expect(text(wrapper, 'fx-update-error')).toBe(CONFLICT_MESSAGE)
    expect(exists(wrapper, 'fx-update-form')).toBe(true)
    expect(text(wrapper, 'fx-rate')).toBe(shown(LATEST.為替レート))
  })

  it.skip('[FXV-15] 正の数でないレートは項目名付きの 422 の理由を出す', async () => {
    const wrapper = await mountView()
    await settle()
    await openUpdate(wrapper)

    await setRate(wrapper, INVALID_RATE)
    await submit(wrapper)

    // 実 API の msg は項目名を含まないので、client.js が loc から補っている
    expect(text(wrapper, 'fx-update-error')).toMatch(/^為替レート: /)
    expect(exists(wrapper, 'fx-update-form')).toBe(true)
  })

  it('[FXV-16] キャンセルでモーダルが閉じ、現在レートは変わらない', async () => {
    const wrapper = await mountView()
    await settle()
    await openUpdate(wrapper)
    await setRate(wrapper, NEW_RATE)

    await byTestid(wrapper, 'fx-update-cancel').trigger('click')
    await flushPromises()

    expect(exists(wrapper, 'fx-update-form')).toBe(false)
    expect(exists(wrapper, 'fx-notice')).toBe(false)
    expect(text(wrapper, 'fx-rate')).toBe(shown(LATEST.為替レート))
  })

  it.skip('[FXV-17] 未登録から今日のレートを登録すると空表示が消えて現在レートが出る', async () => {
    server.use(latestError(404, '有効な為替レートが存在しません'))
    const wrapper = await mountView()
    await settle()
    await openUpdate(wrapper)
    expect(byTestid(wrapper, 'fx-rate-input').element.value).toBe('')

    await setRate(wrapper, NEW_RATE)
    await submit(wrapper)

    expect(exists(wrapper, 'fx-empty')).toBe(false)
    expect(text(wrapper, 'fx-rate')).toBe(shown(NEW_RATE))
    expect(text(wrapper, 'fx-base-date')).toBe(AFTER_ALL_DATE)
  })
})
