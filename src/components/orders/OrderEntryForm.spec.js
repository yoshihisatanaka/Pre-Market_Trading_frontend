import { describe, expect, it } from 'vitest'
import { h, reactive } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { buildExpiryOptions, createOrderForm } from '@/utils/orderEntryForm'
import { ORDER_PERSON_MAX_LENGTH, ORDER_TYPE, SIDE } from '@/utils/orderEntryOptions'
import OrderEntryForm from './OrderEntryForm.vue'

/*
 * 部品のテスト。フォームの値（v-model のオブジェクト）・props（errors / ヒント / 送信可否）・emit の
 * 入出力だけを見る。照会・検証・送信の判断は画面側（views/OrderEntryView.spec.js）で見る。
 */
const NOW = new Date(2026, 8, 29, 10, 30)
const EXPIRY_OPTIONS = buildExpiryOptions({ today: NOW })

function mountForm({ props = {}, slots } = {}) {
  const form = reactive(createOrderForm({ now: NOW }))
  const wrapper = mount(OrderEntryForm, {
    props: {
      modelValue: form,
      'onUpdate:modelValue': (value) => Object.assign(form, value),
      expiryOptions: EXPIRY_OPTIONS,
      ...props,
    },
    slots,
    // 注文種別の選択肢をコードマスタのストアから引くので Pinia を渡す（ここでは読み込まない。
    // 選択肢の中身は views/OrderEntryView.spec.js の NOV-21 が見る）
    global: { plugins: [createPinia()] },
  })
  return { wrapper, form }
}

const find = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const segment = (wrapper, testid, value) => wrapper.find(`[data-testid="${testid}"] [data-value="${value}"]`)

