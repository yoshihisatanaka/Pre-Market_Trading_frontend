import { expect, test } from '@playwright/test'
import { clickSideMenuLink, sideMenu } from './helpers/sideMenu'
import { mockApi } from './helpers/mockApi'
import { branches } from '../src/mocks/fixtures/codes'
import { rolePermissions } from '../src/mocks/fixtures/permissions'
import { users } from '../src/mocks/fixtures/users'

// シナリオ: docs/e2e/users.md（タイトル先頭の [UM-xx] が対応 ID）
// ユーザ管理マスタ。検索条件は URL クエリを正とするので、URL と画面の同期をここで守る。
// 新規追加・削除は無く、行の「編集」（ユーザの権限設定）でロールと状態だけを変える。
// mockApi() はクエリを解釈しないので、絞り込みはクエリを処理する既定ハンドラで見る。
// 更新した行はページ内でだけ保持され、テストごとに新しいページなので持ち越さない。

const PATH = '/masters/users'

// src/stores/users.js の USER_STATUS_ACTIVE と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const STATUS_ACTIVE = 'active'

/** 列の並び（UM-02）。セルを列名で引く索引を兼ねる */
const COLUMNS = ['社員コード', '氏名', '所属部店コード', '所属部店名', 'ロール', '状態', '操作']

/* 期待値はフィクスチャから導く。既定の状態は「すべて」なので無効の利用者も含めて全件出る */
const TOTAL = users.length
const firstUser = users[0]
const activeUsers = users.filter((user) => user.有効フラグ === 1)
const inactiveUser = users.find((user) => user.有効フラグ === 0)
/** 部店の無い利用者（UM-03 / UM-20） */
const noBranchUser = users.find((user) => user.部店コード === null)
/** 有効で 1 行目とは別の利用者（UM-16 / UM-17 で無効にする） */
const deactivateTarget = activeUsers.find((user) => user.ID !== firstUser.ID)

const branchNameOf = (code) => branches.find((branch) => branch.code === code)?.name
const roleOf = (code) => rolePermissions.find((role) => role.ロールコード === code)

/** 絞り込みに使うロール: 無効の利用者と同じロール（UM-05 / UM-12 で有効との併用に効く） */
const FILTER_ROLE = roleOf(inactiveUser.ロールコード)
const byRole = users.filter((user) => user.ロールコード === FILTER_ROLE.ロールコード)
const byRoleActive = byRole.filter((user) => user.有効フラグ === 1)

/** 絞り込みに使う部店: 無効の利用者の部店 */
const FILTER_BRANCH = inactiveUser.部店コード
const byBranch = users.filter((user) => user.部店コード === FILTER_BRANCH)

/** 氏名のキーワード: 1 行目の姓 */
const NAME_KEYWORD = firstUser.氏名.split(' ')[0]
const byName = users.filter((user) => (user.氏名 ?? '').includes(NAME_KEYWORD))
/** 社員コードのキーワード: 1 行目とは別の利用者のコード */
const codeTarget = users[2]

// どの社員コード・氏名にも当たらない文字列
const NO_MATCH = 'ZZZZ'

/** 編集で付け替えるロール: 1 行目と違うロール */
const NEW_ROLE = rolePermissions.find((role) => role.ロールコード !== firstUser.ロールコード)

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'
// PUT が 400 を返すとき（UM-19）の detail。MSW の PUT が返す文言の形に合わせた値
const BAD_ROLE_MESSAGE = 'ロールコードが不正です: unknown（指定可能: ifa, sales, manager, supervisor）'

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('users-table').getByTestId('data-table-row')
}

/** 利用者の行。行の「編集」ボタン（ID 入り）を持つ行で引く */
function rowOf(page, user) {
  return rowsOf(page).filter({ has: page.getByTestId(`users-edit-${user.ID}`) })
}

