import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { rolePermissions } from '@/mocks/fixtures/permissions'
import { viewerOperator } from '@/mocks/fixtures/currentOperator'
import { PERMISSION_ITEMS, permissionBadge } from '@/utils/permissionTypes'
import PermissionListView from './PermissionListView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 4 状態の出し分け・編集可否による列の出し分け・編集ダイアログの保存 / 失敗 / キャンセルを検証する。
 */
const PATH = '/masters/permissions'

/*
 * フィクスチャはバックエンドの生の形（日本語キー・権限は 0 / 1）なので、
 * 期待値は toRow でアプリ内モデルの形（api 層が返す形）に直してから使う。
 */
const toRow = (raw) => ({
  role: raw.ロールコード,
  roleLabel: raw.ロール名,
  description: raw.説明 ?? '',
  canOrder: raw.発注権限 === 1,
  canMasterUpdate: raw.マスタ更新権限 === 1,
  canOperation: raw.運用管理権限 === 1,
  canBranchAll: raw.全店参照権限 === 1,
})
const allRows = rolePermissions.map(toRow)
const TOTAL = allRows.length

// 編集の対象。発注権限が不可の行（チェックを入れると許可に変わる）
const EDIT_TARGET = allRows.find((row) => !row.canOrder)
// PERMISSION_ITEMS 上の発注権限の位置（権限列は 3 列目から並ぶ）
const ORDER_INDEX = PERMISSION_ITEMS.findIndex((item) => item.key === 'canOrder')
const PERMISSION_COLUMN_OFFSET = 2

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'
const CONFLICT_MESSAGE = '他のユーザーによって更新されています。'

const ALLOWED_LABEL = permissionBadge(true).label
const DENIED_LABEL = permissionBadge(false).label

const Page = { render: () => h('div') }

async function mountView() {
  // 実 router/index.js は createWebHistory 固定で差し替えられないため、テスト用に最小定義する
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: PATH, component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push(PATH)

  const wrapper = mount(PermissionListView, {
    global: {
      plugins: [createPinia(), router],
      // ヘッダへ差し込む「再読み込み」とモーダル（Teleport to="body"）を wrapper 内に描画させる
      stubs: { teleport: true },
    },
  })
  return { wrapper, router }
}

/** 取得 → 反映までを待つ */
async function settle() {
  await flushPromises()
  await flushPromises()
}

const exists = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).exists()
const rows = (wrapper) => wrapper.findAll('[data-testid="data-table-row"]')
const headers = (wrapper) => wrapper.findAll('th').map((th) => th.text())
const countText = (wrapper) => wrapper.find('[data-testid="permissions-count"]').text()
const descriptionHeading = (wrapper) =>
  wrapper.find('[data-testid="permissions-description"] strong').text()
const rowOf = (wrapper, role) => rows(wrapper)[allRows.findIndex((row) => row.role === role)]
/** 行の権限 4 列のバッジ文言 */
const badgeTexts = (row) =>
  row
    .findAll('td')
    .slice(PERMISSION_COLUMN_OFFSET, PERMISSION_COLUMN_OFFSET + PERMISSION_ITEMS.length)
    .map((td) => td.text())
const expectedBadges = (row) => PERMISSION_ITEMS.map((item) => permissionBadge(row[item.key]).label)

const editButton = (wrapper, role) => wrapper.find(`[data-testid="permissions-edit-${role}"]`)
const editForm = (wrapper) => wrapper.find('[data-testid="permissions-edit-form"]')
const editSubmit = (wrapper) => wrapper.find('[data-testid="permissions-edit-submit"]')
const editCancel = (wrapper) => wrapper.find('[data-testid="permissions-edit-cancel"]')
const dialog = (wrapper) => wrapper.find('[role="dialog"]')
/** canOrder → permissions-edit-can-order（PermissionCheckList が <input> に付ける） */
const checkbox = (wrapper, key) =>
  wrapper.find(
    `[data-testid="permissions-edit-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}"]`,
  )
const notice = (wrapper) => wrapper.find('[data-testid="permissions-notice"]')

const listErrorHandler = (options) =>
  http.get(
    '*/api/masters/permissions',
    () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
    options,
  )
const emptyHandler = (options) =>
  http.get('*/api/masters/permissions', () => HttpResponse.json({ roles: [] }), options)
const conflictHandler = () =>
  http.put('*/api/masters/permissions/:role', () =>
    HttpResponse.json({ detail: CONFLICT_MESSAGE }, { status: 409 }),
  )

/**
 * 指定のリクエストを握るハンドラ。解放すると既定のモックハンドラへ素通しされる
 * （MSW は応答を返さなかったハンドラの次を試す）。
 *
 * @param {'get'|'put'} method
 * @param {string} path `*` 始まりのパス
 * @returns {() => void} 呼ぶと応答が返る
 */
function gate(method, path) {
  let release
  const gatePromise = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http[method](path, async () => {
      await gatePromise
    }),
  )
  return release
}

async function openEdit(wrapper, role) {
  await editButton(wrapper, role).trigger('click')
}

