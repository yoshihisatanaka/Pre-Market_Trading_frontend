import { expect, test } from '@playwright/test'
import {
  apiContext,
  cleanupMarked,
  fetchAll,
  listHelpers,
  skipUnlessRealApi,
} from './helpers/realApi.js'

/*
 * 手数料優遇マスタを「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/fee-preferences-real-api.md（タイトル先頭の [FPR-xx] が対応 ID）
 *
 * fee-preferences.spec.js（FP）とは目的が違う。FP は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせだけを見るので、
 * 期待値に**データの中身を書かない**（件数・口座番号は実行時に画面か API から読む）。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test fee-preferences.real-api
 *
 * FPR-02 は実 DB に登録と論理削除を行う。ローカルの開発 DB 前提。
 * 手数料優遇は 1 口座 1 レコードで備考欄が無いので、目印は数値の組（掛目とスプレッド）で付け、
 * 開始時と終了時に目印の組を持つ有効な行を削除する。
 */

const PATH = '/masters/fee-preferences'
// 実 API のパス（openapi.json）
const API_PATH = '/api/masters/fee-preferences'
// 一覧の応答の配列キー（openapi.json の FeePreferenceListResponse）
const LIST_KEY = 'fee_preferences'
// 登録に使う口座を選ぶための顧客マスタ（openapi.json の CustomerListResponse）
const CUSTOMERS_API_PATH = '/api/masters/customers'
const CUSTOMERS_LIST_KEY = 'customers'

// src/stores/feePreferences.js の FEE_PREFERENCES_PAGE_SIZE（= DEFAULT_PAGE_SIZE）と同じ値。
// ストアは import.meta を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

/*
 * 試験用の行の目印。備考欄が無いので、実運用で使われそうにない数値の組を入れる。
 * 掛目は % 表記で、精度が仕様に無いので小数 2 桁に留める。スプレッドは画面が小数第 4 位まで出す
 * （src/views/FeePreferenceListView.vue の formatDecimal）。ベイシスは入れない（パターン方式にして、
 * 方式で使われない項目の警告を起こさない）。
 */
const MARK_MULTIPLIER = '99.75'
const MARK_SPREAD = '0.9876'

const { openList, countOf, rowsOf, expectListConsistent } = listHelpers({
  path: PATH,
  testIdPrefix: 'fee-preferences',
})

/** FPR-02 で登録に使う口座番号（文字列）。beforeAll が登録の無い有効な口座から選ぶ */
let accountNumber = ''
/** FPR-02 で登録した行の ID（実 API の採番）。afterAll がこれでも片付ける */
let createdId = 0

/** 数値の目印の一致（API が小数をどう丸めて返しても誤差の範囲で比べる） */
function sameNumber(actual, expected) {
  return typeof actual === 'number' && Math.abs(actual - Number(expected)) < 1e-6
}

function isMarkedRow(row) {
  return sameNumber(row.掛目, MARK_MULTIPLIER) && sameNumber(row.スプレッド, MARK_SPREAD)
}

/**
 * 目印の組を持つ有効な行（と、今回登録した行）を消す。前回が途中で落ちた残骸もここで片付く。
 * 消した行の ID を返す（報告用）
 */
async function cleanupMarkedRows(api) {
  const removed = await cleanupMarked(api, {
    list: () => fetchAll(api, API_PATH, LIST_KEY, { include_deleted: true }),
    /*
     * 今回選んだ口座は登録が一度も無かった口座なので、その口座の有効な行は今回の試験行とみなす
     * （目印の数値がサーバ側で丸められて一致しなくても、ここで拾える）
     */
    isMarked: (row) =>
      row.取消区分 === 0 &&
      (row.ID === createdId ||
        (accountNumber !== '' && String(row.口座番号) === accountNumber) ||
        isMarkedRow(row)),
    deletePathOf: (row) => `${API_PATH}/${row.ID}`,
  })
  return removed.map((row) => row.ID)
}

/**
 * 手数料優遇に一度も登録されたことの無い有効な口座を選ぶ（口座番号の昇順で最初のもの）。
 * 取消済みの行がある口座は除く（登録し直したときの挙動が仕様に無く、素の新規登録を通したいため）
 */
async function pickUnusedAccount(api) {
  const used = new Set(
    (await fetchAll(api, API_PATH, LIST_KEY, { include_deleted: true })).map((row) => row.口座番号),
  )
  const candidates = (await fetchAll(api, CUSTOMERS_API_PATH, CUSTOMERS_LIST_KEY))
    .filter((customer) => (customer.取消区分 ?? 0) === 0 && !used.has(customer.口座番号))
    .map((customer) => customer.口座番号)
    .sort((a, b) => a - b)
  return candidates.length > 0 ? String(candidates[0]) : ''
}

/** 画面が一覧を開いたときに受け取る GET /api/masters/fee-preferences の応答を待つ */
function waitForListResponse(page) {
  return page.waitForResponse(
    (res) =>
      res.request().method() === 'GET' && new URL(res.url()).pathname === API_PATH && res.ok(),
  )
}

function addDialogOf(page) {
  return page.getByRole('dialog', { name: '手数料優遇 新規追加' })
}

