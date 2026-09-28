import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { salesOperator, supervisorOperator } from '@/mocks/fixtures/currentOperator'
import { useCurrentOperatorStore } from '@/stores/currentOperator'
import { requirePermission, routes } from './index'

/*
 * ルート定義と権限のガード。requirePermission は to.meta だけを見るので、
 * ルートを模した { meta } を渡して直接呼ぶ。遷移を通しで見るときだけ、
 * export された routes でテスト用ルータ（メモリ履歴）を組む。
 */

const FORBIDDEN = { name: 'forbidden', replace: true }
const MASTER_ROUTE = { meta: { permission: 'master' } }

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

// シナリオ: docs/unit/router-index.md
describe('router', () => {
  it('[RTR-01] 権限の指定が無いルートは読み込みを待たずに通す', async () => {
    const me = countingMe()

    expect(await requirePermission({ meta: {} })).toBe(true)
    expect(me.count()).toBe(0)
  })

  it('[RTR-02] 権限を持つ操作者は通す', async () => {
    countingMe(supervisorOperator)

    expect(await requirePermission(MASTER_ROUTE)).toBe(true)
  })

  it('[RTR-03] 権限の無い操作者は forbidden へ置き換えで回す', async () => {
    countingMe(salesOperator)

    expect(await requirePermission(MASTER_ROUTE)).toEqual(FORBIDDEN)
  })

  it('[RTR-04] 操作者の取得に失敗したら forbidden へ回す', async () => {
    countingMe({ detail: 'サーバーでエラーが発生しました。' }, { status: 500 })

    expect(await requirePermission(MASTER_ROUTE)).toEqual(FORBIDDEN)
  })

  it('[RTR-05] 起動時の読み込みが終わるのを待ってから判定する', async () => {
    const me = countingMe(supervisorOperator, { wait: 20 })
    const store = useCurrentOperatorStore()
    // main.js が起動時に始める読み込み（待たない）
    const booting = store.load()
    expect(store.loading).toBe(true)

    const verdict = await requirePermission(MASTER_ROUTE)

    // 途中で判定していたら false 側（forbidden）に倒れている
    expect(verdict).toBe(true)
    expect(store.loading).toBe(false)
    expect(me.count()).toBe(1)
    await booting
  })

  it('[RTR-06] /masters/ 配下の全ルートがマスタ権限を要求する', () => {
    const masterRoutes = routes.filter((route) => route.path.startsWith('/masters/'))

    expect(masterRoutes.length).toBeGreaterThan(0)
    for (const route of masterRoutes) {
      expect(route.meta?.permission, route.path).toBe('master')
    }
  })

  it('[RTR-07] 回し先の forbidden は権限を要求しない', () => {
    const forbidden = routes.find((route) => route.name === FORBIDDEN.name)

    expect(forbidden?.path).toBe('/forbidden')
    expect(forbidden.meta?.permission).toBeUndefined()
  })

  it('[RTR-08] 権限の無い操作者がマスタ画面を開くと forbidden に行き着く', async () => {
    countingMe(salesOperator)
    const router = createRouter({ history: createMemoryHistory(), routes })
    router.beforeEach(requirePermission)

    await router.push('/masters/customers')

    expect(router.currentRoute.value.name).toBe(FORBIDDEN.name)
    expect(router.currentRoute.value.path).toBe('/forbidden')
  })
})
