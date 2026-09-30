import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { dreamOrders } from '@/mocks/fixtures/dreamStatus'
import { formatQuantity, joinWide } from '@/utils/format'
import DreamStatusChangeDialog from './DreamStatusChangeDialog.vue'

/*
 * order は store の items の 1 行（アプリ内モデル）。component から api 層は import できないので、
 * フィクスチャ（生の形）からここで組み立てる。部品が読む項目だけを写す。
 */
const SIDES = { 1: 'sell', 3: 'buy' }

function toOrder(raw, overrides = {}) {
  return {
    id: String(raw.ID),
    status: raw.Dream状況,
    statusName: raw.Dream状況名 ?? '',
    canChangeStatus: raw.STS変更可 === true,
    statusTransitions: raw.変更可能状況.map((t) => ({ code: t.コード, name: t.名称 })),
    receiptNumber: raw.受注番号 ?? '',
    accountNumber: String(raw.口座番号),
    customerName: raw.顧客名 ?? '',
    symbolCode: raw.銘柄コード,
    ticker: raw.Ticker,
    side: SIDES[raw.売買区分] ?? '',
    sideName: raw.売買区分名 ?? '',
    quantity: raw.数量,
    ...overrides,
  }
}

/** 登録失敗で受注番号の無い行（遷移先に 0 / 2 / 8 を持つ） */
const FAILED_RAW = dreamOrders.find((row) => row.Dream状況 === '9' && row.受注番号 === null)
const FAILED = toOrder(FAILED_RAW)
/** 取消失敗の行（遷移先に C0 / C2 を持つ） */
const CANCEL_FAILED = toOrder(dreamOrders.find((row) => row.Dream状況 === 'C9'))
/** 受付番号が設定済みの登録失敗の行（受注番号はフィクスチャの別の行から借りる） */
const FAILED_WITH_RECEIPT = toOrder(FAILED_RAW, {
  receiptNumber: dreamOrders.find((row) => row.受注番号).受注番号,
})

const REGISTERED = '2'
const RECEIPT = 'DR-20260928-9999'
const REASON = 'Dream 側で手入力済み'

const mounted = []

afterEach(() => {
  // BaseModal が document に付けた Esc のリスナを外す
  while (mounted.length) mounted.pop().unmount()
})

/** BaseModal の Teleport を stub して wrapper 内に描画させる。既定は登録失敗の行を「未登録」へ */
function mountDialog(props = {}) {
  const wrapper = mount(DreamStatusChangeDialog, {
    props: { open: true, order: FAILED, targetStatus: '0', ...props },
    global: { stubs: { teleport: true } },
  })
  mounted.push(wrapper)
  return wrapper
}

const byTestid = (wrapper, suffix) => wrapper.find(`[data-testid="dream-status-change-${suffix}"]`)
const dialogOf = (wrapper) => wrapper.find('[role="dialog"]')
const receiptInput = (wrapper) => byTestid(wrapper, 'receipt-number')
const summaryOf = (wrapper) => {
  const summary = byTestid(wrapper, 'summary')
  const values = summary.findAll('dd')
  return Object.fromEntries(summary.findAll('dt').map((dt, i) => [dt.text(), values[i].text()]))
}
const nameOf = (order, code) => order.statusTransitions.find((t) => t.code === code).name

