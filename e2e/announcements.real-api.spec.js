import { expect, test } from '@playwright/test'

/*
 * お知らせ管理を「実 API に当てて」確かめる E2E（スモーク 2 本）。
 * シナリオ: docs/e2e/announcements-real-api.md（タイトル先頭の [ANR-xx] が対応 ID）
 *
 * announcements.spec.js（AN）とは目的が違う。AN は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせだけを見るので、
 * 期待値に**データの中身を書かない**（現在値・履歴件数は実行時に API から読む）。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test announcements.real-api
 *
 * ANR-02 は実 DB の唯一のお知らせ行を書き換える。ローカルの開発 DB 前提。
 * beforeAll で 表示フラグ / 本文 を退避し、afterAll で最新の 更新日時 を添えて PUT で戻す。
 * 更新日時 / 更新者 / ユーザー操作フラグ / 履歴行 は戻せない。
 */

const PATH = '/operations/announcements'
const API_PATH = '/api/operations/announcements'

// src/stores/announcements.js の ANNOUNCEMENT_HISTORY_PAGE_SIZE（= utils/pagination.js の DEFAULT_PAGE_SIZE）と同じ値。
// ストアは import.meta を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

// 実行ごとに一意な本文。afterAll で退避した値へ戻すので、DB には履歴行としてだけ残る
const TEST_MESSAGE = `実 API 接続確認（E2E が元に戻す） ${Date.now()}`

// 誰が触ったかを実 DB に残す（実 API の更新系はこのヘッダが無いと弾かれる）
const USER_CODE = 'e2e'

/** beforeAll で退避した現在値（表示フラグ / 本文） */
let saved = null

function apiContext(playwright) {
  return playwright.request.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://frontend:5173',
    extraHTTPHeaders: { 'X-User-Code': USER_CODE },
  })
}

/** 実 API の現在のお知らせ（AnnouncementItem の生の形） */
async function fetchCurrent(api) {
  const res = await api.get(API_PATH)
  expect(res.ok(), '実 API からお知らせを取得できない。api コンテナが動いているか確認する').toBe(
    true,
  )
  return res.json()
}

/** 実 API の履歴（AnnouncementHistoryListResponse の生の形） */
async function fetchHistory(api, { limit = PAGE_SIZE, offset = 0 } = {}) {
  const res = await api.get(`${API_PATH}/history`, { params: { limit, offset } })
  expect(res.ok(), '実 API から履歴を取得できない').toBe(true)
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

/** 取得が終わるのを待つ（お知らせ本体と履歴はローディングが別） */
async function settle(page) {
  await expect(page.getByTestId('announcements-loading')).toHaveCount(0)
  await expect(page.getByTestId('announcements-history-loading')).toHaveCount(0)
}

/** 画面を開いて、実 API に当たっていることまで確認する */
async function openPage(page) {
  await page.goto(PATH)
  /*
   * ルートは権限ガード（GET /auth/me を待つ）と遅延 import の後ろにあり、画面が出るまでは
   * ローディングの testid も存在しない。settle を先に通すと素通りするので、先にフォームを待つ。
   * frontend を作り直した直後は Vite の初回変換で 5 秒を超えることがある（2026-09-29 実測）
   */
  await expect(page.getByTestId('announcements-form')).toBeVisible({ timeout: 20_000 })
  await settle(page)
  await assertRealApi(page)
}

/** 履歴の行。data-table-row は全画面共通の名前なので履歴の表にスコープを切る */
function historyRowsOf(page) {
  return page.getByTestId('announcements-history-table').getByTestId('data-table-row')
}

/** 画面から送られる PUT /api/operations/announcements の応答を待つ */
function waitForPut(page) {
  return page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' && new URL(res.url()).pathname === API_PATH,
  )
}

/** PUT の本文・応答を標準出力に残す（実 API との食い違いを報告するための材料） */
async function logExchange(label, res) {
  const body = await res.text()
  console.log(
    `[${label}] ${res.request().method()} ${new URL(res.url()).pathname}\n` +
      `  request : ${res.request().postData()}\n` +
      `  status  : ${res.status()}\n` +
      `  response: ${body}`,
  )
  return body
}

// 退避 → 書き換え → 復元 は 1 本の流れなので順に実行する
test.describe.configure({ mode: 'serial' })

