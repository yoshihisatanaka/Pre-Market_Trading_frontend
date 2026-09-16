import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppLayout from './AppLayout.vue'

/*
 * AppHeader（useRoute / setInterval）と AppSidebar（RouterLink）を実描画するので、
 * AppSidebar.spec.js と同じメモリ履歴の実ルータを差す。Pinia は要らない。
 *
 * jsdom は scoped CSS を評価しないため「見えない」ことは検証できない。
 * 開閉の判定はメニューボタンの aria-expanded で行う（見え方は E2E の LAY-06 が見る）。
 */
const Page = { render: () => h('div') }

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    // サイドメニューの 15 件を実描画するので、受け皿が無いとルータ警告で埋まる
    routes: [
      { path: '/', component: Page, meta: { title: '注文一覧' } },
      { path: '/:pathMatch(.*)*', component: Page, meta: { title: 'ページが見つかりません' } },
    ],
  })
}

async function mountLayout() {
  const router = createTestRouter()
  await router.push('/')
  return mount(AppLayout, {
    slots: { default: '<p>画面の中身</p>' },
    global: { plugins: [router] },
  })
}

const toggleButton = (wrapper) => wrapper.find('[data-testid="sidebar-toggle"]')
const isOpen = (wrapper) => toggleButton(wrapper).attributes('aria-expanded') === 'true'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('innerWidth', 1280)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// シナリオ: docs/unit/components-layout-app-layout.md
describe('AppLayout', () => {
  it('[ALY-01] 広い画面では開いた状態で描画し、slot の中身を表示する', async () => {
    const wrapper = await mountLayout()

    expect(isOpen(wrapper)).toBe(true)
    expect(wrapper.find('[data-testid="app-sidebar"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('画面の中身')
  })

  it('[ALY-02] 狭い画面では閉じた状態で描画する', async () => {
    vi.stubGlobal('innerWidth', 900)

    const wrapper = await mountLayout()

    expect(isOpen(wrapper)).toBe(false)
  })

  it('[ALY-03] メニューボタンを click すると閉じた状態に変わる', async () => {
    const wrapper = await mountLayout()

    await toggleButton(wrapper).trigger('click')

    expect(isOpen(wrapper)).toBe(false)
  })

  it('[ALY-04] 閉じた選択は次のマウントでも保たれる', async () => {
    const first = await mountLayout()
    await toggleButton(first).trigger('click')
    first.unmount()

    const second = await mountLayout()

    expect(isOpen(second)).toBe(false)
  })
})
