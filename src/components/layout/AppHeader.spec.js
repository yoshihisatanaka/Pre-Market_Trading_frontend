import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useMarketStatusStore } from '@/stores/marketStatus'
import AppHeader from './AppHeader.vue'

/*
 * ヘッダは通信しない。市場状況はストアに入っている応答を描くだけなので、
 * ここでは**ストアに値を直接置いて**表示を確かめる（HTTP を起こさない）。
 * 応答の変換は api/marketStatus.spec.js、表示内容の組み立ては utils/marketStatus.spec.js の担当。
 *
 * 時刻に依存する部品なので setInterval と Date をまとめて偽装する。
 * 待ち合わせには nextTick を使う（flushPromises は setImmediate 依存）。
 *
 * シナリオ: docs/unit/components-layout-app-header.md
 */
const Page = { render: () => h('div') }

/** レギュラーの窓の中（JST）。既定はここに置き、タイトルの検証が時刻に左右されないようにする */
const DURING_REGULAR = Date.parse('2026-03-03T01:00:00+09:00')
const REGULAR_END = Date.parse('2026-03-03T06:00:00+09:00')

const session = (code, name, hoursJst, hoursEt, startJst, endJst) => ({
  code,
  name,
  nameEn: code,
  hoursJst,
  hoursEt,
  startJst,
  endJst,
  current: false,
})

const regularDay = {
  baseDate: '2026-03-02',
  nowJst: '2026-03-03T01:00:00+09:00',
  nowEt: '2026-03-02T11:00:00-05:00',
  dst: false,
  extendedPre: false,
  closed: false,
  closedReason: '',
  shortened: false,
  shortenedReason: '',
  session: 'REGULAR',
  sessionName: 'レギュラー',
  sessionNameEn: 'Regular',
  sessions: [
    session(
      'PRE',
      'プレ',
      '18:00 - 23:30',
      '04:00 - 09:30',
      '2026-03-02T18:00:00+09:00',
      '2026-03-02T23:30:00+09:00',
    ),
    session(
      'REGULAR',
      'レギュラー',
      '23:30 - 06:00',
      '09:30 - 16:00',
      '2026-03-02T23:30:00+09:00',
      '2026-03-03T06:00:00+09:00',
    ),
    session(
      'AFTER',
      'アフター',
      '06:00 - 10:00',
      '16:00 - 20:00',
      '2026-03-03T06:00:00+09:00',
      '2026-03-03T10:00:00+09:00',
    ),
  ],
}

const closedDay = {
  ...regularDay,
  baseDate: '2026-11-26',
  closed: true,
  closedReason: '感謝祭',
  session: 'CLOSED',
  sessions: [],
}

const shortenedDay = { ...regularDay, shortened: true, shortenedReason: '感謝祭翌日' }

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Page, meta: { title: '注文一覧' } },
      { path: '/:pathMatch(.*)*', component: Page, meta: { title: 'ページが見つかりません' } },
    ],
  })
}

/**
 * ストアの状態を整えてからヘッダをマウントする。
 * `status` に null を渡すと「起動直後でまだ取れていない」状態になる。
 */
async function mountAt(path, { props = {}, status = regularDay, error = null } = {}) {
  const store = useMarketStatusStore()
  store.status = status
  store.error = error

  const router = createTestRouter()
  await router.push(path)
  const wrapper = mount(AppHeader, { props, global: { plugins: [router] } })
  return { wrapper, router, store }
}

