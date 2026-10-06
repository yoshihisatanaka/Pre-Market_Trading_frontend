import { expect, test } from '@playwright/test'

/*
 * 受注不可日マスタを「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/blackout-dates-real-api.md（タイトル先頭の [BDR-xx] が対応 ID）
 *
 * blackout-dates.spec.js（BD）とは目的が違う。BD は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせだけを見るので、
 * 期待値に**データの中身を書かない**（件数・日付は実行時に画面から読む）。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test blackout-dates.real-api
 *
 * BDR-04 以降は実 DB に登録・更新・削除を行う。ローカルの開発 DB 前提。
 */

const PATH = '/masters/blackout-dates'

// src/stores/blackoutDates.js の BLACKOUT_DATES_PAGE_SIZE と同じ値（実 API 側の 1 ページ 50 件固定）。
// ストアは import.meta を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

// 試験用の行を置く年。実運用のデータと混ざらないよう遠い将来に寄せる
const RESERVED_YEAR = 2035
const TEST_REASON = '実 API 接続確認'
// BDR-06 で入れ直す理由。元の理由と重ならない文言にする
const EDITED_REASON = '実 API 接続確認（変更後）'
// 誰が触ったかを実 DB に残す（実 API はこのヘッダが無くても一覧は読めるが、更新系は弾かれる）
const USER_CODE = 'e2e'

/** BDR-04〜09 が使う日付。beforeAll が「まだ 1 度も使われていない日」を選ぶ */
let testDate = 0
/** BDR-07 が日付の変更先に使う予備の日。同じく未使用日から選ぶ */
let spareDate = 0
/** 試験用の行がいまある日付。BDR-07 が spareDate へ移し、BDR-08 / 09 はそれを追う */
let rowDate = 0

const toIsoDate = (blackoutDate) => {
  const digits = String(blackoutDate)
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

function apiContext(playwright) {
  return playwright.request.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://frontend:5173',
    extraHTTPHeaders: { 'X-User-Code': USER_CODE },
  })
}

/** 取り消し済みも含めて、指定年に存在する受注不可日を集める */
async function usedDatesIn(api, year) {
  const used = new Set()
  let offset = 0

  for (;;) {
    const res = await api.get('/api/masters/blackout-dates', {
      params: {
        start_date: year * 10000 + 101,
        end_date: year * 10000 + 1231,
        include_deleted: true,
        // 実 API の一覧は 1 ページ 50 件固定（limit というクエリを持たない）
        offset,
      },
    })
    expect(res.ok(), '実 API から一覧を取得できない。api コンテナが動いているか確認する').toBe(true)

    const { total, blackout_dates: items } = await res.json()
    for (const item of items) used.add(item.受注不可日)
    offset += items.length
    if (items.length === 0 || offset >= total) return used
  }
}

/**
 * 受注不可日（YYYYMMDD）から、その行の BlackoutDateItem を引く。
 *
 * 主キーは `ID` で、受注不可日は一意制約を持つ業務上の日付。削除のパスには `ID` を載せるので、
 * 日付しか手元に無い後始末では一覧を引いて `ID` に変換する。無ければ null。
 */
async function findBlackoutDateByDate(api, blackoutDate) {
  const res = await api.get('/api/masters/blackout-dates', {
    params: {
      start_date: blackoutDate,
      end_date: blackoutDate,
      include_deleted: true,
      // 実 API の一覧は limit というクエリを持たない（海外休場日と違う点）
      offset: 0,
    },
  })
  if (!res.ok()) return null

  const { blackout_dates: items } = await res.json()
  return items.find((item) => item.受注不可日 === blackoutDate) ?? null
}

/*
 * 1 度でも登録した日付は論理削除で残り、次に登録すると実 API が黙って再有効化する。
 * BDR-04 は素の新規登録を見たいので、まだ一度も使われていない日付を選ぶ。
 */
