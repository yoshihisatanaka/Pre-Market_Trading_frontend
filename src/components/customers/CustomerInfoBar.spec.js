import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { CAUTION_RANKS, ELDERLY_AGE } from '@/utils/customerCautions'
import CustomerInfoBar from './CustomerInfoBar.vue'

/*
 * 部品のテスト。props（customer / valuation）→ 描画の入出力だけを見る。
 * customer は src/api/customers.js の Customer の形で組み立てる。
 */

const customer = (overrides = {}) => ({
  id: '1',
  branchCode: '123',
  accountNumber: '1230001',
  customerName: '山田 太郎',
  customerNameKana: 'ﾔﾏﾀﾞ ﾀﾛｳ',
  age: '75',
  tradingSuspended: false,
  investmentPolicyName: '安定運用',
  complianceRank: 'C',
  cashJpy: 3500000,
  cashUsd: 50000,
  growthQuota: 1200000,
  ...overrides,
})

const mountBar = (overrides = {}, props = {}) =>
  mount(CustomerInfoBar, { props: { customer: customer(overrides), ...props } })

const byTestId = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const textOf = (wrapper, testid) => byTestId(wrapper, testid).text()

const jpyText = (value) => `${value.toLocaleString('ja-JP')} 円`
const usdText = (value) =>
  `${value.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ドル`

