import { expect, test } from '@playwright/test'

/*
 * 海外休場日マスタを「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/market-holidays-real-api.md（タイトル先頭の [MR-xx] が対応 ID）
 *
 * market-holidays.spec.js（MH）とは目的が違う。MH は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせだけを見るので、
 * 期待値に**データの中身を書かない**（件数・日付は実行時に画面から読む）。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test market-holidays.real-api
 *
 * MR-04 以降は実 DB に登録・削除を行う。ローカルの開発 DB 前提。
 */

const PATH = '/masters/market-holidays'

// src/stores/marketHolidays.js の MARKET_HOLIDAYS_PAGE_SIZE と同じ値。
// ストアは import.meta を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

// 試験用の行を置く年。実運用のデータと混ざらないよう遠い将来に寄せる
const RESERVED_YEAR = 2035
const TEST_REASON = '実 API 接続確認'
// 誰が触ったかを実 DB に残す（実 API はこのヘッダが無くても通り、その場合は SYSTEM になる）
const USER_CODE = 'e2e'

/** MR-04〜08 が使う日付。beforeAll が「まだ 1 度も使われていない日」を選ぶ */
let testDate = 0

const toIsoDate = (holidayDate) => {
  const digits = String(holidayDate)
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

/** 取り消し済みも含めて、指定年に存在する休場日を集める */
async function usedDatesIn(api, year) {
  const used = new Set()
  let offset = 0

  for (;;) {
    const res = await api.get('/api/holidays', {
      params: {
        start_date: year * 10000 + 101,
        end_date: year * 10000 + 1231,
        include_deleted: true,
        // 実 API の上限。これを超える分は次の周で取る
        limit: 200,
        offset,
      },
    })
    expect(res.ok(), '実 API から一覧を取得できない。api コンテナが動いているか確認する').toBe(true)

    const { total, holidays } = await res.json()
    for (const holiday of holidays) used.add(holiday.休場日)
    offset += holidays.length
    if (holidays.length === 0 || offset >= total) return used
  }
}

/*
 * 1 度でも登録した日付は論理削除で残り、次に登録すると「再有効化」の警告が出る。
 * MR-04 は素の新規登録を見たいので、まだ一度も使われていない日付を選ぶ。
 */
async function pickUnusedDate(api) {
  const used = await usedDatesIn(api, RESERVED_YEAR)

  for (let day = 0; day < 366; day += 1) {
    const date = new Date(Date.UTC(RESERVED_YEAR, 0, 1 + day))
    if (date.getUTCFullYear() !== RESERVED_YEAR) break

    const candidate = Number(
      `${RESERVED_YEAR}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
        date.getUTCDate(),
      ).padStart(2, '0')}`,
    )
    if (!used.has(candidate)) return candidate
  }

  throw new Error(`${RESERVED_YEAR} 年に空きが無い。試験用の行を DB から整理すること`)
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
 * 件数の表示は取得中も出ていて、そのあいだは 0 件になる。
 * 値を読み取ってから比べる場面では、先にここを通さないと 0 を掴む。
 */
async function settleList(page) {
  await expect(page.getByTestId('market-holidays-loading')).toHaveCount(0)
}

/** 一覧を開いて、実 API に当たっていることまで確認する */
async function openList(page, query = '') {
  await page.goto(`${PATH}${query}`)
  await expect(page.getByTestId('market-holidays-count')).toBeVisible()
  await settleList(page)
  await assertRealApi(page)
}

/** 「N 件」の表示から件数を読む */
async function countOf(page) {
  await settleList(page)
  const text = await page.getByTestId('market-holidays-count').textContent()
  return Number(text.replace(/[^0-9]/g, ''))
}

function rowsOf(page) {
  return page.getByTestId('market-holidays-table').getByTestId('data-table-row')
}

function addDialogOf(page) {
  return page.getByRole('dialog', { name: '海外休場日 新規追加' })
}

/** 追加モーダルを開いて入力し、送信する */
async function submitAdd(page, isoDate) {
  await page.getByTestId('market-holidays-add').click()
  await expect(addDialogOf(page)).toBeVisible()
  await page.getByTestId('market-holidays-add-date').fill(isoDate)
  await page.getByTestId('market-holidays-add-reason').fill(TEST_REASON)
  await page.getByTestId('market-holidays-add-submit').click()
}

// 登録 → 重複 → 削除 → 警告 → 再有効化 は 1 本の流れなので順に実行する
test.describe.configure({ mode: 'serial' })

test.describe('海外休場日マスタ（実 API 接続）', () => {
  test.skip(
    process.env.E2E_REAL_API !== '1',
    '実 API に当てるテスト。E2E_REAL_API=1 のときだけ実行する',
  )

  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext({
      baseURL: process.env.E2E_BASE_URL || 'http://frontend:5173',
      extraHTTPHeaders: { 'X-User-Code': USER_CODE },
    })
    testDate = await pickUnusedDate(api)
    await api.dispose()
  })

  test.afterAll(async ({ playwright }) => {
    // 試験用の行を有効なまま残さない（論理削除なので行自体は DB に残る）
    const api = await playwright.request.newContext({
      baseURL: process.env.E2E_BASE_URL || 'http://frontend:5173',
      extraHTTPHeaders: { 'X-User-Code': USER_CODE },
    })
    await api.delete(`/api/holidays/${testDate}`)
    await api.dispose()
  })

  test('[MR-01] 実データで一覧が表示される', async ({ page }) => {
    await openList(page)

    const total = await countOf(page)
    // 件数表示と実際の行数が食い違わない（1 ページ目に出るのは表示件数まで）
    await expect(rowsOf(page)).toHaveCount(Math.min(total, PAGE_SIZE))

    // 4 状態のうち「データあり」に落ちている（0 件のときだけ空状態でよい）。
    // ページ送りは件数の表示も兼ねるので、1 ページに収まっていても出る
    if (total > 0) {
      await expect(page.getByTestId('market-holidays-table')).toBeVisible()
      await expect(page.getByTestId('market-holidays-pagination')).toBeVisible()
    } else {
      await expect(page.getByTestId('market-holidays-empty')).toBeVisible()
      await expect(page.getByTestId('market-holidays-pagination')).toHaveCount(0)
    }
    await expect(page.getByTestId('market-holidays-error')).toHaveCount(0)
  })

  test('[MR-02] 休場区分で絞り込むと、その区分の行だけが返る', async ({ page }) => {
    await openList(page)
    const total = await countOf(page)

    await page.getByTestId('market-holidays-holiday-type').selectOption({ label: '短縮取引' })
    await page.getByTestId('market-holidays-search-submit').click()

    await expect(page).toHaveURL(/holiday_type=1/)
    const filtered = await countOf(page)
    expect(filtered).toBeLessThanOrEqual(total)

    if (filtered === 0) {
      await expect(page.getByTestId('market-holidays-empty')).toBeVisible()
      return
    }

    // 表示されている行がすべて短縮取引になっている（サーバ側の絞り込みが効いている）
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(Math.min(filtered, PAGE_SIZE))
    await expect(rows.filter({ hasText: '終日休場' })).toHaveCount(0)
  })

  test('[MR-03] 日付で絞り込むと、その日付の行だけが返る', async ({ page }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total === 0, '実 DB に休場日が 1 件も無いので絞り込みを確かめられない')

    // 期待値は書かず、1 行目に実際に出ている日付をそのまま条件にする
    const date = (await rowsOf(page).first().getByRole('cell').first().innerText()).trim()

    await page.getByTestId('market-holidays-date-from').fill(date)
    await page.getByTestId('market-holidays-date-to').fill(date)
    await page.getByTestId('market-holidays-search-submit').click()

    await expect(page.getByTestId('market-holidays-count')).toHaveText('1 件')
    await expect(rowsOf(page)).toHaveCount(1)
    await expect(rowsOf(page).first()).toContainText(date)
  })

  test('[MR-04] 未登録の日付を追加すると件数が 1 増える', async ({ page }) => {
    await openList(page)
    const before = await countOf(page)
    const isoDate = toIsoDate(testDate)

    await submitAdd(page, isoDate)

    await expect(addDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('market-holidays-notice')).toHaveText(
      `${isoDate} を追加しました。`,
    )
    await expect(page.getByTestId('market-holidays-count')).toHaveText(`${before + 1} 件`)
    // 一覧は休場日の降順なので、遠い将来の試験用データは 1 ページ目に出る
    await expect(rowsOf(page).filter({ hasText: isoDate })).toHaveCount(1)
  })

  test('[MR-05] 同じ日付をもう一度追加すると事前検証で弾かれる', async ({ page }) => {
    await openList(page)
    const before = await countOf(page)

    await submitAdd(page, toIsoDate(testDate))

    const error = page.getByTestId('market-holidays-add-validation-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText(`${testDate}`)
    // 通信・サーバ障害の枠ではない
    await expect(page.getByTestId('market-holidays-add-error')).toHaveCount(0)

    await expect(addDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('market-holidays-count')).toHaveText(`${before} 件`)
  })

  test('[MR-06] 追加した行を削除すると件数が 1 減る', async ({ page }) => {
    await openList(page)
    const before = await countOf(page)
    const isoDate = toIsoDate(testDate)

    await page.getByTestId(`market-holidays-delete-${testDate}`).click()
    await page.getByTestId('market-holidays-delete-submit').click()

    await expect(page.getByRole('dialog', { name: '削除確認' })).toBeHidden()
    await expect(page.getByTestId('market-holidays-notice')).toHaveText(
      `${isoDate} を削除しました。`,
    )
    await expect(page.getByTestId('market-holidays-count')).toHaveText(`${before - 1} 件`)
    await expect(rowsOf(page).filter({ hasText: isoDate })).toHaveCount(0)
  })

  test('[MR-07] 削除した日付を追加し直すと再有効化の警告が出る', async ({ page }) => {
    await openList(page)
    const before = await countOf(page)

    await submitAdd(page, toIsoDate(testDate))

    await expect(page.getByTestId('market-holidays-add-validation-warning')).toBeVisible()
    // 警告は登録できない理由ではない
    await expect(page.getByTestId('market-holidays-add-validation-error')).toHaveCount(0)

    // まだ登録していない。押し直せば進められることがボタンの文言で分かる
    await expect(addDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('market-holidays-add-submit')).toHaveText('続行')
    await expect(page.getByTestId('market-holidays-count')).toHaveText(`${before} 件`)
  })

  test('[MR-08] 警告のあと「続行」を押すと再有効化される', async ({ page }) => {
    await openList(page)
    const before = await countOf(page)
    const isoDate = toIsoDate(testDate)

    await submitAdd(page, isoDate)
    await expect(page.getByTestId('market-holidays-add-validation-warning')).toBeVisible()

    await page.getByTestId('market-holidays-add-submit').click()

    await expect(addDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('market-holidays-notice')).toHaveText(
      `${isoDate} を追加しました。`,
    )
    await expect(page.getByTestId('market-holidays-count')).toHaveText(`${before + 1} 件`)
    await expect(rowsOf(page).filter({ hasText: isoDate })).toHaveCount(1)
  })
})
