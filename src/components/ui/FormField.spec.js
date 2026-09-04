import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { mount } from '@vue/test-utils'
import FormField from './FormField.vue'

/*
 * slot に渡す `field`（id / required / invalid / aria-describedby）が正しく組み立てられるかを見る。
 * 受け取り側の描画は各入力部品のテストに任せる。
 */
function mountField(props = {}) {
  const captured = {}
  const wrapper = mount(FormField, {
    props: { label: '口座番号', ...props },
    slots: {
      default: ({ field }) => {
        Object.assign(captured, field)
        return null
      },
    },
  })
  return { wrapper, field: captured }
}

// シナリオ: docs/unit/components-ui-form-field.md
describe('FormField', () => {
  it('[FLD-01] ラベルを描画し for を slot の id に合わせる', () => {
    const { wrapper, field } = mountField()

    const label = wrapper.find('label')
    expect(label.text()).toContain('口座番号')
    expect(label.attributes('for')).toBe(field.id)
  })

  it('[FLD-02] required のとき必須マークと読み上げ用の文言を出す', () => {
    const { wrapper, field } = mountField({ required: true })

    expect(wrapper.find('.form-field__required').text()).toBe('*')
    expect(wrapper.find('.visually-hidden').text()).toBe('（必須）')
    expect(field.required).toBe(true)
  })

  it('[FLD-03] error のとき文言を alert として出し invalid を渡す', () => {
    const { wrapper, field } = mountField({ error: '必須です' })

    const error = wrapper.find('[role="alert"]')
    expect(error.text()).toBe('必須です')
    expect(field.invalid).toBe(true)
  })

  it('[FLD-04] hint と error の両方があるとき aria-describedby に両方の id が並ぶ', () => {
    const { wrapper, field } = mountField({ hint: '半角数字', error: '必須です' })

    const ids = field['aria-describedby'].split(' ')
    expect(ids).toHaveLength(2)
    expect(ids).toContain(wrapper.find('.form-field__hint').attributes('id'))
    expect(ids).toContain(wrapper.find('.form-field__error').attributes('id'))
  })

  it('[FLD-05] hint も error も無いとき aria-describedby は付かない', () => {
    const { field } = mountField()

    expect(field['aria-describedby']).toBeUndefined()
  })

  it('[FLD-06] layout="inline" では必須マークが ● になる', () => {
    const { wrapper } = mountField({ required: true, layout: 'inline' })

    expect(wrapper.classes()).toContain('form-field--inline')
    expect(wrapper.find('.form-field__required').text()).toBe('●')
  })

  it('[FLD-07] 複数置いても id が衝突しない', () => {
    // useId は同じアプリの中で連番になるため、1 つのツリーに 2 つ並べて確かめる
    const wrapper = mount(() =>
      h('div', [h(FormField, { label: '部店' }), h(FormField, { label: '口座番号' })]),
    )

    const [first, second] = wrapper.findAll('label').map((label) => label.attributes('for'))
    expect(first).not.toBe(second)
  })
})
