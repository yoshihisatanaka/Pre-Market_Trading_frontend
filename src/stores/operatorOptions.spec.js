import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { users } from '@/mocks/fixtures/users'
import { OPERATOR_OPTIONS_LIMIT, useOperatorOptionsStore } from './operatorOptions'

/*
 * 既定の MSW ハンドラに当てる。期待値はフィクスチャ（users）と OPERATOR_OPTIONS_LIMIT から導く。
 * 「一度取れたら読み直さない」は、リクエストが飛ばないこととして外から観察する。
 */

const USERS_PATH = '*/api/masters/users'
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const labelOf = (raw) => (raw.氏名 ? `${raw.操作者コード} ${raw.氏名}` : raw.操作者コード)
const expectedOptions = users.map((raw) => ({ value: raw.操作者コード, label: labelOf(raw) }))

const body = (rows) => ({ total: rows.length, limit: OPERATOR_OPTIONS_LIMIT, offset: 0, operators: rows })

/**
 * 届いたリクエストを数えて記録するハンドラを立てる。応答はフィクスチャの全員。
 *
 * @param {{ wait?: number, rows?: object[] }} [options]
 * @returns {{ count: number, params: URLSearchParams | null }} 呼ばれた回数と最後のクエリ（参照で読む）
 */
function countRequests({ wait = 0, rows = users } = {}) {
  const counter = { count: 0, params: null }
  server.use(
    http.get(USERS_PATH, async ({ request }) => {
      counter.count += 1
      counter.params = new URL(request.url).searchParams
      if (wait > 0) await delay(wait)
      return HttpResponse.json(body(rows))
    }),
  )
  return counter
}

const failUsers = (options) =>
  server.use(
    http.get(
      USERS_PATH,
      () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
      options,
    ),
  )

// シナリオ: docs/unit/stores-operator-options.md
describe('stores/operatorOptions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[OPO-01] 未取得でも options と users は空配列', () => {
    const store = useOperatorOptionsStore()

    expect(store.options).toEqual([])
    expect(store.users).toEqual([])
  })

  it('[OPO-02] ensureLoaded で無効を含む全員が「社員コード 氏名」の選択肢になる', async () => {
    // 無効な操作者がフィクスチャにいないと、このシナリオは意味を失う
    expect(users.some((user) => user.有効フラグ !== 1)).toBe(true)
    const store = useOperatorOptionsStore()

    await store.ensureLoaded()

    expect(store.users.map((user) => user.code)).toEqual(users.map((raw) => raw.操作者コード))
    expect(store.options).toEqual(expectedOptions)
  })

  it('[OPO-03] 無効な操作者を含め、上限件数で取得する', async () => {
    const counter = countRequests()
    const store = useOperatorOptionsStore()

    await store.ensureLoaded()

    expect(counter.params.get('include_inactive')).toBe('true')
    expect(counter.params.get('limit')).toBe(String(OPERATOR_OPTIONS_LIMIT))
  })

  it('[OPO-04] 氏名が無い操作者はコードだけを表示名にする', async () => {
    const nameless = { ...users[0], 氏名: null }
    countRequests({ rows: [nameless] })
    const store = useOperatorOptionsStore()

    await store.ensureLoaded()

    expect(store.options).toEqual([{ value: nameless.操作者コード, label: nameless.操作者コード }])
  })

  it('[OPO-05] 取得済みなら ensureLoaded は読み直さない', async () => {
    const counter = countRequests()
    const store = useOperatorOptionsStore()
    await store.ensureLoaded()

    const second = store.ensureLoaded()

    expect(second).toBeUndefined()
    expect(counter.count).toBe(1)
    expect(store.options).toEqual(expectedOptions)
  })

  it('[OPO-06] 取得中に ensureLoaded を重ねてもリクエストは 1 本', async () => {
    const counter = countRequests({ wait: 10 })
    const store = useOperatorOptionsStore()

    const first = store.ensureLoaded()
    const second = store.ensureLoaded()
    expect(store.loading).toBe(true)
    expect(second).toBeInstanceOf(Promise)

    await Promise.all([first, second])

    expect(counter.count).toBe(1)
    expect(store.loading).toBe(false)
    expect(store.options).toEqual(expectedOptions)
  })

  it('[OPO-07] 取得に失敗すると error に入り、選択肢は空のまま', async () => {
    failUsers()
    const store = useOperatorOptionsStore()

    await store.ensureLoaded()

    expect(store.error?.message).toBe(ERROR_MESSAGE)
    expect(store.options).toEqual([])
  })

  it('[OPO-08] 失敗した後の ensureLoaded は読み直す', async () => {
    // once を付けて、1 回目だけ 500・2 回目から既定ハンドラに戻す
    failUsers({ once: true })
    const store = useOperatorOptionsStore()
    await store.ensureLoaded()
    expect(store.error).not.toBeNull()

    await store.ensureLoaded()

    expect(store.error).toBeNull()
    expect(store.options).toEqual(expectedOptions)
  })

  it('[OPO-09] load は取得済みでも読み直す', async () => {
    const counter = countRequests()
    const store = useOperatorOptionsStore()
    await store.ensureLoaded()

    await store.load()

    expect(counter.count).toBe(2)
    expect(store.options).toEqual(expectedOptions)
  })
})