// シナリオ: docs/unit/views-permission-list-view.md
describe('PermissionListView', () => {
  it('[PMV-01] 取得中はローディングを表示する', async () => {
    const release = gate('get', '*/api/masters/permissions')
    const { wrapper } = await mountView()
    await flushPromises()

    expect(exists(wrapper, 'permissions-loading')).toBe(true)
    expect(exists(wrapper, 'permissions-table')).toBe(false)
    expect(exists(wrapper, 'permissions-empty')).toBe(false)
    expect(exists(wrapper, 'permissions-error')).toBe(false)

    release()
    await settle()
  })

  it('[PMV-02] 取得が 500 のときはエラーと再試行を表示する', async () => {
    server.use(listErrorHandler())
    const { wrapper } = await mountView()
    await settle()

    const error = wrapper.find('[data-testid="permissions-error"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'permissions-table')).toBe(false)
  })

  it('[PMV-03] ロールが 0 件のときは空状態を表示する', async () => {
    server.use(emptyHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(wrapper.find('[data-testid="permissions-empty"]').text()).toBe(
      'ロールが登録されていません。',
    )
    expect(exists(wrapper, 'permissions-table')).toBe(false)
  })

  it('[PMV-04] 既定モックでロールの行と権限のバッジを表示する', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(countText(wrapper)).toBe(`${TOTAL} ロール`)
    expect(rows(wrapper)).toHaveLength(TOTAL)
    allRows.forEach((expected, index) => {
      const row = rows(wrapper)[index]
      expect(row.text()).toContain(expected.roleLabel)
      expect(row.text()).toContain(expected.role)
      expect(row.text()).toContain(expected.description)
      expect(badgeTexts(row)).toEqual(expectedBadges(expected))
    })
  })

  it('[PMV-05] エラーから再試行すると一覧を表示する', async () => {
    server.use(listErrorHandler({ once: true }))
    const { wrapper } = await mountView()
    await settle()
    expect(exists(wrapper, 'permissions-error')).toBe(true)

    await wrapper.find('[data-testid="permissions-error"] button').trigger('click')
    await settle()

    expect(exists(wrapper, 'permissions-error')).toBe(false)
    expect(rows(wrapper)).toHaveLength(TOTAL)
  })

  it('[PMV-06] 管理責任者では操作列と編集ボタンが出て注記は権限設定可能になる', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(headers(wrapper)).toEqual([
      'ロール',
      '運用概要',
      ...PERMISSION_ITEMS.map((item) => item.columnLabel),
      '操作',
    ])
    expect(allRows.every((row) => editButton(wrapper, row.role).exists())).toBe(true)
    expect(descriptionHeading(wrapper)).toBe('権限設定可能')
  })

  it('[PMV-07] 管理責任者以外では操作列も編集ボタンも出ず注記は閲覧のみになる', async () => {
    server.use(http.get('*/api/auth/me', () => HttpResponse.json(viewerOperator)))
    const { wrapper } = await mountView()
    await settle()

    expect(rows(wrapper)).toHaveLength(TOTAL)
    expect(headers(wrapper)).not.toContain('操作')
    expect(allRows.some((row) => editButton(wrapper, row.role).exists())).toBe(false)
    expect(descriptionHeading(wrapper)).toBe('閲覧のみ')
  })

  it('[PMV-08] /auth/me が失敗しても一覧は出て閲覧のみになる', async () => {
    server.use(
      http.get('*/api/auth/me', () =>
        HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
      ),
    )
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'permissions-error')).toBe(false)
    expect(rows(wrapper)).toHaveLength(TOTAL)
    expect(headers(wrapper)).not.toContain('操作')
    expect(descriptionHeading(wrapper)).toBe('閲覧のみ')
  })

  it('[PMV-09] 編集を押すとその行の権限が入ったダイアログが開く', async () => {
    const { wrapper } = await mountView()
    await settle()
    expect(editForm(wrapper).exists()).toBe(false)

    await openEdit(wrapper, EDIT_TARGET.role)

    expect(editForm(wrapper).exists()).toBe(true)
    expect(dialog(wrapper).attributes('aria-label')).toBe(`${EDIT_TARGET.roleLabel}の権限設定`)
    PERMISSION_ITEMS.forEach((item) => {
      expect(checkbox(wrapper, item.key).element.checked).toBe(EDIT_TARGET[item.key])
    })
  })

  it('[PMV-10] 権限を変えて保存するとダイアログが閉じ通知が出てバッジが変わる', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openEdit(wrapper, EDIT_TARGET.role)

    await checkbox(wrapper, 'canOrder').setValue(true)
    await editSubmit(wrapper).trigger('click')
    await settle()

    expect(editForm(wrapper).exists()).toBe(false)
    expect(notice(wrapper).text()).toBe(`${EDIT_TARGET.roleLabel}の権限設定を更新しました。`)
    expect(badgeTexts(rowOf(wrapper, EDIT_TARGET.role))[ORDER_INDEX]).toBe(ALLOWED_LABEL)
  })

  it('[PMV-11] 何も変えずに保存すると変更なしの通知が出る', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openEdit(wrapper, EDIT_TARGET.role)

    await editSubmit(wrapper).trigger('click')
    await settle()

    expect(editForm(wrapper).exists()).toBe(false)
    expect(notice(wrapper).text()).toBe('変更はありません。')
    expect(badgeTexts(rowOf(wrapper, EDIT_TARGET.role))).toEqual(expectedBadges(EDIT_TARGET))
  })

  it('[PMV-12] 保存が 409 のときダイアログ内にエラーが出て一覧は変わらない', async () => {
    server.use(conflictHandler())
    const { wrapper } = await mountView()
    await settle()
    await openEdit(wrapper, EDIT_TARGET.role)

    await checkbox(wrapper, 'canOrder').setValue(true)
    await editSubmit(wrapper).trigger('click')
    await settle()

    expect(editForm(wrapper).exists()).toBe(true)
    expect(wrapper.find('[data-testid="permissions-edit-error"]').text()).toContain(
      CONFLICT_MESSAGE,
    )
    expect(notice(wrapper).exists()).toBe(false)
    expect(badgeTexts(rowOf(wrapper, EDIT_TARGET.role))[ORDER_INDEX]).toBe(DENIED_LABEL)
  })

  it('[PMV-13] キャンセルすると一覧は変わらず開き直すと元の値に戻っている', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openEdit(wrapper, EDIT_TARGET.role)
    await checkbox(wrapper, 'canOrder').setValue(true)

    await editCancel(wrapper).trigger('click')

    expect(editForm(wrapper).exists()).toBe(false)
    expect(badgeTexts(rowOf(wrapper, EDIT_TARGET.role))).toEqual(expectedBadges(EDIT_TARGET))

    await openEdit(wrapper, EDIT_TARGET.role)

    expect(checkbox(wrapper, 'canOrder').element.checked).toBe(EDIT_TARGET.canOrder)
  })

  it('[PMV-14] 保存失敗の後に開き直すと前回のエラーが出ていない', async () => {
    server.use(conflictHandler())
    const { wrapper } = await mountView()
    await settle()
    await openEdit(wrapper, EDIT_TARGET.role)
    await checkbox(wrapper, 'canOrder').setValue(true)
    await editSubmit(wrapper).trigger('click')
    await settle()
    expect(exists(wrapper, 'permissions-edit-error')).toBe(true)

    await editCancel(wrapper).trigger('click')
    await openEdit(wrapper, EDIT_TARGET.role)

    expect(editForm(wrapper).exists()).toBe(true)
    expect(exists(wrapper, 'permissions-edit-error')).toBe(false)
  })

  it('[PMV-15] 保存中は「保存中…」になり保存もキャンセルも押せない', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openEdit(wrapper, EDIT_TARGET.role)
    await checkbox(wrapper, 'canOrder').setValue(true)

    const release = gate('put', '*/api/masters/permissions/:role')
    await editSubmit(wrapper).trigger('click')
    await flushPromises()

    expect(editSubmit(wrapper).text()).toBe('保存中…')
    expect(editSubmit(wrapper).attributes('disabled')).toBeDefined()
    expect(editCancel(wrapper).attributes('disabled')).toBeDefined()

    release()
    await settle()

    expect(editForm(wrapper).exists()).toBe(false)
  })

  it('[PMV-16] 再読み込みで通知が消え一覧を表示する', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openEdit(wrapper, EDIT_TARGET.role)
    await checkbox(wrapper, 'canOrder').setValue(true)
    await editSubmit(wrapper).trigger('click')
    await settle()
    expect(notice(wrapper).exists()).toBe(true)

    await wrapper.find('[data-testid="permissions-reload"]').trigger('click')
    await settle()

    expect(notice(wrapper).exists()).toBe(false)
    expect(rows(wrapper)).toHaveLength(TOTAL)
  })

  it('[PMV-17] 画面の注記は 4 状態のいずれでも表示される', async () => {
    // ローディング中
    const release = gate('get', '*/api/masters/permissions')
    const loadingView = await mountView()
    await flushPromises()
    expect(exists(loadingView.wrapper, 'permissions-loading')).toBe(true)
    expect(exists(loadingView.wrapper, 'permissions-description')).toBe(true)

    // データあり
    release()
    await settle()
    expect(rows(loadingView.wrapper)).toHaveLength(TOTAL)
    expect(exists(loadingView.wrapper, 'permissions-description')).toBe(true)

    // エラー
    server.use(listErrorHandler({ once: true }))
    const errorView = await mountView()
    await settle()
    expect(exists(errorView.wrapper, 'permissions-error')).toBe(true)
    expect(exists(errorView.wrapper, 'permissions-description')).toBe(true)

    // 空
    server.use(emptyHandler({ once: true }))
    const emptyView = await mountView()
    await settle()
    expect(exists(emptyView.wrapper, 'permissions-empty')).toBe(true)
    expect(exists(emptyView.wrapper, 'permissions-description')).toBe(true)
  })
})
