import { expect, test } from '@playwright/test'
import { apiContext, assertRealApi, skipUnlessRealApi } from './helpers/realApi.js'

/*
 * 仮計算マスタを「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/calculation-settings-real-api.md（タイトル先頭の [PCR-xx] が対応 ID）
 *
 * calculation-settings.spec.js（PC）とは目的が違う。PC は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせだけを見るので、
 * 期待値に**データの中身を書かない**（現在値は実行時に画面と API から読む）。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test calculation-settings.real-api
 *
 * 仮計算マスタは DB に 1 行しか無い共有設定で、副作用を隔離できない。
 * beforeAll で全項目を退避し、afterAll で書き戻す（手本は slice-criteria.real-api.spec.js）。
 * 更新日時 / 更新者 / ユーザー操作フラグと履歴は戻せないので、ローカルの開発 DB 前提。
 */

const PATH = '/masters/provisional-calculation'
// 実 API のパス（openapi.json）。画面の path とは綴りが違う
const API_PATH = '/api/masters/calculation-settings'

// PCR-04 で備考に入れる目印。元が NULL だと「保たれた」と「NULL に落ちた」を区別できないため
const NOTE_MARKER = '実 API 接続確認（E2E が復元する）'

// 画面が送らない項目。PCR-04 で保たれることを見る
const HIDDEN_RATE_KEYS = ['消費税率', '譲渡益所得税率', '譲渡益住民税率']

/*
 * 画面の換算と丸め。src/views/CalculationSettingsMasterView.vue の ratioToPercent / bpToPercent /
 * percentToRatio / percentToBp / INPUT_RULES の digits と同じ規則。
 * view は import.meta を辿るストアに依存しており Playwright からは import できないので再掲する。
 */
const DIGITS = { exchangeTax: 6, spread: 4, commission: 6, nisaMarkup: 4 }

/** API の生の値 → 画面の表記（数値。単位なし） */
function shownOf(raw) {
  return {
    exchangeTax: (raw['取引所税率'] * 100).toFixed(DIGITS.exchangeTax),
    spread: raw['為替スプレッド'].toFixed(DIGITS.spread),
    commission: (raw['現地手数料率_bp'] / 100).toFixed(DIGITS.commission),
    nisaMarkup: raw['NISA為替上乗せ率'].toFixed(DIGITS.nisaMarkup),
  }
}

/** 画面が「触らずに保存」したときに送る値（表記 → API の単位。view の丸めと同じ） */
function roundTripOf(raw) {
  const shown = shownOf(raw)
  return {
    取引所税率: Number((Number(shown.exchangeTax) / 100).toFixed(10)),
    為替スプレッド: Number(shown.spread),
    現地手数料率_bp: Number((Number(shown.commission) * 100).toFixed(4)),
    NISA為替上乗せ率: Number(shown.nisaMarkup),
  }
}

/** スプレッドを 0.0001 円（画面の最小単位）ずらした値 */
function bumpSpread(spread, steps = 1) {
  return Number((Number(spread.toFixed(DIGITS.spread)) + 0.0001 * steps).toFixed(DIGITS.spread))
}

/**
 * 0〜1 の比率を、既定値と区別できるようずらす（上限 1 を超えない向きに）。
 * 幅は DB の桁数より粗くする。実 API は 消費税率 に 0.10001 を送ると 200 のまま 0.1 に丸めて保存した
 * （2026-10-07 実測。桁数は openapi.json に書かれていない）ので、0.00001 刻みでは区別がつかない
 */
function nudgeRate(rate) {
  const step = 0.01
  return Number((rate + step <= 1 ? rate + step : rate - step).toFixed(10))
}

/** 実 API を直接叩くためのコンテキスト。beforeAll で作り afterAll で捨てる */
let api = null

/** 実行前の仮計算マスタ。afterAll でこの値に戻す */
let original = null

async function getSettings() {
  const res = await api.get(API_PATH)
  expect(
    res.ok(),
    `実 API から仮計算マスタを取得できない（${res.status()}）。api コンテナが動いているか、` +
      'db/migrate_calculation_setting.py で初期化済みかを確認する',
  ).toBe(true)
  return res.json()
}

/**
 * 最新の 更新日時 を添えて patch だけを PUT する（部分更新なので送った項目だけが変わる）。
 * 応答は { success, calculation_setting, message } で包まれている。
 */
async function putSettings(base, patch) {
  const res = await api.put(API_PATH, { data: { ...patch, 更新日時: base['更新日時'] } })
  expect(res.ok(), `実 API への PUT が失敗した: ${res.status()} ${await res.text()}`).toBe(true)
  return (await res.json()).calculation_setting
}

/**
 * 取得が終わるのを待つ。現在の設定は取得中は出ていない。
 * 値を読み取ってから比べる場面でここを通さないと、描画前の状態を掴む。
 */
