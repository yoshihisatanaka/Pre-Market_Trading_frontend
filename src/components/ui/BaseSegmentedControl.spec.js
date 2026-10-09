import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseSegmentedControl from './BaseSegmentedControl.vue'

const options = [
  { value: '特定', label: '特定' },
  { value: '一般', label: '一般' },
  { value: 'NISA', label: 'NISA' },
]

const sideOptions = [
  { value: '買', label: '買い', tone: 'buy' },
  { value: '売', label: '売り', tone: 'sell' },
]

// シナリオ: docs/unit/components-ui-base-segmented-control.md
describe('BaseSegmentedControl', () => {
  it('[BSC-01] options を順にボタンとして描画する', () => {
    const wrapper = mount(BaseSegmentedControl, { props: { options } })

    const buttons = wrapper.findAll('button')
    expect(buttons.map((b) => b.text())).toEqual(['特定', '一般', 'NISA'])
    expect(buttons.every((b) => b.attributes('type') === 'button')).toBe(true)
  })

  it('[BSC-02] 選択中のボタンだけが押下状態になる', () => {
    const wrapper = mount(BaseSegmentedControl, { props: { options, modelValue: '一般' } })

    const buttons = wrapper.findAll('button')
    expect(buttons.map((b) => b.attributes('data-selected'))).toEqual(['false', 'true', 'false'])
    expect(buttons[1].attributes('aria-pressed')).toBe('true')
  })

  it('[BSC-03] 押すと update:modelValue が発火する', async () => {
    const wrapper = mount(BaseSegmentedControl, { props: { options, modelValue: '特定' } })

    await wrapper.findAll('button')[2].trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([['NISA']])
  })

  it('[BSC-04] tone を data-tone として出す', () => {
    const wrapper = mount(BaseSegmentedControl, { props: { options: sideOptions } })

    expect(wrapper.findAll('button').map((b) => b.attributes('data-tone'))).toEqual(['buy', 'sell'])
  })

  it('[BSC-05] disabled のとき全ボタンが無効になる', () => {
    const wrapper = mount(BaseSegmentedControl, { props: { options, disabled: true } })

    expect(wrapper.findAll('button').every((b) => b.element.disabled)).toBe(true)
  })

  it('[BSC-06] disabled のとき押しても値は変わらない', async () => {
    const wrapper = mount(BaseSegmentedControl, {
      props: { options, modelValue: '特定', disabled: true },
    })

    await wrapper.findAll('button')[1].trigger('click')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('[BSC-07] disabled を付けた選択肢だけが無効になり、押しても値は変わらない', async () => {
    const wrapper = mount(BaseSegmentedControl, {
      props: { options: [options[0], { ...options[1], disabled: true }], modelValue: '特定' },
    })

    const buttons = wrapper.findAll('button')
    expect(buttons.map((b) => b.element.disabled)).toEqual([false, true])

    await buttons[1].trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('[BSC-08] note はラベルの後ろに添え書きとして出る', () => {
    const wrapper = mount(BaseSegmentedControl, {
      props: { options: [options[0], { ...options[1], note: '（Ph.2予定）' }] },
    })

    const buttons = wrapper.findAll('button')
    expect(buttons[0].find('.segmented__note').exists()).toBe(false)
    expect(buttons[1].find('.segmented__note').text()).toBe('（Ph.2予定）')
    expect(buttons[1].text()).toBe('一般（Ph.2予定）')
  })
})
