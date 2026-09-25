import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseSwitch from './BaseSwitch.vue'

const LABEL = 'IBの発注停止'

function mountSwitch(props = {}, attrs = {}) {
  return mount(BaseSwitch, { props: { modelValue: false, label: LABEL, ...props }, attrs })
}

// シナリオ: docs/unit/components-ui-base-switch.md
describe('BaseSwitch', () => {
  it('[BSW-01] OFF は role="switch" のボタンで aria-checked="false" と aria-label を持つ', () => {
    const wrapper = mountSwitch()

    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.attributes('type')).toBe('button')
    expect(wrapper.attributes('role')).toBe('switch')
    expect(wrapper.attributes('aria-checked')).toBe('false')
    expect(wrapper.attributes('aria-label')).toBe(LABEL)
    expect(wrapper.classes()).not.toContain('is-on')
  })

  it('[BSW-02] ON は aria-checked="true" で is-on が付く', () => {
    const wrapper = mountSwitch({ modelValue: true })

    expect(wrapper.attributes('aria-checked')).toBe('true')
    expect(wrapper.classes()).toContain('is-on')
  })

  it('[BSW-03] click は toggle を emit するだけで、値は変えない', async () => {
    const wrapper = mountSwitch()

    await wrapper.trigger('click')

    expect(wrapper.emitted('toggle')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.attributes('aria-checked')).toBe('false')
  })

  it('[BSW-04] disabled なら disabled 属性が付き、click しても toggle を emit しない', async () => {
    const wrapper = mountSwitch({ disabled: true })

    expect(wrapper.attributes('disabled')).toBeDefined()
    await wrapper.trigger('click')
    expect(wrapper.emitted('toggle')).toBeUndefined()
  })

  it('[BSW-05] data-testid はルートの button に付く', () => {
    const wrapper = mountSwitch({}, { 'data-testid': 'incidents-target-1-action' })

    expect(wrapper.attributes('data-testid')).toBe('incidents-target-1-action')
  })
})
