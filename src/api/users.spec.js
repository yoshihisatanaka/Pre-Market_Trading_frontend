import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { users } from '@/mocks/fixtures/users'
import { rolePermissions } from '@/mocks/fixtures/permissions'
import { fetchUsers, updateUser } from './users'

/*
 * API 層のテスト。ここだけが「バックエンドの形」を知ってよい層なので、
 * **送り出すリクエストそのもの** と、日本語キーからアプリ内モデルへの変換を検証する。
 * 期待値はフィクスチャ（users。004 だけ無効）から導く。
 */

const USERS_PATH = '*/api/masters/users'

/** 最後に届いたリクエスト */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

/**
 * リクエストを記録して、指定の本文を返すハンドラを立てる。
 *
 * @param {unknown} body 返す本文
 * @param {number} [status]
 */
function record(body, status = 200) {
  server.use(
    http.get(USERS_PATH, ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams }
      return HttpResponse.json(body, { status })
    }),
  )
}

const listBody = (rows) => ({ total: rows.length, limit: 50, offset: 0, operators: rows })

/** OperatorItem → User の期待値 */
const toExpected = (raw) => ({
  id: raw.ID,
  code: raw.操作者コード,
  name: raw.氏名 ?? '',
  roleCode: raw.ロールコード,
  roleName: raw.ロール名 ?? '',
  branchCode: raw.部店コード ?? '',
  orderTakerCode: raw.受注者コード ?? '',
  active: raw.有効フラグ === 1,
  updatedAt: raw.更新日時 ?? '',
  updatedBy: raw.更新者 ?? '',
})

/** 最後に届いた更新リクエスト */
let lastPut = null

afterEach(() => {
  lastPut = null
})

/**
 * 更新リクエストを記録して、指定の本文を返すハンドラを立てる。
 *
 * @param {unknown} body 返す本文
 * @param {number} [status]
 */
function recordPut(body, status = 200) {
  server.use(
    http.put(`${USERS_PATH}/:operatorCode`, async ({ request }) => {
      lastPut = { url: new URL(request.url), body: await request.json() }
      return HttpResponse.json(body, { status })
    }),
  )
}

/** 受注者コードを持つ有効な操作者（受注者コードを送り返すことを見るため） */
const withOrderTaker = users.find((user) => user.受注者コード && user.有効フラグ === 1)

/** フィクスチャの 1 行 → updateUser の引数 */
const toUpdateArgs = (raw) => ({
  code: raw.操作者コード,
  name: raw.氏名 ?? '',
  roleCode: raw.ロールコード,
  branchCode: raw.部店コード ?? '',
  orderTakerCode: raw.受注者コード ?? '',
  active: raw.有効フラグ === 1,
})

const activeUsers = users.filter((user) => user.有効フラグ === 1)
const inactiveUser = users.find((user) => user.有効フラグ !== 1)

