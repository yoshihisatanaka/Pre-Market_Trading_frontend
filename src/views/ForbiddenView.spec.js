import { beforeEach, describe, expect, it } from 'vitest'
import { h } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { useCurrentOperatorStore } from '@/stores/currentOperator'
import ForbiddenView from './ForbiddenView.vue'

const Page = { render: () => h('div') }
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Page },
      { path: '/forbidden', name: 'forbidden', component: Page },
    ],
  })
  await router.push('/forbidden')
  return mount(ForbiddenView, { global: { plugins: [router] } })
}

const byTestId = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)

beforeEach(() => {
  setActivePinia(createPinia())
})

// シナリオ: docs/unit/views-forbidden-view.md
describe('ForbiddenView', () => {
  it('[FBV-01] 既定は権限が無い旨と注文一覧へのリンクを出す', async () => {
    const wrapper = await mountView()

    expect(byTestId(wrapper, 'forbidden-message').text()).toBe('この画面を開く権限がありません。')
    expect(byTestId(wrapper, 'forbidden-check-failed').exists()).toBe(false)
    const link = wrapper.find('a')
    expect(link.text()).toBe('注文一覧へ戻る')
    expect(link.attributes('href')).toBe('/')
  })

  it('[FBV-02] /auth/me が失敗していたら確認できなかった旨を理由付きで出す', async () => {
    server.use(
      http.get('*/api/auth/me', () =>
        HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
      ),
    )
    await useCurrentOperatorStore().ensureLoaded()

    const wrapper = await mountView()

    expect(byTestId(wrapper, 'forbidden-check-failed').text()).toBe(
      `権限を確認できませんでした（${ERROR_MESSAGE}）。時間をおいて開き直してください。`,
    )
    expect(byTestId(wrapper, 'forbidden-message').exists()).toBe(false)
  })
})
