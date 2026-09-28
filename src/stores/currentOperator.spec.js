import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { salesOperator, supervisorOperator } from '@/mocks/fixtures/currentOperator'
import { useCurrentOperatorStore } from './currentOperator'

/*
 * ログイン中の操作者と権限。守るのは「失敗・未取得は権限なし」と「読み込みを 1 本にまとめる」の 2 点。
 * 期待値はフィクスチャ（src/mocks/fixtures/currentOperator.js）の権限フラグから導く。
 */

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 権限のキー（アプリ内モデル。api 層が branch_all → branchAll に直す） */
const PERMISSION_KEYS = ['order', 'master', 'operation', 'branchAll']

/**
 * /auth/me を指定の本文で返し、叩かれた回数を数えるハンドラを立てる。
 *
 * @returns {{ count: () => number }}
 */
function countingMe(body = supervisorOperator, { status = 200, wait = 0 } = {}) {
  let calls = 0
  server.use(
    http.get('*/api/auth/me', async () => {
      calls += 1
      if (wait) await delay(wait)
      return HttpResponse.json(body, { status })
    }),
  )
  return { count: () => calls }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

// シナリオ: docs/unit/stores-current-operator.md
describe('stores/currentOperator', () => {
  it('[COP-01] 作っただけでは取りに行かず、権限も持たない', () => {
    const me = countingMe()
    const store = useCurrentOperatorStore()

    expect(store.operator).toBeNull()
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
    expect(store.hasPermission('master')).toBe(false)
    expect(me.count()).toBe(0)
  })

  it('[COP-02] load すると操作者と権限が入る', async () => {
    const store = useCurrentOperatorStore()

    await store.load()

    expect(store.operator).toMatchObject({
      operatorCode: supervisorOperator.操作者コード,
      name: supervisorOperator.氏名,
      roleCode: supervisorOperator.ロールコード,
    })
    // 既定の管理責任者は全権限を持つ前提
    expect(supervisorOperator.権限.master).toBe(true)
    expect(store.hasPermission('master')).toBe(true)
    expect(store.hasPermission('order')).toBe(supervisorOperator.権限.order)
  })

  it('[COP-03] マスタ権限の無い操作者は master を持たない', async () => {
    countingMe(salesOperator)
    const store = useCurrentOperatorStore()

    await store.load()

    expect(store.hasPermission('master')).toBe(salesOperator.権限.master)
    expect(store.hasPermission('master')).toBe(false)
    expect(store.hasPermission('order')).toBe(salesOperator.権限.order)
    expect(store.hasPermission('order')).toBe(true)
  })

  it('[COP-04] 取得中は loading が立ち、完了すると下りる', async () => {
    countingMe(supervisorOperator, { wait: 10 })
    const store = useCurrentOperatorStore()

    const pending = store.load()
    expect(store.loading).toBe(true)

    await pending
    expect(store.loading).toBe(false)
  })

  it('[COP-05] 取得に失敗したら error に入り、どの権限も持たない', async () => {
    countingMe({ detail: ERROR_MESSAGE }, { status: 500 })
    const store = useCurrentOperatorStore()

    await store.load()

    expect(store.error?.message).toBe(ERROR_MESSAGE)
    expect(store.operator).toBeNull()
    for (const key of PERMISSION_KEYS) {
      expect(store.hasPermission(key)).toBe(false)
    }
  })

  it('[COP-06] load と ensureLoaded が重なっても /auth/me は 1 回だけ叩く', async () => {
    const me = countingMe(supervisorOperator, { wait: 10 })
    const store = useCurrentOperatorStore()

    // main.js の load と、ガードの ensureLoaded が同時に走る状況
    const results = await Promise.all([store.load(), store.ensureLoaded(), store.ensureLoaded()])

    expect(me.count()).toBe(1)
    for (const result of results) {
      expect(result.operatorCode).toBe(supervisorOperator.操作者コード)
    }
  })

  it('[COP-07] load を呼んでいなくても ensureLoaded で読み込める', async () => {
    const me = countingMe()
    const store = useCurrentOperatorStore()

    await store.ensureLoaded()

    expect(me.count()).toBe(1)
    expect(store.operator.operatorCode).toBe(supervisorOperator.操作者コード)
  })

  it('[COP-08] 定義に無い権限は持っていないと読む', async () => {
    const store = useCurrentOperatorStore()
    await store.load()

    expect(store.hasPermission('unknown')).toBe(false)
  })

  it('[COP-09] 読み込みに失敗したあとの ensureLoaded は読み直し、回復すれば権限が入る', async () => {
    let calls = 0
    server.use(
      http.get('*/api/auth/me', () => {
        calls += 1
        // 1 回目だけ一時的な障害。以降は既定の管理責任者
        return calls === 1
          ? HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })
          : HttpResponse.json(supervisorOperator)
      }),
    )
    const store = useCurrentOperatorStore()
    await store.load()
    expect(store.error?.message).toBe(ERROR_MESSAGE)
    expect(store.hasPermission('master')).toBe(false)

    await store.ensureLoaded()

    expect(calls).toBe(2)
    expect(store.error).toBeNull()
    expect(store.hasPermission('master')).toBe(true)
  })

  it('[COP-10] 読み込みに成功したあとの ensureLoaded は叩き直さない', async () => {
    const me = countingMe()
    const store = useCurrentOperatorStore()
    await store.load()

    await store.ensureLoaded()
    await store.ensureLoaded()

    expect(me.count()).toBe(1)
    expect(store.hasPermission('master')).toBe(true)
  })
})
