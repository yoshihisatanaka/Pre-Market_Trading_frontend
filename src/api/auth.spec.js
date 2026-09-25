import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { supervisorOperator, viewerOperator } from '@/mocks/fixtures/currentOperator'
import { fetchCurrentOperator } from './auth'

/*
 * API 層のテスト。GET /auth/me の生の形（CurrentOperatorResponse）を
 * アプリ内モデル（CurrentOperator）へ畳む変換と、欠けた値の倒しかたを固定する。
 */

/** 最後に届いたリクエストを覚えておくための入れ物 */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

const PATH = '*/api/auth/me'

/** リクエストを記録して、指定の本文を返すハンドラを立てる */
function record(body, status = 200) {
  server.use(
    http.get(PATH, ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams }
      return HttpResponse.json(body, { status })
    }),
  )
}

/** フィクスチャ（生の形）→ アプリ内モデルの期待値 */
const toModel = (raw) => ({
  operatorCode: raw.操作者コード,
  name: raw.氏名 ?? '',
  roleCode: raw.ロールコード ?? '',
  roleLabel: raw.ロール名 ?? '',
  branchCode: raw.部店コード ?? '',
  registered: raw.登録済,
  permissions: {
    order: raw.権限.order,
    master: raw.権限.master,
    operation: raw.権限.operation,
    branchAll: raw.権限.branch_all,
  },
  authzEnforced: raw.認可強制,
})

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

// シナリオ: docs/unit/api-auth.md
describe('api/auth', () => {
  it('[AUA-01] 取得は /auth/me をクエリなしで呼ぶ', async () => {
    record(supervisorOperator)

    await fetchCurrentOperator()

    expect(lastRequest.url.pathname).toBe('/api/auth/me')
    expect([...lastRequest.params.keys()]).toEqual([])
  })

  it('[AUA-02] 管理責任者の応答が camelCase のモデルに変換される', async () => {
    record(supervisorOperator)

    const operator = await fetchCurrentOperator()

    expect(operator).toEqual(toModel(supervisorOperator))
    // フィクスチャの部店コードは null。空文字に寄せる
    expect(supervisorOperator.部店コード).toBeNull()
    expect(operator.branchCode).toBe('')
  })

  it('[AUA-03] 管理者の応答はそのロールコードと部店コードになる', async () => {
    record(viewerOperator)

    const operator = await fetchCurrentOperator()

    expect(operator.roleCode).toBe(viewerOperator.ロールコード)
    expect(operator.branchCode).toBe(viewerOperator.部店コード)
  })

  it('[AUA-04] 権限の無い応答は 4 つとも false になる', async () => {
    const withoutFlags = Object.fromEntries(
      Object.entries(supervisorOperator).filter(([key]) => key !== '権限'),
    )
    record(withoutFlags)

    const operator = await fetchCurrentOperator()

    expect(operator.permissions).toEqual({
      order: false,
      master: false,
      operation: false,
      branchAll: false,
    })
  })

  it('[AUA-05] 未登録の操作者はロールコードと氏名が空文字で registered が false になる', async () => {
    record({ ...viewerOperator, ロールコード: null, ロール名: null, 氏名: null, 登録済: false })

    const operator = await fetchCurrentOperator()

    expect(operator.roleCode).toBe('')
    expect(operator.name).toBe('')
    expect(operator.registered).toBe(false)
  })

  it('[AUA-06] 500 は detail を message に持つ ApiError になる', async () => {
    record({ detail: ERROR_MESSAGE }, 500)

    await expect(fetchCurrentOperator()).rejects.toMatchObject({
      status: 500,
      message: ERROR_MESSAGE,
    })
  })
})
