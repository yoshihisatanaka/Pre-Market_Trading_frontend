import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { rolePermissions } from '@/mocks/fixtures/permissions'
import { fetchPermissions, updateRolePermission } from './permissions'

/*
 * API 層のテスト。ここだけが「バックエンドの形」を知ってよい層なので、
 * **送り出すリクエストそのもの** を docs/api/openapi.json の RolePermissionUpdateRequest と突き合わせる。
 */

/** 最後に届いたリクエストを覚えておくための入れ物 */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

/**
 * リクエストを記録して、指定の本文を返すハンドラを立てる。
 *
 * @param {'get'|'put'} method
 * @param {string} path `*` 始まりのパス
 * @param {unknown} body 返す本文
 * @param {number} [status]
 */
function record(method, path, body, status = 200) {
  server.use(
    http[method](path, async ({ request }) => {
      const url = new URL(request.url)
      lastRequest = {
        url,
        params: url.searchParams,
        headers: request.headers,
        // GET は本文が無いので読まない
        body: method === 'put' ? await request.json() : null,
      }
      return HttpResponse.json(body, { status })
    }),
  )
}

const LIST_PATH = '*/api/masters/permissions'
const ITEM_PATH = '*/api/masters/permissions/:role'

/** フィクスチャ（生の形）→ アプリ内モデルの期待値 */
const toModel = (raw) => ({
  id: raw.ID,
  role: raw.ロールコード,
  roleLabel: raw.ロール名,
  description: raw.説明 ?? '',
  canOrder: raw.発注権限 === 1,
  canMasterUpdate: raw.マスタ更新権限 === 1,
  canOperation: raw.運用管理権限 === 1,
  canBranchAll: raw.全店参照権限 === 1,
  updatedAt: raw.更新日時 ?? '',
})

// 合札を持っている行（更新日時 を送る経路）と、持っていない行（送らない経路）
const WITH_TIMESTAMP = rolePermissions.find((row) => row.更新日時 !== null)
const WITHOUT_TIMESTAMP = rolePermissions.find((row) => row.更新日時 === null)

/** updateRolePermission() に渡す値。0 / 1 の両方が本文に出るよう混ぜる */
const updateArgs = {
  canOrder: true,
  canMasterUpdate: false,
  canOperation: true,
  canBranchAll: false,
  updatedAt: WITH_TIMESTAMP.更新日時,
}

const itemBody = (raw, message = 'ok') => ({ success: true, role: raw, message })

// シナリオ: docs/unit/api-permissions.md
describe('api/permissions', () => {
  it('[PMA-01] 取得は /masters/permissions をクエリなしで呼ぶ', async () => {
    record('get', LIST_PATH, { roles: rolePermissions })

    await fetchPermissions()

    expect(lastRequest.url.pathname).toBe('/api/masters/permissions')
    expect([...lastRequest.params.keys()]).toEqual([])
  })

  it('[PMA-02] 日本語キーと 0/1 の応答が camelCase と真偽値のモデルに変換される', async () => {
    record('get', LIST_PATH, { roles: rolePermissions })

    const roles = await fetchPermissions()

    expect(roles).toEqual(rolePermissions.map(toModel))
  })

  it('[PMA-03] 説明と更新日時が null のときは空文字になる', async () => {
    record('get', LIST_PATH, { roles: [{ ...WITH_TIMESTAMP, 説明: null, 更新日時: null }] })

    const [role] = await fetchPermissions()

    expect(role.description).toBe('')
    expect(role.updatedAt).toBe('')
  })

  it('[PMA-04] 欠けている権限は false と読む', async () => {
    // 全部許可の行から 4 権限のキーだけを落とす（値が 1 のまま残っていれば true になってしまう行）
    const allowed = rolePermissions.find((row) => row.発注権限 === 1 && row.全店参照権限 === 1)
    const flagKeys = ['発注権限', 'マスタ更新権限', '運用管理権限', '全店参照権限']
    const missing = Object.fromEntries(
      Object.entries(allowed).filter(([key]) => !flagKeys.includes(key)),
    )
    record('get', LIST_PATH, { roles: [missing] })

    const [role] = await fetchPermissions()

    expect(role).toMatchObject({
      canOrder: false,
      canMasterUpdate: false,
      canOperation: false,
      canBranchAll: false,
    })
  })

  it('[PMA-05] roles の無い本文は空配列になる', async () => {
    record('get', LIST_PATH, {})

    await expect(fetchPermissions()).resolves.toEqual([])
  })

  it('[PMA-06] 更新の本文が 4 権限の 0/1 と更新日時になり説明は送らない', async () => {
    record('put', ITEM_PATH, itemBody(WITH_TIMESTAMP))

    await updateRolePermission(WITH_TIMESTAMP.ロールコード, updateArgs)

    expect(lastRequest.url.pathname).toBe(
      `/api/masters/permissions/${WITH_TIMESTAMP.ロールコード}`,
    )
    expect(lastRequest.body).toEqual({
      発注権限: 1,
      マスタ更新権限: 0,
      運用管理権限: 1,
      全店参照権限: 0,
      更新日時: updateArgs.updatedAt,
    })
  })

  it('[PMA-07] updatedAt が空のときは更新日時を送らない', async () => {
    record('put', ITEM_PATH, itemBody(WITHOUT_TIMESTAMP))

    await updateRolePermission(WITHOUT_TIMESTAMP.ロールコード, { ...updateArgs, updatedAt: '' })

    expect(lastRequest.body).not.toHaveProperty('更新日時')
  })

  it('[PMA-08] パスのロールコードは URL エンコードされる', async () => {
    record('put', ITEM_PATH, itemBody(WITH_TIMESTAMP))

    await updateRolePermission('a/b', updateArgs)

    expect(lastRequest.url.pathname).toBe('/api/masters/permissions/a%2Fb')
  })

  it('[PMA-09] 更新の戻り値は更新後の行のモデルとサーバの文言になる', async () => {
    const updated = { ...WITH_TIMESTAMP, 発注権限: 1, 更新日時: '2026-09-25 09:00:00' }
    const message = `${updated.ロール名}の権限設定を更新しました。`
    record('put', ITEM_PATH, itemBody(updated, message))

    const result = await updateRolePermission(WITH_TIMESTAMP.ロールコード, updateArgs)

    expect(result).toEqual({ role: toModel(updated), message })
  })

  it('[PMA-10] 存在しないロールは 404 の ApiError になる', async () => {
    // 既定のモックハンドラが未知のロールを 404（detail にロールコードを含む）で拒む
    const unknownRole = 'unknown'
    expect(rolePermissions.some((row) => row.ロールコード === unknownRole)).toBe(false)

    const error = await updateRolePermission(unknownRole, updateArgs).catch((caught) => caught)

    expect(error.status).toBe(404)
    expect(error.message).toContain(unknownRole)
  })

  it('[PMA-11] 更新に X-User-Code ヘッダが載る', async () => {
    record('put', ITEM_PATH, itemBody(WITH_TIMESTAMP))

    await updateRolePermission(WITH_TIMESTAMP.ロールコード, updateArgs)

    expect(lastRequest.headers.get('X-User-Code')).toBeTruthy()
  })
})