async function pickUnusedDates(api, count) {
  const used = await usedDatesIn(api, RESERVED_YEAR)
  const picked = []

  for (let day = 0; day < 366; day += 1) {
    const date = new Date(Date.UTC(RESERVED_YEAR, 0, 1 + day))
    if (date.getUTCFullYear() !== RESERVED_YEAR) break

    const candidate = Number(
      `${RESERVED_YEAR}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
        date.getUTCDate(),
      ).padStart(2, '0')}`,
    )
    if (!used.has(candidate)) picked.push(candidate)
    if (picked.length === count) return picked
  }

  throw new Error(`${RESERVED_YEAR} 年に空きが足りない。試験用の行を DB から整理すること`)
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
  await expect(page.getByTestId('blackout-dates-loading')).toHaveCount(0)
}

/** 一覧を開いて、実 API に当たっていることまで確認する */
async function openList(page, query = '') {
  await page.goto(`${PATH}${query}`)
  await expect(page.getByTestId('blackout-dates-count')).toBeVisible()
  await settleList(page)
  await assertRealApi(page)
}

/** 「N 件」の表示から件数を読む */
async function countOf(page) {
  await settleList(page)
  const text = await page.getByTestId('blackout-dates-count').textContent()
  return Number(text.replace(/[^0-9]/g, ''))
}

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('blackout-dates-table').getByTestId('data-table-row')
}

/** 各行の日付セル（表の 1 列目。列順は BD-08 で固定してある） */
function dateCellsOf(page) {
  return rowsOf(page).locator('td:first-child')
}

function addDialogOf(page) {
  return page.getByRole('dialog', { name: '受注不可日 新規追加' })
}

function editDialogOf(page) {
  return page.getByRole('dialog', { name: '受注不可日 編集' })
}

/** 追加モーダルを開いて入力し、送信する */
async function submitAdd(page, isoDate, reason = TEST_REASON) {
  await page.getByTestId('blackout-dates-add').click()
  await expect(addDialogOf(page)).toBeVisible()
  await page.getByTestId('blackout-dates-add-date').fill(isoDate)
  await page.getByTestId('blackout-dates-add-reason').fill(reason)
  await page.getByTestId('blackout-dates-add-submit').click()
}

/** 行の操作ボタン。行を日付で絞ってから引く（testid に入る id は実行時にしか判らない） */
function rowButtonOf(page, isoDate, name) {
  return rowsOf(page).filter({ hasText: isoDate }).getByRole('button', { name })
}

/*
 * 行の指定は id（実 API の `ID`）。値は実行時にしか判らないので日付で行を絞って引くが、
 * testid が数字で終わっていることだけは確かめる。ここが `blackout-dates-edit-`（id が空文字）に
 * なるのは実 API が `ID` を返していない徴候で、そのまま進めても対象を特定できずに落ちるため、
 * 原因の判る形で先に止める。
 */
async function expectIdTestId(button, action) {
  await expect(button).toHaveAttribute('data-testid', new RegExp(`^blackout-dates-${action}-\\d+$`))
}

/** 対象の日付の行の編集モーダルを開いて、日付と理由を入れ直して送信する */
async function submitEdit(page, targetIsoDate, { isoDate, reason }) {
  const editButton = rowButtonOf(page, targetIsoDate, '編集')
  await expectIdTestId(editButton, 'edit')

  await editButton.click()
  await expect(editDialogOf(page)).toBeVisible()
  if (isoDate) await page.getByTestId('blackout-dates-edit-date').fill(isoDate)
  if (reason) await page.getByTestId('blackout-dates-edit-reason').fill(reason)
  await page.getByTestId('blackout-dates-edit-submit').click()
}

// 登録 → 重複 → 更新 → 削除 → 再有効化 は 1 本の流れなので順に実行する
test.describe.configure({ mode: 'serial' })

