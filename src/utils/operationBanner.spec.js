import { describe, expect, it } from 'vitest'
import {
  incidentBannerResponse,
  noneBannerResponse,
  noticeBannerResponse,
} from '@/mocks/fixtures/banner'
import { toBannerDisplay } from './operationBanner'

/*
 * 純関数。入力は fixtures/banner.js の生の値を Banner モデル（src/api/banner.js の typedef）に写して作る。
 * 写し方は api/banner.js の toBanner() と同じ（null の本文は空文字に寄せる）。
 */
const toModel = (raw) => ({
  kind: raw.種別,
  severity: raw.重要度,
  message: raw.メッセージ ?? '',
  ordersSuspended: raw.発注停止中,
  suspendedTargets: raw.停止中の対象,
  suspendedTargetNames: raw.停止中の対象名,
  announcementVisible: raw.お知らせ表示中,
  announcementMessage: raw.お知らせ本文 ?? '',
})

const incident = toModel(incidentBannerResponse)
const notice = toModel(noticeBannerResponse)
const none = toModel(noneBannerResponse)

// シナリオ: docs/unit/utils-operation-banner.md
describe('toBannerDisplay', () => {
  it('[OBU-01] 発注停止は赤・閉じられない帯になり、停止対象を添える', () => {
    expect(toBannerDisplay(incident)).toEqual({
      kind: 'INCIDENT',
      tone: 'danger',
      label: '発注停止中',
      message: incident.message,
      targets: `停止対象: ${incident.suspendedTargetNames[0]}`,
      dismissible: false,
    })
  })

  it('[OBU-02] 停止対象が複数なら読点でつなぐ', () => {
    const names = [...incident.suspendedTargetNames, '新規注文（テスト）']

    const display = toBannerDisplay({ ...incident, suspendedTargetNames: names })

    expect(display.targets).toBe(`停止対象: ${names.join('、')}`)
  })

  it('[OBU-03] 停止対象名が空なら targets は空文字で、帯は出す', () => {
    const display = toBannerDisplay({ ...incident, suspendedTargetNames: [] })

    expect(display).not.toBeNull()
    expect(display.targets).toBe('')
    expect(display.message).toBe(incident.message)
  })

  it('[OBU-04] お知らせは青・閉じられる帯になり、停止対象は付かない', () => {
    expect(toBannerDisplay(notice)).toEqual({
      kind: 'NOTICE',
      tone: 'info',
      label: 'お知らせ',
      message: notice.message,
      targets: '',
      dismissible: true,
    })
  })

  it('[OBU-05] お知らせに停止対象名が入っていても出さない', () => {
    const display = toBannerDisplay({
      ...notice,
      suspendedTargetNames: incident.suspendedTargetNames,
    })

    expect(display.targets).toBe('')
  })

  it('[OBU-06] 配色は severity で決まり、ラベルと閉じられるかは kind で決まる', () => {
    const incidentInfo = toBannerDisplay({ ...incident, severity: notice.severity })
    const noticeCritical = toBannerDisplay({ ...notice, severity: incident.severity })

    expect(incidentInfo.tone).toBe('info')
    expect(incidentInfo.label).toBe('発注停止中')
    expect(incidentInfo.dismissible).toBe(false)
    expect(noticeCritical.tone).toBe('danger')
    expect(noticeCritical.label).toBe('お知らせ')
    expect(noticeCritical.dismissible).toBe(true)
  })

  it('[OBU-07] 本文は前後だけ削り、途中の改行は残す', () => {
    const body = `${notice.message}\n2 行目の案内（テスト）`

    const display = toBannerDisplay({ ...notice, message: `  \n${body}\n  ` })

    expect(display.message).toBe(body)
  })

  it('[OBU-08] NONE は null', () => {
    expect(toBannerDisplay(none)).toBeNull()
  })

  it('[OBU-09] 未取得（null / undefined）は null', () => {
    expect(toBannerDisplay(null)).toBeNull()
    expect(toBannerDisplay(undefined)).toBeNull()
  })

  it('[OBU-10] 未知の kind は本文があっても null', () => {
    expect(toBannerDisplay({ ...notice, kind: 'MAINTENANCE' })).toBeNull()
  })

  it('[OBU-11] 本文が空・空白と改行だけなら null', () => {
    for (const message of ['', '   ', ' \n\t\n ']) {
      expect(toBannerDisplay({ ...notice, message })).toBeNull()
      expect(toBannerDisplay({ ...incident, message })).toBeNull()
    }
  })
})
