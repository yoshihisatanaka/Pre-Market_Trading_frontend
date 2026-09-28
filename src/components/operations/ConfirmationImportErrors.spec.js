import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ConfirmationImportErrors from './ConfirmationImportErrors.vue'

/*
 * 取込の行エラーの表。props（ConfirmationImportResult.errors）→ 描画だけを見る。
 */
const mountErrors = (errors) => mount(ConfirmationImportErrors, { props: { errors } })

const headers = (wrapper) => wrapper.findAll('th').map((th) => th.text())
const rows = (wrapper) => wrapper.findAll('[data-testid="data-table-row"]')
const cells = (row) => row.findAll('td')

// シナリオ: docs/unit/components-operations-confirmation-import-errors.md
describe('ConfirmationImportErrors', () => {
  it('[CIE-01] 列見出しは 行 / 注文ID / 内容', () => {
    const wrapper = mountErrors([{ lineNumber: 2, orderId: '999', messages: ['x'] }])

    expect(headers(wrapper)).toEqual(['行', '注文ID', '内容'])
  })

  it('[CIE-02] 行エラーの件数だけ行が出て、行番号と注文 ID がそのまま出る', () => {
    const errors = [
      { lineNumber: 2, orderId: '999', messages: ['a'] },
      { lineNumber: 4, orderId: '27', messages: ['b'] },
    ]
    const wrapper = mountErrors(errors)

    expect(rows(wrapper)).toHaveLength(errors.length)
    expect(rows(wrapper).map((row) => cells(row)[0].text())).toEqual(
      errors.map((item) => String(item.lineNumber)),
    )
    expect(rows(wrapper).map((row) => cells(row)[1].text())).toEqual(
      errors.map((item) => item.orderId),
    )
  })

  it('[CIE-03] 1 行に理由が複数あれば全部出る', () => {
    const messages = ['注文IDが違います。', 'confirmation_status が違います。']
    const wrapper = mountErrors([{ lineNumber: 2, orderId: '999', messages }])

    expect(cells(rows(wrapper)[0])[2].findAll('li').map((li) => li.text())).toEqual(messages)
  })

  it('[CIE-04] 注文 ID が空なら「—」', () => {
    const wrapper = mountErrors([{ lineNumber: 2, orderId: '', messages: ['x'] }])

    expect(cells(rows(wrapper)[0])[1].text()).toBe('—')
  })

  it('[CIE-05] 行番号が null なら「—」', () => {
    const wrapper = mountErrors([{ lineNumber: null, orderId: '999', messages: ['x'] }])

    expect(cells(rows(wrapper)[0])[0].text()).toBe('—')
  })
})
