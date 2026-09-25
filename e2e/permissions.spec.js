import { expect, test } from '@playwright/test'
import { viewerOperator } from '../src/mocks/fixtures/currentOperator'
import { rolePermissions } from '../src/mocks/fixtures/permissions'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/permissions.md（タイトル先頭の [PM-xx] が対応 ID）
// 4 ロールの権限が読めること、編集できるかが GET /auth/me のロールで出し分けられること、
// 保存した値が一覧に反映され失敗が利用者に伝わることを守る。
// 既定ハンドラは保存した値をページ内で保持する（テストごとに新しいページなので持ち越さない）。
// mockApi() は固定の body を返すだけなので、保存の反映（PM-10 / 11 / 14 / 15）は既定ハンドラで検証する。

const PATH = '/masters/permissions'

/*
 * 権限の 4 列。並びは src/utils/permissionTypes.js の PERMISSION_ITEMS と同じ
 * （utils は import できるが、フィクスチャの日本語キーとの対応をここで持ちたいので再掲する）。
 * cell は表の列位置（0: ロール / 1: 運用概要 / 2〜5: 権限）。
 */
const PERMISSIONS = [
  { column: '発注権限', checkbox: 'permissions-edit-can-order', cell: 2 },
  { column: 'マスタ更新権限', checkbox: 'permissions-edit-can-master-update', cell: 3 },
  { column: '運用管理権限', checkbox: 'permissions-edit-can-operation', cell: 4 },
  { column: '全店参照権限', checkbox: 'permissions-edit-can-branch-all', cell: 5 },
]
const [ORDER, MASTER_UPDATE, , BRANCH_ALL] = PERMISSIONS

/** 許可 / 不可のバッジの文言（src/utils/permissionTypes.js の permissionBadge と同じ） */
const badge = (flag) => (flag === 1 ? '許可' : '不可')

const byRole = (code) => rolePermissions.find((row) => row.ロールコード === code)
const SALES = byRole('sales')
const SUPERVISOR = byRole('supervisor')

// PM-12 で差し替える 409 の detail。サーバが返した文言をそのまま出すことを見るための値
const CONFLICT_MESSAGE =
  '他のユーザーによって更新されています。最新の情報を取得してからやり直してください。'

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('permissions-table').getByTestId('data-table-row')
}

/** ロールの行。並びはフィクスチャ（実 API と同じ ID 順）のまま */
function roleRow(page, row) {
  return rowsOf(page).nth(rolePermissions.indexOf(row))
}

/** ロールの行の、ある権限のセル */
function permissionCell(page, row, permission) {
  return roleRow(page, row).getByRole('cell').nth(permission.cell)
}

/** 4 ロール × 4 権限のバッジがフィクスチャどおりに出ていることを確かめる */
async function expectFixtureBadges(page) {
  for (const row of rolePermissions) {
    const cells = roleRow(page, row).getByRole('cell')
    for (const permission of PERMISSIONS) {
      await expect(cells.nth(permission.cell)).toHaveText(badge(row[permission.column]))
    }
  }
}

/** 編集ダイアログの 4 つのチェックがその行の現在値どおりかを確かめる */
async function expectChecks(dialog, row) {
  for (const permission of PERMISSIONS) {
    const checkbox = dialog.getByTestId(permission.checkbox)
    if (row[permission.column] === 1) {
      await expect(checkbox).toBeChecked()
    } else {
      await expect(checkbox).not.toBeChecked()
    }
  }
}

