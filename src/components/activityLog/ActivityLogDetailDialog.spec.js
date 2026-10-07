import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  formatActivityAt,
  formatActivityValue,
  operationBadgeVariant,
  operationLabel,
} from '@/utils/activityLogTypes'
import ActivityLogDetailDialog from './ActivityLogDetailDialog.vue'

/*
 * props の log は src/api/activityLogs.js の ActivityLog（アプリ内モデル）をテスト内で組み立てて渡す。
 * BaseModal の Teleport で body に出るため、teleport を stub して wrapper 内に描画させる。
 */

const EMPTY = '—'

/** 更新の行。差分は 1 項目で、入れ子の値を持つ */
const updateLog = {
  id: 'symbols:3',
  historyId: 3,
  targetType: 'symbols',
  targetTypeName: '銘柄マスタ',
  targetId: 'AAPL',
  targetKey: 'AAPL',
  operation: 'UPDATE',
  operationText: '銘柄マスタを更新',
  operator: '005',
  at: '2026-09-16T10:40:00',
  before: { 銘柄コード: 'AAPL', 規制区分: '0', 付加情報: { 市場: 'NASDAQ' } },
  after: { 銘柄コード: 'AAPL', 規制区分: '1', 付加情報: { 市場: 'NASDAQ' } },
  diff: [{ field: '規制区分', before: '0', after: '1' }],
  changedFields: ['規制区分'],
}

/** 登録の行（変更前データが無い） */
const createLog = {
  ...updateLog,
  id: 'symbols:4',
  historyId: 4,
  operation: 'CREATE',
  before: null,
  after: { 銘柄コード: 'PLTR', 銘柄名: 'パランティア' },
  diff: [
    { field: '銘柄コード', before: null, after: 'PLTR' },
    { field: '銘柄名', before: null, after: 'パランティア' },
  ],
  changedFields: ['銘柄コード', '銘柄名'],
}

/** 削除の行（変更後データが無い） */
const deleteLog = {
  ...updateLog,
  id: 'symbols:5',
  historyId: 5,
  operation: 'DELETE',
  before: { 銘柄コード: 'TWTR', 銘柄名: 'ツイッター' },
  after: null,
  diff: [
    { field: '銘柄コード', before: 'TWTR', after: null },
    { field: '銘柄名', before: 'ツイッター', after: null },
  ],
  changedFields: ['銘柄コード', '銘柄名'],
}

/** 注文の行（変更前後のレコードを持たず、変更の中身は操作内容の文にある） */
const orderLog = {
  ...updateLog,
  id: 'orders:2',
  historyId: 2,
  targetType: 'orders',
  targetTypeName: '注文',
  targetId: '101',
  targetKey: '101',
  operationText: '注文訂正 注文ID 101 数量 100→80',
  before: null,
  after: null,
  diff: [],
  changedFields: [],
}

function mountDialog(props = {}) {
  return mount(ActivityLogDetailDialog, {
    props: { open: true, log: updateLog, ...props },
    global: { stubs: { teleport: true } },
  })
}

const find = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)

/** 概要（dl）の dt → dd の対応 */
function summaryOf(wrapper) {
  const terms = wrapper.findAll('dt').map((dt) => dt.text())
  const details = wrapper.findAll('dd')
  return Object.fromEntries(terms.map((term, index) => [term, details[index]]))
}

/** DataTable の行ごとのセル文字列 */
function tableCells(wrapper, testid) {
  return find(wrapper, testid)
    .findAll('[data-testid="data-table-row"]')
    .map((row) => row.findAll('td').map((td) => td.text()))
}

/** レコードの期待値（項目 / 値） */
const recordCells = (record) =>
  Object.entries(record).map(([field, value]) => [field, formatActivityValue(value)])