// シナリオ: docs/unit/components-customers-customer-info-bar.md
describe('CustomerInfoBar', () => {
  it('[CIB-01] 部店・口座番号・顧客名・カナ・投資方針をそのまま出す', () => {
    const value = customer()
    const wrapper = mountBar()

    expect(textOf(wrapper, 'customer-info-branch')).toBe(value.branchCode)
    expect(textOf(wrapper, 'customer-info-account')).toBe(value.accountNumber)
    expect(textOf(wrapper, 'customer-info-name')).toBe(value.customerName)
    expect(textOf(wrapper, 'customer-info-kana')).toBe(value.customerNameKana)
    expect(textOf(wrapper, 'customer-info-policy')).toBe(value.investmentPolicyName)
  })

  it('[CIB-02] 空の項目は — で、カナが空なら要素ごと出さない', () => {
    const wrapper = mountBar({
      branchCode: '',
      accountNumber: '',
      customerName: '',
      customerNameKana: '',
      investmentPolicyName: '',
    })

    expect(textOf(wrapper, 'customer-info-branch')).toBe('—')
    expect(textOf(wrapper, 'customer-info-account')).toBe('—')
    expect(textOf(wrapper, 'customer-info-name')).toBe('—')
    expect(textOf(wrapper, 'customer-info-policy')).toBe('—')
    expect(byTestId(wrapper, 'customer-info-kana').exists()).toBe(false)
  })

  it('[CIB-03] 高齢者の年齢以上だけ「高齢者」と is-elderly が付く', () => {
    const elderly = mountBar({ age: String(ELDERLY_AGE) })
    const younger = mountBar({ age: String(ELDERLY_AGE - 1) })

    expect(textOf(elderly, 'customer-info-age')).toContain(`${ELDERLY_AGE}歳`)
    expect(textOf(elderly, 'customer-info-elderly')).toBe('高齢者')
    expect(byTestId(elderly, 'customer-info-age').classes()).toContain('is-elderly')

    expect(textOf(younger, 'customer-info-age')).toBe(`${ELDERLY_AGE - 1}歳`)
    expect(byTestId(younger, 'customer-info-elderly').exists()).toBe(false)
    expect(byTestId(younger, 'customer-info-age').classes()).not.toContain('is-elderly')
  })

  it('[CIB-04] 年齢の無い法人は — で、高齢者は出ない', () => {
    const wrapper = mountBar({ age: '' })

    expect(textOf(wrapper, 'customer-info-age')).toBe('—')
    expect(byTestId(wrapper, 'customer-info-elderly').exists()).toBe(false)
  })

  it('[CIB-05] 取引規制は全取引停止か制限なし', () => {
    const suspended = byTestId(mountBar({ tradingSuspended: true }), 'customer-info-restriction')
    const normal = byTestId(mountBar({ tradingSuspended: false }), 'customer-info-restriction')

    expect(suspended.text()).toBe('全取引停止')
    expect(suspended.classes()).toContain('is-caution')
    expect(normal.text()).toBe('制限なし')
    expect(normal.classes()).not.toContain('is-caution')
  })

  it('[CIB-06] 要注意のコンプラランクだけ「要注意」が付き、空は —', () => {
    expect(CAUTION_RANKS.length).toBeGreaterThan(0)
    for (const rank of CAUTION_RANKS) {
      const wrapper = mountBar({ complianceRank: rank })
      expect(textOf(wrapper, 'customer-info-compliance'), rank).toContain(rank)
      expect(textOf(wrapper, 'customer-info-compliance-caution'), rank).toBe('要注意')
      expect(byTestId(wrapper, 'customer-info-compliance').classes(), rank).toContain('is-caution')
    }

    const plain = mountBar({ complianceRank: 'C' })
    expect(CAUTION_RANKS).not.toContain('C')
    expect(textOf(plain, 'customer-info-compliance')).toBe('C')
    expect(byTestId(plain, 'customer-info-compliance-caution').exists()).toBe(false)
    expect(byTestId(plain, 'customer-info-compliance').classes()).not.toContain('is-caution')

    const empty = mountBar({ complianceRank: '' })
    expect(textOf(empty, 'customer-info-compliance')).toBe('—')
    expect(byTestId(empty, 'customer-info-compliance-caution').exists()).toBe(false)
  })

  it('[CIB-07] 預り金と成長投資枠は単位付きで、null は —、0 は 0 円', () => {
    const value = customer()
    const filled = mountBar()
    expect(textOf(filled, 'customer-info-cash-jpy')).toBe(jpyText(value.cashJpy))
    expect(textOf(filled, 'customer-info-cash-usd')).toBe(usdText(value.cashUsd))
    expect(textOf(filled, 'customer-info-growth-quota')).toBe(jpyText(value.growthQuota))

    const blank = mountBar({ cashJpy: 0, cashUsd: null, growthQuota: null })
    expect(textOf(blank, 'customer-info-cash-jpy')).toBe('0 円')
    expect(textOf(blank, 'customer-info-cash-usd')).toBe('—')
    expect(textOf(blank, 'customer-info-growth-quota')).toBe('—')
  })

  it('[CIB-08] 預りの合計が読めていなければ評価額と評価損益は — で色を付けない', () => {
    const wrapper = mountBar()

    expect(textOf(wrapper, 'customer-info-valuation')).toBe('—')
    expect(textOf(wrapper, 'customer-info-profit-loss')).toBe('—')
    const classes = byTestId(wrapper, 'customer-info-profit-loss').classes()
    expect(classes).not.toContain('is-profit')
    expect(classes).not.toContain('is-loss')
  })

  it('[CIB-09] 評価損益は符号付きで、益は is-profit・損は is-loss・0 は無色', () => {
    const VALUE = 3407400
    const mountWith = (profitLossJpy) =>
      mountBar({}, { valuation: { valueJpy: VALUE, profitLossJpy } })

    const profit = mountWith(407400)
    expect(textOf(profit, 'customer-info-valuation')).toBe(jpyText(VALUE))
    expect(textOf(profit, 'customer-info-profit-loss')).toBe(`+${jpyText(407400)}`)
    expect(byTestId(profit, 'customer-info-profit-loss').classes()).toContain('is-profit')

    const loss = mountWith(-151500)
    // 負の符号は U+2212（ハイフンではない）
    expect(textOf(loss, 'customer-info-profit-loss')).toBe(`−${jpyText(151500)}`)
    expect(byTestId(loss, 'customer-info-profit-loss').classes()).toContain('is-loss')

    const zero = mountWith(0)
    expect(textOf(zero, 'customer-info-profit-loss')).toBe('0 円')
    const classes = byTestId(zero, 'customer-info-profit-loss').classes()
    expect(classes).not.toContain('is-profit')
    expect(classes).not.toContain('is-loss')
  })
})