/** ロールの「編集」を押してダイアログを返す */
async function openEdit(page, row) {
  await page.getByTestId(`permissions-edit-${row.ロールコード}`).click()
  const dialog = page.getByRole('dialog', { name: `${row.ロール名}の権限設定` })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('権限マスタ', () => {
  test('[PM-01] サイドメニューから遷移すると 4 ロールが並ぶ', async ({ page }) => {
    await page.goto('/')

    await page
      .getByRole('navigation', { name: 'メインメニュー' })
      .getByRole('link', { name: '権限マスタ', exact: true })
      .click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByRole('heading', { name: '権限マスタ', exact: true })).toBeVisible()
    // 画面固有の操作がヘッダ（#topbar-actions）へ差し込まれている
    await expect(page.getByTestId('permissions-reload')).toBeVisible()

    await expect(page.getByTestId('permissions-count')).toHaveText(`${rolePermissions.length} ロール`)
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(rolePermissions.length)
    for (const [index, row] of rolePermissions.entries()) {
      await expect(rows.nth(index).getByRole('cell').first()).toContainText(row.ロール名)
    }
  })

  test('[PM-02] 列がロールから操作までの順に並びページャーは出ない', async ({ page }) => {
    await page.goto(PATH)

    const table = page.getByTestId('permissions-table')
    await expect(rowsOf(page)).toHaveCount(rolePermissions.length)
    await expect(table.getByRole('columnheader')).toHaveText([
      'ロール',
      '運用概要',
      ...PERMISSIONS.map((permission) => permission.column),
      '操作',
    ])
    await expect(page.getByTestId('permissions-pagination')).toHaveCount(0)
  })

  test('[PM-03] ロールごとの権限が許可 / 不可で表示される', async ({ page }) => {
    await page.goto(PATH)

    await expect(rowsOf(page)).toHaveCount(rolePermissions.length)
    await expectFixtureBadges(page)
  })

  test('[PM-04] 管理責任者で開くと権限設定可能で全行に編集ボタンがある', async ({ page }) => {
    await page.goto(PATH)

    await expect(page.getByTestId('permissions-description')).toContainText('権限設定可能')
    for (const row of rolePermissions) {
      await expect(roleRow(page, row).getByTestId(`permissions-edit-${row.ロールコード}`)).toBeVisible()
    }
  })

  test('[PM-05] 一覧の取得が失敗するとエラーと再試行が出て表は出ない', async ({ page }) => {
    await mockApi(page, [
      {
        path: '*/api/masters/permissions',
        status: 500,
        body: { detail: 'サーバーでエラーが発生しました。' },
      },
    ])
    await page.goto(PATH)

    const error = page.getByTestId('permissions-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('サーバーでエラーが発生しました。')
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('permissions-table')).toHaveCount(0)
    // 注記は 4 状態に関わらず出る
    await expect(page.getByTestId('permissions-description')).toBeVisible()
  })

  test('[PM-06] ロールが 0 件なら空の表示になり表は出ない', async ({ page }) => {
    await mockApi(page, [{ path: '*/api/masters/permissions', body: { roles: [] } }])
    await page.goto(PATH)

    await expect(page.getByTestId('permissions-empty')).toHaveText('ロールが登録されていません。')
    await expect(page.getByTestId('permissions-count')).toHaveText('0 ロール')
    await expect(page.getByTestId('permissions-table')).toHaveCount(0)
  })

  test('[PM-07] 管理責任者以外で開くと閲覧のみで操作列が無い', async ({ page }) => {
    await mockApi(page, [{ path: '*/api/auth/me', body: viewerOperator }])
    await page.goto(PATH)

    await expect(page.getByTestId('permissions-description')).toContainText('閲覧のみ')
    await expect(rowsOf(page)).toHaveCount(rolePermissions.length)
    await expect(
      page.getByTestId('permissions-table').getByRole('columnheader', { name: '操作', exact: true }),
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: '編集' })).toHaveCount(0)
    // 権限そのものは閲覧のみでも読める
    await expectFixtureBadges(page)
  })

  test('[PM-08] 操作者の取得が失敗しても一覧は出て閲覧のみになる', async ({ page }) => {
    await mockApi(page, [
      {
        path: '*/api/auth/me',
        status: 500,
        body: { detail: 'サーバーでエラーが発生しました。' },
      },
    ])
    await page.goto(PATH)

    await expect(rowsOf(page)).toHaveCount(rolePermissions.length)
    await expect(page.getByTestId('permissions-error')).toHaveCount(0)
    await expect(page.getByTestId('permissions-description')).toContainText('閲覧のみ')
    await expect(page.getByRole('button', { name: '編集' })).toHaveCount(0)
  })

  test('[PM-09] 編集を押すとダイアログにその行の現在値が入っている', async ({ page }) => {
    await page.goto(PATH)

    const dialog = await openEdit(page, SALES)
    await expectChecks(dialog, SALES)
  })

  test('[PM-10] 権限を変えて保存すると一覧のバッジが変わる', async ({ page }) => {
    await page.goto(PATH)

    const dialog = await openEdit(page, SALES)
    await dialog.getByTestId(MASTER_UPDATE.checkbox).check()
    await dialog.getByTestId('permissions-edit-submit').click()

    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('permissions-notice')).toHaveText(
      `${SALES.ロール名}の権限設定を更新しました。`,
    )
    await expect(permissionCell(page, SALES, MASTER_UPDATE)).toHaveText('許可')
    // 触っていない権限・ほかのロール・件数は変わらない
    await expect(permissionCell(page, SALES, ORDER)).toHaveText(badge(SALES.発注権限))
    await expect(page.getByTestId('permissions-count')).toHaveText(`${rolePermissions.length} ロール`)
    for (const row of rolePermissions.filter((item) => item !== SALES)) {
      for (const permission of PERMISSIONS) {
        await expect(permissionCell(page, row, permission)).toHaveText(badge(row[permission.column]))
      }
    }
  })

  test('[PM-11] 何も変えずに保存すると変更はありませんと出る', async ({ page }) => {
    await page.goto(PATH)

    const dialog = await openEdit(page, SALES)
    await dialog.getByTestId('permissions-edit-submit').click()

    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('permissions-notice')).toHaveText('変更はありません。')
    for (const permission of PERMISSIONS) {
      await expect(permissionCell(page, SALES, permission)).toHaveText(badge(SALES[permission.column]))
    }
  })

  test('[PM-12] 保存が競合するとダイアログは開いたまま detail が出る', async ({ page }) => {
    // 実ブラウザで「他の利用者」を作れないので、競合の応答そのものを差し替える
    await mockApi(page, [
      {
        method: 'put',
        path: '*/api/masters/permissions/:roleCode',
        status: 409,
        body: { detail: CONFLICT_MESSAGE },
      },
    ])
    await page.goto(PATH)

    const dialog = await openEdit(page, SALES)
    await dialog.getByTestId(MASTER_UPDATE.checkbox).check()
    await dialog.getByTestId('permissions-edit-submit').click()

    await expect(dialog.getByTestId('permissions-edit-error')).toContainText(CONFLICT_MESSAGE)
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('permissions-notice')).toHaveCount(0)
    await expect(permissionCell(page, SALES, MASTER_UPDATE)).toHaveText(
      badge(SALES.マスタ更新権限),
    )
  })

  test('[PM-13] キャンセルすると一覧は変わらず開き直すと現在値に戻る', async ({ page }) => {
    await page.goto(PATH)

    const dialog = await openEdit(page, SALES)
    await dialog.getByTestId(MASTER_UPDATE.checkbox).check()
    await dialog.getByTestId('permissions-edit-cancel').click()

    await expect(dialog).toHaveCount(0)
    await expect(permissionCell(page, SALES, MASTER_UPDATE)).toHaveText(
      badge(SALES.マスタ更新権限),
    )

    const reopened = await openEdit(page, SALES)
    await expectChecks(reopened, SALES)
  })

  test('[PM-14] 保存後に再読み込みしても保存した値が残る', async ({ page }) => {
    await page.goto(PATH)

    const dialog = await openEdit(page, SALES)
    await dialog.getByTestId(MASTER_UPDATE.checkbox).check()
    await dialog.getByTestId('permissions-edit-submit').click()
    await expect(page.getByTestId('permissions-notice')).toBeVisible()

    await page.getByTestId('permissions-reload').click()

    await expect(page.getByTestId('permissions-notice')).toHaveCount(0)
    await expect(rowsOf(page)).toHaveCount(rolePermissions.length)
    await expect(permissionCell(page, SALES, MASTER_UPDATE)).toHaveText('許可')
  })

  test('[PM-15] 一度も更新されていない行も保存できる', async ({ page }) => {
    // 管理責任者の行は更新日時が null（楽観的ロックの合札を送らない経路）
    await page.goto(PATH)

    const dialog = await openEdit(page, SUPERVISOR)
    await dialog.getByTestId(BRANCH_ALL.checkbox).uncheck()
    await dialog.getByTestId('permissions-edit-submit').click()

    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('permissions-notice')).toHaveText(
      `${SUPERVISOR.ロール名}の権限設定を更新しました。`,
    )
    await expect(permissionCell(page, SUPERVISOR, BRANCH_ALL)).toHaveText('不可')
  })

  test('[PM-16] 競合で弾かれたあと開き直すとエラーが消えて現在値に戻る', async ({ page }) => {
    await mockApi(page, [
      {
        method: 'put',
        path: '*/api/masters/permissions/:roleCode',
        status: 409,
        body: { detail: CONFLICT_MESSAGE },
      },
    ])
    await page.goto(PATH)

    const dialog = await openEdit(page, SALES)
    await dialog.getByTestId(MASTER_UPDATE.checkbox).check()
    await dialog.getByTestId('permissions-edit-submit').click()
    await expect(dialog.getByTestId('permissions-edit-error')).toBeVisible()

    await dialog.getByTestId('permissions-edit-cancel').click()
    await expect(dialog).toHaveCount(0)

    const reopened = await openEdit(page, SALES)
    await expect(reopened.getByTestId('permissions-edit-error')).toHaveCount(0)
    await expectChecks(reopened, SALES)
  })
})