// シナリオ: docs/unit/api-users.md
describe('api/users', () => {
  it('[USA-01] 引数なしの一覧取得は limit と offset だけを送る', async () => {
    record(listBody([]))

    await fetchUsers()

    expect(lastRequest.url.pathname).toBe('/api/masters/users')
    expect(lastRequest.params.get('limit')).toBe('50')
    expect(lastRequest.params.get('offset')).toBe('0')
    expect([...lastRequest.params.keys()]).toEqual(['limit', 'offset'])
  })

  it('[USA-02] 条件は仕様のクエリ名で送り、それ以外は送らない', async () => {
    record(listBody([]))
    const sample = users[0]
    const conditions = {
      role: sample.ロールコード,
      branchCode: sample.部店コード,
      includeInactive: true,
      limit: 200,
      offset: 10,
    }

    await fetchUsers(conditions)

    expect(lastRequest.params.get('role')).toBe(conditions.role)
    expect(lastRequest.params.get('branch_code')).toBe(conditions.branchCode)
    expect(lastRequest.params.get('include_inactive')).toBe('true')
    expect(lastRequest.params.get('limit')).toBe(String(conditions.limit))
    expect(lastRequest.params.get('offset')).toBe(String(conditions.offset))
    expect([...lastRequest.params.keys()].sort()).toEqual(
      ['branch_code', 'include_inactive', 'limit', 'offset', 'role'].sort(),
    )
  })

  it('[USA-03] 空の条件と include_inactive=false はクエリに載せない', async () => {
    record(listBody([]))

    await fetchUsers({ role: '', branchCode: '', includeInactive: false })

    expect([...lastRequest.params.keys()]).toEqual(['limit', 'offset'])
  })

  it('[USA-04] 無効を含めた全員をアプリ内モデルに変換する', async () => {
    const { items, total } = await fetchUsers({ includeInactive: true, limit: users.length })

    expect(total).toBe(users.length)
    expect(items).toEqual(users.map(toExpected))
  })

  it('[USA-05] 無効を含めないときは無効な操作者が返らない', async () => {
    // 無効な操作者がフィクスチャにいないと、このシナリオは意味を失う
    expect(inactiveUser).toBeDefined()

    const { items, total } = await fetchUsers()

    expect(total).toBe(activeUsers.length)
    expect(items.map((item) => item.code)).toEqual(activeUsers.map((user) => user.操作者コード))
    expect(items.map((item) => item.code)).not.toContain(inactiveUser.操作者コード)
  })

  it('[USA-06] null の氏名・ロール名・部店コードは空文字に寄せる', async () => {
    record(listBody([{ ...users[0], 氏名: null, ロール名: null, 部店コード: null }]))

    const { items } = await fetchUsers()

    expect(items[0]).toMatchObject({ name: '', roleName: '', branchCode: '' })
  })

  it('[USA-07] 有効フラグの 1 / 0 は true / false になる', async () => {
    record(listBody([{ ...users[0], 有効フラグ: 1 }, { ...users[0], ID: 99, 有効フラグ: 0 }]))

    const { items } = await fetchUsers()

    expect(items.map((item) => item.active)).toEqual([true, false])
  })

  it('[USA-08] operators / total を持たない応答でも空の一覧として扱う', async () => {
    record({})

    const { items, total } = await fetchUsers()

    expect(items).toEqual([])
    expect(total).toBe(0)
  })

  it('[USA-09] サーバエラーは例外になる', async () => {
    record({ detail: 'サーバーでエラーが発生しました。' }, 500)

    await expect(fetchUsers()).rejects.toBeTruthy()
  })

  it('[USA-10] keyword は値があるときだけそのまま送る', async () => {
    record(listBody([]))
    const keyword = users[0].氏名.slice(0, 2)

    await fetchUsers({ keyword })
    expect(lastRequest.params.get('keyword')).toBe(keyword)

    await fetchUsers({ keyword: '' })
    expect(lastRequest.params.has('keyword')).toBe(false)
  })

  it('[USA-11] 更新のパスキーはエンコードした操作者コード', async () => {
    recordPut({ success: true, operator: withOrderTaker })
    const code = 'a/b c'

    await updateUser({ ...toUpdateArgs(withOrderTaker), code })

    expect(lastPut.url.pathname).toBe(`/api/masters/users/${encodeURIComponent(code)}`)
    // ID はパスに載らない
    expect(lastPut.url.pathname).not.toContain(`/${withOrderTaker.ID}`)
  })

  it('[USA-12] 更新の本文は 5 キーちょうどで、今の受注者コードも送り返す', async () => {
    expect(withOrderTaker).toBeDefined()
    recordPut({ success: true, operator: withOrderTaker })

    await updateUser(toUpdateArgs(withOrderTaker))

    expect(lastPut.body).toEqual({
      氏名: withOrderTaker.氏名,
      ロールコード: withOrderTaker.ロールコード,
      部店コード: withOrderTaker.部店コード,
      受注者コード: withOrderTaker.受注者コード,
      有効フラグ: 1,
    })
  })

  it('[USA-13] 空文字の 3 項目は null で送り、無効は 0 になる（キーは省かない）', async () => {
    recordPut({ success: true, operator: withOrderTaker })

    await updateUser({
      ...toUpdateArgs(withOrderTaker),
      name: '',
      branchCode: '',
      orderTakerCode: '',
      active: false,
    })

    expect(lastPut.body).toEqual({
      氏名: null,
      ロールコード: withOrderTaker.ロールコード,
      部店コード: null,
      受注者コード: null,
      有効フラグ: 0,
    })
  })

  it('[USA-14] 応答の operator をアプリ内モデルに変換して返す', async () => {
    const nextRole = rolePermissions.find((row) => row.ロールコード !== withOrderTaker.ロールコード)

    const updated = await updateUser({
      ...toUpdateArgs(withOrderTaker),
      roleCode: nextRole.ロールコード,
    })

    expect(updated).toMatchObject({
      id: withOrderTaker.ID,
      code: withOrderTaker.操作者コード,
      roleCode: nextRole.ロールコード,
      roleName: nextRole.ロール名,
      orderTakerCode: withOrderTaker.受注者コード,
      active: true,
    })
  })

  it('[USA-15] 更新の 400 は detail を理由に持つ例外になる', async () => {
    const detail = 'ロールコードが不正です: xxx'
    recordPut({ detail }, 400)

    await expect(updateUser(toUpdateArgs(withOrderTaker))).rejects.toMatchObject({
      message: detail,
    })
  })

  it('[USA-16] operator を持たない応答でも既定値の 1 件を返す', async () => {
    recordPut({ success: true })

    const updated = await updateUser(toUpdateArgs(withOrderTaker))

    expect(updated).toEqual({
      id: 0,
      code: '',
      name: '',
      roleCode: '',
      roleName: '',
      branchCode: '',
      orderTakerCode: '',
      active: false,
      updatedAt: '',
      updatedBy: '',
    })
  })
})
