import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_OPERATION_OPTIONS,
  formatActivityAt,
  formatActivityValue,
  isActivitySort,
  operationBadgeVariant,
  operationLabel,
} from './activityLogTypes'

/*
 * 期待する表示名は ACTIVITY_OPERATION_OPTIONS から導き、文字列を直接書かない。
 * 空値の表現は他の列とそろえて — （em dash）。
 */

const EMPTY = '—'

/** `2026-09-16T10:40:00` → `2026/09/16 10:40:00`（入力の数字から期待値を組み立てる） */
const expectedAt = (iso) => `${iso.slice(0, 10).replaceAll('-', '/')} ${iso.slice(11, 19)}`

// シナリオ: docs/unit/utils-activity-log-types.md
describe('utils/activityLogTypes', () => {
  it('[ALU-01] 選択肢にある操作区分は表示名になる', () => {
    for (const { value, label } of ACTIVITY_OPERATION_OPTIONS) {
      expect(operationLabel(value)).toBe(label)
    }
    expect(ACTIVITY_OPERATION_OPTIONS.length).toBeGreaterThan(0)
  })

  it('[ALU-02] 未知の操作区分はそのまま返す', () => {
    expect(operationLabel('PURGE')).toBe('PURGE')
  })

  it('[ALU-03] 登録・更新・削除のバッジ色', () => {
    expect(operationBadgeVariant('CREATE')).toBe('success')
    expect(operationBadgeVariant('UPDATE')).toBe('info')
    // 削除は失敗ではないので error（赤）にしない
    expect(operationBadgeVariant('DELETE')).toBe('warning')
  })

  it('[ALU-04] 一括処理・未知の値・空文字は gray', () => {
    for (const value of ['BATCH', 'PURGE', '']) {
      expect(operationBadgeVariant(value)).toBe('gray')
    }
  })

  it('[ALU-06] isActivitySort は空文字と asc だけを通す', () => {
    expect(isActivitySort('')).toBe(true)
    expect(isActivitySort('asc')).toBe(true)
    // 既定の新しい順は空文字で表すので、desc は選択肢に無い
    for (const value of ['desc', 'ASC', undefined]) {
      expect(isActivitySort(value)).toBe(false)
    }
  })

  it('[ALU-07] 操作日時は年から秒まで出す', () => {
    for (const iso of ['2026-09-16T10:40:00', '2027-01-05T09:03:07']) {
      expect(formatActivityAt(iso)).toBe(expectedAt(iso))
    }
  })

  it('[ALU-08] 空値・不正な日時は — になる', () => {
    for (const value of ['', null, undefined, 'not-a-date']) {
      expect(formatActivityAt(value)).toBe(EMPTY)
    }
  })

  it('[ALU-09] 値が無いときは — になる', () => {
    for (const value of [null, undefined, '']) {
      expect(formatActivityValue(value)).toBe(EMPTY)
    }
  })

  it('[ALU-10] object と配列は JSON にする', () => {
    const object = { 部店コード: '123', 残高: 35 }
    const array = ['a', 1]

    expect(formatActivityValue(object)).toBe(JSON.stringify(object))
    expect(formatActivityValue(array)).toBe(JSON.stringify(array))
  })

  it('[ALU-11] 文字列・数値・真偽値はそのまま文字列にする（0 と false を — にしない）', () => {
    expect(formatActivityValue('AAPL')).toBe('AAPL')
    expect(formatActivityValue(147.85)).toBe('147.85')
    expect(formatActivityValue(0)).toBe('0')
    expect(formatActivityValue(true)).toBe('true')
    expect(formatActivityValue(false)).toBe('false')
  })
})
