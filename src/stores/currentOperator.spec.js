import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { noOperationOperator, supervisorOperator } from '@/mocks/fixtures/currentOperator'
import { useCurrentOperatorStore } from './currentOperator'

const PATH = '*/api/auth/me'
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 届いたリクエストの数を数える（何も返さないので既定のハンドラが応答する） */
function countRequests() {
  const counter = { value: 0 }
  server.use(
    http.get(PATH, () => {
      counter.value += 1
    }),
  )
  return counter
}

const respond = (body, status = 200, options) =>
  server.use(http.get(PATH, () => HttpResponse.json(body, { status }), options))

beforeEach(() => {
  setActivePinia(createPinia())
})

// シナリオ: docs/unit/stores-current-operator.md
describe('useCurrentOperatorStore', () => {
  it('[COS-01] 読む前は権限を持っていない扱い', () => {
    const store = useCurrentOperatorStore()

    expect(store.can('operation')).toBe(false)
  })

  it('[COS-02] 読み終えたら運用管理権限のある利用者は can が true', async () => {
    expect(supervisorOperator.権限.operation).toBe(true)
    const store = useCurrentOperatorStore()

    await store.ensureLoaded()

    expect(store.can('operation')).toBe(true)
  })

  it('[COS-03] 同時に 2 回呼んでもリクエストは 1 本で、どちらも読み終えて解決する', async () => {
    const requests = countRequests()
    const store = useCurrentOperatorStore()

    /*
     * Promise の同一性は見ない。Pinia はストアの関数を action として包み、呼ぶたびに
     * 新しい Promise を返すので、ストア内部で同じものを返していても外からは別物に見える。
     */
    await Promise.all([store.ensureLoaded(), store.ensureLoaded()])

    expect(requests.value).toBe(1)
    expect(store.can('operation')).toBe(true)
  })

  it('[COS-04] 運用管理権限の無い利用者は can が false', async () => {
    respond(noOperationOperator)
    const store = useCurrentOperatorStore()

    await store.ensureLoaded()

    expect(store.can('operation')).toBe(false)
  })

  it('[COS-05] /auth/me が 500 なら can は false、error に理由が入り reject しない', async () => {
    respond({ detail: ERROR_MESSAGE }, 500)
    const store = useCurrentOperatorStore()

    await expect(store.ensureLoaded()).resolves.toBeUndefined()

    expect(store.can('operation')).toBe(false)
    expect(store.error?.message).toBe(ERROR_MESSAGE)
  })

  it('[COS-06] 失敗のあとの ensureLoaded は読み直す', async () => {
    respond({ detail: ERROR_MESSAGE }, 500, { once: true })
    const store = useCurrentOperatorStore()
    await store.ensureLoaded()
    expect(store.can('operation')).toBe(false)

    await store.ensureLoaded()

    expect(store.error).toBeNull()
    expect(store.can('operation')).toBe(true)
  })

  it('[COS-07] 成功のあとの ensureLoaded は読み直さない', async () => {
    const requests = countRequests()
    const store = useCurrentOperatorStore()
    await store.ensureLoaded()

    await store.ensureLoaded()

    expect(requests.value).toBe(1)
  })
})
