import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseCard from './BaseCard.vue'

// シナリオ: docs/unit/components-ui-base-card.md
describe('BaseCard', () => {
  it('[BCD-01] title をヘッダに、slot を本文に描画する', () => {
    const wrapper = mount(BaseCard, {
      props: { title: '受注不可日一覧' },
      slots: { default: '<p>本文</p>' },
    })

    expect(wrapper.find('.card__title').text()).toBe('受注不可日一覧')
    expect(wrapper.find('.card__body').text()).toBe('本文')
  })

  it('[BCD-02] title も header-actions も無ければヘッダを出さない', () => {
    const wrapper = mount(BaseCard, { slots: { default: '<p>本文</p>' } })

    expect(wrapper.find('.card__header').exists()).toBe(false)
  })

  it('[BCD-03] header-actions だけでもヘッダを出す', () => {
    const wrapper = mount(BaseCard, { slots: { 'header-actions': '<span>6 件</span>' } })

    expect(wrapper.find('.card__header').text()).toContain('6 件')
  })

  it('[BCD-04] flush で本文の余白を外す', () => {
    const wrapper = mount(BaseCard, { props: { flush: true } })

    expect(wrapper.find('.card__body').classes()).toContain('is-flush')
  })
})
