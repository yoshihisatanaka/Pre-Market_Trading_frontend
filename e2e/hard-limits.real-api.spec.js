import { expect, test } from '@playwright/test'

/*
 * ハードリミットマスタを「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/hard-limits-real-api.md（タイトル先頭の [HR-xx] が対応 ID）
 *
 * hard-limits.spec.js（HL）とは目的が違う。HL は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせだけを見るので、
 * 期待値に**データの中身を書かない**（現在値は実行時に画面と API から読む）。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test hard-limits.real-api
 *
 * スライス注文設定は DB に 1 行しか無い共有設定で、副作用を隔離できない。
 * beforeAll で全項目を退避し、afterAll で書き戻す。更新日時 / 更新者 / ユーザー操作フラグと
 * 履歴テーブルは戻せないので、ローカルの開発 DB 前提。
 */

const PATH = '/masters/hard-limits'

// 誰が触ったかを実 DB に残す（更新系は X-User-Code が要る。src/api/client.js の暫定実装と同じ扱い）
const USER_CODE = 'e2e'

// HR-04 で使う目印。備考が元から NULL だと「保持された」と「落ちた」を区別できないため
const NOTE_MARKER = '実 API 接続確認（E2E が復元する）'

/** 更新系の宛先。dev サーバの /api プロキシ越しに実 API へ届く */
const baseURL = process.env.E2E_BASE_URL || 'http://frontend:5173'

/** 実 API を直接叩くためのコンテキスト。beforeAll で作り afterAll で捨てる */
let api = null

/** 実行前のスライス注文設定。afterAll でこの値に戻す */
let original = null

async function getSettings() {
  const res = await api.get('/api/slice-settings')
  expect(
    res.ok(),
    '実 API からスライス注文設定を取得できない。api コンテナが動いているか確認する',
  ).toBe(true)
  return res.json()
}

/**
 * 現在値（base）を土台に patch だけを変えて PUT する。
 *
 * 実 API は省略した項目をサーバ既定に落とす（備考は NULL、スライス有効フラグは 1）。
 * 楽観的ロックがあるので 更新日時 も base のものを添える。
 */
async function putSettings(base, patch = {}) {
  const res = await api.put('/api/slice-settings', {
    data: {
      市場関与率: base['市場関与率'],
      大口数量閾値: base['大口数量閾値'],
      大口金額閾値: base['大口金額閾値'],
      スライス有効フラグ: base['スライス有効フラグ'],
      備考: base['備考'],
      更新日時: base['更新日時'],
      ...patch,
    },
  })
  expect(res.ok(), `実 API への PUT が失敗した: ${res.status()} ${await res.text()}`).toBe(true)
  return res.json()
}

/** 実 API を見ているかを確かめる。MSW はサービスワーカーで横取りするので、それで判別できる */
async function assertRealApi(page) {
  const mswActive = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller))
  expect(
    mswActive,
    'MSW が有効なままなので実 API を見ていない。VITE_ENABLE_MSW を false にして frontend を作り直すこと',
  ).toBe(false)
}

/**
 * 取得が終わるのを待つ。
 *
 * 現在値のカードは取得中は出ていない。値を読み取ってから比べる場面で
 * ここを通さないと、描画前の状態を掴む。
 */
async function settleView(page) {
  await expect(page.getByTestId('hard-limits-current')).toBeVisible()
  await expect(page.getByTestId('hard-limits-loading')).toHaveCount(0)
}

/** 画面を開いて、実 API に当たっていることまで確認する */
async function openView(page) {
  await page.goto(PATH)
  await settleView(page)
  await assertRealApi(page)
}

/** 「1.00%」「20,000 株」「USD 300,000」から数値だけを取り出す */
function numberFrom(text) {
  return Number(text.replace(/[^0-9.]/g, ''))
}

/** 現在値カードの 3 項目を数値で読む */
async function currentOf(page) {
  await settleView(page)
  return {
    rate: numberFrom(await page.getByTestId('hard-limits-rate').innerText()),
    quantity: numberFrom(await page.getByTestId('hard-limits-quantity').innerText()),
    amount: numberFrom(await page.getByTestId('hard-limits-amount').innerText()),
  }
}

/** 数量上限を指定の値にして保存する。3 つの入力欄のうち触るのはここだけ */
async function saveQuantity(page, quantity) {
  await page.getByTestId('hard-limits-quantity-input').fill(String(quantity))
  await page.getByTestId('hard-limits-save').click()
}

// 同じ 1 行を順に書き換えるので直列に実行する
test.describe.configure({ mode: 'serial' })

