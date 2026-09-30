import { expect, test } from '@playwright/test'
import { suspensionHistories, suspensionTargets } from '../src/mocks/fixtures/incidents'
import { formatDateTime } from '../src/utils/format'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/incidents.md（タイトル先頭の [IN-nn] が対応 ID）
// 全体（ALL）または注文ルート別の発注停止・再開を、確認ダイアログから実ブラウザで通す。
// 既定ハンドラは状態を持つ（停止・再開で行と履歴が書き換わる）。page.goto() で初期状態に戻る。
// 全体停止中 / 一部停止中 / 履歴 0 件 / 400 / 409 / 500 は mockApi() で固定の応答に差し替える。
// 「現在の運用状態」の文言の組み立てや props の境界は単体テスト側
// （docs/unit/views-incident-management-view.md ほか）が担保する。

const PATH = '/operations/incidents'

const STATUS_PATH = '*/api/operations/order-suspensions'
const HISTORY_PATH = '*/api/operations/order-suspensions/history'
const SUSPEND_PATH = '*/api/operations/order-suspensions/suspend'

const allTarget = suspensionTargets.find((row) => row.停止対象 === 'ALL')
const ibTarget = suspensionTargets.find((row) => row.停止対象 === '1')
const vwapTarget = suspensionTargets.find((row) => row.停止対象 === '2')
const routeTargets = suspensionTargets.filter((row) => row.停止対象 !== 'ALL')

const NEW_REASON = 'IB回線障害'

/** SuspensionStatusResponse を、停止中にする対象コードの一覧から組み立てる（サーバ役の合成と同じ） */
function statusBody(suspendedCodes) {
  const codes = new Set(suspendedCodes)
  const targets = suspensionTargets.map((row) =>
    codes.has(row.停止対象)
      ? {
          ...row,
          発注停止フラグ: 1,
          発注停止中: true,
          停止理由: `${row.停止対象名}の障害（テスト）`,
          停止日時: '2026-09-20T10:00:00',
          停止者: '006',
        }
      : { ...row },
  )
  return {
    発注停止中: codes.size > 0,
    全体停止中: codes.has('ALL'),
    停止中の対象: targets.filter((row) => row.発注停止中).map((row) => row.停止対象),
    targets,
  }
}

function historyBody(histories) {
  return { total: histories.length, limit: 50, offset: 0, histories }
}

/** 停止対象の表の行。data-table-row は全画面共通の名前なのでこの表にスコープを切る */
function targetRowsOf(page) {
  return page.getByTestId('incidents-targets').getByTestId('data-table-row')
}

function targetRowOf(page, target) {
  return targetRowsOf(page).filter({ has: page.getByTestId(`incidents-target-${target}-action`) })
}

function historyRowsOf(page) {
  return page.getByTestId('incidents-history').getByTestId('data-table-row')
}

function dialogOf(page) {
  return page.getByRole('dialog')
}

/** 行ごとの発注停止トグル（role="switch"・ON = 停止中） */
function switchOf(page, target) {
  return page.getByTestId(`incidents-target-${target}-action`)
}

/** IB を停止する（IN-15 の操作）。成功の通知が出るまで待つ */
async function suspendIb(page) {
  await page.getByTestId('incidents-target-1-action').click()
  await page.getByTestId('incidents-control-reason').fill(NEW_REASON)
  await page.getByTestId('incidents-control-submit').click()
  await expect(page.getByTestId('incidents-notice')).toHaveText(
    `${ibTarget.停止対象名}の発注を停止しました。`,
  )
}

