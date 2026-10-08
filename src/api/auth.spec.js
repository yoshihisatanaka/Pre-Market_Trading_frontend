import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { salesOperator, supervisorOperator, viewerOperator } from '@/mocks/fixtures/currentOperator'
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
  orderTakerCode: raw.受注者コード ?? '',
  registered: raw.登録済,
  permissions: {
    order: raw.権限.order,
    master: raw.権限.master,
    operation: raw.権限.operation,
    branchAll: raw.権限.branch_all,
    depositary: raw.権限.depositary,
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

  it('[AUA-04] 権限の無い応答は 5 つとも false になる', async () => {
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
      depositary: false,
    })
  })

  it('[AUA-07] 預託先参照権限は 権限.depositary から真偽値で入り、欠けていれば false', async () => {
    record(supervisorOperator)
    expect((await fetchCurrentOperator()).permissions.depositary).toBe(true)

    record(salesOperator)
    expect((await fetchCurrentOperator()).permissions.depositary).toBe(false)

    const flagsWithoutDepositary = Object.fromEntries(
      Object.entries(supervisorOperator.権限).filter(([key]) => key !== 'depositary'),
    )
    record({ ...supervisorOperator, 権限: flagsWithoutDepositary })
    expect((await fetchCurrentOperator()).permissions.depositary).toBe(false)
  })

  it('[AUA-05] 未登録の操作者はロールコードと氏名が空文字で registered が false になる', async () => {
    record({ ...viewerOperator, ロールコード: null, ロール名: null, 氏名: null, 登録済: false })

    const operator = await fetchCurrentOperator()

    expect(operator.roleCode).toBe('')
    expect(operator.name).toBe('')
    expect(operator.registered).toBe(false)
  })

  it('[AUA-08] 受注者コードはそのまま入り、null・欠けは空文字になる', async () => {
    record(salesOperator)
    expect((await fetchCurrentOperator()).orderTakerCode).toBe(salesOperator.受注者コード)

    // フィクスチャの管理責任者（admin）は受注者コードが未設定（null）
    expect(supervisorOperator.受注者コード).toBeNull()
    record(supervisorOperator)
    expect((await fetchCurrentOperator()).orderTakerCode).toBe('')

    const withoutOrderTaker = Object.fromEntries(
      Object.entries(salesOperator).filter(([key]) => key !== '受注者コード'),
    )
    record(withoutOrderTaker)
    expect((await fetchCurrentOperator()).orderTakerCode).toBe('')
  })

  it('[AUA-06] 500 は detail を message に持つ ApiError になる', async () => {
    record({ detail: ERROR_MESSAGE }, 500)

    await expect(fetchCurrentOperator()).rejects.toMatchObject({
      status: 500,
      message: ERROR_MESSAGE,
    })
  })
})
