import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MasterSearchCard from './MasterSearchCard.vue'

const PREFIX = 'market-holidays'

function mountCard(props = {}, slots = {}) {
  return mount(MasterSearchCard, {
    props: { testidPrefix: PREFIX, ...props },
    slots,
  })
}

/** testid は prefix から組み立てる（文字列を直書きすると prefix の反映を検証できない） */
function testid(wrapper, suffix) {
  return wrapper.find(`[data-testid="${PREFIX}-${suffix}"]`)
}

// シナリオ: docs/unit/components-masters-master-search-card.md
describe('MasterSearchCard', () => {
  it('[MSC-01] testidPrefix を form と 2 つのボタンの data-testid に反映する', () => {
    const wrapper = mountCard()

    expect(testid(wrapper, 'search').element.tagName).toBe('FORM')
    expect(testid(wrapper, 'search-submit').exists()).toBe(true)
    expect(testid(wrapper, 'search-clear').exists()).toBe(true)
  })

  it('[MSC-02] 既定スロットを入力欄の器の中に描画する', () => {
    const wrapper = mountCard({}, { default: '<label data-testid="field">年</label>' })

    expect(wrapper.find('.form-grid').find('[data-testid="field"]').exists()).toBe(true)
  })

  it('[MSC-03] columns を渡さないと 4 列になる', () => {
    const wrapper = mountCard()

    expect(wrapper.find('.form-grid').classes()).toContain('form-grid--4')
  })

  it('[MSC-04] columns に 2 を渡すと 2 列になる', () => {
    const wrapper = mountCard({ columns: 2 })

    expect(wrapper.find('.form-grid').classes()).toContain('form-grid--2')
  })

  it('[MSC-05] form の submit で submit を発火する', async () => {
    const wrapper = mountCard()

    await testid(wrapper, 'search').trigger('submit')

    expect(wrapper.emitted('submit')).toHaveLength(1)
  })

  it('[MSC-06] クリアボタンで clear を発火する', async () => {
    const wrapper = mountCard()

    await testid(wrapper, 'search-clear').trigger('click')

    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('[MSC-07] 既定では検索もクリアも押せる', () => {
    const wrapper = mountCard()

    expect(testid(wrapper, 'search-submit').attributes('disabled')).toBeUndefined()
    expect(testid(wrapper, 'search-clear').attributes('disabled')).toBeUndefined()
  })

  it('[MSC-08] disabled で検索もクリアも押せなくなる', () => {
    const wrapper = mountCard({ disabled: true })

    expect(testid(wrapper, 'search-submit').attributes('disabled')).toBeDefined()
    expect(testid(wrapper, 'search-clear').attributes('disabled')).toBeDefined()
  })

  it('[MSC-09] disabled でも入力欄は無効にならない', () => {
    const wrapper = mountCard({ disabled: true })

    expect(wrapper.find('fieldset').attributes('disabled')).toBeUndefined()
  })

  it('[MSC-10] optionsLoading で入力欄がまとめて無効になる', () => {
    const wrapper = mountCard({ optionsLoading: true })

    expect(wrapper.find('fieldset').attributes('disabled')).toBeDefined()
  })

  it('[MSC-11] optionsLoading で検索もクリアも押せなくなる', () => {
    const wrapper = mountCard({ optionsLoading: true })

    expect(testid(wrapper, 'search-submit').attributes('disabled')).toBeDefined()
    expect(testid(wrapper, 'search-clear').attributes('disabled')).toBeDefined()
  })

  it('[MSC-12] optionsLoading で回転マークを出す', () => {
    const wrapper = mountCard({ optionsLoading: true })

    expect(testid(wrapper, 'options-loading').exists()).toBe(true)
  })

  it('[MSC-13] optionsLoading を渡さなければ回転マークは出ない', () => {
    const wrapper = mountCard()

    expect(testid(wrapper, 'options-loading').exists()).toBe(false)
  })
})