test.describe('障害管理', () => {
  test('[IN-01] サイドメニューから開くと見出しと現在ページ表示が切り替わる', async ({ page }) => {
    await page.goto('/')

    const nav = page.getByRole('navigation', { name: 'メインメニュー' })
    await nav.getByRole('link', { name: '障害管理', exact: true }).click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByRole('heading', { name: '障害管理', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: '障害管理', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)
  })

  test('[IN-02] 直接開くと説明文と「通常運用」が表示される', async ({ page }) => {
    await page.goto(PATH)

    await expect(
      page.getByText('障害発生時に、全体または注文ルート別に発注を停止・再開します。'),
    ).toBeVisible()
    await expect(page.getByText('現在の運用状態')).toBeVisible()
    await expect(page.getByTestId('incidents-state')).toHaveText('通常運用')
  })

  test('[IN-04] 全体のトグルで確認ダイアログが開く', async ({ page }) => {
    await page.goto(PATH)

    await page.getByRole('switch', { name: `${allTarget.停止対象名}の発注停止` }).click()

    const dialog = page.getByRole('dialog', {
      name: `${allTarget.停止対象名}の発注を停止しますか？`,
    })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(`「${allTarget.停止対象名}」の発注を停止します。`)
    await expect(page.getByTestId('incidents-control-reason')).toBeVisible()
    await expect(page.getByTestId('incidents-control-reason')).toHaveValue('')
  })

  test('[IN-06] キャンセルするとダイアログが閉じ、状態も履歴も変わらない', async ({ page }) => {
    await page.goto(PATH)
    await page.getByTestId('incidents-target-ALL-action').click()
    await expect(dialogOf(page)).toBeVisible()

    await page.getByTestId('incidents-control-cancel').click()

    await expect(dialogOf(page)).toHaveCount(0)
    await expect(page.getByTestId('incidents-state')).toHaveText('通常運用')
    await expect(historyRowsOf(page)).toHaveCount(suspensionHistories.length)
  })

  test('[IN-07] IB のトグルでは対象が IB で、全ルート停止の警告は出ない', async ({ page }) => {
    await page.goto(PATH)

    await switchOf(page, '1').click()

    const dialog = page.getByRole('dialog', {
      name: `${ibTarget.停止対象名}の発注を停止しますか？`,
    })
    await expect(dialog).toContainText(`「${ibTarget.停止対象名}」の発注を停止します。`)
    await expect(page.getByTestId('incidents-control-reason')).toBeVisible()
    await expect(page.getByTestId('incidents-control-warning')).toHaveCount(0)
  })

  test('[IN-08] 操作履歴が新しい順に表示される', async ({ page }) => {
    await page.goto(PATH)

    const history = page.getByTestId('incidents-history')
    await expect(history.getByRole('columnheader')).toHaveText([
      '変更日時',
      '制御内容',
      '停止理由',
      '更新者',
    ])

    const rows = historyRowsOf(page)
    await expect(rows).toHaveCount(suspensionHistories.length)

    // フィクスチャは実 API と同じ最新順。先頭が最も新しい
    const latest = suspensionHistories[0]
    const first = rows.first()
    await expect(first).toContainText(formatDateTime(latest.操作日時))
    await expect(first.getByRole('cell').nth(1)).toHaveText(
      `${latest.停止対象名}：${latest.操作区分名}`,
    )
    await expect(first).toContainText(latest.操作者)
  })

  test('[IN-09] 操作履歴が 0 件でも停止対象の表は表示される', async ({ page }) => {
    await mockApi(page, [{ path: HISTORY_PATH, body: historyBody([]) }])
    await page.goto(PATH)

    await expect(page.getByTestId('incidents-history-empty')).toHaveText(
      '障害対応履歴はありません。',
    )
    await expect(page.getByTestId('incidents-history')).toHaveCount(0)
    await expect(targetRowsOf(page)).toHaveCount(suspensionTargets.length)
  })

  test('[IN-10] 停止状態の取得が 500 だとエラーと再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [
      { path: STATUS_PATH, status: 500, body: { detail: 'サーバーでエラーが発生しました。' } },
    ])
    await page.goto(PATH)

    const error = page.getByTestId('incidents-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('サーバーでエラーが発生しました。')
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('incidents-targets')).toHaveCount(0)
    await expect(page.getByTestId('incidents-history')).toHaveCount(0)
  })

  test('[IN-11] API が回復してから「再試行」を押すと表示が戻る', async ({ page }) => {
    await mockApi(page, [
      { path: STATUS_PATH, status: 500, body: { detail: 'サーバーでエラーが発生しました。' } },
    ])
    await page.goto(PATH)
    const error = page.getByTestId('incidents-error')
    await expect(error).toBeVisible()

    /*
     * 回復の再現。mockApi() の差し替えは起動時に worker.use() へ積まれ、ページが生きている間は残る。
     * ページを読み込み直すと「再試行」の導線を通らないので、dev サーバが配る MSW の worker を
     * 同じ URL で import し（モジュールは URL 単位で 1 つ）、差し替えだけを外して既定ハンドラへ戻す。
     */
    await page.evaluate(async () => {
      const { worker } = await import('/src/mocks/browser.js')
      worker.resetHandlers()
    })

    await error.getByRole('button', { name: '再試行' }).click()

    await expect(page.getByTestId('incidents-state')).toHaveText('通常運用')
    await expect(targetRowsOf(page)).toHaveCount(suspensionTargets.length)
    await expect(error).toHaveCount(0)
  })

  test('[IN-12] 全体停止中は「全体停止中」が通常運用と異なる見た目で出る', async ({ page }) => {
    await page.goto(PATH)
    const state = page.getByTestId('incidents-state')
    await expect(state).toHaveText('通常運用')
    const normalColor = await state.evaluate((el) => getComputedStyle(el).color)

    await mockApi(page, [{ path: STATUS_PATH, body: statusBody(['ALL']) }])
    await page.goto(PATH)

    await expect(state).toHaveText('全体停止中')
    const dangerColor = await state.evaluate((el) => getComputedStyle(el).color)
    expect(dangerColor).not.toBe(normalColor)
  })

  test('[IN-13] 停止対象の 4 行が並び、過去の停止理由が残っている', async ({ page }) => {
    await page.goto(PATH)

    const rows = targetRowsOf(page)
    await expect(rows).toHaveCount(suspensionTargets.length)

    for (const [index, target] of suspensionTargets.entries()) {
      const row = rows.nth(index)
      await expect(row.getByRole('cell').first()).toHaveText(target.停止対象名)
      await expect(row).toContainText('通常')
      await expect(row).not.toContainText('停止中')
    }

    await expect(targetRowOf(page, 'ALL')).toContainText(allTarget.停止理由)
    await expect(targetRowOf(page, '1')).toContainText(ibTarget.停止理由)
  })

  test('[IN-14] IB と VWAP だけ停止中なら「一部停止中（IB, VWAP）」が出る', async ({ page }) => {
    await mockApi(page, [
      {
        path: STATUS_PATH,
        body: statusBody([ibTarget.停止対象, vwapTarget.停止対象]),
      },
    ])
    await page.goto(PATH)

    await expect(page.getByTestId('incidents-state')).toHaveText(
      `一部停止中（${ibTarget.停止対象名}, ${vwapTarget.停止対象名}）`,
    )
    await expect(targetRowOf(page, '1')).toContainText('停止中')
    await expect(targetRowOf(page, '2')).toContainText('停止中')
    await expect(targetRowOf(page, '0')).not.toContainText('停止中')
  })

  test('[IN-15] IB を停止すると通知が出て、行と運用状態が停止に変わる', async ({ page }) => {
    await page.goto(PATH)

    await suspendIb(page)

    await expect(dialogOf(page)).toHaveCount(0)
    await expect(switchOf(page, '1')).toHaveAttribute('aria-checked', 'true')
    const ibRow = targetRowOf(page, '1')
    await expect(ibRow).toContainText('停止中')
    await expect(ibRow).toContainText(NEW_REASON)
    await expect(ibRow).not.toContainText(ibTarget.停止理由)
    await expect(page.getByTestId('incidents-state')).toHaveText(
      `一部停止中（${ibTarget.停止対象名}）`,
    )
  })

  test('[IN-16] 停止すると操作履歴の先頭に積まれる', async ({ page }) => {
    await page.goto(PATH)
    await suspendIb(page)

    const rows = historyRowsOf(page)
    await expect(rows).toHaveCount(suspensionHistories.length + 1)
    const first = rows.first()
    await expect(first.getByRole('cell').nth(1)).toHaveText(`${ibTarget.停止対象名}：発注停止`)
    await expect(first).toContainText(NEW_REASON)
  })

  test('[IN-17] 停止理由が空のままだと入力エラーでダイアログが残る', async ({ page }) => {
    await page.goto(PATH)
    await page.getByTestId('incidents-target-ALL-action').click()

    await page.getByTestId('incidents-control-submit').click()

    await expect(
      page.getByTestId('incidents-control-reason-field').getByRole('alert'),
    ).toHaveText('停止理由を入力してください。')
    await expect(dialogOf(page)).toBeVisible()
    await expect(page.getByTestId('incidents-state')).toHaveText('通常運用')
  })

  test('[IN-18] 停止 API が 400 を返すとダイアログにサーバの文言が出て入力は残る', async ({
    page,
  }) => {
    const detail = `${ibTarget.停止対象名}はすでに停止中です。`
    await mockApi(page, [{ method: 'post', path: SUSPEND_PATH, status: 400, body: { detail } }])
    await page.goto(PATH)

    await page.getByTestId('incidents-target-1-action').click()
    await page.getByTestId('incidents-control-reason').fill(NEW_REASON)
    await page.getByTestId('incidents-control-submit').click()

    await expect(page.getByTestId('incidents-control-error')).toHaveText(detail)
    await expect(dialogOf(page)).toBeVisible()
    await expect(page.getByTestId('incidents-control-reason')).toHaveValue(NEW_REASON)
    await expect(page.getByTestId('incidents-notice')).toHaveCount(0)
  })

  test('[IN-19] 停止 API が 409 を返すとダイアログに競合の文言が出る', async ({ page }) => {
    const detail =
      '他のユーザーによって発注停止状態が更新されました。最新情報を再取得してください。'
    await mockApi(page, [{ method: 'post', path: SUSPEND_PATH, status: 409, body: { detail } }])
    await page.goto(PATH)

    await page.getByTestId('incidents-target-1-action').click()
    await page.getByTestId('incidents-control-reason').fill(NEW_REASON)
    await page.getByTestId('incidents-control-submit').click()

    await expect(page.getByTestId('incidents-control-error')).toHaveText(detail)
    await expect(dialogOf(page)).toBeVisible()
  })

  test('[IN-20] 全体を停止するダイアログには全ルート停止の警告が出る', async ({ page }) => {
    await page.goto(PATH)
    await page.getByTestId('incidents-target-ALL-action').click()

    await expect(page.getByTestId('incidents-control-warning')).toHaveText(
      '全ルートの発注が止まり、注文の新規受付・取消も停止します。',
    )
  })

  test('[IN-21] 停止中の IB を再開すると通常に戻り、停止理由は残る', async ({ page }) => {
    await page.goto(PATH)
    await suspendIb(page)

    await switchOf(page, '1').click()
    await expect(
      page.getByRole('dialog', { name: `${ibTarget.停止対象名}の発注を再開しますか？` }),
    ).toBeVisible()
    await page.getByTestId('incidents-control-submit').click()

    await expect(dialogOf(page)).toHaveCount(0)
    await expect(page.getByTestId('incidents-notice')).toHaveText(
      `${ibTarget.停止対象名}の発注を再開しました。`,
    )
    await expect(switchOf(page, '1')).toHaveAttribute('aria-checked', 'false')
    const ibRow = targetRowOf(page, '1')
    await expect(ibRow).toContainText('通常')
    await expect(ibRow).not.toContainText('停止中')
    // 新しい理由は既定の理由の部分文字列なので、既定の理由が消えていることも見る
    await expect(ibRow).toContainText(NEW_REASON)
    await expect(ibRow).not.toContainText(ibTarget.停止理由)
    await expect(page.getByTestId('incidents-state')).toHaveText('通常運用')
    await expect(historyRowsOf(page)).toHaveCount(suspensionHistories.length + 2)
  })

  test('[IN-22] 再開の確認では停止理由が読み取り専用で出る', async ({ page }) => {
    await page.goto(PATH)
    await suspendIb(page)

    await switchOf(page, '1').click()

    const dialog = page.getByRole('dialog', {
      name: `${ibTarget.停止対象名}の発注を再開しますか？`,
    })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('復旧確認が完了していることを確認してください。')
    await expect(page.getByTestId('incidents-control-summary')).toContainText(NEW_REASON)
    await expect(page.getByTestId('incidents-control-reason')).toHaveCount(0)
  })

  test('[IN-23] 全体停止中はルート行のトグルが押せず、注意書きが出る', async ({ page }) => {
    await mockApi(page, [{ path: STATUS_PATH, body: statusBody(['ALL']) }])
    await page.goto(PATH)

    const allSwitch = switchOf(page, 'ALL')
    await expect(allSwitch).toHaveAttribute('aria-checked', 'true')
    await expect(allSwitch).toBeEnabled()
    for (const target of routeTargets) {
      await expect(switchOf(page, target.停止対象)).toBeDisabled()
    }
    await expect(page.getByTestId('incidents-locked')).toContainText(
      '全体停止中はルート別に停止・再開できません。',
    )
  })

  test('[IN-24] トグルを押しただけでは切り替わらず、キャンセルで元のまま', async ({ page }) => {
    await page.goto(PATH)
    const ibSwitch = switchOf(page, '1')
    await expect(ibSwitch).toHaveAttribute('aria-checked', 'false')

    await ibSwitch.click()
    await expect(dialogOf(page)).toBeVisible()
    await expect(ibSwitch).toHaveAttribute('aria-checked', 'false')

    await page.getByTestId('incidents-control-cancel').click()

    await expect(dialogOf(page)).toHaveCount(0)
    await expect(ibSwitch).toHaveAttribute('aria-checked', 'false')
    await expect(targetRowOf(page, '1')).not.toContainText('停止中')
  })
})

