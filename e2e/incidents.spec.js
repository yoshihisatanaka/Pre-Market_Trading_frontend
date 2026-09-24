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

  test('[IN-04] 全体の「停止する」で確認ダイアログが開く', async ({ page }) => {
    await page.goto(PATH)

    await page.getByTestId('incidents-target-ALL-action').click()

    const dialog = page.getByRole('dialog', { name: '発注停止の確認' })
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

  test('[IN-07] IB の「停止する」では対象が IB で、全ルート停止の警告は出ない', async ({
    page,
  }) => {
    await page.goto(PATH)

    await page.getByTestId('incidents-target-1-action').click()

    const dialog = page.getByRole('dialog', { name: '発注停止の確認' })
    await expect(dialog).toContainText(`「${ibTarget.停止対象名}」の発注を停止します。`)
    await expect(page.getByTestId('incidents-control-reason')).toBeVisible()
    await expect(page.getByTestId('incidents-control-warning')).toHaveCount(0)
  })

  test('[IN-08] 操作履歴が新しい順に表示される', async ({ page }) => {
    await page.goto(PATH)

    const history = page.getByTestId('incidents-history')
    await expect(history.getByRole('columnheader')).toHaveText([
      '操作日時',
      '停止対象',
      '操作区分',
      '停止理由',
      '操作者',
    ])

    const rows = historyRowsOf(page)
    await expect(rows).toHaveCount(suspensionHistories.length)

    // フィクスチャは実 API と同じ最新順。先頭が最も新しい
    const latest = suspensionHistories[0]
    const first = rows.first()
    await expect(first).toContainText(formatDateTime(latest.操作日時))
    await expect(first).toContainText(latest.停止対象名)
    await expect(first).toContainText(latest.操作区分名)
    await expect(first).toContainText(latest.操作者)
  })

  test('[IN-09] 操作履歴が 0 件でも停止対象の表は表示される', async ({ page }) => {
    await mockApi(page, [{ path: HISTORY_PATH, body: historyBody([]) }])
    await page.goto(PATH)

    await expect(page.getByTestId('incidents-history-empty')).toHaveText(
      '発注停止・再開の操作履歴はありません。',
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

  test('[IN-13] 停止対象の 6 行が並び、過去の停止理由が残っている', async ({ page }) => {
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
    await expect(first).toContainText(ibTarget.停止対象名)
    await expect(first).toContainText('発注停止')
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

    await page.getByTestId('incidents-target-1-action').click()
    await expect(page.getByRole('dialog', { name: '発注再開の確認' })).toBeVisible()
    await page.getByTestId('incidents-control-submit').click()

    await expect(dialogOf(page)).toHaveCount(0)
    await expect(page.getByTestId('incidents-notice')).toHaveText(
      `${ibTarget.停止対象名}の発注を再開しました。`,
    )
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

    await page.getByTestId('incidents-target-1-action').click()

    await expect(page.getByRole('dialog', { name: '発注再開の確認' })).toBeVisible()
    await expect(page.getByTestId('incidents-control-summary')).toContainText(NEW_REASON)
    await expect(page.getByTestId('incidents-control-reason')).toHaveCount(0)
  })

  test('[IN-23] 全体停止中はルート行の操作が押せず、注意書きが出る', async ({ page }) => {
    await mockApi(page, [{ path: STATUS_PATH, body: statusBody(['ALL']) }])
    await page.goto(PATH)

    const allAction = page.getByTestId('incidents-target-ALL-action')
    await expect(allAction).toHaveText('再開する')
    await expect(allAction).toBeEnabled()
    for (const target of routeTargets) {
      await expect(page.getByTestId(`incidents-target-${target.停止対象}-action`)).toBeDisabled()
    }
    await expect(page.getByTestId('incidents-locked')).toContainText(
      '全体停止中はルート別に停止・再開できません。',
    )
  })
})
