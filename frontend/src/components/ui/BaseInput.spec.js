import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseInput from './BaseInput.vue'

// シナリオ: docs/unit/components-ui-base-input.md
describe('BaseInput', () => {
  it('[BIN-01] modelValue を入力欄に反映する', () => {
    const wrapper = mount(BaseInput, { props: { modelValue: 'AAPL' } })

    expect(wrapper.find('input').element.value).toBe('AAPL')
  })

  it('[BIN-02] 入力すると update:modelValue が発火する', async () => {
    const wrapper = mount(BaseInput, { props: { modelValue: '' } })

    await wrapper.find('input').setValue('MSFT')

    expect(wrapper.emitted('update:modelValue')).toEqual([['MSFT']])
  })

  it('[BIN-03] 既定は text / boxed', () => {
    const wrapper = mount(BaseInput)

    const input = wrapper.find('input')
    expect(input.attributes('type')).toBe('text')
    expect(input.attributes('data-variant')).toBe('boxed')
  })

  it('[BIN-04] variant と type を指定できる', () => {
    const wrapper = mount(BaseInput, { props: { variant: 'underline', type: 'number' } })

    const input = wrapper.find('input')
    expect(input.attributes('data-variant')).toBe('underline')
    expect(input.attributes('type')).toBe('number')
  })

  it('[BIN-05] invalid のとき aria-invalid と is-invalid が付く', () => {
    const wrapper = mount(BaseInput, { props: { invalid: true } })

    const input = wrapper.find('input')
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(input.classes()).toContain('is-invalid')
  })

  it('[BIN-06] invalid でないとき aria-invalid は付かない', () => {
    const wrapper = mount(BaseInput)

    expect(wrapper.find('input').attributes('aria-invalid')).toBeUndefined()
  })

  it('[BIN-07] 宣言していない属性は input へ素通しする', () => {
    const wrapper = mount(BaseInput, {
      attrs: { step: '0.0001', maxlength: '5', disabled: true, 'aria-describedby': 'hint-1' },
    })

    const input = wrapper.find('input')
    expect(input.attributes('step')).toBe('0.0001')
    expect(input.attributes('maxlength')).toBe('5')
    expect(input.attributes('aria-describedby')).toBe('hint-1')
    expect(input.element.disabled).toBe(true)
  })
})