/** 行の中の 1 セル。列名から位置を引く */
function cellOf(row, column) {
  return row.locator('td').nth(COLUMNS.indexOf(column))
}

/** 表の 1 列ぶんのセル（全行） */
function columnOf(page, column) {
  return page.getByTestId('users-table').locator(`td:nth-child(${COLUMNS.indexOf(column) + 1})`)
}

/** 行の「編集」でモーダルを開く */
async function openEdit(page, user) {
  await page.getByTestId(`users-edit-${user.ID}`).click()
  const dialog = page.getByRole('dialog', { name: 'ユーザの権限設定' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** 一覧を開いて全件が出るまで待つ */
async function openList(page, path = PATH) {
  await page.goto(path)
  await expect(rowsOf(page)).toHaveCount(TOTAL)
}

test.describe('ユーザ管理マスタ', () => {
  test('[UM-01] サイドメニューから開くと説明の帯と一覧が表示される', async ({ page }) => {
    await page.goto('/')

    await clickSideMenuLink(page, 'ユーザ管理マスタ')

    // メニューでは「顧客マスタ」の直後に並ぶ
    const links = await sideMenu(page).getByRole('link').allTextContents()
    const labels = links.map((text) => text.trim())
    expect(labels[labels.indexOf('顧客マスタ') + 1]).toBe('ユーザ管理マスタ')

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByRole('heading', { name: 'ユーザ管理マスタ', exact: true })).toBeVisible()
    await expect(page.getByTestId('users-description')).toContainText('権限判定の流れ')

    await expect(page.getByTestId('users-count')).toHaveText(`${TOTAL} 件`)
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(TOTAL)
    await expect(cellOf(rows.first(), '社員コード')).toHaveText(firstUser.操作者コード)
    await expect(cellOf(rows.first(), '氏名')).toHaveText(firstUser.氏名)
  })

  test('[UM-02] 列順が仕様どおりで、行の操作は編集だけ・新規追加と削除は無い', async ({ page }) => {
    await openList(page)

    const table = page.getByTestId('users-table')
    await expect(table.locator('th')).toHaveText(COLUMNS)

    await expect(table.getByRole('button', { name: '編集', exact: true })).toHaveCount(TOTAL)
    await expect(rowsOf(page).first().getByRole('button')).toHaveCount(1)
    await expect(page.getByRole('button', { name: '削除' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '新規追加' })).toHaveCount(0)
  })

  test('[UM-03] 所属部店名・ロール名・状態が行に表示される', async ({ page }) => {
    const withBranch = users.find((user) => user.部店コード !== null)
    // 部店あり・部店なし・無効の行がフィクスチャに無いと、このシナリオは意味を失う
    expect(withBranch).toBeDefined()
    expect(noBranchUser).toBeDefined()
    expect(inactiveUser).toBeDefined()

    await openList(page)

    const branchRow = rowOf(page, withBranch)
    await expect(cellOf(branchRow, '所属部店コード')).toHaveText(withBranch.部店コード)
    await expect(cellOf(branchRow, '所属部店名')).toHaveText(branchNameOf(withBranch.部店コード))
    await expect(cellOf(branchRow, 'ロール')).toHaveText(withBranch.ロール名)
    await expect(cellOf(branchRow, '状態')).toHaveText('有効')

    const noBranchRow = rowOf(page, noBranchUser)
    await expect(cellOf(noBranchRow, '所属部店コード')).toHaveText('—')
    await expect(cellOf(noBranchRow, '所属部店名')).toHaveText('—')

    await expect(cellOf(rowOf(page, inactiveUser), '状態')).toHaveText('無効')
  })

  test('[UM-04] 状態で「有効」を選ぶと無効の利用者が外れる', async ({ page }) => {
    await openList(page)

    await page.getByTestId('users-status').selectOption(STATUS_ACTIVE)
    await page.getByTestId('users-search-submit').click()

    await expect(page.getByTestId('users-count')).toHaveText(`${activeUsers.length} 件`)
    expect(new URL(page.url()).searchParams.get('status')).toBe(STATUS_ACTIVE)
    await expect(rowsOf(page)).toHaveCount(activeUsers.length)
    await expect(rowOf(page, inactiveUser)).toHaveCount(0)
    await expect(columnOf(page, '状態')).toHaveText(Array(activeUsers.length).fill('有効'))
  })

  test('[UM-05] ロールの選択肢は権限マスタのロールで、選ぶと絞り込まれる', async ({ page }) => {
    await openList(page)

    const roleSelect = page.getByTestId('users-role')
    // 先頭は「すべて」、続いて権限マスタのロール名が並び順どおり
    await expect(roleSelect.locator('option')).toHaveText([
      'すべて',
      ...rolePermissions.map((role) => role.ロール名),
    ])

    await roleSelect.selectOption(FILTER_ROLE.ロールコード)
    await page.getByTestId('users-search-submit').click()

    await expect(page.getByTestId('users-count')).toHaveText(`${byRole.length} 件`)
    expect(new URL(page.url()).searchParams.get('role')).toBe(FILTER_ROLE.ロールコード)
    await expect(columnOf(page, 'ロール')).toHaveText(Array(byRole.length).fill(FILTER_ROLE.ロール名))
  })

  test('[UM-06] 所属部店を選ぶと絞り込まれる', async ({ page }) => {
    await openList(page)

    await page.getByTestId('users-branch-code').selectOption(FILTER_BRANCH)
    await page.getByTestId('users-search-submit').click()

    await expect(page.getByTestId('users-count')).toHaveText(`${byBranch.length} 件`)
    expect(new URL(page.url()).searchParams.get('branch_code')).toBe(FILTER_BRANCH)
    await expect(columnOf(page, '所属部店コード')).toHaveText(
      Array(byBranch.length).fill(FILTER_BRANCH),
    )
  })

  test('[UM-07] 氏名の一部で検索すると絞り込まれる', async ({ page }) => {
    expect(byName).toHaveLength(1)
    await openList(page)

    await page.getByTestId('users-keyword').fill(NAME_KEYWORD)
    await page.getByTestId('users-search-submit').click()

    await expect(page.getByTestId('users-count')).toHaveText('1 件')
    expect(new URL(page.url()).searchParams.get('keyword')).toBe(NAME_KEYWORD)
    await expect(rowsOf(page)).toHaveCount(1)
    await expect(cellOf(rowsOf(page).first(), '氏名')).toHaveText(byName[0].氏名)
  })

  test('[UM-08] 社員コードで検索すると絞り込まれる', async ({ page }) => {
    await openList(page)

    await page.getByTestId('users-keyword').fill(codeTarget.操作者コード)
    await page.getByTestId('users-search-submit').click()

    await expect(page.getByTestId('users-count')).toHaveText('1 件')
    const row = rowsOf(page).first()
    await expect(cellOf(row, '社員コード')).toHaveText(codeTarget.操作者コード)
    await expect(cellOf(row, '氏名')).toHaveText(codeTarget.氏名)
  })

  test('[UM-09] 「クリア」を押すと絞り込みが解除される', async ({ page }) => {
    await openList(page)

    await page.getByTestId('users-role').selectOption(FILTER_ROLE.ロールコード)
    await page.getByTestId('users-status').selectOption(STATUS_ACTIVE)
    await page.getByTestId('users-search-submit').click()
    await expect(rowsOf(page)).toHaveCount(byRoleActive.length)

    await page.getByTestId('users-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('users-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(TOTAL)
    await expect(page.getByTestId('users-role')).toHaveValue('')
    await expect(page.getByTestId('users-status')).toHaveValue('')
  })

  test('[UM-10] 該当が無いときは空状態が表示される', async ({ page }) => {
    await openList(page)

    await page.getByTestId('users-keyword').fill(NO_MATCH)
    await page.getByTestId('users-search-submit').click()

    await expect(page.getByTestId('users-empty')).toHaveText('該当するユーザがありません。')
    await expect(page.getByTestId('users-table')).toBeHidden()
    await expect(page.getByTestId('users-description')).toBeVisible()
    await expect(page.getByTestId('users-search')).toBeVisible()
  })

  test('[UM-11] API がエラーを返したときエラー表示と再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [{ path: '*/api/masters/users', status: 500, body: { detail: ERROR_MESSAGE } }])
    await page.goto(PATH)

    const error = page.getByTestId('users-error')
    await expect(error).toContainText(ERROR_MESSAGE)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('users-table')).toBeHidden()
    await expect(page.getByTestId('users-description')).toBeVisible()
    await expect(page.getByTestId('users-search')).toBeVisible()
  })

  test('[UM-12] 条件付きの URL を直接開くと検索欄と一覧に復元される', async ({ page }) => {
    expect(byRoleActive).toHaveLength(1)

    await page.goto(`${PATH}?role=${FILTER_ROLE.ロールコード}&status=${STATUS_ACTIVE}`)

    await expect(page.getByTestId('users-role')).toHaveValue(FILTER_ROLE.ロールコード)
    await expect(page.getByTestId('users-status')).toHaveValue(STATUS_ACTIVE)
    await expect(page.getByTestId('users-count')).toHaveText('1 件')
    await expect(rowsOf(page)).toHaveCount(1)
    await expect(cellOf(rowsOf(page).first(), '社員コード')).toHaveText(
      byRoleActive[0].操作者コード,
    )
  })

  test('[UM-13] ブラウザバックで絞り込み前に戻る', async ({ page }) => {
    await openList(page)

    await page.getByTestId('users-keyword').fill(NAME_KEYWORD)
    await page.getByTestId('users-search-submit').click()
    await expect(rowsOf(page)).toHaveCount(byName.length)

    await page.goBack()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('users-count')).toHaveText(`${TOTAL} 件`)
    await expect(rowsOf(page)).toHaveCount(TOTAL)
    await expect(page.getByTestId('users-keyword')).toHaveValue('')
  })

  test('[UM-14] 編集を開くと現在値が入り、社員コード・氏名・所属部店は書き換えられない', async ({
    page,
  }) => {
    await openList(page)
    const dialog = await openEdit(page, firstUser)

    const code = dialog.getByTestId('users-edit-code')
    const name = dialog.getByTestId('users-edit-name')
    const branch = dialog.getByTestId('users-edit-branch')
    await expect(code).toHaveValue(firstUser.操作者コード)
    await expect(name).toHaveValue(firstUser.氏名)
    await expect(branch).toHaveValue(
      `${firstUser.部店コード} ${branchNameOf(firstUser.部店コード)}`,
    )
    for (const input of [code, name, branch]) {
      await expect(input).not.toBeEditable()
    }

    const role = dialog.getByTestId('users-edit-role')
    const active = dialog.getByTestId('users-edit-active')
    await expect(role).toHaveValue(firstUser.ロールコード)
    await expect(active.locator('option:checked')).toHaveText('有効')
    await expect(role).toBeEnabled()
    await expect(active).toBeEnabled()
  })

  test('[UM-15] ロールを変えて保存すると一覧と通知に反映される', async ({ page }) => {
    await openList(page)
    const dialog = await openEdit(page, firstUser)

    await dialog.getByTestId('users-edit-role').selectOption(NEW_ROLE.ロールコード)
    await dialog.getByTestId('users-edit-submit').click()

    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('users-notice')).toHaveText(
      `${firstUser.氏名}の権限設定を更新しました。`,
    )
    await expect(cellOf(rowOf(page, firstUser), 'ロール')).toHaveText(NEW_ROLE.ロール名)
    await expect(page.getByTestId('users-count')).toHaveText(`${TOTAL} 件`)
  })

  test('[UM-16] 状態「すべて」で無効にすると行は残り状態が無効になる', async ({ page }) => {
    await openList(page)
    const dialog = await openEdit(page, deactivateTarget)

    await dialog.getByTestId('users-edit-active').selectOption({ label: '無効' })
    await dialog.getByTestId('users-edit-submit').click()

    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('users-notice')).toBeVisible()
    await expect(cellOf(rowOf(page, deactivateTarget), '状態')).toHaveText('無効')
    await expect(page.getByTestId('users-count')).toHaveText(`${TOTAL} 件`)
  })

  test('[UM-17] 状態「有効」で絞り込み中に無効にすると行が一覧から消える', async ({ page }) => {
    await page.goto(`${PATH}?status=${STATUS_ACTIVE}`)
    await expect(rowsOf(page)).toHaveCount(activeUsers.length)

    const dialog = await openEdit(page, deactivateTarget)
    await dialog.getByTestId('users-edit-active').selectOption({ label: '無効' })
    await dialog.getByTestId('users-edit-submit').click()

    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('users-notice')).toHaveText(
      `${deactivateTarget.氏名}の権限設定を更新しました。`,
    )
    await expect(rowOf(page, deactivateTarget)).toHaveCount(0)
    await expect(page.getByTestId('users-count')).toHaveText(`${activeUsers.length - 1} 件`)
  })

  test('[UM-18] キャンセルすると一覧は変わらず、開き直すと現在値に戻る', async ({ page }) => {
    await openList(page)
    const dialog = await openEdit(page, firstUser)

    await dialog.getByTestId('users-edit-role').selectOption(NEW_ROLE.ロールコード)
    await dialog.getByTestId('users-edit-cancel').click()

    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('users-notice')).toHaveCount(0)
    await expect(cellOf(rowOf(page, firstUser), 'ロール')).toHaveText(firstUser.ロール名)

    const reopened = await openEdit(page, firstUser)
    await expect(reopened.getByTestId('users-edit-role')).toHaveValue(firstUser.ロールコード)
  })

  test('[UM-19] 更新が 400 を返すとモーダルは開いたまま detail が出る', async ({ page }) => {
    await mockApi(page, [
      {
        method: 'put',
        path: '*/api/masters/users/:operatorCode',
        status: 400,
        body: { detail: BAD_ROLE_MESSAGE },
      },
    ])
    await openList(page)

    const dialog = await openEdit(page, firstUser)
    await dialog.getByTestId('users-edit-role').selectOption(NEW_ROLE.ロールコード)
    await dialog.getByTestId('users-edit-submit').click()

    await expect(dialog.getByTestId('users-edit-error')).toContainText(BAD_ROLE_MESSAGE)
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('users-notice')).toHaveCount(0)
    await expect(cellOf(rowOf(page, firstUser), 'ロール')).toHaveText(firstUser.ロール名)
  })

  test('[UM-20] 部店の無い利用者を編集で開くと所属部店は「—」', async ({ page }) => {
    await openList(page)
    const dialog = await openEdit(page, noBranchUser)

    await expect(dialog.getByTestId('users-edit-branch')).toHaveValue('—')
  })

  test('[UM-21] 権限マスタが読めなくても一覧は表示され、選択肢のエラーだけが出る', async ({
    page,
  }) => {
    await mockApi(page, [
      { path: '*/api/masters/permissions', status: 500, body: { detail: ERROR_MESSAGE } },
    ])
    await openList(page)

    const rolesError = page.getByTestId('users-roles-error')
    await expect(rolesError).toContainText('ロールの選択肢を読み込めませんでした')
    await expect(rolesError.getByRole('button', { name: '再読み込み' })).toBeVisible()
    await expect(page.getByTestId('users-count')).toHaveText(`${TOTAL} 件`)
  })
})
