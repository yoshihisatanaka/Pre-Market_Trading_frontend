import { expect, test } from '@playwright/test'

/*
 * 障害管理を「実 API に当てて」確かめる E2E（スモーク 2 本）。
 * シナリオ: docs/e2e/incidents-real-api.md（タイトル先頭の [IR-xx] が対応 ID）
 *
 * incidents.spec.js（IN）とは目的が違う。IN は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせだけを見るので、
 * 期待値に**データの中身を書かない**（現在値は実行時に画面と API から読む）。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test incidents.real-api
 *
 * IR-02 はローカル DB の発注停止マスタを実際に書き換える（VWAP `2` を停止 → 再開）。
 * 停止はバックエンド全体に効くので、他の実 API E2E と排他で流す。途中で落ちても
 * afterEach が API を直接叩いて再開に戻す。停止理由・日時・操作者と履歴 2 行は戻せないので、
 * ローカルの開発 DB 前提。
 */

const PATH = '/operations/incidents'

const STATUS_API = '/api/operations/order-suspensions'
const RESUME_API = '/api/operations/order-suspensions/resume'

// 操作するのは全体ではなく注文ルート 1 つ（影響を最小にする）。
// IB（1）は自己取引も含むので避け、VWAP を使う
const TARGET = '2'

// 誰が触ったかを実 DB に残す（更新系は X-User-Code が要る。src/api/client.js の暫定実装と同じ扱い）
const USER_CODE = 'e2e'

/** 更新系の宛先。dev サーバの /api プロキシ越しに実 API へ届く */
const baseURL = process.env.E2E_BASE_URL || 'http://frontend:5173'

/** 実 API を直接叩くためのコンテキスト。beforeAll で作り afterAll で捨てる */
let api = null

async function getStatus() {
  const res = await api.get(STATUS_API)
  expect(
    res.ok(),
    `実 API から発注停止状態を取得できない（${res.status()}）。api コンテナが動いているか確認する`,
  ).toBe(true)
  return res.json()
}

function targetOf(status, code) {
  const row = (status.targets ?? []).find((item) => item['停止対象'] === code)
  expect(row, `実 API の targets に停止対象 ${code} が無い`).toBeTruthy()
  return row
}

/** 実 API を見ているかを確かめる。MSW はサービスワーカーで横取りするので、それで判別できる */
async function assertRealApi(page) {
  const mswActive = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller))
  expect(
    mswActive,
    'MSW が有効なままなので実 API を見ていない。VITE_ENABLE_MSW を false にして frontend を作り直すこと',
  ).toBe(false)
}

/** 停止対象のカード（1 対象 = 1 枚。サーバの並びのまま） */
function targetCardsOf(page) {
  return page.getByTestId('incidents-targets').getByTestId('incidents-target')
}

function targetCardOf(page, code) {
  return targetCardsOf(page).filter({ has: page.getByTestId(`incidents-target-${code}-action`) })
}

function historyRowsOf(page) {
  return page.getByTestId('incidents-history').getByTestId('data-table-row')
}

/**
 * 取得が終わるのを待つ。画面が描画される前はローディング表示も無いので、
 * 先に「データあり」の表が出るのを待ってからローディングの消滅を確かめる。
 */
async function settleView(page) {
  await expect(page.getByTestId('incidents-targets')).toBeVisible()
  await expect(page.getByTestId('incidents-loading')).toHaveCount(0)
}

/** 画面を開いて、実 API に当たっていることまで確認する */
async function openView(page) {
  await page.goto(PATH)
  await settleView(page)
  await assertRealApi(page)
}

// IR-02 が実 DB の停止状態を書き換えるので、IR-01 と並走させない
test.describe.configure({ mode: 'serial' })

