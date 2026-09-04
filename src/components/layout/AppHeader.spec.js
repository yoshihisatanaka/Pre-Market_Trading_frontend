import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppHeader from './AppHeader.vue'

/*
 * 時刻に依存する部品のテストの見本。
 * setInterval と Date をまとめて偽装するため、待ち合わせには nextTick を使う
 * （flushPromises は setImmediate 依存で、フェイクタイマー下では進まない）。
 */
const Page = { render: () => h('div') }

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Page, meta: { title: '注文一覧' } },
      { path: '/:pathMatch(.*)*', component: Page, meta: { title: 'ページが見つかりません' } },
    ],
  })
}

async function mountAt(path) {
  const router = createTestRouter()
  await router.push(path)
  const wrapper = mount(AppHeader, { global: { plugins: [router] } })
  return { wrapper, router }
}

const marketStatus = (wrapper) => wrapper.find('[data-testid="market-status"]')

beforeEach(() => {
  vi.useFakeTimers()
  // 既定は通常取引の時間帯にしておく（タイトルの検証が時刻に影響されないように）
  vi.setSystemTime(new Date('2026-03-02T14:30:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

// シナリオ: docs/unit/components-layout-app-header.md
describe('AppHeader', () => {
  it('[AHD-01] ルートの meta.title を見出しに表示する', async () => {
    const { wrapper } = await mountAt('/')

    expect(wrapper.find('h1').text()).toBe('注文一覧')
  })

  it('[AHD-02] 遷移すると見出しが遷移先のタイトルに変わる', async () => {
    const { wrapper, router } = await mountAt('/')

    await router.push('/masters/users')
    await nextTick()

    expect(wrapper.find('h1').text()).toBe('ページが見つかりません')
  })

  it('[AHD-03] 現在時刻の取引セッションを表示する', async () => {
    const { wrapper } = await mountAt('/')

    expect(marketStatus(wrapper).text()).toBe('● Regular')
    expect(marketStatus(wrapper).attributes('data-status')).toBe('regular')
  })

  it('[AHD-04] 60 秒ごとに取引セッションを再判定する', async () => {
    vi.setSystemTime(new Date('2026-03-02T20:59:00Z')) // NY 15:59
    const { wrapper } = await mountAt('/')
    expect(marketStatus(wrapper).text()).toBe('● Regular')

    vi.advanceTimersByTime(60_000) // NY 16:00
    await nextTick()

    expect(marketStatus(wrapper).text()).toBe('● After-Hours')
  })

  it('[AHD-05] 画面固有ボタンの差し込み先を空で描画する', async () => {
    const { wrapper } = await mountAt('/')

    const actions = wrapper.find('[data-testid="topbar-actions"]')
    expect(actions.exists()).toBe(true)
    expect(actions.text()).toBe('')
  })

  it('[AHD-06] アンマウントすると定期更新のタイマーが残らない', async () => {
    const { wrapper } = await mountAt('/')

    wrapper.unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
