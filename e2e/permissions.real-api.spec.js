import { expect, test } from '@playwright/test'
import { apiContext, listHelpers, skipUnlessRealApi } from './helpers/realApi.js'

/*
 * 権限マスタを「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/permissions-real-api.md（タイトル先頭の [PMR-xx] が対応 ID）
 *
 * permissions.spec.js（PM）とは目的が違う。PM は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせだけを見るので、
 * 期待値に**データの中身を書かない**（権限の値は実行時に API から読んで画面と比べる）。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 3 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   3. VITE_USER_CODE を管理責任者（supervisor）の社員コードにしておく（保存は管理責任者のみ）
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test permissions.real-api
 *
 * PMR-02 以降は実 DB のロール別権限を書き換える。ロールは 4 つ固定の共有設定で隔離できないので、
 * beforeAll で対象ロールの値を退避し、各シナリオと afterAll で元に戻す。
 * 更新日時 / 更新者と変更履歴は戻らないので、ローカルの開発 DB 前提。
 */

const PATH = '/masters/permissions'
// 実 API のパス（openapi.json の GET /masters/permissions）
const API_PATH = '/api/masters/permissions'
// 一覧の応答の配列キー（openapi.json の RolePermissionListResponse）
const LIST_KEY = 'roles'

// 権限マスタを変更できるロール（src/stores/permissions.js の EDITOR_ROLE と同じ値）。
// ストアは import.meta を辿る api/client.js に依存しており Playwright からは import できない。
const EDITOR_ROLE = 'supervisor'

const baseURL = process.env.E2E_BASE_URL || 'http://frontend:5173'

/*
 * 権限の 4 列。並びは src/utils/permissionTypes.js の PERMISSION_ITEMS と同じ
 * （utils は日本語キーを持たないので、応答のキーとの対応をここで持つ）。
 * cell は表の列位置（0: ロール / 1: 運用概要 / 2〜5: 権限）。testid は permissions.spec.js と同じ。
 */
const PERMISSIONS = [
  { key: '発注権限', checkbox: 'permissions-edit-can-order', cell: 2 },
  { key: 'マスタ更新権限', checkbox: 'permissions-edit-can-master-update', cell: 3 },
  { key: '運用管理権限', checkbox: 'permissions-edit-can-operation', cell: 4 },
  { key: '全店参照権限', checkbox: 'permissions-edit-can-branch-all', cell: 5 },
]
const [, , OPERATION, BRANCH_ALL] = PERMISSIONS

/** 許可 / 不可のバッジの文言（src/utils/permissionTypes.js の permissionBadge と同じ） */
const badge = (flag) => (flag === 1 ? '許可' : '不可')

const { openList, countOf, rowsOf, expectListConsistent } = listHelpers({
  path: PATH,
  testIdPrefix: 'permissions',
})

/** 書き換える対象のロール（beforeAll で決める）と、その実行前の値 */
let target = null

/** 実 API の roles を全件読む（4 ロール固定でページングは無い） */
async function fetchRoles(api) {
  const res = await api.get(API_PATH)
  expect(res.ok(), `実 API から ${API_PATH} を取得できない。api コンテナが動いているか確認する`).toBe(
    true,
  )
  const body = await res.json()
  expect(Array.isArray(body[LIST_KEY]), `${API_PATH} の応答に配列 ${LIST_KEY} が無い`).toBe(true)
  return body[LIST_KEY]
}

/** API を新しく開いて roles を読み、閉じる */
async function readRoles(playwright) {
  const api = await apiContext(playwright)
  try {
    return await fetchRoles(api)
  } finally {
    await api.dispose()
  }
}

/** 対象ロールの現在の行（API） */
async function readTarget(playwright) {
  const row = (await readRoles(playwright)).find(
    (item) => item.ロールコード === target.ロールコード,
  )
  expect(row, `対象ロール ${target.ロールコード} が実 API の一覧に無い`).toBeTruthy()
  return row
}

/** 表の中の、そのロールの行。並びはサーバの並びのまま（ストアは並べ替えない） */
function roleRow(page, index) {
  return rowsOf(page).nth(index)
}

/** ロールの「編集」を押してダイアログを返す。管理責任者でなければボタンが無い */
async function openEdit(page, role) {
  const button = page.getByTestId(`permissions-edit-${role.ロールコード}`)
  await expect(
    button,
    '「編集」が無い。VITE_USER_CODE が管理責任者（supervisor）の社員コードか確認する',
  ).toBeVisible()
  await button.click()
  const dialog = page.getByRole('dialog', { name: `${role.ロール名}の権限設定` })
  await expect(dialog).toBeVisible()
  return dialog
}

/** ダイアログのチェックを values（日本語キーの 0 / 1）どおりにして保存し、閉じるのを待つ */
async function saveFlags(page, role, values) {
  const dialog = await openEdit(page, role)
  for (const permission of PERMISSIONS) {
    await dialog.getByTestId(permission.checkbox).setChecked(values[permission.key] === 1)
  }
  await dialog.getByTestId('permissions-edit-submit').click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('permissions-notice')).toBeVisible()
}