/* ここから履歴のページャー */

// src/stores/incidents.js の INCIDENT_HISTORY_PAGE_SIZE（= utils/pagination.js の DEFAULT_PAGE_SIZE）と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

// 3 ページになる件数（50 + 50 + 20）
const PAGED_TOTAL = 120

const SERVER_ERROR = 'サーバーでエラーが発生しました。'

/** ページ送りの件数表示（BasePagination の rangeLabel と同じ形） */
function rangeText(total, first, last) {
  return `${total} 件中 ${first}–${last} 件`
}

/** 合成した履歴の n 件目（1 始まり・新しい順）の停止理由。行の取り違えを見分けるための印 */
function pagedReason(n) {
  return `E2E履歴-${String(n).padStart(3, '0')}`
}

function paginationOf(page) {
  return page.getByTestId('incidents-history-pagination')
}

function pageButtonsOf(page) {
  return paginationOf(page).getByTestId('pagination-page')
}

/**
 * ページ内の MSW worker に、offset を解釈する履歴ハンドラを足す。
 * mockApi() は固定の body しか返せず、既定モックの履歴は 4 件で 1 ページに収まるため。
 * worker は IN-11 と同じく dev サーバが配るモジュールを同じ URL で import して掴む。
 * http / HttpResponse も worker と同じ msw の実体でないと扱えないので、
 * browser.js が import している依存の URL（?v= 付き）をそのまま辿る。
 * failOnce を付けると、次の 1 回の取得だけ 500 を返す（以降は先に足したハンドラへ落ちる）。
 */