test.describe('お知らせ管理（実 API 接続）', () => {
  test.skip(
    process.env.E2E_REAL_API !== '1',
    '実 API に当てるテスト。E2E_REAL_API=1 のときだけ実行する',
  )

  test.beforeAll(async ({ playwright }) => {
    const api = await apiContext(playwright)
    const current = await fetchCurrent(api)
    await api.dispose()
    saved = { 表示フラグ: current.表示フラグ, 本文: current.本文 }
    console.log(`[beforeAll] 退避した現在値: ${JSON.stringify(saved)}`)
  })

  test.afterAll(async ({ playwright }) => {
    if (!saved) return
    const api = await apiContext(playwright)

    // 楽観的ロックがあるので、復元の直前に最新の 更新日時 を取り直して添える
    const latest = await fetchCurrent(api)
    const restore = {
      表示フラグ: saved.表示フラグ,
      // 空本文 + 非表示は null に寄せる（実 API の初期状態と同じ形）
      本文: saved.本文 || null,
      ...(latest.更新日時 ? { 更新日時: latest.更新日時 } : {}),
    }
    const res = await api.put(API_PATH, { data: restore })
    const body = await res.text()
    console.log(`[afterAll] 復元 PUT ${JSON.stringify(restore)} → ${res.status()} ${body}`)
    expect(res.ok(), `退避値へ戻せない: ${res.status()} ${body}`).toBe(true)

    const after = await fetchCurrent(api)
    await api.dispose()
    console.log(
      `[afterAll] 復元後: 表示フラグ=${after.表示フラグ} 本文=${JSON.stringify(after.本文)}`,
    )
    expect(after.表示フラグ).toBe(saved.表示フラグ)
    expect(after.本文 ?? '').toBe(saved.本文 ?? '')
  })

  test('[ANR-01] 実データで現在値と履歴が表示される', async ({ page, playwright }) => {
    const api = await apiContext(playwright)
    const current = await fetchCurrent(api)
    const { total } = await fetchHistory(api, { limit: 1 })
    await api.dispose()

    await openPage(page)

    // 編集フォームの初期値が実 API の現在値と一致する
    const enabled = page.getByTestId('announcements-enabled')
    if (current.表示フラグ === 1) {
      await expect(enabled).toBeChecked()
    } else {
      await expect(enabled).not.toBeChecked()
    }
    await expect(page.getByTestId('announcements-message')).toHaveValue(current.本文 ?? '')

    // 履歴は total に応じて 表＋ページ送り か 空状態
    if (total > 0) {
      await expect(historyRowsOf(page)).toHaveCount(Math.min(total, PAGE_SIZE))
      await expect(page.getByTestId('announcements-history-pagination')).toBeVisible()
      await expect(page.getByTestId('announcements-history-empty')).toHaveCount(0)
    } else {
      await expect(page.getByTestId('announcements-history-empty')).toBeVisible()
      await expect(page.getByTestId('announcements-history-table')).toHaveCount(0)
      await expect(page.getByTestId('announcements-history-pagination')).toHaveCount(0)
    }

    // ローディング・エラーは残らない
    await expect(page.getByTestId('announcements-loading')).toHaveCount(0)
    await expect(page.getByTestId('announcements-error')).toHaveCount(0)
    await expect(page.getByTestId('announcements-empty')).toHaveCount(0)
    await expect(page.getByTestId('announcements-history-error')).toHaveCount(0)
  })

  test('[ANR-02] 本文の更新が受理され、履歴に積まれ、再読み込みしても残る', async ({
    page,
    playwright,
  }) => {
    // 画面の読み込み 2 回（初回・再読み込み）と実 API の往復が重なるので既定の 30 秒では足りないことがある
    test.setTimeout(60_000)

    const api = await apiContext(playwright)
    const held = await fetchCurrent(api)
    const before = await fetchHistory(api, { limit: 1 })
    console.log(`[ANR-02] 取得時の 更新日時: ${held.更新日時} / 履歴 total: ${before.total}`)

    await openPage(page)

    // 表示 ON で本文あり、の形にして送る（OFF のままだと表示フラグの変更が伴わない）
    await page.getByTestId('announcements-enabled').setChecked(true)
    await page.getByTestId('announcements-message').fill(TEST_MESSAGE)

    const putResponse = waitForPut(page)
    await page.getByTestId('announcements-save').click()
    const res = await putResponse
    const body = await logExchange('ANR-02', res)

    const sent = res.request().postDataJSON()
    expect(sent.本文).toBe(TEST_MESSAGE)
    expect(sent.表示フラグ).toBe(1)
    // 取得時の 更新日時 を書式を変えずに合札として送る。null なら送らない
    if (held.更新日時) {
      expect(sent.更新日時).toBe(held.更新日時)
    } else {
      expect(sent).not.toHaveProperty('更新日時')
    }
    expect(res.status(), `実 API が更新を受理しない: ${body}`).toBe(200)

    // 成功文言はサーバが決めるので固定しない
    const notice = page.getByTestId('announcements-notice')
    await expect(notice).toBeVisible()
    await expect(notice).not.toHaveText('')
    await expect(page.getByTestId('announcements-save-error')).toHaveCount(0)

    // 履歴が 1 増え、1 行目が新しい本文
    const after = await fetchHistory(api, { limit: 1 })
    console.log(`[ANR-02] 更新後の履歴 1 行目: ${JSON.stringify(after.histories[0])}`)
    expect(after.total).toBe(before.total + 1)
    await settle(page)
    await expect(historyRowsOf(page)).toHaveCount(Math.min(after.total, PAGE_SIZE))
    /*
     * 実 API の 変更後データ は object ではなく JSON 文字列で返る（2026-09-29 実測）。
     * src/api/announcements.js の historyMessage がそれを解釈できていることをここで見る
     */
    await expect(historyRowsOf(page).first()).toContainText(TEST_MESSAGE)

    // 再読み込みしても新しい本文のまま
    await page.reload()
    await settle(page)
    await expect(page.getByTestId('announcements-enabled')).toBeChecked()
    await expect(page.getByTestId('announcements-message')).toHaveValue(TEST_MESSAGE)

    // API 直叩きでも同じ
    const now = await fetchCurrent(api)
    await api.dispose()
    console.log(`[ANR-02] 更新後の現在値: ${JSON.stringify(now)}`)
    expect(now.表示フラグ).toBe(1)
    expect(now.本文).toBe(TEST_MESSAGE)
  })
})