// シナリオ: docs/unit/components-activity-log-detail-dialog.md
describe('ActivityLogDetailDialog', () => {
  it('[ALD-01] open が false なら描画しない', () => {
    const wrapper = mountDialog({ open: false })

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('[ALD-02] タイトルと操作の概要を出す', () => {
    const wrapper = mountDialog()

    expect(wrapper.find('[role="dialog"]').text()).toContain('操作ログの詳細')
    const summary = summaryOf(wrapper)
    expect(summary['操作日時'].text()).toBe(formatActivityAt(updateLog.at))
    expect(summary['対象種別'].text()).toBe(updateLog.targetTypeName)
    expect(summary['対象キー'].text()).toBe(updateLog.targetKey)
    expect(summary['操作区分'].text()).toBe(operationLabel(updateLog.operation))
    expect(summary['操作区分'].find('[data-variant]').attributes('data-variant')).toBe(
      operationBadgeVariant(updateLog.operation),
    )
    expect(summary['操作者'].text()).toBe(updateLog.operator)
    expect(summary['履歴ID'].text()).toBe(String(updateLog.historyId))
  })

  it('[ALD-03] 対象キーと操作者を持たない行は — を出す', () => {
    const wrapper = mountDialog({
      log: { ...updateLog, operation: 'BATCH', targetKey: '', operator: '' },
    })

    const summary = summaryOf(wrapper)
    expect(summary['対象キー'].text()).toBe(EMPTY)
    expect(summary['操作者'].text()).toBe(EMPTY)
  })

  it('[ALD-04] 読み取り専用で、入力欄が無くボタンは「閉じる」だけ', () => {
    const wrapper = mountDialog()

    expect(wrapper.findAll('input, select, textarea')).toHaveLength(0)
    const buttons = wrapper.findAll('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].text()).toBe('閉じる')
  })

  it('[ALD-05] 変更項目をバッジで並びどおりに出す', () => {
    const wrapper = mountDialog({ log: createLog })

    const badges = find(wrapper, 'activity-log-detail-changed-fields')
      .findAll('[data-variant]')
      .map((badge) => badge.text())
    expect(badges).toEqual(createLog.changedFields)
  })

  it('[ALD-06] 変更項目が空なら文言を出し、バッジの枠は出さない', () => {
    const wrapper = mountDialog({ log: { ...updateLog, changedFields: [] } })

    expect(find(wrapper, 'activity-log-detail-changed-fields').exists()).toBe(false)
    expect(find(wrapper, 'activity-log-detail').text()).toContain('変更された項目はありません。')
  })

  it('[ALD-07] 差分の表に 項目 / 変更前 / 変更後 を出し、null は — にする', () => {
    const wrapper = mountDialog({ log: createLog })

    const headers = find(wrapper, 'activity-log-detail-diff')
      .findAll('th')
      .map((th) => th.text())
    expect(headers).toEqual(['項目', '変更前', '変更後'])
    expect(tableCells(wrapper, 'activity-log-detail-diff')).toEqual(
      createLog.diff.map(({ field, before, after }) => [
        field,
        formatActivityValue(before),
        formatActivityValue(after),
      ]),
    )
    // 登録の行なので変更前は全部 —
    expect(tableCells(wrapper, 'activity-log-detail-diff').map((cells) => cells[1])).toEqual(
      createLog.diff.map(() => EMPTY),
    )
  })

  it('[ALD-08] 差分が空なら差分の表を出さない', () => {
    const wrapper = mountDialog({ log: { ...updateLog, diff: [] } })

    expect(find(wrapper, 'activity-log-detail-diff').exists()).toBe(false)
  })

  it('[ALD-09] 更新の行は変更前・変更後データの全項目を出す', () => {
    const wrapper = mountDialog()

    expect(tableCells(wrapper, 'activity-log-detail-before')).toEqual(recordCells(updateLog.before))
    expect(tableCells(wrapper, 'activity-log-detail-after')).toEqual(recordCells(updateLog.after))
    // 入れ子の値は JSON で出る
    expect(tableCells(wrapper, 'activity-log-detail-before')).toContainEqual([
      '付加情報',
      JSON.stringify(updateLog.before.付加情報),
    ])
  })

  it('[ALD-10] 登録の行は変更前データを出さない', () => {
    const wrapper = mountDialog({ log: createLog })

    expect(find(wrapper, 'activity-log-detail-before').exists()).toBe(false)
    expect(tableCells(wrapper, 'activity-log-detail-after')).toEqual(recordCells(createLog.after))
  })

  it('[ALD-11] 削除の行は変更後データを出さない', () => {
    const wrapper = mountDialog({ log: deleteLog })

    expect(find(wrapper, 'activity-log-detail-after').exists()).toBe(false)
    expect(tableCells(wrapper, 'activity-log-detail-before')).toEqual(recordCells(deleteLog.before))
  })

  it('[ALD-12] 「閉じる」で close を発火する', async () => {
    const wrapper = mountDialog()

    await find(wrapper, 'activity-log-detail-close').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('[ALD-13] log が null でも落ちず、本文を出さない', () => {
    const wrapper = mountDialog({ log: null })

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(find(wrapper, 'activity-log-detail').exists()).toBe(false)
    expect(find(wrapper, 'activity-log-detail-close').exists()).toBe(true)
  })

  it('[ALD-14] 操作内容の文を概要に出す', () => {
    const wrapper = mountDialog()

    expect(find(wrapper, 'activity-log-detail-operation-text').text()).toBe(updateLog.operationText)
    expect(summaryOf(wrapper)['操作内容'].text()).toBe(updateLog.operationText)
  })

  it('[ALD-15] 操作内容が空なら — を出す', () => {
    const wrapper = mountDialog({ log: { ...updateLog, operationText: '' } })

    expect(find(wrapper, 'activity-log-detail-operation-text').text()).toBe(EMPTY)
  })

  it('[ALD-16] 注文の行は変更前後と差分の表を出さず、操作内容の文で中身を見せる', () => {
    const wrapper = mountDialog({ log: orderLog })

    expect(find(wrapper, 'activity-log-detail-before').exists()).toBe(false)
    expect(find(wrapper, 'activity-log-detail-after').exists()).toBe(false)
    expect(find(wrapper, 'activity-log-detail-diff').exists()).toBe(false)
    expect(find(wrapper, 'activity-log-detail-operation-text').text()).toBe(orderLog.operationText)
  })
})