async function installHistoryHandler(page, { total, failOnce = false }) {
  await page.evaluate(
    async ({ path, total, template, failOnce, detail }) => {
      const { worker } = await import('/src/mocks/browser.js')
      const source = await (await fetch('/src/mocks/browser.js')).text()
      const mswUrl = source.match(/from "([^"]*\/deps\/msw\.js[^"]*)"/)[1]
      const { http, HttpResponse } = await import(mswUrl)

      if (failOnce) {
        worker.use(
          http.get(path, () => HttpResponse.json({ detail }, { status: 500 }), { once: true }),
        )
        return
      }

      const rows = Array.from({ length: total }, (_, index) => ({
        ...template,
        ID: total - index,
        操作区分: 'SUSPEND',
        操作区分名: '発注停止',
        変更後データ: { 発注停止フラグ: 1, 停止理由: `E2E履歴-${String(index + 1).padStart(3, '0')}` },
      }))
      worker.use(
        http.get(path, ({ request }) => {
          const params = new URL(request.url).searchParams
          const limit = Number(params.get('limit') ?? 50)
          const offset = Number(params.get('offset') ?? 0)
          return HttpResponse.json({
            total,
            limit,
            offset,
            histories: rows.slice(offset, offset + limit),
          })
        }),
      )
    },
    { path: HISTORY_PATH, total, template: suspensionHistories[0], failOnce, detail: SERVER_ERROR },
  )
}

