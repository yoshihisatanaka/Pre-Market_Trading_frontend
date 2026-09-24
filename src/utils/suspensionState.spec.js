import { describe, expect, it } from 'vitest'
import { suspensionTargets } from '@/mocks/fixtures/incidents'
import { summarizeSuspension } from './suspensionState'

/*
 * 停止対象の並びと表示名はフィクスチャ（サーバの並び: ALL が先頭）から作る。
 * 名前を直接書かない。
 */
const TARGETS = suspensionTargets.map((row) => ({
  target: row['停止対象'],
  targetName: row['停止対象名'],
}))
const nameOf = (code) => TARGETS.find((row) => row.target === code).targetName

/** 総合フラグを指定して status を組み立てる */
function statusOf({ suspended = false, allSuspended = false, suspendedTargets = [] } = {}) {
  return { suspended, allSuspended, suspendedTargets, targets: TARGETS }
}

// シナリオ: docs/unit/utils-suspension-state.md
describe('summarizeSuspension', () => {
  it('[SUS-01] status が null なら null を返す', () => {
    expect(summarizeSuspension(null)).toBeNull()
  })

  it('[SUS-02] どの対象も停止していなければ通常運用', () => {
    expect(summarizeSuspension(statusOf())).toEqual({ label: '通常運用', tone: 'normal' })
  })

  it('[SUS-03] 全体停止中はルートが停止していても全体停止中だけを出す', () => {
    const result = summarizeSuspension(
      statusOf({ suspended: true, allSuspended: true, suspendedTargets: ['ALL', '1'] }),
    )

    expect(result).toEqual({ label: '全体停止中', tone: 'danger' })
    expect(result.label).not.toContain(nameOf('1'))
  })

  it('[SUS-04] ルート別の停止は targets の並び順の名前で一部停止中になる', () => {
    const result = summarizeSuspension(statusOf({ suspended: true, suspendedTargets: ['2', '1'] }))

    // targets の並びでは 1（IB）が 2（VWAP）より前
    expect(result).toEqual({
      label: `一部停止中（${nameOf('1')}, ${nameOf('2')}）`,
      tone: 'warning',
    })
  })

  it('[SUS-05] targets に無いコードは既知の名前の後ろにそのまま出る', () => {
    const result = summarizeSuspension(statusOf({ suspended: true, suspendedTargets: ['9', '1'] }))

    expect(result.label).toBe(`一部停止中（${nameOf('1')}, 9）`)
    expect(result.tone).toBe('warning')
  })

  it('[SUS-06] suspended だが停止中の対象が空なら括弧なしの一部停止中', () => {
    const result = summarizeSuspension(statusOf({ suspended: true, suspendedTargets: [] }))

    expect(result).toEqual({ label: '一部停止中', tone: 'warning' })
  })
})