// シナリオ: docs/unit/components-orders-dream-status-change-dialog.md
describe('DreamStatusChangeDialog', () => {
  it('[DSD-01] open が false なら何も描画しない', () => {
    const wrapper = mountDialog({ open: false })

    expect(dialogOf(wrapper).exists()).toBe(false)
    expect(byTestid(wrapper, 'dialog').exists()).toBe(false)
  })

  it('[DSD-02] 見出しと対象の注文・現在の状況・変更後を出す', () => {
    const wrapper = mountDialog()

    expect(dialogOf(wrapper).attributes('aria-label')).toBe('Dream状況を変更しますか？')
    expect(summaryOf(wrapper)).toEqual({
      注文ID: `#${FAILED.id}`,
      顧客: `${FAILED.accountNumber} ${FAILED.customerName}`,
      銘柄: joinWide(FAILED.ticker, `${FAILED.sideName} ${formatQuantity(FAILED.quantity)}`),
      現在の状況: FAILED.statusName,
      変更後: nameOf(FAILED, '0'),
    })
  })

  it('[DSD-03] 受注番号の無い行を登録済へ変えるときは必須の受付番号欄を出す', () => {
    const wrapper = mountDialog({ targetStatus: REGISTERED })

    const input = receiptInput(wrapper)
    expect(input.exists()).toBe(true)
    expect(input.attributes('required')).toBeDefined()
    const label = wrapper.find(`label[for="${input.attributes('id')}"]`)
    expect(label.text()).toContain('Dream受付番号')
    expect(label.text()).toContain('必須')
  })

  it('[DSD-04] 受注番号が設定済みなら登録済へ変えるときも受付番号欄を出さない', () => {
    const wrapper = mountDialog({ order: FAILED_WITH_RECEIPT, targetStatus: REGISTERED })

    expect(byTestid(wrapper, 'dialog').exists()).toBe(true)
    expect(receiptInput(wrapper).exists()).toBe(false)
  })

  it('[DSD-05] 登録済以外へ変えるときは受付番号欄を出さない', () => {
    for (const [order, targetStatus] of [
      [FAILED, '0'],
      [FAILED, '8'],
      [CANCEL_FAILED, 'C2'],
    ]) {
      const wrapper = mountDialog({ order, targetStatus })

      expect(byTestid(wrapper, 'dialog').exists()).toBe(true)
      expect(receiptInput(wrapper).exists()).toBe(false)
    }
  })

  it('[DSD-06] 変更理由の入力欄を出し、エラーと未接続の案内は出さない', () => {
    const wrapper = mountDialog({ error: null })

    expect(byTestid(wrapper, 'reason').exists()).toBe(true)
    expect(byTestid(wrapper, 'error').exists()).toBe(false)
    expect(byTestid(wrapper, 'pending').exists()).toBe(false)
  })

  it('[DSD-07] 「変更する」で遷移先・受付番号・理由を confirm に載せる', async () => {
    const wrapper = mountDialog({ targetStatus: REGISTERED })

    await receiptInput(wrapper).setValue(RECEIPT)
    await byTestid(wrapper, 'reason').setValue(REASON)

    const submit = byTestid(wrapper, 'submit')
    expect(submit.text()).toBe('変更する')
    expect(submit.attributes('disabled')).toBeUndefined()

    await submit.trigger('click')

    expect(wrapper.emitted('confirm')).toEqual([
      [{ status: REGISTERED, receiptNumber: RECEIPT, reason: REASON }],
    ])
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('[DSD-08] 「キャンセル」で close を 1 回 emit する', async () => {
    const wrapper = mountDialog()

    await byTestid(wrapper, 'cancel').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('[DSD-09] Esc とオーバーレイのクリックでも close を emit する', async () => {
    const wrapper = mountDialog()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.find('[role="presentation"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(2)
  })

  it('[DSD-10] 閉じて開き直すと受付番号と理由が空に戻る', async () => {
    const wrapper = mountDialog({ targetStatus: REGISTERED })
    await receiptInput(wrapper).setValue(RECEIPT)
    await byTestid(wrapper, 'reason').setValue(REASON)

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(receiptInput(wrapper).element.value).toBe('')
    expect(byTestid(wrapper, 'reason').element.value).toBe('')
  })

  it('[DSD-11] order が null でも例外を投げずに描画する', () => {
    const wrapper = mountDialog({ order: null })

    expect(byTestid(wrapper, 'dialog').exists()).toBe(true)
    expect(byTestid(wrapper, 'summary').findAll('dt')).toHaveLength(0)
  })

  it('[DSD-12] 遷移先が行の遷移先一覧に無ければコードをそのまま出す', () => {
    const unknown = 'X9'
    expect(FAILED.statusTransitions.some((t) => t.code === unknown)).toBe(false)

    const wrapper = mountDialog({ targetStatus: unknown })

    expect(summaryOf(wrapper).変更後).toBe(unknown)
  })

  it('[DSD-13] 受付番号欄が出ない遷移先では receiptNumber を空で送る', async () => {
    for (const [order, targetStatus] of [
      [FAILED, '0'],
      [FAILED_WITH_RECEIPT, REGISTERED],
    ]) {
      const wrapper = mountDialog({ order, targetStatus })
      expect(receiptInput(wrapper).exists()).toBe(false)

      await byTestid(wrapper, 'reason').setValue(REASON)
      await byTestid(wrapper, 'submit').trigger('click')

      expect(wrapper.emitted('confirm')).toEqual([
        [{ status: targetStatus, receiptNumber: '', reason: REASON }],
      ])
    }
  })

  it('[DSD-14] 受付番号が要るのに空なら欄にエラーを出して emit しない', async () => {
    for (const input of ['', '   ']) {
      const wrapper = mountDialog({ targetStatus: REGISTERED })
      await receiptInput(wrapper).setValue(input)

      await byTestid(wrapper, 'submit').trigger('click')

      expect(byTestid(wrapper, 'receipt-number-field').text()).toContain(
        'Dream受付番号を入力してください。',
      )
      expect(wrapper.emitted('confirm')).toBeUndefined()
    }
  })

  it('[DSD-15] 送信中はボタンと入力を止め、主ボタンを「変更中…」にする', () => {
    const wrapper = mountDialog({ targetStatus: REGISTERED, pending: true })

    const submit = byTestid(wrapper, 'submit')
    expect(submit.text()).toBe('変更中…')
    expect(submit.attributes('disabled')).toBeDefined()
    expect(byTestid(wrapper, 'cancel').attributes('disabled')).toBeDefined()
    expect(receiptInput(wrapper).attributes('disabled')).toBeDefined()
    expect(byTestid(wrapper, 'reason').attributes('disabled')).toBeDefined()
  })

  it('[DSD-16] 送信中は送信も閉じる操作も emit しない', async () => {
    const wrapper = mountDialog({ pending: true })

    await byTestid(wrapper, 'submit').trigger('click')
    await byTestid(wrapper, 'cancel').trigger('click')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.find('[role="presentation"]').trigger('click')

    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('[DSD-17] サーバに弾かれた理由をダイアログの先頭に出す', () => {
    const message = '他のユーザーによって更新されています。'
    const wrapper = mountDialog({ error: new Error(message) })

    const error = byTestid(wrapper, 'error')
    expect(error.text()).toContain(message)
    // 先頭（対象の表より前）に出る
    const dialog = byTestid(wrapper, 'dialog').element
    expect(dialog.firstElementChild).toBe(error.element)
  })

  it('[DSD-18] 閉じて開き直すと受付番号欄のエラーが消える', async () => {
    const wrapper = mountDialog({ targetStatus: REGISTERED })
    await byTestid(wrapper, 'submit').trigger('click')
    const field = () => byTestid(wrapper, 'receipt-number-field')
    expect(field().text()).toContain('Dream受付番号を入力してください。')

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(field().exists()).toBe(true)
    expect(field().text()).not.toContain('Dream受付番号を入力してください。')
  })
})
