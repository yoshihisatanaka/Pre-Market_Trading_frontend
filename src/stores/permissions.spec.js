import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { rolePermissions } from '@/mocks/fixtures/permissions'
import { viewerOperator } from '@/mocks/fixtures/currentOperator'
import { usePermissionsStore } from './permissions'

/*
 * 期待値はフィクスチャから導く（ロール数・ロールコード・更新日時を直接書かない）。
 * バックエンドのキーは日本語なので、生の形を読むのはこの定義部分だけにする。
 */
const TOTAL = rolePermissions.length
const ROLE_CODES = rolePermissions.map((row) => row.ロールコード)

/** 生の行の 4 権限 → save() に渡す真偽値 */
const flagsOf = (raw) => ({
  canOrder: raw.発注権限 === 1,
  canMasterUpdate: raw.マスタ更新権限 === 1,
  canOperation: raw.運用管理権限 === 1,
  canBranchAll: raw.全店参照権限 === 1,
})

// 保存の対象。発注権限が不可で、合札（更新日時）を持っている行
const TARGET = rolePermissions.find((row) => row.発注権限 === 0 && row.更新日時 !== null)
const TARGET_ROLE = TARGET.ロールコード
const TARGET_FLAGS = flagsOf(TARGET)
const CHANGED_FLAGS = { ...TARGET_FLAGS, canOrder: true }
// 合札を持っていない行（更新日時 を送らない経路）
const NO_TIMESTAMP = rolePermissions.find((row) => row.更新日時 === null)

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'
const CONFLICT_MESSAGE = '他のユーザーによって更新されています。'

const LIST_PATH = '*/api/masters/permissions'
const ITEM_PATH = '*/api/masters/permissions/:role'

/**
 * PUT の本文を覚えるだけのハンドラ。何も返さないので、既定のモックハンドラへ素通しされる
 * （MSW は応答を返さなかったハンドラの次を試す）。
 *
 * @returns {{ bodies: object[] }} 届いた本文の一覧
 */
function capturePut() {
  const captured = { bodies: [] }
  server.use(
    http.put(ITEM_PATH, async ({ request }) => {
      captured.bodies.push(await request.clone().json())
    }),
  )
  return captured
}