const toggleButton = (wrapper) => wrapper.find('[data-testid="sidebar-toggle"]')
const market = (wrapper) => wrapper.find('[data-testid="market"]')
const marketStatus = (wrapper) => wrapper.find('[data-testid="market-status"]')
const marketJst = (wrapper) => wrapper.find('[data-testid="market-jst"]')
const marketEt = (wrapper) => wrapper.find('[data-testid="market-et"]')

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  vi.setSystemTime(DURING_REGULAR)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AppHeader', () => {
  it('[AHD-01] ルートの meta.title を見出しに表示する', async () => {
    const { wrapper } = await mountAt('/')

    expect(wrapper.find('h1').text()).toBe('注文一覧')
  })

  it('[AHD-02] 遷移すると見出しが遷移先のタイトルに変わる', async () => {
    const { wrapper, router } = await mountAt('/')

    await router.push('/masters/fx')
    await nextTick()

    expect(wrapper.find('h1').text()).toBe('ページが見つかりません')
  })

  it('[AHD-03] いまの取引セッションと時間帯をバッジで表示する', async () => {
    const { wrapper } = await mountAt('/')

    expect(market(wrapper).attributes('data-status')).toBe('regular')
    expect(marketStatus(wrapper).text()).toBe('Regular')
    expect(marketJst(wrapper).text()).toBe('日本時間 23:30–翌06:00（冬時間）')
    expect(marketEt(wrapper).text()).toBe('ET 09:30–16:00')
  })

  it('[AHD-04] 次のセッションの開始時刻に達すると、通信せずに表示が切り替わる', async () => {
    const { wrapper, store } = await mountAt('/')
    const load = vi.spyOn(store, 'load').mockResolvedValue(null)

    vi.advanceTimersByTime(REGULAR_END - DURING_REGULAR)
    await nextTick()

    expect(market(wrapper).attributes('data-status')).toBe('afterhours')
    expect(marketStatus(wrapper).text()).toBe('After-Hours')
    expect(marketJst(wrapper).text()).toBe('日本時間 翌06:00–翌10:00（冬時間）')
    expect(marketEt(wrapper).text()).toBe('ET 16:00–20:00')
    expect(load).not.toHaveBeenCalled()
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

  it('[AHD-07] サイドメニューが開いているとメニューボタンが展開中を示す', async () => {
    const { wrapper } = await mountAt('/', { props: { sidebarOpen: true } })

    expect(toggleButton(wrapper).attributes('aria-expanded')).toBe('true')
    expect(toggleButton(wrapper).attributes('aria-controls')).toBe('app-sidebar')
  })

  it('[AHD-08] サイドメニューが閉じているとメニューボタンが折りたたみ中を示す', async () => {
    const { wrapper } = await mountAt('/', { props: { sidebarOpen: false } })

    expect(toggleButton(wrapper).attributes('aria-expanded')).toBe('false')
  })

  it('[AHD-09] メニューボタンの click は開閉を通知するだけで自分では変えない', async () => {
    const { wrapper } = await mountAt('/', { props: { sidebarOpen: true } })

    await toggleButton(wrapper).trigger('click')

    expect(wrapper.emitted('toggle-sidebar')).toHaveLength(1)
    expect(toggleButton(wrapper).attributes('aria-expanded')).toBe('true')
  })

  it('[AHD-10] 休場の日は理由を出し、時間帯を出さない', async () => {
    const { wrapper } = await mountAt('/', { status: closedDay })

    expect(market(wrapper).attributes('data-status')).toBe('holiday')
    expect(marketStatus(wrapper).text()).toBe('Closed')
    expect(marketJst(wrapper).text()).toBe('休場（感謝祭）')
    expect(marketEt(wrapper).text()).toBe('ET Market Holiday')
  })

  it('[AHD-11] まだ取れていないときは推定を出さない', async () => {
    const { wrapper } = await mountAt('/', { status: null })

    expect(marketStatus(wrapper).text()).toBe('—')
    expect(market(wrapper).attributes('data-status')).toBe('unknown')
    expect(marketJst(wrapper).exists()).toBe(false)
    expect(marketEt(wrapper).exists()).toBe(false)
  })

  it('[AHD-12] 取得に失敗しても推定を出さず、ヘッダの他の機能は使える', async () => {
    // component からは api 層を import できない（ESLint のレイヤ規約）。
    // ヘッダが見るのは message だけなので、ここは素の Error で足りる
    const error = new Error('サーバーでエラーが発生しました。')
    const { wrapper } = await mountAt('/', { status: null, error })

    expect(marketStatus(wrapper).text()).toBe('—')
    expect(marketJst(wrapper).text()).toBe('市場状況を取得できません')
    expect(marketEt(wrapper).exists()).toBe(false)

    // 見出しとメニューボタンは通常どおり
    expect(wrapper.find('h1').text()).toBe('注文一覧')
    await toggleButton(wrapper).trigger('click')
    expect(wrapper.emitted('toggle-sidebar')).toHaveLength(1)
  })

  it('[AHD-13] title に基準日と 3 セッションの JST / ET が入る', async () => {
    const { wrapper } = await mountAt('/')

    const title = market(wrapper).attributes('title')
    expect(title).toContain('基準日 2026-03-02（EST）')
    expect(title).toContain('プレ JST 18:00–23:30 / ET 04:00–09:30')
    expect(title).toContain('レギュラー JST 23:30–翌06:00 / ET 09:30–16:00')
    expect(title).toContain('アフター JST 翌06:00–翌10:00 / ET 16:00–20:00')
  })

  it('[AHD-14] 短縮取引日は理由を title にだけ出す', async () => {
    const { wrapper } = await mountAt('/', { status: shortenedDay })

    expect(market(wrapper).attributes('title')).toContain('短縮取引: 感謝祭翌日')
    // モックのヘッダに目印は無いので、バッジの中には出さない
    expect(market(wrapper).text()).not.toContain('短縮取引')

    const normal = await mountAt('/', { status: regularDay })
    expect(market(normal.wrapper).attributes('title')).not.toContain('短縮取引')
  })
})
