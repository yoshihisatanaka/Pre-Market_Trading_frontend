import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MasterFormDialog from './MasterFormDialog.vue'

const PREFIX = 'blackout-dates'
const TITLE = '休止日の追加'

/*
 * BaseModal の Teleport で body に出るため、teleport を stub して wrapper 内に描画させる
 * （見本: src/components/ui/BaseModal.spec.js の mountModal）。
 */
function mountDialog(props = {}, slots = {}) {
  return mount(MasterFormDialog, {
    props: { open: true, title: TITLE, testidPrefix: PREFIX, ...props },
    slots,
    global: { stubs: { teleport: true } },
  })
}

/** testid は prefix と action から組み立てる（直書きすると振り替わりを検証できない） */
function testid(wrapper, suffix, action = 'add') {
  return wrapper.find(`[data-testid="${PREFIX}-${action}-${suffix}"]`)
}

// シナリオ: docs/unit/components-masters-master-form-dialog.md
describe('MasterFormDialog', () => {
  it('[MFD-01] open が false なら描画しない', () => {
    const wrapper = mountDialog({ open: false })

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('[MFD-02] title と slot をダイアログの中に描画する', () => {
    const wrapper = mountDialog({}, { default: '<input data-testid="field" />' })

    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.text()).toContain(TITLE)
    expect(dialog.find('[data-testid="field"]').exists()).toBe(true)
  })

  it('[MFD-03] action を渡さないと data-testid が -add- になる', () => {
    const wrapper = mountDialog()

    expect(testid(wrapper, 'form').element.tagName).toBe('FORM')
    expect(testid(wrapper, 'cancel').exists()).toBe(true)
    expect(testid(wrapper, 'submit').exists()).toBe(true)
  })

  it('[MFD-04] action="edit" で data-testid が -edit- に振り替わる', () => {
    const wrapper = mountDialog({ action: 'edit' })

    expect(testid(wrapper, 'form', 'edit').element.tagName).toBe('FORM')
    expect(testid(wrapper, 'cancel', 'edit').exists()).toBe(true)
    expect(testid(wrapper, 'submit', 'edit').exists()).toBe(true)
    expect(testid(wrapper, 'form').exists()).toBe(false)
  })

  it('[MFD-05] validationErrors を箇条書きで出す', () => {
    const validationErrors = ['すでに登録されています。', '休場日と重複しています。']
    const wrapper = mountDialog({ validationErrors })

    const items = testid(wrapper, 'validation-error').findAll('li')
    expect(items).toHaveLength(validationErrors.length)
    expect(items.map((item) => item.text())).toEqual(validationErrors)
  })

  it('[MFD-06] validationWarnings は警告として出す', () => {
    const validationWarnings = ['直近の営業日です。']
    const wrapper = mountDialog({ validationWarnings })

    const alert = testid(wrapper, 'validation-warning')
    expect(alert.attributes('data-variant')).toBe('warning')
    expect(alert.findAll('li').map((item) => item.text())).toEqual(validationWarnings)
  })

  it('[MFD-07] validationWarnings があっても送信ボタンは押せる', () => {
    const wrapper = mountDialog({ validationWarnings: ['直近の営業日です。'] })

    expect(testid(wrapper, 'submit').attributes('disabled')).toBeUndefined()
  })

  it('[MFD-08] error を 1 行で出す', () => {
    const error = new Error('登録に失敗しました')
    const wrapper = mountDialog({ error })

    expect(testid(wrapper, 'error').text()).toBe(error.message)
  })

  it('[MFD-09] 3 種類のエラーを同時に渡すと 3 つとも出る', () => {
    const wrapper = mountDialog({
      validationErrors: ['すでに登録されています。'],
      validationWarnings: ['直近の営業日です。'],
      error: new Error('登録に失敗しました'),
    })

    expect(testid(wrapper, 'validation-error').exists()).toBe(true)
    expect(testid(wrapper, 'validation-warning').exists()).toBe(true)
    expect(testid(wrapper, 'error').exists()).toBe(true)
  })

  it('[MFD-10] エラーを渡さなければどの枠も出ない', () => {
    const wrapper = mountDialog()

    expect(testid(wrapper, 'validation-error').exists()).toBe(false)
    expect(testid(wrapper, 'validation-warning').exists()).toBe(false)
    expect(testid(wrapper, 'error').exists()).toBe(false)
  })

  it('[MFD-11] submitLabel を渡さないと送信ボタンは「追加」になる', () => {
    const wrapper = mountDialog()

    expect(testid(wrapper, 'submit').text()).toBe('追加')
  })

  it('[MFD-12] pending 中は送信ボタンが「追加中…」になる', () => {
    const wrapper = mountDialog({ pending: true })

    expect(testid(wrapper, 'submit').text()).toBe('追加中…')
  })

  it('[MFD-13] submitLabel が「更新」なら pending 中は「更新中…」になる', () => {
    const wrapper = mountDialog({ submitLabel: '更新', pending: true })

    expect(testid(wrapper, 'submit').text()).toBe('更新中…')
  })

  it('[MFD-14] pending 中はキャンセルも送信も押せない', () => {
    const wrapper = mountDialog({ pending: true })

    expect(testid(wrapper, 'cancel').attributes('disabled')).toBeDefined()
    expect(testid(wrapper, 'submit').attributes('disabled')).toBeDefined()
  })

  it('[MFD-15] キャンセルボタンで close を発火する', async () => {
    const wrapper = mountDialog()

    await testid(wrapper, 'cancel').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('[MFD-16] 送信ボタンで submit を発火する', async () => {
    const wrapper = mountDialog()

    await testid(wrapper, 'submit').trigger('click')

    expect(wrapper.emitted('submit')).toHaveLength(1)
  })

  it('[MFD-17] form の submit でも submit を発火する', async () => {
    const wrapper = mountDialog()

    await testid(wrapper, 'form').trigger('submit')

    expect(wrapper.emitted('submit')).toHaveLength(1)
  })
})
