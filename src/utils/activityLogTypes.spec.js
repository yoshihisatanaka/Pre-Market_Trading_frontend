import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_ACTOR_GROUP_OPTIONS,
  ACTIVITY_CATEGORY_OPTIONS,
  ACTIVITY_OPERATION_OPTIONS,
  BUSINESS_TARGET_TYPES,
  OPERATION_TARGET_TYPES,
  categoryBadgeVariant,
  categoryLabel,
  categoryOf,
  formatActivityAt,
  formatActivityValue,
  isActivityActorGroup,
  isActivityCategory,
  isActivitySort,
  operationBadgeVariant,
  operationLabel,
  resolveCategory,
  targetTypesFor,
} from './activityLogTypes'

/*
 * 期待する表示名は ACTIVITY_OPERATION_OPTIONS / ACTIVITY_CATEGORY_OPTIONS から導き、文字列を直接書かない。
 * 空値の表現は他の列とそろえて — （em dash）。
 */

const EMPTY = '—'

/** `2026-09-16T10:40:00` → `2026/09/16 10:40:00`（入力の数字から期待値を組み立てる） */
const expectedAt = (iso) => `${iso.slice(0, 10).replaceAll('-', '/')} ${iso.slice(11, 19)}`

/** 対象種別の一覧（実 API の /targets 相当・区分なし）。業務操作・運用管理の固定の並びとマスタ 3 種 */
const MASTER_TYPES = ['customers', 'symbols', 'fx']
const TARGETS = [...BUSINESS_TARGET_TYPES, ...MASTER_TYPES, ...OPERATION_TARGET_TYPES].map(
  (code) => ({ code }),
)