/** 履歴が PAGED_TOTAL 件ある状態で画面を開く（IN-26 の前提）。再読み込みでページ応答に取り直す */
async function openPaged(page) {
  await page.goto(PATH)
  await expect(historyRowsOf(page)).toHaveCount(suspensionHistories.length)
  await installHistoryHandler(page, { total: PAGED_TOTAL })
  await page.getByTestId('incidents-reload').click()
  await expect(paginationOf(page).getByTestId('pagination-range')).toHaveText(
    rangeText(PAGED_TOTAL, 1, PAGE_SIZE),
  )
}

/** 2 ページ目を開く（IN-27 の操作） */
async function goToSecondPage(page) {
  await paginationOf(page).getByRole('button', { name: '2', exact: true }).click()
  await expect(paginationOf(page).getByTestId('pagination-range')).toHaveText(
    rangeText(PAGED_TOTAL, PAGE_SIZE + 1, PAGE_SIZE * 2),
  )
}

/** 履歴の表の先頭行が、合成した履歴の n 件目であること */
async function expectFirstHistory(page, n) {
  await expect(historyRowsOf(page).first().getByRole('cell').nth(2)).toHaveText(pagedReason(n))
}

// シナリオ: docs/e2e/incidents.md（タイトル先頭の [IN-nn] が対応 ID）
// 障害対応履歴のページャー。件数表示とページ番号の出し分け、ページ送りで履歴だけが替わること、
// ページ送りの失敗が履歴カードに閉じること、再読み込み・停止後のページ位置を守る。
// 番号の畳み方や範囲外 offset の丸めは BasePagination の単体テスト側が担保する。
test.describe('障害管理 履歴のページャー', () => {
  test('[IN-25] 1 ページに収まるときは件数表示だけでページ番号は出ない', async ({ page }) => {
    await page.goto(PATH)

    const pagination = paginationOf(page)
    await expect(pagination.getByTestId('pagination-range')).toHaveText(
      rangeText(suspensionHistories.length, 1, suspensionHistories.length),
    )
    await expect(pageButtonsOf(page)).toHaveCount(0)
    await expect(pagination.getByTestId('pagination-prev')).toHaveCount(0)
    await expect(pagination.getByTestId('pagination-next')).toHaveCount(0)
  })

  test('[IN-26] 1 ページを超えると件数表示とページ番号が出る', async ({ page }) => {
    await openPaged(page)

    const pageCount = Math.ceil(PAGED_TOTAL / PAGE_SIZE)
    await expect(pageButtonsOf(page)).toHaveText(
      Array.from({ length: pageCount }, (_, index) => String(index + 1)),
    )
    await expect(paginationOf(page).getByRole('button', { name: '1', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(historyRowsOf(page)).toHaveCount(PAGE_SIZE)
    await expectFirstHistory(page, 1)
  })

  test('[IN-27] ページ番号を押すと履歴だけが替わり、URL と停止対象の表はそのまま', async ({
    page,
  }) => {
    await openPaged(page)
    const url = page.url()

    await goToSecondPage(page)

    await expect(paginationOf(page).getByRole('button', { name: '2', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(historyRowsOf(page)).toHaveCount(PAGE_SIZE)
    await expectFirstHistory(page, PAGE_SIZE + 1)
    expect(page.url()).toBe(url)
    await expect(targetRowsOf(page)).toHaveCount(suspensionTargets.length)
  })

  test('[IN-28] 履歴が 0 件のときはページャーも出ない', async ({ page }) => {
    await mockApi(page, [{ path: HISTORY_PATH, body: historyBody([]) }])
    await page.goto(PATH)

    await expect(page.getByTestId('incidents-history-empty')).toHaveText(
      '障害対応履歴はありません。',
    )
    await expect(paginationOf(page)).toHaveCount(0)
  })

  test('[IN-29] ページ送りに失敗すると履歴カードにエラーが出て、停止対象の表は残る', async ({
    page,
  }) => {
    await openPaged(page)
    await installHistoryHandler(page, { total: PAGED_TOTAL, failOnce: true })

    await paginationOf(page).getByRole('button', { name: '次のページ' }).click()

    const error = page.getByTestId('incidents-history-error')
    await expect(error).toContainText(SERVER_ERROR)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('incidents-history')).toHaveCount(0)
    await expect(paginationOf(page)).toHaveCount(0)

    // 画面全体のエラーではない。停止対象の表と操作は使えるまま
    await expect(page.getByTestId('incidents-error')).toHaveCount(0)
    await expect(targetRowsOf(page)).toHaveCount(suspensionTargets.length)
    await expect(switchOf(page, '1')).toBeEnabled()
  })

  test('[IN-30] 履歴カードの「再試行」で失敗したページが表示される', async ({ page }) => {
    await openPaged(page)
    await installHistoryHandler(page, { total: PAGED_TOTAL, failOnce: true })
    await paginationOf(page).getByRole('button', { name: '次のページ' }).click()
    const error = page.getByTestId('incidents-history-error')
    await expect(error).toBeVisible()

    await error.getByRole('button', { name: '再試行' }).click()

    await expect(error).toHaveCount(0)
    await expect(paginationOf(page).getByTestId('pagination-range')).toHaveText(
      rangeText(PAGED_TOTAL, PAGE_SIZE + 1, PAGE_SIZE * 2),
    )
    await expectFirstHistory(page, PAGE_SIZE + 1)
  })

  test('[IN-31] ヘッダの「再読み込み」は見ている履歴のページを保つ', async ({ page }) => {
    await openPaged(page)
    await goToSecondPage(page)

    await page.getByTestId('incidents-reload').click()

    // 再読み込み中は画面全体がローディングになるので、表示が戻るのを待ってから見る
    await expect(targetRowsOf(page)).toHaveCount(suspensionTargets.length)
    await expect(paginationOf(page).getByTestId('pagination-range')).toHaveText(
      rangeText(PAGED_TOTAL, PAGE_SIZE + 1, PAGE_SIZE * 2),
    )
    await expect(paginationOf(page).getByRole('button', { name: '2', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expectFirstHistory(page, PAGE_SIZE + 1)
  })

  test('[IN-32] 停止に成功すると履歴は先頭ページに戻る', async ({ page }) => {
    await openPaged(page)
    await goToSecondPage(page)

    await suspendIb(page)

    await expect(paginationOf(page).getByTestId('pagination-range')).toHaveText(
      rangeText(PAGED_TOTAL, 1, PAGE_SIZE),
    )
    await expect(paginationOf(page).getByRole('button', { name: '1', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expectFirstHistory(page, 1)
  })
})
