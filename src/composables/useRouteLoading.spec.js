import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { trackRouteLoading, useRouteLoading } from './useRouteLoading'

/*
 * メモリ履歴の実ルータに、解決を手で止められる遅延ルート /slow を置く。
 * router.push() は await せず flushPromises() で beforeEach まで進め、その時点の状態を見る。
 * vue-router は遅延 component の解決を beforeEnter の後・beforeResolve の前に待つので、
 * ガードのリダイレクト / 中止はチャンクを解決しなくても決着する。
 */
const Page = { render: () => h('div') }

let router
let stop
/** /slow のチャンクを解決する（RLD-01〜05・08 で使う） */
let release

const { isLoading, pendingPath } = useRouteLoading()

beforeEach(async () => {
  const held = new Promise((resolve) => {
    release = () => resolve(Page)
  })
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Page },
      { path: '/fast', component: Page },
      { path: '/slow', component: () => held },
      { path: '/redirecting', component: Page, beforeEnter: () => '/slow' },
      { path: '/blocked', component: Page, beforeEnter: () => false },
      { path: '/broken', component: () => Promise.reject(new Error('chunk load failed')) },
    ],
  })
  // 初回遷移は済ませてから差す（初回の確定待ちを各テストの前提に混ぜない）
  await router.push('/')
  stop = trackRouteLoading(router)
})

afterEach(() => {
  stop()
  vi.restoreAllMocks()
})

// シナリオ: docs/unit/composables-use-route-loading.md
describe('useRouteLoading', () => {
  it('[RLD-01] 遅延ルートへ push すると確定するまで読み込み中になり、行き先を持つ', async () => {
    router.push('/slow')
    await flushPromises()

    expect(isLoading.value).toBe(true)
    expect(pendingPath.value).toBe('/slow')
  })

  it('[RLD-02] チャンクが解決すると push が完了して解除される', async () => {
    const navigation = router.push('/slow')
    await flushPromises()

    release()
    await navigation

    expect(isLoading.value).toBe(false)
    expect(pendingPath.value).toBe('')
    expect(router.currentRoute.value.path).toBe('/slow')
  })

  it('[RLD-03] 確定待ち中に別のルートへ push すると後から押した方が勝ち、古い遷移の取り消しで消えない', async () => {
    const stale = router.push('/slow')
    await flushPromises()

    await router.push('/fast')

    expect(isLoading.value).toBe(false)
    expect(pendingPath.value).toBe('')

    // 古い遷移はチャンクが届いてから取り消しになる（CANCELLED）。それで表示が立ち戻らないこと
    release()
    await stale
    await flushPromises()

    expect(isLoading.value).toBe(false)
    expect(pendingPath.value).toBe('')
    expect(router.currentRoute.value.path).toBe('/fast')
  })

  it('[RLD-04] 確定待ち中に現在地へ push すると古い遷移を待たずに解除される', async () => {
    const stale = router.push('/slow')
    await flushPromises()

    await router.push('/')

    expect(isLoading.value).toBe(false)
    expect(pendingPath.value).toBe('')

    release()
    await stale
    await flushPromises()

    expect(isLoading.value).toBe(false)
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('[RLD-05] ガードのリダイレクトは行き先に引き継がれ、行き先の確定で解除される', async () => {
    const navigation = router.push('/redirecting')
    await flushPromises()

    expect(isLoading.value).toBe(true)
    expect(pendingPath.value).toBe('/slow')

    release()
    await navigation

    expect(isLoading.value).toBe(false)
    expect(pendingPath.value).toBe('')
    expect(router.currentRoute.value.path).toBe('/slow')
  })

  it('[RLD-06] ガードが遷移を中止すると解除される', async () => {
    await router.push('/blocked')

    expect(isLoading.value).toBe(false)
    expect(pendingPath.value).toBe('')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('[RLD-07] チャンクの取得に失敗すると解除される', async () => {
    // onError の購読があれば vue-router は console.error を出さないはずだが、出ても出力を汚さないようにする
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await router.push('/broken').catch(() => {})

    expect(isLoading.value).toBe(false)
    expect(pendingPath.value).toBe('')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('[RLD-08] 登録を外した後は router の遷移に反応しない', async () => {
    stop()

    router.push('/slow')
    await flushPromises()

    expect(isLoading.value).toBe(false)
    expect(pendingPath.value).toBe('')
  })
})
