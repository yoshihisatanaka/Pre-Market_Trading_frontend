import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseBadge from './BaseBadge.vue'

// シナリオ: docs/unit/components-ui-base-badge.md
describe('BaseBadge', () => {
  it('[BBG-01] 既定は gray で slot の内容を描画する', () => {
    const wrapper = mount(BaseBadge, { slots: { default: '特定' } })

    expect(wrapper.attributes('data-variant')).toBe('gray')
    expect(wrapper.text()).toBe('特定')
  })

  it('[BBG-02] variant で見た目を変えられる', () => {
    const wrapper = mount(BaseBadge, { props: { variant: 'buy' } })

    expect(wrapper.attributes('data-variant')).toBe('buy')
    expect(wrapper.classes()).toContain('badge--buy')
  })
})