// シナリオ: docs/unit/components-orders-order-entry-form.md
describe('OrderEntryForm', () => {
  it('[NOC-13] 受注者の欄は最大文字数までしか打てず、入力が orderPerson に入る', async () => {
    const { wrapper, form } = mountForm()
    const input = find(wrapper, 'order-entry-order-person')

    expect(input.attributes('maxlength')).toBe(String(ORDER_PERSON_MAX_LENGTH))
    await input.setValue('T001')
    expect(form.orderPerson).toBe('T001')
  })

  it('[NOC-01] 売買区分でフォームの色が変わる', async () => {
    const { wrapper, form } = mountForm()
    const root = find(wrapper, 'order-entry-form')
    expect(root.classes()).not.toContain('is-buy')
    expect(root.classes()).not.toContain('is-sell')

    await segment(wrapper, 'order-entry-side', SIDE.BUY).trigger('click')
    expect(form.side).toBe(SIDE.BUY)
    expect(root.classes()).toContain('is-buy')

    await segment(wrapper, 'order-entry-side', SIDE.SELL).trigger('click')
    expect(form.side).toBe(SIDE.SELL)
    expect(root.classes()).toContain('is-sell')
    expect(root.classes()).not.toContain('is-buy')
  })

  it('[NOC-02] 指値で価格欄が出て、成行に戻すと値が消える', async () => {
    const { wrapper, form } = mountForm()
    expect(find(wrapper, 'order-entry-limit-price').exists()).toBe(false)

    await segment(wrapper, 'order-entry-order-type', ORDER_TYPE.LIMIT).trigger('click')
    await find(wrapper, 'order-entry-limit-price').setValue('200.5')
    expect(form.orderType).toBe(ORDER_TYPE.LIMIT)
    expect(form.limitPrice).toBe('200.5')

    await segment(wrapper, 'order-entry-order-type', ORDER_TYPE.MARKET).trigger('click')
    expect(find(wrapper, 'order-entry-limit-price').exists()).toBe(false)
    expect(form.orderType).toBe(ORDER_TYPE.MARKET)
    expect(form.limitPrice).toBe('')
  })

  it('[NOC-03] 注文数量はカンマ区切りになり、数字以外は表示に残らない', async () => {
    const { wrapper, form } = mountForm()
    const input = find(wrapper, 'order-entry-quantity')

    await input.setValue('1234')
    expect(input.element.value).toBe('1,234')
    expect(form.quantity).toBe('1,234')

    await input.setValue('1,234a')
    expect(input.element.value).toBe('1,234')
    expect(form.quantity).toBe('1,234')
  })

  it('[NOC-04] 受注日は MM/DD、受注時刻は HH:MM に整形される', async () => {
    const { wrapper, form } = mountForm()
    const date = find(wrapper, 'order-entry-order-date')
    const time = find(wrapper, 'order-entry-order-time')

    await date.setValue('0929')
    await time.setValue('1125')
    expect(date.element.value).toBe('09/29')
    expect(time.element.value).toBe('11:25')
    expect(form.orderDate).toBe('09/29')
    expect(form.orderTime).toBe('11:25')

    await date.setValue('09/29x')
    expect(date.element.value).toBe('09/29')
    expect(form.orderDate).toBe('09/29')
  })

  it('[NOC-05] ティッカーは大文字になる', async () => {
    const { wrapper, form } = mountForm()
    const input = find(wrapper, 'order-entry-ticker')

    await input.setValue('aapl')

    expect(input.element.value).toBe('AAPL')
    expect(form.ticker).toBe('AAPL')
  })

  it('[NOC-06] errors の文言が項目の下に出る', () => {
    const errors = {
      branchCode: '部店コードを入力してください。',
      side: '売買区分を選択してください。',
      quantity: '注文数量を入力してください。',
    }
    const { wrapper } = mountForm({ props: { errors } })

    const alerts = wrapper.findAll('[role="alert"]').map((node) => node.text())
    expect(alerts).toEqual(expect.arrayContaining(Object.values(errors)))
    expect(alerts).toHaveLength(Object.keys(errors).length)
  })

  it('[NOC-07] 照会のヒントを tone の見た目で出し、空なら出さない', () => {
    const { wrapper } = mountForm({
      props: {
        customerHint: { text: '山田 太郎', tone: 'found' },
        symbolHint: { text: '銘柄なし', tone: 'not-found' },
      },
    })
    const accountHint = find(wrapper, 'order-entry-account-hint')
    const tickerHint = find(wrapper, 'order-entry-ticker-hint')
    expect(accountHint.text()).toBe('山田 太郎')
    expect(accountHint.classes()).toContain('is-found')
    expect(tickerHint.text()).toBe('銘柄なし')
    expect(tickerHint.classes()).toContain('is-not-found')

    const { wrapper: empty } = mountForm({ props: { customerHint: { text: '', tone: '' } } })
    expect(find(empty, 'order-entry-account-hint').exists()).toBe(false)
    expect(find(empty, 'order-entry-ticker-hint').exists()).toBe(false)
  })

  it('[NOC-08] フロコン警告ありのときだけ強制区分の注記が出る', () => {
    const { wrapper: warned } = mountForm({ props: { warned: true } })
    expect(find(warned, 'order-entry-forced-note').text()).toBe('フロコン警告あり — 確認の上チェック')

    const { wrapper: quiet } = mountForm()
    expect(find(quiet, 'order-entry-forced-note').exists()).toBe(false)
  })

  it('[NOC-09] disabled / submitting では送信ボタンが押せない', () => {
    const { wrapper: normal } = mountForm()
    expect(find(normal, 'order-entry-submit').attributes('disabled')).toBeUndefined()
    expect(find(normal, 'order-entry-submit').text()).toBe('送信')

    const { wrapper: disabled } = mountForm({ props: { disabled: true } })
    expect(find(disabled, 'order-entry-submit').attributes('disabled')).toBeDefined()

    const { wrapper: submitting } = mountForm({ props: { submitting: true } })
    expect(find(submitting, 'order-entry-submit').attributes('disabled')).toBeDefined()
    expect(find(submitting, 'order-entry-submit').text()).toBe('確認中…')
  })

  it('[NOC-10] submit で submit を emit する', async () => {
    const { wrapper } = mountForm()

    await find(wrapper, 'order-entry-form').trigger('submit')

    expect(wrapper.emitted('submit')).toHaveLength(1)
  })

  it('[NOC-11] 期間指定の選択肢を並べる', () => {
    const options = EXPIRY_OPTIONS.slice(0, 2)
    const { wrapper } = mountForm({ props: { expiryOptions: options } })

    const labels = find(wrapper, 'order-entry-expiry')
      .findAll('option')
      .map((node) => node.text())
    expect(labels).toEqual(options.map((option) => option.label))
  })

  it('[NOC-12] customer スロットを描く', () => {
    const { wrapper } = mountForm({
      slots: { customer: () => h('div', { 'data-testid': 'slot-customer' }, '顧客バー') },
    })

    expect(find(wrapper, 'order-entry-form').find('[data-testid="slot-customer"]').text()).toBe(
      '顧客バー',
    )
  })
})
