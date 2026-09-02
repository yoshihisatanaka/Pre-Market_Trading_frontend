import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseSelect from './BaseSelect.vue'

const options = [
  { value: '123', label: '123 A支店' },
  { value: '234', label: '234 B支店' },
  { value: '345', label: '345 C支店' },
]

// シナリオ: docs/unit/components-ui-base-select.md
describe('BaseSelect', () => {
  it('[BSL-01] options を順に描画する', () => {
    const wrapper = mount(BaseSelect, { props: { options } })

    expect(wrapper.findAll('option').map((o) => o.text())).toEqual([
      '123 A支店',
      '234 B支店',
      '345 C支店',
    ])
  })

  it('[BSL-02] placeholder を渡すと空値の選択肢が先頭に増える', () => {
    const wrapper = mount(BaseSelect, { props: { options, placeholder: '-- 全部店 --' } })

    const first = wrapper.findAll('option')[0]
    expect(first.attributes('value')).toBe('')
    expect(first.text()).toBe('-- 全部店 --')
  })

  it('[BSL-03] placeholder が無ければ空値の選択肢は増えない', () => {
    const wrapper = mount(BaseSelect, { props: { options } })

    expect(wrapper.findAll('option')).toHaveLength(options.length)
  })

  it('[BSL-04] 選ぶと update:modelValue が発火する', async () => {
    const wrapper = mount(BaseSelect, { props: { options, modelValue: '' } })

    await wrapper.find('select').setValue('234')

    expect(wrapper.emitted('update:modelValue')).toEqual([['234']])
  })

  it('[BSL-05] invalid のとき aria-invalid と is-invalid が付く', () => {
    const wrapper = mount(BaseSelect, { props: { options, invalid: true } })

    const select = wrapper.find('select')
    expect(select.attributes('aria-invalid')).toBe('true')
    expect(select.classes()).toContain('is-invalid')
  })

  it('[BSL-06] variant を指定できる', () => {
    const wrapper = mount(BaseSelect, { props: { options, variant: 'underline' } })

    expect(wrapper.find('select').attributes('data-variant')).toBe('underline')
  })
})