test.describe('ハードリミットマスタ（実 API 接続）', () => {
  test.skip(
    process.env.E2E_REAL_API !== '1',
    '実 API に当てるテスト。E2E_REAL_API=1 のときだけ実行する',
  )

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'X-User-Code': USER_CODE },
    })
    original = await getSettings()
  })

  test.afterAll(async () => {
    // 唯一の行を書き換えているので必ず戻す。楽観的ロックのため最新の 更新日時 を取り直す
    const latest = await getSettings()
    await putSettings(latest, {
      市場関与率: original['市場関与率'],
      大口数量閾値: original['大口数量閾値'],
      大口金額閾値: original['大口金額閾値'],
      スライス有効フラグ: original['スライス有効フラグ'],
      備考: original['備考'],
    })
    await api.dispose()
  })

  test('[HR-01] 実データで現在値の 3 項目が表示される', async ({ page }) => {
    await openView(page)

    const settings = await getSettings()
    const shown = await currentOf(page)

    // 比率 → % の換算まで含めて、サーバの値と画面の値が一致する
    expect(shown.rate).toBeCloseTo(settings['市場関与率'] * 100, 2)
    expect(shown.quantity).toBe(settings['大口数量閾値'])
    expect(shown.amount).toBeCloseTo(settings['大口金額閾値'], 2)

    // 4 状態のうち「データあり」に落ちている
    await expect(page.getByTestId('hard-limits-form')).toBeVisible()
    await expect(page.getByTestId('hard-limits-error')).toHaveCount(0)
    await expect(page.getByTestId('hard-limits-empty')).toHaveCount(0)
  })

  test('[HR-02] 入力欄の初期値が現在値と一致する', async ({ page }) => {
    await openView(page)

    const settings = await getSettings()

    const rate = await page.getByTestId('hard-limits-rate-input').inputValue()
    const quantity = await page.getByTestId('hard-limits-quantity-input').inputValue()
    const amount = await page.getByTestId('hard-limits-amount-input').inputValue()

    // 入力欄だけは % で扱う（比率 0.01 ↔ 入力 1）
    expect(Number(rate)).toBeCloseTo(settings['市場関与率'] * 100, 2)
    expect(Number(quantity)).toBe(settings['大口数量閾値'])
    expect(Number(amount)).toBeCloseTo(settings['大口金額閾値'], 2)
  })

  test('[HR-03] 数量上限を変えて保存すると実 API にも反映される', async ({ page }) => {
    await openView(page)
    const before = await currentOf(page)

    await saveQuantity(page, before.quantity + 1)

    await expect(page.getByTestId('hard-limits-notice')).toBeVisible()
    expect((await currentOf(page)).quantity).toBe(before.quantity + 1)

    // 画面の状態ではなく、サーバに届いているかを見る
    expect((await getSettings())['大口数量閾値']).toBe(before.quantity + 1)

    // 開き直しても保持される（保存後の画面表示だけが更新されているのではない）
    await openView(page)
    expect((await currentOf(page)).quantity).toBe(before.quantity + 1)
  })

  test('[HR-04] 保存しても備考が消えない', async ({ page }) => {
    /*
     * 画面に備考の入力欄は無い。api 層が現在値を送り返しているので保持されるが、
     * 送り忘れるとサーバが NULL に落とす。モックでは追えない噛み合わせなのでここで見る。
     * 元から NULL だと「保持された」と区別できないため、先に目印を入れておく。
     */
    let seeded = await getSettings()
    if (seeded['備考'] === null) {
      await putSettings(seeded, { 備考: NOTE_MARKER })
      seeded = await getSettings()
    }
    expect(seeded['備考']).not.toBeNull()

    await openView(page)
    const before = await currentOf(page)

    await saveQuantity(page, before.quantity + 1)
    await expect(page.getByTestId('hard-limits-notice')).toBeVisible()

    const after = await getSettings()
    expect(after['大口数量閾値'], '保存自体が届いていない').toBe(before.quantity + 1)
    expect(after['備考']).toBe(seeded['備考'])
  })

  test('[HR-05] 保存してもスライス有効フラグが変わらない', async ({ page }) => {
    /*
     * こちらも画面に出ない項目。省略するとサーバは 1 に立てるので、
     * 0 にしてから保存して「1 に戻らない」ことを見ないと確かめたことにならない。
     */
    const seeded = await putSettings(await getSettings(), { スライス有効フラグ: 0 })
    expect(seeded['スライス有効フラグ']).toBe(0)

    await openView(page)
    const before = await currentOf(page)

    await saveQuantity(page, before.quantity + 1)
    await expect(page.getByTestId('hard-limits-notice')).toBeVisible()

    const after = await getSettings()
    expect(after['大口数量閾値'], '保存自体が届いていない').toBe(before.quantity + 1)
    expect(after['スライス有効フラグ']).toBe(0)
  })

  test('[HR-06] 範囲外の値で保存すると理由が出て現在値は変わらない', async ({ page }) => {
    await openView(page)
    const before = await currentOf(page)
    const apiBefore = await getSettings()

    // 実 API の下限は 0.0001（= 0.01%）。0 は必ず 422 で弾かれる
    await page.getByTestId('hard-limits-rate-input').fill('0')
    await page.getByTestId('hard-limits-save').click()

    // 文言はサーバ側の資産なので固定しない。拒否が利用者に伝わることだけを見る
    await expect(page.getByTestId('hard-limits-save-error')).toBeVisible()
    await expect(page.getByTestId('hard-limits-notice')).toHaveCount(0)

    const after = await currentOf(page)
    expect(after.rate).toBeCloseTo(before.rate, 2)
    expect(after.quantity).toBe(before.quantity)

    const apiAfter = await getSettings()
    expect(apiAfter['市場関与率']).toBe(apiBefore['市場関与率'])
    expect(apiAfter['更新日時'], '拒否されたのに DB が更新されている').toBe(apiBefore['更新日時'])
  })

  test('[HR-07] 先に更新されていると競合が出て現在値は変わらない', async ({ page }) => {
    await openView(page)
    const before = await currentOf(page)

    // 画面が現在値を掴んだあとに、別経路で更新して 更新日時 を進める
    const external = await putSettings(await getSettings(), {
      大口数量閾値: before.quantity + 1,
    })

    await saveQuantity(page, before.quantity + 5)

    await expect(page.getByTestId('hard-limits-save-error')).toBeVisible()
    await expect(page.getByTestId('hard-limits-notice')).toHaveCount(0)

    // 画面の現在値は掴んだときのまま（失敗した値で塗り替えない）
    expect((await currentOf(page)).quantity).toBe(before.quantity)

    // 先勝ちした側の値が残っている
    expect((await getSettings())['大口数量閾値']).toBe(external['大口数量閾値'])
  })
})
