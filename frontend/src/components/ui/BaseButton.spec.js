import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseButton from './BaseButton.vue'

// シナリオ: docs/unit/components-ui-base-button.md
describe('BaseButton', () => {
  it('[BBT-01] 既定は primary / md の button', () => {
    const wrapper = mount(BaseButton, { slots: { default: '検索' } })

    expect(wrapper.attributes('type')).toBe('button')
    expect(wrapper.classes()).toContain('base-button--primary')
    expect(wrapper.classes()).toContain('base-button--md')
    expect(wrapper.text()).toBe('検索')
  })

  it('[BBT-02] variant と size を指定できる', () => {
    const wrapper = mount(BaseButton, { props: { variant: 'success', size: 'sm' } })

    expect(wrapper.classes()).toContain('base-button--success')
    expect(wrapper.classes()).toContain('base-button--sm')
  })

  it('[BBT-03] block で横幅いっぱいにする', () => {
    const wrapper = mount(BaseButton, { props: { block: true } })

    expect(wrapper.classes()).toContain('is-block')
  })

  it('[BBT-04] disabled を渡すとボタンが無効になる', () => {
    const wrapper = mount(BaseButton, { props: { disabled: true } })

    expect(wrapper.element.disabled).toBe(true)
  })

  it('[BBT-05] click はそのまま呼び出し側へ届く', async () => {
    const onClick = vi.fn()
    const wrapper = mount(BaseButton, { attrs: { onClick } })

    await wrapper.trigger('click')

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('[BBT-06] type を submit にできる', () => {
    const wrapper = mount(BaseButton, { props: { type: 'submit' } })

    expect(wrapper.attributes('type')).toBe('submit')
  })
})
