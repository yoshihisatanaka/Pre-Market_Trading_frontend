import { beforeEach, describe, expect, it } from 'vitest'
import { h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { noOperationOperator } from '@/mocks/fixtures/currentOperator'
import { navSections } from '@/components/layout/navigation'
import { permissionGuard } from './permissionGuard'
import appRouter from './index'

/*
 * ガードの単体テスト。メモリ履歴のテスト用ルータに同じ関数を差して、遷移先を見る。
 * 実ルータ（router/index.js）は createWebHistory 固定なので、meta の付け方だけを確かめる。
 */
const AUTH_ME = '*/api/auth/me'
const Page = { render: () => h('div') }

function createTestRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Page },
      { path: '/ops', name: 'ops', component: Page, meta: { requiredPermission: 'operation' } },
      { path: '/forbidden', name: 'forbidden', component: Page },
    ],
  })
  router.beforeEach(permissionGuard)
  return router
}

/** /auth/me に届いたリクエストの数を数える（何も返さないので既定のハンドラが応答する） */
function countAuthRequests() {
  const counter = { value: 0 }
  server.use(
    http.get(AUTH_ME, () => {
      counter.value += 1
    }),
  )
  return counter
}

beforeEach(() => {
  setActivePinia(createPinia())
})

// シナリオ: docs/unit/router-permission-guard.md
describe('permissionGuard', () => {
  it('[PMG-01] requiredPermission の無いルートは /auth/me を待たずに通る', async () => {
    const requests = countAuthRequests()
    const router = createTestRouter()

    await router.push('/')

    expect(router.currentRoute.value.name).toBe('home')
    expect(requests.value).toBe(0)
  })

  it('[PMG-02] 権限があれば requiredPermission の付いたルートへ通る', async () => {
    const router = createTestRouter()

    await router.push('/ops')

    expect(router.currentRoute.value.name).toBe('ops')
  })

  it('[PMG-03] 権限が無ければ forbidden へ回る', async () => {
    server.use(http.get(AUTH_ME, () => HttpResponse.json(noOperationOperator)))
    const router = createTestRouter()

    await router.push('/ops')

    expect(router.currentRoute.value.name).toBe('forbidden')
  })

  it('[PMG-04] /auth/me が失敗したら forbidden へ回る', async () => {
    server.use(http.get(AUTH_ME, () => HttpResponse.json({ detail: 'x' }, { status: 500 })))
    const router = createTestRouter()

    await router.push('/ops')

    expect(router.currentRoute.value.name).toBe('forbidden')
  })

  it('[PMG-05] 実ルータで運用管理権限が要るのはサイドメニューの運用管理 4 項目と同じパス', () => {
    const guarded = appRouter
      .getRoutes()
      .filter((route) => route.meta.requiredPermission === 'operation')
      .map((route) => route.path)
    const section = navSections.find((s) => s.requiredPermission === 'operation')

    expect(guarded).toHaveLength(section.items.length)
    expect(new Set(guarded)).toEqual(new Set(section.items.map((item) => item.to)))
  })
})
