import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AppLoadingOverlay from './AppLoadingOverlay.vue'

/*
 * 表示だけの部品なので、ストアも MSW も通さず props で状態を作る。
 * 「再試行で読み直す」配線は App.vue 側の責務で、ここでは emit までを見る。
 *
 * シナリオ: docs/unit/components-layout-app-loading-overlay.md
 */
const ERROR = { message: 'サーバーでエラーが発生しました。' }

const exists = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).exists()

describe('AppLoadingOverlay', () => {
  it('[ALO-01] 取得中は覆いと回転マークが出る', () => {
    const wrapper = mount(AppLoadingOverlay, { props: { loading: true } })

    expect(wrapper.find('.app-loading-overlay').exists()).toBe(true)
    expect(exists(wrapper, 'app-loading')).toBe(true)
    expect(wrapper.find('.base-spinner').exists()).toBe(true)
    // 起動画面として読ませる（回転マークだけだと止まった画面と区別が付かない）
    expect(wrapper.text()).toContain('米株発注システム')
    expect(wrapper.find('[role="status"]').text()).toBe('読み込んでいます')
  })

  it('[ALO-02] 取得が終わると覆いが消える', () => {
    const wrapper = mount(AppLoadingOverlay, { props: { loading: false } })

    expect(wrapper.find('.app-loading-overlay').exists()).toBe(false)
    expect(exists(wrapper, 'app-loading')).toBe(false)
  })

  it('[ALO-03] 取得に失敗すると理由と「再試行」が出る', () => {
    const wrapper = mount(AppLoadingOverlay, { props: { loading: false, error: ERROR } })

    expect(wrapper.find('.app-loading-overlay').exists()).toBe(true)
    expect(wrapper.find('[data-testid="app-loading-error"]').text()).toContain(ERROR.message)
    expect(exists(wrapper, 'app-loading-retry')).toBe(true)
    // 失敗の表示に回転マークを混ぜない（まだ読み込んでいるように見える）
    expect(exists(wrapper, 'app-loading')).toBe(false)
  })

  it('[ALO-04] 「再試行」を押すと retry が出る', async () => {
    const wrapper = mount(AppLoadingOverlay, { props: { loading: false, error: ERROR } })

    await wrapper.find('[data-testid="app-loading-retry"]').trigger('click')

    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('[ALO-05] 読み直し中は前回の失敗を見せない', () => {
    const wrapper = mount(AppLoadingOverlay, { props: { loading: true, error: ERROR } })

    expect(exists(wrapper, 'app-loading')).toBe(true)
    expect(exists(wrapper, 'app-loading-error')).toBe(false)
  })
})