test.describe('手数料優遇マスタ（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test.beforeAll(async ({ playwright }) => {
    // 顧客の全件を引くので既定の 30 秒では足りない（2026-10-07 実測で超過）
    test.setTimeout(180_000)
    const api = await apiContext(playwright)
    const removed = await cleanupMarkedRows(api)
    if (removed.length > 0) console.log(`[beforeAll] 前回の残骸を削除した: ${removed.join(', ')}`)

    accountNumber = await pickUnusedAccount(api)
    console.log(`[beforeAll] FPR-02 で使う口座番号: ${accountNumber || '（候補なし）'}`)
    await api.dispose()
  })

  test.afterAll(async ({ playwright }) => {
    // 試験用の行を有効なまま残さない（論理削除なので行自体は DB に残る）
    test.setTimeout(180_000)
    const api = await apiContext(playwright)
    const removed = await cleanupMarkedRows(api)
    if (removed.length > 0) console.log(`[afterAll] 試験用の行を削除した: ${removed.join(', ')}`)
    await api.dispose()
  })

  test('[FPR-01] 実データで一覧が表示され、応答の件数・先頭行が画面と一致する', async ({ page }) => {
    const listResponse = waitForListResponse(page)
    await openList(page)
    const body = await (await listResponse).json()

    const total = await expectListConsistent(page, { pageSize: PAGE_SIZE })

    // 画面が受け取った応答そのものと突き合わせる（API を別のユーザで引くと部店の限定が変わりうるため）
    expect(Array.isArray(body[LIST_KEY]), `応答に配列 ${LIST_KEY} が無い`).toBe(true)
    expect(body.total).toBe(total)

    if (total > 0) {
      // 列は 部店 / 口座番号 / 顧客名 / …（src/views/FeePreferenceListView.vue の columns）
      const firstAccount = String(body[LIST_KEY][0].口座番号)
      await expect(rowsOf(page).first().getByRole('cell').nth(1)).toHaveText(firstAccount)
    }
  })

  test('[FPR-02] 登録の無い口座に新規追加が受理され、件数が 1 増える', async ({
    page,
    playwright,
  }) => {
    expect(
      accountNumber,
      '手数料優遇の登録が一度も無い有効な口座が実 DB に無い（顧客を足すか、取消済みの試験行を整理する）',
    ).not.toBe('')

    await openList(page)
    const before = await countOf(page)

    await page.getByTestId('fee-preferences-add').click()
    await expect(addDialogOf(page)).toBeVisible()
    await page.getByTestId('fee-preferences-add-account-number').fill(accountNumber)
    await page.getByTestId('fee-preferences-add-fee-multiplier').fill(MARK_MULTIPLIER)
    await page.getByTestId('fee-preferences-add-fx-spread').fill(MARK_SPREAD)
    await page.getByTestId('fee-preferences-add-submit').click()

    /*
     * 事前検証は warnings を返しうる（デフォルトパターンがマスタ未登録、など）。出たら押し直して続行する。
     * 文言はサーバが決めるので固定しない。不合格（validation-error）や通信エラーなら下の期待で落ちる
     */
    const warning = page.getByTestId('fee-preferences-add-validation-warning')
    const notice = page.getByTestId('fee-preferences-notice')
    await expect(
      warning.or(notice).or(page.getByTestId('fee-preferences-add-validation-error')),
    ).toBeVisible()
    if (await warning.isVisible()) {
      console.log(`[FPR-02] 事前検証の警告: ${await warning.innerText()}`)
      await page.getByTestId('fee-preferences-add-submit').click()
    }

    await expect(page.getByTestId('fee-preferences-add-validation-error')).toHaveCount(0)
    await expect(addDialogOf(page)).toBeHidden()
    await expect(notice).toContainText(accountNumber)
    await expect(notice).toContainText('の手数料優遇を追加しました。')
    await expect(page.getByTestId('fee-preferences-count')).toHaveText(`${before + 1} 件`)

    // 並びは口座番号の昇順で 1 ページ目に出るとは限らないので、その口座番号で絞って確かめる
    await page.getByTestId('fee-preferences-account-number').fill(accountNumber)
    await page.getByTestId('fee-preferences-search-submit').click()
    await expect(page).toHaveURL(new RegExp(`account_no=${accountNumber}`))
    await expect(page.getByTestId('fee-preferences-count')).toHaveText('1 件')
    await expect(rowsOf(page)).toHaveCount(1)
    await expect(rowsOf(page).first().getByRole('cell').nth(1)).toHaveText(accountNumber)

    // API を直接引いても有効な行として存在し、入れた値で保存されている
    const api = await apiContext(playwright)
    const created = (await fetchAll(api, API_PATH, LIST_KEY)).find(
      (row) => String(row.口座番号) === accountNumber,
    )
    await api.dispose()
    expect(created, '登録した行が実 API の一覧に無い').toBeTruthy()
    createdId = created.ID
    expect(created.取消区分 ?? 0).toBe(0)
    expect(sameNumber(created.掛目, MARK_MULTIPLIER), `掛目が ${created.掛目}`).toBe(true)
    expect(sameNumber(created.スプレッド, MARK_SPREAD), `スプレッドが ${created.スプレッド}`).toBe(
      true,
    )
    await expect(page.getByTestId(`fee-preferences-delete-${createdId}`)).toHaveCount(1)
  })
})