// シナリオ: docs/unit/utils-activity-log-types.md
describe('utils/activityLogTypes', () => {
  it('[ALU-01] 選択肢にある操作区分は表示名になる', () => {
    for (const { value, label } of ACTIVITY_OPERATION_OPTIONS) {
      expect(operationLabel(value)).toBe(label)
    }
    // 実 API の 9 種（CREATE … VWAP_BULK）がすべて載っていること
    expect(ACTIVITY_OPERATION_OPTIONS.map(({ value }) => value)).toEqual([
      'CREATE',
      'UPDATE',
      'DELETE',
      'BATCH',
      'SUSPEND',
      'RESUME',
      'SHOW',
      'HIDE',
      'VWAP_BULK',
    ])
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

  it('[ALU-04] 一括処理・運用系・未知の値・空文字は gray', () => {
    for (const value of ['BATCH', 'SUSPEND', 'RESUME', 'SHOW', 'HIDE', 'VWAP_BULK', 'PURGE', '']) {
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

  it('[ALU-12] 区分は対象種別から決まり、業務操作・運用管理以外はマスタ更新になる', () => {
    for (const code of BUSINESS_TARGET_TYPES) {
      expect(categoryOf(code)).toBe('business')
    }
    for (const code of OPERATION_TARGET_TYPES) {
      expect(categoryOf(code)).toBe('operation')
    }
    // 未知の対象種別（バックエンドがマスタを増やしたとき）もマスタ更新に倒す
    for (const code of [...MASTER_TYPES, 'new-master', '']) {
      expect(categoryOf(code)).toBe('master')
    }
  })

  it('[ALU-13] 区分の表示名と色はモックの色分け（業務操作は青・マスタ更新は緑・運用管理は灰）', () => {
    for (const { value, label } of ACTIVITY_CATEGORY_OPTIONS) {
      expect(categoryLabel(value)).toBe(label)
    }
    expect(categoryBadgeVariant('business')).toBe('info')
    expect(categoryBadgeVariant('master')).toBe('success')
    expect(categoryBadgeVariant('operation')).toBe('gray')
    // 未知の区分は表示名をそのまま返し、色は業務操作と同じ info
    expect(categoryLabel('unknown-kind')).toBe('unknown-kind')
    expect(categoryBadgeVariant('unknown-kind')).toBe('info')
  })

  it('[ALU-14] isActivityCategory は選択肢の 3 値だけを通す', () => {
    expect(ACTIVITY_CATEGORY_OPTIONS.map(({ value }) => value)).toEqual([
      'business',
      'master',
      'operation',
    ])
    for (const { value } of ACTIVITY_CATEGORY_OPTIONS) {
      expect(isActivityCategory(value)).toBe(true)
    }
    for (const value of ['', 'MASTER', 'BUSINESS', undefined]) {
      expect(isActivityCategory(value)).toBe(false)
    }
  })

  it('[ALU-15] targetTypesFor は対象機能を優先し、区分だけなら対象種別の並びに展開する', () => {
    // 対象機能が選ばれていれば区分は見ない（区分より細かい条件）
    expect(targetTypesFor({ category: 'operation', targetType: 'symbols', targets: TARGETS })).toEqual([
      'symbols',
    ])
    // 区分だけなら一覧のうちその区分のもの全部（区分の無い一覧は対象種別から導く）
    expect(targetTypesFor({ category: 'business', targets: TARGETS })).toEqual(BUSINESS_TARGET_TYPES)
    expect(targetTypesFor({ category: 'master', targets: TARGETS })).toEqual(MASTER_TYPES)
    expect(targetTypesFor({ category: 'operation', targets: TARGETS })).toEqual(
      OPERATION_TARGET_TYPES,
    )
    // 一覧が無い（取得前・取得失敗）とき、業務操作・運用管理は固定の並び、マスタ更新は空（絞り込み無し）
    expect(targetTypesFor({ category: 'business', targets: [] })).toEqual(BUSINESS_TARGET_TYPES)
    expect(targetTypesFor({ category: 'operation', targets: [] })).toEqual(OPERATION_TARGET_TYPES)
    expect(targetTypesFor({ category: 'master', targets: [] })).toEqual([])
    // 何も選ばれていなければ空
    expect(targetTypesFor({ targets: TARGETS })).toEqual([])
    expect(targetTypesFor()).toEqual([])
  })

  it('[ALU-16] resolveCategory は応答の区分を正とし、無ければ対象種別から導く', () => {
    // 応答の区分があれば、対象種別から導く値と違っても応答を採る
    expect(resolveCategory('operation', MASTER_TYPES[0])).toBe('operation')
    expect(resolveCategory('master', OPERATION_TARGET_TYPES[0])).toBe('master')
    // 空なら対象種別から導く
    for (const code of [...BUSINESS_TARGET_TYPES, ...OPERATION_TARGET_TYPES, ...MASTER_TYPES]) {
      expect(resolveCategory('', code)).toBe(categoryOf(code))
    }
  })

  it('[ALU-17] isActivityActorGroup は選択肢の 2 値だけを通す', () => {
    expect(ACTIVITY_ACTOR_GROUP_OPTIONS.map(({ value }) => value)).toEqual(['sales_ifa', 'manager'])
    for (const { value } of ACTIVITY_ACTOR_GROUP_OPTIONS) {
      expect(isActivityActorGroup(value)).toBe(true)
    }
    for (const value of ['', 'sales', 'MANAGER', undefined]) {
      expect(isActivityActorGroup(value)).toBe(false)
    }
  })

  it('[ALU-18] targetTypesFor は応答の区分で絞り、その区分が無ければ固定の並びに落とす', () => {
    // コードからはマスタ更新と導かれる対象種別を、応答が運用管理と言っている
    const promoted = 'new-operation'
    const targets = [
      ...MASTER_TYPES.map((code) => ({ code, category: 'master' })),
      ...OPERATION_TARGET_TYPES.map((code) => ({ code, category: 'operation' })),
      { code: promoted, category: 'operation' },
    ]

    expect(targetTypesFor({ category: 'operation', targets })).toEqual([
      ...OPERATION_TARGET_TYPES,
      promoted,
    ])
    expect(targetTypesFor({ category: 'master', targets })).toEqual(MASTER_TYPES)
    // 一覧に業務操作の対象種別が 1 件も無いときは固定の並び
    expect(targetTypesFor({ category: 'business', targets })).toEqual(BUSINESS_TARGET_TYPES)
  })
})
