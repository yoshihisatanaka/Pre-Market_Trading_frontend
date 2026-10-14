import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { rolePermissions } from '@/mocks/fixtures/permissions'
import { viewerOperator } from '@/mocks/fixtures/currentOperator'
import {
  EDITABLE_PERMISSION_ITEMS,
  PERMISSION_ITEMS,
  UNSUPPORTED_LABEL,
  permissionBadge,
} from '@/utils/permissionTypes'
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
  canReference: raw.参照権限 === 1,
  canOrder: raw.発注権限 === 1,
  canForceOrder: raw.強制発注権限 === 1,
  canCsvOrder: raw.CSV一括発注権限 === 1,
  canMasterUpdate: raw.マスタ更新権限 === 1,
  canOperation: raw.運用管理権限 === 1,
  canActivityLogView: raw.マスタ更新権限 === 1 || raw.運用管理権限 === 1,
  canUserManagement: raw.ユーザ管理権限 === 1,
})
const allRows = rolePermissions.map(toRow)
const TOTAL = allRows.length

// 編集の対象。発注権限が不可の行（チェックを入れると許可に変わる）
const EDIT_TARGET = allRows.find((row) => !row.canOrder)
// PERMISSION_ITEMS 上の発注権限の位置（権限列は 3 列目から並ぶ）
const ORDER_INDEX = PERMISSION_ITEMS.findIndex((item) => item.key === 'canOrder')
const PERMISSION_COLUMN_OFFSET = 2

/** 契約提案の 4 権限（実 API に保存先が無い）と、その生のキー */
const PROPOSED_ITEMS = PERMISSION_ITEMS.filter((item) => item.proposed)
const PROPOSED_RAW_KEYS = ['参照権限', '強制発注権限', 'CSV一括発注権限', 'ユーザ管理権限']
const DERIVED_ITEM = PERMISSION_ITEMS.find((item) => item.derived)

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'
const CONFLICT_MESSAGE = '他のユーザーによって更新されています。'

const ALLOWED_LABEL = permissionBadge(true).label
const DENIED_LABEL = permissionBadge(false).label
/** セルの文言。未対応（null）はバッジを出さず「—」 */
const cellLabel = (value, item) => permissionBadge(value, item)?.label ?? UNSUPPORTED_LABEL

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
      // モーダル（Teleport to="body"）を wrapper 内に描画させる
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
/** 行の権限 8 列のバッジ文言 */
const badgeTexts = (row) =>
  row
    .findAll('td')
    .slice(PERMISSION_COLUMN_OFFSET, PERMISSION_COLUMN_OFFSET + PERMISSION_ITEMS.length)
    .map((td) => td.text())
const expectedBadges = (row) => PERMISSION_ITEMS.map((item) => cellLabel(row[item.key], item))

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
      '説明',
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
    EDITABLE_PERMISSION_ITEMS.forEach((item) => {
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

  it('[PMV-18] 実 API が契約提案の権限を返さないと「—」になり編集のチェックは押せず送らない', async () => {
    // いまの実 API の形。仕様に無い 4 権限のキーを落とした行を返す
    server.use(
      http.get('*/api/masters/permissions', () =>
        HttpResponse.json({
          roles: rolePermissions.map((raw) =>
            Object.fromEntries(
              Object.entries(raw).filter(([key]) => !PROPOSED_RAW_KEYS.includes(key)),
            ),
          ),
        }),
      ),
    )
    const bodies = []
    server.use(
      http.put('*/api/masters/permissions/:role', async ({ request }) => {
        bodies.push(await request.clone().json())
      }),
    )
    const { wrapper } = await mountView()
    await settle()

    const unsupportedRow = { ...EDIT_TARGET }
    PROPOSED_ITEMS.forEach((item) => {
      unsupportedRow[item.key] = null
    })
    // 提案の 4 列は「—」、ほかの列は従来どおりのバッジ
    expect(badgeTexts(rowOf(wrapper, EDIT_TARGET.role))).toEqual(expectedBadges(unsupportedRow))

    await openEdit(wrapper, EDIT_TARGET.role)
    PROPOSED_ITEMS.forEach((item) => {
      expect(checkbox(wrapper, item.key).attributes('disabled')).toBeDefined()
    })
    expect(checkbox(wrapper, 'canOrder').attributes('disabled')).toBeUndefined()

    await checkbox(wrapper, 'canOrder').setValue(true)
    await editSubmit(wrapper).trigger('click')
    await settle()

    expect(bodies).toHaveLength(1)
    PROPOSED_RAW_KEYS.forEach((key) => {
      expect(bodies[0]).not.toHaveProperty(key)
    })
  })

  it('[PMV-19] 発注なしで発注（強制）を許可して保存するとダイアログ内に不備が出て送らない', async () => {
    const bodies = []
    server.use(
      http.put('*/api/masters/permissions/:role', async ({ request }) => {
        bodies.push(await request.clone().json())
      }),
    )
    const { wrapper } = await mountView()
    await settle()
    await openEdit(wrapper, EDIT_TARGET.role)

    await checkbox(wrapper, 'canForceOrder').setValue(true)
    await editSubmit(wrapper).trigger('click')
    await settle()

    expect(editForm(wrapper).exists()).toBe(true)
    expect(wrapper.find('[data-testid="permissions-edit-validation-error"]').text()).toContain(
      '「発注（強制）」を許可するには「発注」も許可してください。',
    )
    expect(bodies).toHaveLength(0)

    // 発注も許可すれば保存できる
    await checkbox(wrapper, 'canOrder').setValue(true)
    await editSubmit(wrapper).trigger('click')
    await settle()

    expect(editForm(wrapper).exists()).toBe(false)
    expect(bodies).toHaveLength(1)
  })

  it('[PMV-20] 操作ログ閲覧は閲覧可 / 不可で出し、編集ダイアログにはチェックを置かない', async () => {
    const { wrapper } = await mountView()
    await settle()
    const derivedIndex = PERMISSION_ITEMS.indexOf(DERIVED_ITEM)

    allRows.forEach((row) => {
      expect(badgeTexts(rowOf(wrapper, row.role))[derivedIndex]).toBe(
        row.canActivityLogView ? '閲覧可' : DENIED_LABEL,
      )
    })

    await openEdit(wrapper, EDIT_TARGET.role)

    expect(checkbox(wrapper, DERIVED_ITEM.key).exists()).toBe(false)
    expect(wrapper.find('[data-testid="permissions-edit-derived"]').text()).toContain('操作ログ閲覧')
  })
})