test.describe('障害管理（実 API 接続）', () => {
  test.skip(
    process.env.E2E_REAL_API !== '1',
    '実 API に当てるテスト。E2E_REAL_API=1 のときだけ実行する',
  )

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'X-User-Code': USER_CODE },
    })
  })

  test.afterEach(async () => {
    // 途中で落ちても VWAP を停止のまま残さない。停止中なら最新の 更新日時 で再開する
    const status = await getStatus()
    const row = targetOf(status, TARGET)
    if (row['発注停止中'] !== true) return
    const res = await api.post(RESUME_API, {
      data: { 停止対象: TARGET, 更新日時: row['更新日時'] ?? null },
    })
    expect(res.ok(), `後片付けの再開が失敗した: ${res.status()} ${await res.text()}`).toBe(true)
  })

  test.afterAll(async () => {
    await api?.dispose()
  })

  test('[IR-01] 実データで停止対象のカードが API の targets と一致する', async ({ page }) => {
    await openView(page)

    const status = await getStatus()
    const targets = status.targets ?? []
    expect(targets.length, '実 API の targets が 0 件').toBeGreaterThan(0)
    expect(targets[0]['停止対象'], '先頭が全体（ALL）ではない').toBe('ALL')

    const cards = targetCardsOf(page)
    await expect(cards).toHaveCount(targets.length)

    for (const [index, target] of targets.entries()) {
      const card = cards.nth(index)
      await expect(card.getByTestId('incidents-target-name')).toHaveText(target['停止対象名'])
      await expect(card.getByTestId(`incidents-target-${target['停止対象']}-action`)).toHaveAttribute(
        'aria-checked',
        String(target['発注停止中'] === true),
      )
      await expect(card.getByTestId('incidents-target-state')).toHaveText(
        target['発注停止中'] === true ? '停止中' : '通常',
      )
    }

    // 4 状態のうち「データあり」に落ちている
    await expect(page.getByTestId('incidents-loading')).toHaveCount(0)
    await expect(page.getByTestId('incidents-error')).toHaveCount(0)
    await expect(page.getByTestId('incidents-empty')).toHaveCount(0)
  })

  test('[IR-02] VWAP を停止して再開するとカード・履歴・API が対で戻る', async ({ page }) => {
    const before = await getStatus()
    expect(
      before['全体停止中'],
      '全体（ALL）が停止中のため、ルートの操作は画面が塞ぐ。DB で全体を再開してから流すこと',
    ).toBe(false)
    const initial = targetOf(before, TARGET)
    expect(
      initial['発注停止中'],
      'VWAP が停止中のまま始まった（前回の後片付け漏れ）。再開してから流すこと',
    ).toBe(false)
    const targetName = initial['停止対象名']

    // 実行ごとに違う理由にして、前回の理由が残っているだけの状態と区別する
    const reason = `E2E 実 API 接続確認 ${new Date().toISOString()}`

    await openView(page)
    const state = targetCardOf(page, TARGET).getByTestId('incidents-target-state')
    const latestHistory = historyRowsOf(page).first()
    const toggle = page.getByTestId(`incidents-target-${TARGET}-action`)

    // 停止
    await toggle.click()
    await page.getByTestId('incidents-control-reason').fill(reason)
    await page.getByTestId('incidents-control-submit').click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('incidents-notice')).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(state).toHaveText('停止中')
    // 停止理由はカードに出さず、履歴の先頭行で見る
    await expect(latestHistory.getByRole('cell').nth(1)).toHaveText(`${targetName}：発注停止`)
    await expect(latestHistory).toContainText(reason)

    // 再開
    await toggle.click()
    await page.getByTestId('incidents-control-submit').click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('incidents-notice')).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(state).toHaveText('通常')
    await expect(latestHistory.getByRole('cell').nth(1)).toHaveText(`${targetName}：発注再開`)

    // 画面の状態ではなく、サーバに届いているかを見る
    const after = targetOf(await getStatus(), TARGET)
    expect(after['発注停止中']).toBe(false)
    expect(after['停止理由']).toBe(reason)
  })
})