/** 4 権限だけを抜き出す（比較用） */
function flagsOf(row) {
  return Object.fromEntries(PERMISSIONS.map((permission) => [permission.key, row[permission.key]]))
}

/** 1 つの権限を反転した値 */
function flipped(row, permission) {
  return { ...flagsOf(row), [permission.key]: row[permission.key] === 1 ? 0 : 1 }
}

/** 対象ロールの行の位置（表の nth） */
async function indexOfTarget(playwright) {
  const roles = await readRoles(playwright)
  return roles.findIndex((item) => item.ロールコード === target.ロールコード)
}

// 同じロールを順に書き換えるので直列に実行する
test.describe.configure({ mode: 'serial' })

test.describe('権限マスタ（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test.beforeAll(async ({ playwright }) => {
    // 管理責任者以外の先頭のロールを書き換える。管理責任者のマスタ更新権限を落とすと
    // 操作者が /masters/* に入れなくなり、画面からの復元もできなくなるため
    const roles = await readRoles(playwright)
    target = roles.find((item) => item.ロールコード !== EDITOR_ROLE) ?? null
    expect(target, '管理責任者以外のロールが実 API に無い').toBeTruthy()
  })

  test.afterAll(async ({ browser, playwright }) => {
    if (!target) return
    // 途中で落ちて戻し損ねていたら、画面から戻す（PUT は管理責任者のみで、
    // テストが直接持つ X-User-Code では通らない可能性があるため VITE_USER_CODE で動く画面を使う）
    const current = await readTarget(playwright)
    if (JSON.stringify(flagsOf(current)) === JSON.stringify(flagsOf(target))) return

    const page = await browser.newPage({ baseURL })
    await openList(page)
    await saveFlags(page, target, flagsOf(target))
    await page.close()

    expect(flagsOf(await readTarget(playwright)), '対象ロールの権限を元に戻せなかった').toEqual(
      flagsOf(target),
    )
  })

  test('[PMR-01] 実データで一覧が表示される', async ({ page, playwright }) => {
    await openList(page)
    // ロールは件数が少なくページ送りを出さない画面なので、全件が 1 ページに並ぶ
    const total = await expectListConsistent(page, {
      pageSize: Number.MAX_SAFE_INTEGER,
      pagination: false,
    })
    await expect(page.getByTestId('permissions-pagination')).toHaveCount(0)

    expect(total, '件数表示が実 API の roles の件数と食い違う').toBe(
      (await readRoles(playwright)).length,
    )
  })

  test('[PMR-02] 全店参照権限を変えて保存すると実 API に反映され、元に戻せる', async ({
    page,
    playwright,
  }) => {
    const index = await indexOfTarget(playwright)
    const before = await readTarget(playwright)
    const changed = flipped(before, BRANCH_ALL)

    await openList(page)
    await saveFlags(page, before, changed)

    const cell = roleRow(page, index).getByRole('cell').nth(BRANCH_ALL.cell)
    await expect(cell).toHaveText(badge(changed[BRANCH_ALL.key]))
    // 全店参照権限は任意項目（未指定なら現在値維持）。送り忘れても 200 で通るので API の値で見る
    expect((await readTarget(playwright))[BRANCH_ALL.key]).toBe(changed[BRANCH_ALL.key])

    // 開き直しても保持される（保存後の画面表示だけが更新されているのではない）
    await openList(page)
    await expect(roleRow(page, index).getByRole('cell').nth(BRANCH_ALL.cell)).toHaveText(
      badge(changed[BRANCH_ALL.key]),
    )

    // 元に戻す（スモークの後片付けもここで済ませる）
    await saveFlags(page, before, flagsOf(before))
    await expect(roleRow(page, index).getByRole('cell').nth(BRANCH_ALL.cell)).toHaveText(
      badge(before[BRANCH_ALL.key]),
    )
    expect(flagsOf(await readTarget(playwright))).toEqual(flagsOf(before))
  })

  test('[PMR-03] 各ロールの権限が API の値どおりに許可 / 不可で表示される', async ({
    page,
    playwright,
  }) => {
    await openList(page)
    const roles = await readRoles(playwright)
    await expect(rowsOf(page)).toHaveCount(roles.length)

    for (const [index, role] of roles.entries()) {
      const cells = roleRow(page, index).getByRole('cell')
      await expect(cells.first()).toContainText(role.ロール名)
      for (const permission of PERMISSIONS) {
        await expect(cells.nth(permission.cell)).toHaveText(badge(role[permission.key]))
      }
    }
  })

  test('[PMR-04] 編集できるかが /auth/me のロールで出し分けられる', async ({ page }) => {
    // ブラウザ自身が受け取った応答を見る（テストの X-User-Code ではなく VITE_USER_CODE の操作者）
    const meResponse = page.waitForResponse(
      (res) => new URL(res.url()).pathname === '/api/auth/me' && res.ok(),
    )
    await openList(page)
    const me = await (await meResponse).json()
    const total = await countOf(page)

    const description = page.getByTestId('permissions-description')
    const editButtons = page.getByTestId('permissions-table').getByRole('button', { name: '編集' })

    if (me.ロールコード === EDITOR_ROLE) {
      await expect(description).toContainText('権限設定可能')
      await expect(editButtons).toHaveCount(total)
    } else {
      await expect(description).toContainText('閲覧のみ')
      await expect(
        page.getByTestId('permissions-table').getByRole('columnheader', { name: '操作', exact: true }),
      ).toHaveCount(0)
      await expect(editButtons).toHaveCount(0)
    }
  })

  test('[PMR-05] 編集ダイアログの初期値が API の値と一致する', async ({ page, playwright }) => {
    await openList(page)
    const current = await readTarget(playwright)

    const dialog = await openEdit(page, current)
    for (const permission of PERMISSIONS) {
      const checkbox = dialog.getByTestId(permission.checkbox)
      if (current[permission.key] === 1) {
        await expect(checkbox).toBeChecked()
      } else {
        await expect(checkbox).not.toBeChecked()
      }
    }
  })

  test('[PMR-06] 保存しても説明・触っていない権限・ほかのロールが変わらない', async ({
    page,
    playwright,
  }) => {
    const rolesBefore = await readRoles(playwright)
    const before = rolesBefore.find((item) => item.ロールコード === target.ロールコード)

    await openList(page)
    await saveFlags(page, before, flipped(before, BRANCH_ALL))

    const rolesAfter = await readRoles(playwright)
    const after = rolesAfter.find((item) => item.ロールコード === target.ロールコード)
    expect(after[BRANCH_ALL.key], '保存自体が届いていない').not.toBe(before[BRANCH_ALL.key])
    // 画面は 説明 を送らない。未指定なら現在値維持のはずで、消えていないかを見る
    expect(after.説明).toBe(before.説明)
    for (const permission of PERMISSIONS.filter((item) => item !== BRANCH_ALL)) {
      expect(after[permission.key], `${permission.key} が変わった`).toBe(before[permission.key])
    }
    for (const other of rolesBefore.filter((item) => item.ロールコード !== target.ロールコード)) {
      const otherAfter = rolesAfter.find((item) => item.ロールコード === other.ロールコード)
      expect(flagsOf(otherAfter), `${other.ロールコード} の権限が変わった`).toEqual(flagsOf(other))
    }

    // 元に戻す
    await saveFlags(page, before, flagsOf(before))
    expect(flagsOf(await readTarget(playwright))).toEqual(flagsOf(before))
  })

  test('[PMR-07] 何も変えずに保存しても値と更新日時が変わらない', async ({ page, playwright }) => {
    const before = await readTarget(playwright)

    await openList(page)
    const dialog = await openEdit(page, before)
    await dialog.getByTestId('permissions-edit-submit').click()

    // 文言はサーバの資産なので固定しない（「変更はありません。」は MSW 版の PM-11 が持つ）
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('permissions-notice')).toBeVisible()

    const after = await readTarget(playwright)
    expect(flagsOf(after)).toEqual(flagsOf(before))
    expect(after.更新日時, '変更が無いのに更新日時が進んだ').toBe(before.更新日時)
  })

  test('[PMR-08] 先に別の画面で保存されていると競合で弾かれる', async ({ page, playwright }) => {
    const before = await readTarget(playwright)

    // 画面 A: 編集を開いて、取得時の更新日時を掴んだままにする
    await openList(page)
    const dialogA = await openEdit(page, before)

    // 画面 B: 同じロールを先に保存して更新日時を進める（PUT は管理責任者のみなので画面経由で行う）
    const pageB = await page.context().newPage()
    await openList(pageB)
    const external = flipped(before, BRANCH_ALL)
    await saveFlags(pageB, before, external)
    await pageB.close()

    // 画面 A: B と別の権限を変えて保存する（同じ値を送ると「変更なし」の経路に入りうるため）
    await dialogA.getByTestId(OPERATION.checkbox).setChecked(before[OPERATION.key] !== 1)
    await dialogA.getByTestId('permissions-edit-submit').click()

    // 文言はサーバの資産なので固定しない。拒否が利用者に伝わることだけを見る
    await expect(dialogA.getByTestId('permissions-edit-error')).toBeVisible()
    await expect(dialogA).toBeVisible()
    await expect(page.getByTestId('permissions-notice')).toHaveCount(0)

    // 先勝ちした B の値が残り、A の運用管理権限は入っていない
    expect(flagsOf(await readTarget(playwright))).toEqual(external)

    // 元に戻す（A のダイアログを閉じて開き直し、最新の更新日時で保存する）
    await dialogA.getByTestId('permissions-edit-cancel').click()
    await openList(page)
    await saveFlags(page, before, flagsOf(before))
    expect(flagsOf(await readTarget(playwright))).toEqual(flagsOf(before))
  })
})
