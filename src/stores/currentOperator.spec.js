import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import {
  noOperationOperator,
  salesOperator,
  supervisorOperator,
} from '@/mocks/fixtures/currentOperator'
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

  it('[COS-08] 作っただけでは /auth/me を叩かず、操作者も持たない', () => {
    const requests = countRequests()
    const store = useCurrentOperatorStore()

    expect(store.operator).toBeNull()
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
    expect(requests.value).toBe(0)
  })

  it('[COS-09] 読み終えると操作者の情報が入り、マスタ権限も読める', async () => {
    const store = useCurrentOperatorStore()

    await store.ensureLoaded()

    expect(store.operator).toMatchObject({
      operatorCode: supervisorOperator.操作者コード,
      name: supervisorOperator.氏名,
      roleCode: supervisorOperator.ロールコード,
    })
    expect(supervisorOperator.権限.master).toBe(true)
    expect(store.can('master')).toBe(true)
  })

  it('[COS-10] 権限ごとにフラグどおり読む（master なし・order あり）', async () => {
    // フィクスチャの前提が崩れたら、このシナリオは意味を失う
    expect(salesOperator.権限.master).toBe(false)
    expect(salesOperator.権限.order).toBe(true)
    respond(salesOperator)
    const store = useCurrentOperatorStore()

    await store.ensureLoaded()

    expect(store.can('master')).toBe(false)
    expect(store.can('order')).toBe(true)
  })

  it('[COS-13] 預託先参照権限は can(depositary) で読み、管理責任者は true・営業員は false', async () => {
    // フィクスチャの前提が崩れたら、このシナリオは意味を失う
    expect(supervisorOperator.権限.depositary).toBe(true)
    expect(salesOperator.権限.depositary).toBe(false)

    const supervisor = useCurrentOperatorStore()
    await supervisor.ensureLoaded()
    expect(supervisor.can('depositary')).toBe(true)

    setActivePinia(createPinia())
    respond(salesOperator)
    const sales = useCurrentOperatorStore()
    await sales.ensureLoaded()
    expect(sales.can('depositary')).toBe(false)
  })

  it('[COS-11] 読み込み中は loading が立ち、完了すると下りる', async () => {
    server.use(
      http.get(PATH, async () => {
        await delay(10)
        return HttpResponse.json(supervisorOperator)
      }),
    )
    const store = useCurrentOperatorStore()

    const pending = store.ensureLoaded()
    expect(store.loading).toBe(true)

    await pending
    expect(store.loading).toBe(false)
  })

  it('[COS-12] 定義に無い権限は持っていないと読む', async () => {
    const store = useCurrentOperatorStore()
    await store.ensureLoaded()

    expect(store.can('unknown')).toBe(false)
  })
})