// シナリオ: docs/unit/stores-permissions.md
describe('usePermissionsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[PMS-01] load でロール別の権限を読み込む', async () => {
    const store = usePermissionsStore()

    await store.load()

    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
    expect(store.roles.map((row) => row.role)).toEqual(ROLE_CODES)
    rolePermissions.forEach((raw, index) => {
      expect(store.roles[index]).toMatchObject(flagsOf(raw))
    })
  })

  it('[PMS-02] 管理責任者で入っていれば canEdit が true になる', async () => {
    const store = usePermissionsStore()

    await store.load()

    expect(store.canEdit).toBe(true)
  })

  it('[PMS-03] 管理責任者以外で入っていれば canEdit が false で一覧は読める', async () => {
    server.use(http.get('*/api/auth/me', () => HttpResponse.json(viewerOperator)))
    const store = usePermissionsStore()

    await store.load()

    expect(store.canEdit).toBe(false)
    expect(store.roles).toHaveLength(TOTAL)
  })

  it('[PMS-04] /auth/me が失敗しても一覧は読め閲覧のみになる', async () => {
    server.use(
      http.get('*/api/auth/me', () =>
        HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
      ),
    )
    const store = usePermissionsStore()

    await store.load()

    expect(store.error).toBeNull()
    expect(store.canEdit).toBe(false)
    expect(store.roles).toHaveLength(TOTAL)
  })

  it('[PMS-05] 一覧の取得が失敗すると error に入り roles は空になる', async () => {
    server.use(
      http.get(LIST_PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
    )
    const store = usePermissionsStore()

    await store.load()

    expect(store.loading).toBe(false)
    expect(store.error).toBeInstanceOf(Error)
    expect(store.error.status).toBe(500)
    expect(store.error.message).toBe(ERROR_MESSAGE)
    expect(store.roles).toEqual([])
    expect(store.isEmpty).toBe(false)
  })

  it('[PMS-06] ロールが 0 件なら isEmpty が true になる', async () => {
    server.use(http.get(LIST_PATH, () => HttpResponse.json({ roles: [] })))
    const store = usePermissionsStore()

    await store.load()

    expect(store.isEmpty).toBe(true)
  })

  it('[PMS-07] save が成功すると該当行だけが応答の行に差し替わる', async () => {
    const store = usePermissionsStore()
    await store.load()
    const others = store.roles.filter((row) => row.role !== TARGET_ROLE)

    const result = await store.save(TARGET_ROLE, CHANGED_FLAGS)

    expect(store.saveError).toBeNull()
    expect(result.role).toMatchObject({ role: TARGET_ROLE, ...CHANGED_FLAGS })
    expect(result.message).toBe(`${TARGET.ロール名}の権限設定を更新しました。`)
    expect(store.roles.find((row) => row.role === TARGET_ROLE)).toEqual(result.role)
    // 他の行は同じものが残る
    expect(store.roles.filter((row) => row.role !== TARGET_ROLE)).toEqual(others)
  })

  it('[PMS-08] save は手元の行の updatedAt を合札として送る', async () => {
    const captured = capturePut()
    const store = usePermissionsStore()
    await store.load()

    await store.save(TARGET_ROLE, CHANGED_FLAGS)

    expect(captured.bodies).toHaveLength(1)
    expect(captured.bodies[0].更新日時).toBe(TARGET.更新日時)
  })

  it('[PMS-09] 手元の行に updatedAt が無ければ更新日時を送らない', async () => {
    const captured = capturePut()
    const store = usePermissionsStore()
    await store.load()

    await store.save(NO_TIMESTAMP.ロールコード, {
      ...flagsOf(NO_TIMESTAMP),
      canBranchAll: !flagsOf(NO_TIMESTAMP).canBranchAll,
    })

    expect(captured.bodies).toHaveLength(1)
    expect(captured.bodies[0]).not.toHaveProperty('更新日時')
  })

  it('[PMS-10] 同じロールを続けて保存しても 2 回目が 409 にならない', async () => {
    const store = usePermissionsStore()
    await store.load()

    const first = await store.save(TARGET_ROLE, CHANGED_FLAGS)
    const second = await store.save(TARGET_ROLE, TARGET_FLAGS)

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(store.saveError).toBeNull()
    expect(store.roles.find((row) => row.role === TARGET_ROLE)).toMatchObject(TARGET_FLAGS)
  })

  it('[PMS-11] 409 のとき saveError に入り roles は変わらない', async () => {
    server.use(
      http.put(ITEM_PATH, () => HttpResponse.json({ detail: CONFLICT_MESSAGE }, { status: 409 })),
    )
    const store = usePermissionsStore()
    await store.load()
    const before = store.roles

    const result = await store.save(TARGET_ROLE, CHANGED_FLAGS)

    expect(result).toBeNull()
    expect(store.saveError).toBeInstanceOf(Error)
    expect(store.saveError.status).toBe(409)
    expect(store.saveError.message).toBe(CONFLICT_MESSAGE)
    expect(store.roles).toEqual(before)
  })

  it('[PMS-12] 読み込み前の save は何も送らず null を返す', async () => {
    const captured = capturePut()
    const store = usePermissionsStore()

    const result = await store.save(TARGET_ROLE, CHANGED_FLAGS)

    expect(result).toBeNull()
    expect(captured.bodies).toHaveLength(0)
    expect(store.saveError).toBeNull()
  })

  it('[PMS-13] 保存の応答待ちの間だけ saving が true になる', async () => {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    server.use(
      http.put(ITEM_PATH, async () => {
        await gate
      }),
    )
    const store = usePermissionsStore()
    await store.load()
    expect(store.saving).toBe(false)

    const pending = store.save(TARGET_ROLE, CHANGED_FLAGS)
    expect(store.saving).toBe(true)

    // 握りを解くと既定のモックハンドラへ素通しされて応答が返る
    release()
    await pending

    expect(store.saving).toBe(false)
  })

  it('[PMS-14] clearSaveError で保存エラーが消える', async () => {
    server.use(
      http.put(ITEM_PATH, () => HttpResponse.json({ detail: CONFLICT_MESSAGE }, { status: 409 })),
    )
    const store = usePermissionsStore()
    await store.load()
    await store.save(TARGET_ROLE, CHANGED_FLAGS)
    expect(store.saveError).not.toBeNull()

    store.clearSaveError()

    expect(store.saveError).toBeNull()
  })

  it('[PMS-15] 現在値と同じ権限で保存すると変更なしの文言が返り updatedAt は変わらない', async () => {
    const store = usePermissionsStore()
    await store.load()

    const result = await store.save(TARGET_ROLE, TARGET_FLAGS)

    expect(result.message).toBe('変更はありません。')
    expect(store.roles.find((row) => row.role === TARGET_ROLE).updatedAt).toBe(TARGET.更新日時)
  })
})