test.describe('受注不可日マスタ（実 API 接続）', () => {
  test.skip(
    process.env.E2E_REAL_API !== '1',
    '実 API に当てるテスト。E2E_REAL_API=1 のときだけ実行する',
  )

  test.beforeAll(async ({ playwright }) => {
    const api = await apiContext(playwright)
    ;[testDate, spareDate] = await pickUnusedDates(api, 2)
    rowDate = testDate
    await api.dispose()
  })

  test.afterAll(async ({ playwright }) => {
    // 試験用の行を有効なまま残さない（論理削除なので行自体は DB に残る）
    // 削除のパスキーは ID。日付では引けないので一覧から ID を取り直す。
    // BDR-07 が日付を移すので、testDate と spareDate のどちらに行が残っているかは流れ次第
    const api = await apiContext(playwright)
    for (const date of [testDate, spareDate]) {
      const item = await findBlackoutDateByDate(api, date)
      if (item && item.取消区分 === 0) {
        await api.delete(`/api/masters/blackout-dates/${item.ID}`)
      }
    }
    await api.dispose()
  })

  test('[BDR-01] 実データで一覧が表示される', async ({ page }) => {
    await openList(page)

    const total = await countOf(page)
    // 件数表示と実際の行数が食い違わない（1 ページ目に出るのは表示件数まで）
    await expect(rowsOf(page)).toHaveCount(Math.min(total, PAGE_SIZE))

    // 4 状態のうち「データあり」に落ちている（0 件のときだけ空状態でよい）。
    // ページ送りは件数の表示も兼ねるので、1 ページに収まっていても出る
    if (total > 0) {
      await expect(page.getByTestId('blackout-dates-table')).toBeVisible()
      await expect(page.getByTestId('blackout-dates-pagination')).toBeVisible()
    } else {
      await expect(page.getByTestId('blackout-dates-empty')).toBeVisible()
      await expect(page.getByTestId('blackout-dates-pagination')).toHaveCount(0)
    }
    await expect(page.getByTestId('blackout-dates-error')).toHaveCount(0)
  })

  test('[BDR-02] 日付で検索すると、その日付の行だけが返る', async ({ page }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total === 0, '実 DB に受注不可日が 1 件も無いので絞り込みを確かめられない')

    // 期待値は書かず、1 行目に実際に出ている日付をそのまま条件にする
    const date = (await dateCellsOf(page).first().innerText()).trim()

    await page.getByTestId('blackout-dates-date').fill(date)
    await page.getByTestId('blackout-dates-search-submit').click()

    await expect(page).toHaveURL(/[?&]date=/)
    await expect(page.getByTestId('blackout-dates-count')).toHaveText('1 件')
    await expect(rowsOf(page)).toHaveCount(1)
    await expect(rowsOf(page).first()).toContainText(date)
  })

  test('[BDR-03] 未登録の日付で検索すると 0 件になる', async ({ page }) => {
    await openList(page)

    // beforeAll が選んだ未使用日。BDR-04 で登録する前なので、まだ一覧に無い。
    // 日付の条件が実 API に届いていなければ全件が返り、ここで落ちる
    const isoDate = toIsoDate(testDate)

    await page.getByTestId('blackout-dates-date').fill(isoDate)
    await page.getByTestId('blackout-dates-search-submit').click()

    await expect(page).toHaveURL(/[?&]date=/)
    await expect(page.getByTestId('blackout-dates-count')).toHaveText('0 件')
    await expect(page.getByTestId('blackout-dates-empty')).toBeVisible()
  })

  test('[BDR-04] 未登録の日付を追加すると件数が 1 増える', async ({ page }) => {
    await openList(page)
    const before = await countOf(page)
    const isoDate = toIsoDate(testDate)

    await submitAdd(page, isoDate)

    await expect(addDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('blackout-dates-notice')).toHaveText(`${isoDate} を追加しました。`)
    await expect(page.getByTestId('blackout-dates-count')).toHaveText(`${before + 1} 件`)
    // 一覧は受注不可日の降順なので、遠い将来の試験用データは 1 ページ目に出る
    await expect(rowsOf(page).filter({ hasText: isoDate })).toHaveCount(1)
  })

  test('[BDR-05] 同じ日付をもう一度追加すると事前検証で弾かれる', async ({ page }) => {
    await openList(page)
    const before = await countOf(page)

    await submitAdd(page, toIsoDate(testDate))

    const error = page.getByTestId('blackout-dates-add-validation-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText(`${testDate}`)
    // 通信・サーバ障害の枠ではない
    await expect(page.getByTestId('blackout-dates-add-error')).toHaveCount(0)

    await expect(addDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('blackout-dates-count')).toHaveText(`${before} 件`)
  })

  test('[BDR-06] 理由だけを変更すると、その行の理由が変わる', async ({ page }) => {
    await openList(page)
    const before = await countOf(page)
    const isoDate = toIsoDate(testDate)

    // 日付は変えない。実 API 側は変更検証（is_update）に切り替わり、自分自身を重複としない
    await submitEdit(page, isoDate, { reason: EDITED_REASON })

    await expect(editDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('blackout-dates-notice')).toHaveText(`${isoDate} を更新しました。`)
    await expect(page.getByTestId('blackout-dates-count')).toHaveText(`${before} 件`)
    await expect(rowsOf(page).filter({ hasText: isoDate })).toContainText(EDITED_REASON)
  })

  /*
   * 実 API の事前検証は blackout_date_id を付けると、本文の 受注不可日 が ID の指す日付と
   * 違うだけで 400 を返す（PUT 自体は日付の変更を受け付ける）。バックエンド対応待ち
   * （docs/api/requests.md の依頼 #18、docs/e2e/blackout-dates-real-api.md に経緯）。
   * 対応したら test.fixme を test に戻し、文書の状態を実装済にする。
   * 戻るまでは rowDate が testDate のままなので、BDR-08 / 09 は testDate の行を追う。
   */
  test.fixme('[BDR-07] 日付を変更すると、その行が新しい日付に移る', async ({ page }) => {
    await openList(page)
    const before = await countOf(page)
    const fromIso = toIsoDate(testDate)
    const toIso = toIsoDate(spareDate)

    await submitEdit(page, fromIso, { isoDate: toIso })

    await expect(editDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('blackout-dates-notice')).toHaveText(`${toIso} を更新しました。`)
    await expect(page.getByTestId('blackout-dates-count')).toHaveText(`${before} 件`)
    await expect(rowsOf(page).filter({ hasText: toIso })).toHaveCount(1)
    await expect(rowsOf(page).filter({ hasText: fromIso })).toHaveCount(0)

    // 以降の削除・再有効化は、移した先の日付で行を追う
    rowDate = spareDate
  })

  test('[BDR-08] 追加した行を削除すると件数が 1 減る', async ({ page }) => {
    await openList(page)
    const before = await countOf(page)
    const isoDate = toIsoDate(rowDate)

    const deleteButton = rowButtonOf(page, isoDate, '削除')
    await expectIdTestId(deleteButton, 'delete')

    await deleteButton.click()
    await page.getByTestId('blackout-dates-delete-submit').click()

    await expect(page.getByRole('dialog', { name: '削除確認' })).toBeHidden()
    await expect(page.getByTestId('blackout-dates-notice')).toHaveText(`${isoDate} を削除しました。`)
    await expect(page.getByTestId('blackout-dates-count')).toHaveText(`${before - 1} 件`)
    await expect(rowsOf(page).filter({ hasText: isoDate })).toHaveCount(0)
  })

  test('[BDR-09] 削除した日付を追加し直すと警告なしで再有効化される', async ({ page }) => {
    await openList(page)
    const before = await countOf(page)
    const isoDate = toIsoDate(rowDate)

    await submitAdd(page, isoDate)

    // 海外休場日（MR-07 / MR-08）と違い、実 API は取消済みでも警告を出さずそのまま通す
    await expect(addDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('blackout-dates-notice')).toHaveText(`${isoDate} を追加しました。`)
    await expect(page.getByTestId('blackout-dates-count')).toHaveText(`${before + 1} 件`)
    await expect(rowsOf(page).filter({ hasText: isoDate })).toHaveCount(1)
  })
})
