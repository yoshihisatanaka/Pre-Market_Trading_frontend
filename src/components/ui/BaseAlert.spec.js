import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseAlert from './BaseAlert.vue'

// シナリオ: docs/unit/components-ui-base-alert.md
describe('BaseAlert', () => {
  it('[BAL-01] 既定は info で status として読ませる', () => {
    const wrapper = mount(BaseAlert, { slots: { default: '1行目はヘッダー行です。' } })

    expect(wrapper.attributes('data-variant')).toBe('info')
    expect(wrapper.attributes('role')).toBe('status')
    expect(wrapper.text()).toBe('1行目はヘッダー行です。')
  })

  it('[BAL-02] error は alert として読ませる', () => {
    const wrapper = mount(BaseAlert, { props: { variant: 'error' } })

    expect(wrapper.attributes('data-variant')).toBe('error')
    expect(wrapper.attributes('role')).toBe('alert')
  })

  it('[BAL-03] warning は status のまま', () => {
    const wrapper = mount(BaseAlert, { props: { variant: 'warning' } })

    expect(wrapper.attributes('data-variant')).toBe('warning')
    expect(wrapper.attributes('role')).toBe('status')
  })
})
