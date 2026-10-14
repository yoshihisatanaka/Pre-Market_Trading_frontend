import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { users } from '@/mocks/fixtures/users'
import { rolePermissions } from '@/mocks/fixtures/permissions'
import { USER_STATUS_ACTIVE, USERS_PAGE_SIZE, useUsersStore } from './users'

/*
 * 既定の MSW ハンドラ（src/mocks/handlers/users.js）に当てる。
 * 期待値はフィクスチャと表示件数から導き、件数や社員コードを直接書かない。
 */

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const codesOf = (rows) => rows.map((row) => row.操作者コード)
const itemCodes = (store) => store.items.map((item) => item.code)

const activeUsers = users.filter((user) => user.有効フラグ === 1)
const inactiveUser = users.find((user) => user.有効フラグ !== 1)

/** 受注者コードを持つ有効な操作者（更新で送り返されることを見る） */
const withOrderTaker = users.find((user) => user.受注者コード && user.有効フラグ === 1)

/** 一覧の 1 件 → update の引数（画面が組み立てるのと同じ形） */
const toPayload = (item, overrides = {}) => ({
  code: item.code,
  name: item.name,
  roleCode: item.roleCode,
  branchCode: item.branchCode,
  orderTakerCode: item.orderTakerCode,
  active: item.active,
  ...overrides,
})

/** 1 ページ目を読み込んだストア */
async function loadedStore() {
  const store = useUsersStore()
  await store.load()
  return store
}

// シナリオ: docs/unit/stores-users.md
describe('stores/users', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[USS-01] 既定の読み込みは無効を含む全員が並びどおりに入る', async () => {
    // 無効な操作者がいないと「すべて」が既定であることを確かめられない
    expect(inactiveUser).toBeDefined()

    const store = await loadedStore()

    expect(itemCodes(store)).toEqual(codesOf(users))
    expect(store.total).toBe(users.length)
    expect(store.limit).toBe(USERS_PAGE_SIZE)
    expect(store.offset).toBe(0)
  })

  it('[USS-02] offset を渡すとその位置から読み込む', async () => {
    const offset = 2
    const store = useUsersStore()

    await store.load({ offset })

    expect(store.offset).toBe(offset)
    expect(itemCodes(store)).toEqual(codesOf(users.slice(offset)))
    expect(store.total).toBe(users.length)
  })

  it('[USS-03] 状態「有効」では無効な操作者を含めない', async () => {
    const store = useUsersStore()

    await store.load({ status: USER_STATUS_ACTIVE })

    expect(store.status).toBe(USER_STATUS_ACTIVE)
    expect(itemCodes(store)).toEqual(codesOf(activeUsers))
    expect(itemCodes(store)).not.toContain(inactiveUser.操作者コード)
  })

  it('[USS-04] 所属部店・ロールで絞り込む（無効も含む）', async () => {
    const branchCode = inactiveUser.部店コード
    const role = inactiveUser.ロールコード
    const store = useUsersStore()

    await store.load({ branchCode })
    expect(store.branchCode).toBe(branchCode)
    expect(itemCodes(store)).toEqual(codesOf(users.filter((user) => user.部店コード === branchCode)))
    expect(itemCodes(store)).toContain(inactiveUser.操作者コード)

    await store.load({ role })
    expect(store.role).toBe(role)
    expect(itemCodes(store)).toEqual(codesOf(users.filter((user) => user.ロールコード === role)))
  })

  it('[USS-05] キーワードは社員コードにも氏名にも当たる（部分一致）', async () => {
    const target = users[0]
    const byCode = target.操作者コード.slice(-2)
    const byName = target.氏名.slice(0, 2)
    const store = useUsersStore()

    await store.load({ keyword: byCode })
    expect(itemCodes(store)).toEqual(
      codesOf(users.filter((user) => user.操作者コード.includes(byCode) || user.氏名?.includes(byCode))),
    )

    await store.load({ keyword: byName })
    expect(store.keyword).toBe(byName)
    expect(itemCodes(store)).toEqual(
      codesOf(users.filter((user) => user.操作者コード.includes(byName) || user.氏名?.includes(byName))),
    )
    expect(itemCodes(store)).toContain(target.操作者コード)
  })

  it('[USS-06] 当たらないキーワードでは空になる', async () => {
    const store = useUsersStore()

    await store.load({ keyword: '該当なし' })

    expect(store.items).toEqual([])
    expect(store.total).toBe(0)
    expect(store.isEmpty).toBe(true)
  })

  it('[USS-07] 一覧の失敗は error に入り、空とは区別される', async () => {
    server.use(
      http.get('*/api/masters/users', () =>
        HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
      ),
    )
    const store = useUsersStore()

    await store.load()

    expect(store.error.message).toBe(ERROR_MESSAGE)
    expect(store.items).toEqual([])
    expect(store.isEmpty).toBe(false)
    expect(store.loading).toBe(false)
  })

  it('[USS-08] 編集だけを公開し、追加・削除は持たない', () => {
    const store = useUsersStore()

    expect(typeof store.update).toBe('function')
    expect(store.updating).toBe(false)
    expect(store.updateError).toBeNull()
    expect(store.create).toBeUndefined()
    expect(store.remove).toBeUndefined()
  })

  it('[USS-09] ロールを変えて更新すると、受注者コードを保ったまま一覧に反映される', async () => {
    expect(withOrderTaker).toBeDefined()
    const nextRole = rolePermissions.find((row) => row.ロールコード !== withOrderTaker.ロールコード)
    const store = await loadedStore()
    const item = store.items.find((row) => row.code === withOrderTaker.操作者コード)

    const updated = await store.update(toPayload(item, { roleCode: nextRole.ロールコード }))

    expect(updated).toMatchObject({
      code: withOrderTaker.操作者コード,
      roleCode: nextRole.ロールコード,
      roleName: nextRole.ロール名,
      orderTakerCode: withOrderTaker.受注者コード,
    })
    const reloaded = store.items.find((row) => row.code === withOrderTaker.操作者コード)
    expect(reloaded.roleCode).toBe(nextRole.ロールコード)
    expect(reloaded.orderTakerCode).toBe(withOrderTaker.受注者コード)
    expect(store.total).toBe(users.length)
  })

  it('[USS-10] 更新の 400 は updateError に入り、一覧は変わらない', async () => {
    const detail = 'ロールコードが不正です: xxx'
    server.use(
      http.put('*/api/masters/users/:operatorCode', () =>
        HttpResponse.json({ detail }, { status: 400 }),
      ),
    )
    const store = await loadedStore()
    const before = store.items.map((item) => ({ ...item }))

    const result = await store.update(toPayload(store.items[0], { roleCode: 'xxx' }))

    expect(result).toBeNull()
    expect(store.updateError.message).toBe(detail)
    expect(store.items).toEqual(before)
  })

  it('[USS-11] ロールの選択肢は権限マスタの並びで value / label になる', async () => {
    const store = useUsersStore()
    expect(store.roleOptions).toEqual([])

    await store.loadRoles()

    expect(store.roleOptions).toEqual(
      rolePermissions.map((row) => ({ value: row.ロールコード, label: row.ロール名 })),
    )
  })

  it('[USS-12] ロールの選択肢の失敗は rolesError にだけ入る', async () => {
    server.use(
      http.get('*/api/masters/permissions', () =>
        HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
      ),
    )
    const store = useUsersStore()

    await store.loadRoles()

    expect(store.rolesError.message).toBe(ERROR_MESSAGE)
    expect(store.roleOptions).toEqual([])
    expect(store.error).toBeNull()
  })
})
