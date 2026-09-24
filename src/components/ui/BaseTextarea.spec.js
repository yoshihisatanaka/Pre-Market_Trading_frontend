import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseTextarea from './BaseTextarea.vue'

// シナリオ: docs/unit/components-ui-base-textarea.md
describe('BaseTextarea', () => {
  it('[BTX-01] modelValue を入力欄に反映する', () => {
    const wrapper = mount(BaseTextarea, { props: { modelValue: '1 行目\n2 行目' } })

    expect(wrapper.find('textarea').element.value).toBe('1 行目\n2 行目')
  })

  it('[BTX-02] 入力すると update:modelValue が発火する', async () => {
    const wrapper = mount(BaseTextarea, { props: { modelValue: '' } })

    await wrapper.find('textarea').setValue('お知らせ')

    expect(wrapper.emitted('update:modelValue')).toEqual([['お知らせ']])
  })

  it('[BTX-03] 既定の rows は 4', () => {
    const wrapper = mount(BaseTextarea)

    expect(wrapper.find('textarea').attributes('rows')).toBe('4')
  })

  it('[BTX-04] rows を指定できる', () => {
    const wrapper = mount(BaseTextarea, { props: { rows: 8 } })

    expect(wrapper.find('textarea').attributes('rows')).toBe('8')
  })

  it('[BTX-05] invalid のとき aria-invalid と is-invalid が付く', () => {
    const wrapper = mount(BaseTextarea, { props: { invalid: true } })

    const textarea = wrapper.find('textarea')
    expect(textarea.attributes('aria-invalid')).toBe('true')
    expect(textarea.classes()).toContain('is-invalid')
  })

  it('[BTX-06] invalid でないとき aria-invalid は付かない', () => {
    const wrapper = mount(BaseTextarea)

    const textarea = wrapper.find('textarea')
    expect(textarea.attributes('aria-invalid')).toBeUndefined()
    expect(textarea.classes()).not.toContain('is-invalid')
  })

  it('[BTX-07] 宣言していない属性は textarea へ素通しする', () => {
    const wrapper = mount(BaseTextarea, {
      attrs: {
        maxlength: '500',
        placeholder: '例：お知らせ',
        disabled: true,
        id: 'notice-input',
        'aria-describedby': 'hint-1',
      },
    })

    const textarea = wrapper.find('textarea')
    expect(textarea.attributes('maxlength')).toBe('500')
    expect(textarea.attributes('placeholder')).toBe('例：お知らせ')
    expect(textarea.attributes('id')).toBe('notice-input')
    expect(textarea.attributes('aria-describedby')).toBe('hint-1')
    expect(textarea.element.disabled).toBe(true)
  })
})
