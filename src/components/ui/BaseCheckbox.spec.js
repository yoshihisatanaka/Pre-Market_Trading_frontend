import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseCheckbox from './BaseCheckbox.vue'

// シナリオ: docs/unit/components-ui-base-checkbox.md
describe('BaseCheckbox', () => {
  it('[BCK-01] ラベルを描画し、未チェックで始まる', () => {
    const wrapper = mount(BaseCheckbox, { props: { label: '強制区分', modelValue: false } })

    expect(wrapper.text()).toContain('強制区分')
    expect(wrapper.find('input').element.checked).toBe(false)
  })

  it('[BCK-02] チェックすると update:modelValue が true で発火する', async () => {
    const wrapper = mount(BaseCheckbox, { props: { modelValue: false } })

    await wrapper.find('input').setValue(true)

    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
  })

  it('[BCK-03] modelValue が true ならチェック済みで描画する', () => {
    const wrapper = mount(BaseCheckbox, { props: { modelValue: true } })

    expect(wrapper.find('input').element.checked).toBe(true)
  })

  it('[BCK-04] disabled はルートの label ではなく input に付く', () => {
    const wrapper = mount(BaseCheckbox, { attrs: { disabled: true } })

    expect(wrapper.find('input').element.disabled).toBe(true)
    expect(wrapper.attributes('disabled')).toBeUndefined()
  })
})