async function settleView(page) {
  await expect(page.getByTestId('calc-settings-current')).toBeVisible()
  await expect(page.getByTestId('calc-settings-loading')).toHaveCount(0)
}

/** 画面を開いて、実 API に当たっていることまで確認する */
async function openView(page) {
  await page.goto(PATH)
  await settleView(page)
  await assertRealApi(page)
}

/** 「0.0500 円/USD」から数値の部分だけを取り出す（単位の / や記号を落とす） */
function numberTextFrom(text) {
  return text.replace(/[^0-9.]/g, '')
}

/** 現在の設定のスプレッドを数値で読む */
async function shownSpreadOf(page) {
  await settleView(page)
  return Number(numberTextFrom(await page.getByTestId('calc-settings-spread').innerText()))
}

/** スプレッドだけを指定の値にして保存する。4 つの入力欄のうち触るのはここだけ */
async function saveSpread(page, spread) {
  await page.getByTestId('calc-settings-spread-input').fill(spread.toFixed(DIGITS.spread))
  await page.getByTestId('calc-settings-save').click()
}

// 同じ 1 行を順に書き換えるので直列に実行する
test.describe.configure({ mode: 'serial' })

test.describe('仮計算マスタ（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test.beforeAll(async ({ playwright }) => {
    api = await apiContext(playwright)
    original = await getSettings()
  })

  test.afterAll(async () => {
    if (!api) return
    if (original) {
      // 唯一の行を書き換えているので必ず戻す。楽観的ロックのため最新の 更新日時 を取り直す
      const latest = await getSettings()
      const restored = await putSettings(latest, {
        取引所税率: original['取引所税率'],
        為替スプレッド: original['為替スプレッド'],
        現地手数料率_bp: original['現地手数料率_bp'],
        NISA為替上乗せ率: original['NISA為替上乗せ率'],
        消費税率: original['消費税率'],
        譲渡益所得税率: original['譲渡益所得税率'],
        譲渡益住民税率: original['譲渡益住民税率'],
        // 元が NULL なら明示的に null を送る（部分更新で null が「クリア」と扱われる前提）
        備考: original['備考'],
      })
      if (restored['備考'] !== original['備考']) {
        // 復元できなかったことを報告に残す（テスト自体は落とさない。実データの後始末の問題なので）
        console.log(
          `[PCR] 備考を元に戻せなかった: 期待 ${JSON.stringify(original['備考'])} / ` +
            `実際 ${JSON.stringify(restored['備考'])}。実 API が null を「触らない」と扱っている可能性がある`,
        )
      }
    }
    await api.dispose()
  })

  test('[PCR-01] 実データで現在の設定の 4 値が換算どおりに表示される', async ({ page }) => {
    await openView(page)

    const expected = shownOf(await getSettings())

    // 換算・桁数・単位まで含めて、サーバの値と画面の表記が一致する
    const exchangeTax = page.getByTestId('calc-settings-exchange-tax')
    const spread = page.getByTestId('calc-settings-spread')
    const commission = page.getByTestId('calc-settings-commission')
    const nisaMarkup = page.getByTestId('calc-settings-nisa-markup')

    expect(numberTextFrom(await exchangeTax.innerText())).toBe(expected.exchangeTax)
    expect(numberTextFrom(await spread.innerText())).toBe(expected.spread)
    expect(numberTextFrom(await commission.innerText())).toBe(expected.commission)
    expect(numberTextFrom(await nisaMarkup.innerText())).toBe(expected.nisaMarkup)

    await expect(exchangeTax).toContainText('%')
    await expect(spread).toContainText('円/USD')
    await expect(commission).toContainText('%')
    await expect(nisaMarkup).toContainText('%')

    // 4 状態のうち「データあり」に落ちている
    await expect(page.getByTestId('calc-settings-form')).toBeVisible()
    await expect(page.getByTestId('calc-settings-error')).toHaveCount(0)
    await expect(page.getByTestId('calc-settings-empty')).toHaveCount(0)
  })

  test('[PCR-02] スプレッドを変えて保存すると実 API にも反映される', async ({ page }) => {
    await openView(page)
    const next = bumpSpread(await shownSpreadOf(page))

    await saveSpread(page, next)

    const notice = page.getByTestId('calc-settings-notice')
    await expect(notice).toBeVisible()
    // 差分なしの経路（PCR-05）に入っていない
    await expect(notice).not.toContainText('変更はありません')
    await expect(page.getByTestId('calc-settings-save-error')).toHaveCount(0)
    expect(await shownSpreadOf(page)).toBeCloseTo(next, 4)

    // 画面の状態ではなく、サーバに届いているかを見る
    expect((await getSettings())['為替スプレッド']).toBeCloseTo(next, 4)

    // 開き直しても保持される（保存後の画面表示だけが更新されているのではない）
    await openView(page)
    expect(await shownSpreadOf(page)).toBeCloseTo(next, 4)
  })

  test('[PCR-03] 入力欄の初期値が API の値の換算と一致する', async ({ page }) => {
    await openView(page)

    const expected = shownOf(await getSettings())

    const inputs = {
      exchangeTax: page.getByTestId('calc-settings-exchange-tax-input'),
      spread: page.getByTestId('calc-settings-spread-input'),
      commission: page.getByTestId('calc-settings-commission-input'),
      nisaMarkup: page.getByTestId('calc-settings-nisa-markup-input'),
    }

    // type="number" の inputValue は表記を正規化することがあるので、数値として比べる
    for (const [key, input] of Object.entries(inputs)) {
      expect(Number(await input.inputValue()), key).toBeCloseTo(
        Number(expected[key]),
        DIGITS[key],
      )
    }
  })

  test('[PCR-04] 保存しても画面に出ない 4 項目が変わらない', async ({ page }) => {
    /*
     * 画面は 4 項目と 更新日時 しか送らない（部分更新に任せている）。
     * サーバが省略された項目を既定値や NULL に落とすと、このテストでしか気づけない。
     * 現在値が既定値と同じだと「保たれた」と「既定値に落ちた」を区別できないので、
     * 先に API で少しずらした値と目印を入れておく（afterAll で元に戻す）。
     */
    const current = await getSettings()
    const seeded = await putSettings(current, {
      ...Object.fromEntries(HIDDEN_RATE_KEYS.map((key) => [key, nudgeRate(current[key])])),
      備考: NOTE_MARKER,
    })
    for (const key of HIDDEN_RATE_KEYS) {
      expect(seeded[key], `${key} の下ごしらえが効いていない`).toBeCloseTo(nudgeRate(current[key]), 4)
    }
    expect(seeded['備考']).toBe(NOTE_MARKER)

    await openView(page)
    const next = bumpSpread(await shownSpreadOf(page))

    await saveSpread(page, next)
    await expect(page.getByTestId('calc-settings-notice')).toBeVisible()

    const after = await getSettings()
    expect(after['為替スプレッド'], '保存自体が届いていない').toBeCloseTo(next, 4)
    for (const key of HIDDEN_RATE_KEYS) {
      expect(after[key], `${key} が保存で変わった`).toBe(seeded[key])
    }
    expect(after['備考'], '備考が保存で変わった').toBe(seeded['備考'])
  })

  test('[PCR-05] 何も変えずに保存すると「変更はありません。」になる', async ({ page }) => {
    /*
     * API の値が画面の桁より細かいと、触らずに保存しても丸めた値が送られて差分になる。
     * 差分なしの経路を確かめたいので、先に 4 項目を画面の精度に丸めた値にしておく。
     */
    const current = await getSettings()
    const rounded = roundTripOf(current)
    const needsRounding = Object.entries(rounded).some(([key, value]) => value !== current[key])
    if (needsRounding) await putSettings(current, rounded)

    await openView(page)
    const apiBefore = await getSettings()

    await page.getByTestId('calc-settings-save').click()

    // 差分なしの経路に入ったことは、この文言でしか画面から見分けられない
    await expect(page.getByTestId('calc-settings-notice')).toContainText('変更はありません。')
    await expect(page.getByTestId('calc-settings-save-error')).toHaveCount(0)

    const apiAfter = await getSettings()
    expect(apiAfter['更新日時'], '差分が無いのに DB が更新されている').toBe(apiBefore['更新日時'])
  })

  test('[PCR-06] 先に更新されていると競合が出て値は上書きされない', async ({ page }) => {
    await openView(page)
    const before = await shownSpreadOf(page)

    // 画面が現在値を掴んだあとに、別経路で更新して 更新日時 を進める
    const external = await putSettings(await getSettings(), {
      為替スプレッド: bumpSpread(before),
    })

    // 別経路の値とも違う値にする（同じ値だと差分なしの経路に入り、競合を見ない）
    await saveSpread(page, bumpSpread(before, 2))

    // 文言はサーバ側の資産なので固定しない。拒否が利用者に伝わることだけを見る
    await expect(page.getByTestId('calc-settings-save-error')).toBeVisible()
    await expect(page.getByTestId('calc-settings-notice')).toHaveCount(0)

    // 画面の現在値は掴んだときのまま（失敗した値で塗り替えない）
    expect(await shownSpreadOf(page)).toBeCloseTo(before, 4)

    // 先勝ちした側の値が残っている
    expect((await getSettings())['為替スプレッド']).toBe(external['為替スプレッド'])
  })
})
