import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/client'
import { toMarketDisplay } from './marketStatus'

/*
 * 純関数のテストの見本。**フェイクタイマーもマウントも要らない**（now を引数で渡す）。
 *
 * 旧 getMarketStatus() のシナリオ MKS-01〜13 は関数ごと消えたので削除した。
 * **番号は振り直していない**（過去のコミットの ID がどの行を指していたかを保つため）。
 *
 * モデルは api/marketStatus.js が返すアプリ内モデル。2026-03-02（月・EST）の通常営業日で、
 * JST は ET + 14 時間。レギュラーの終了は翌日 06:00 JST になる（日跨ぎ）。
 *
 * シナリオ: docs/unit/utils-market-status.md
 */

const session = (code, name, hoursJst, hoursEt, startJst, endJst) => ({
  code,
  name,
  nameEn: code,
  hoursJst,
  hoursEt,
  startJst,
  endJst,
  current: false,
})

/** 通常営業日（プレ 18:00 → レギュラー 23:30 → アフター 翌 06:00 → 翌 10:00、いずれも JST） */
const regularDay = {
  baseDate: '2026-03-02',
  nowJst: '2026-03-03T01:00:00+09:00',
  nowEt: '2026-03-02T11:00:00-05:00',
  dst: false,
  extendedPre: false,
  closed: false,
  closedReason: '',
  shortened: false,
  shortenedReason: '',
  session: 'REGULAR',
  sessionName: 'レギュラー',
  sessionNameEn: 'Regular',
  sessions: [
    session(
      'PRE',
      'プレ',
      '18:00 - 23:30',
      '04:00 - 09:30',
      '2026-03-02T18:00:00+09:00',
      '2026-03-02T23:30:00+09:00',
    ),
    session(
      'REGULAR',
      'レギュラー',
      '23:30 - 06:00',
      '09:30 - 16:00',
      '2026-03-02T23:30:00+09:00',
      '2026-03-03T06:00:00+09:00',
    ),
    session(
      'AFTER',
      'アフター',
      '06:00 - 10:00',
      '16:00 - 20:00',
      '2026-03-03T06:00:00+09:00',
      '2026-03-03T10:00:00+09:00',
    ),
  ],
}

const closedDay = {
  ...regularDay,
  baseDate: '2026-11-26',
  closed: true,
  closedReason: '感謝祭',
  session: 'CLOSED',
  sessions: [],
}

/** 短縮取引日。終了時刻だけが通常営業日と違う（サーバが短縮後の境界を返す） */
const shortenedDay = {
  ...regularDay,
  baseDate: '2026-11-27',
  shortened: true,
  shortenedReason: '感謝祭翌日',
}

/** JST の時刻をミリ秒で */
const at = (iso) => Date.parse(iso)

const codes = (display) => display.sessions.map((s) => s.code)
const currentCodes = (display) => display.sessions.filter((s) => s.current).map((s) => s.code)

describe('toMarketDisplay', () => {
  it('[MKS-14] 窓に入っているセッションが現在になる', () => {
    const display = toMarketDisplay(regularDay, at('2026-03-03T01:00:00+09:00'))

    expect(display.key).toBe('regular')
    expect(display.label).toBe('● Regular')
    expect(codes(display)).toEqual(['PRE', 'REGULAR', 'AFTER'])
    expect(currentCodes(display)).toEqual(['REGULAR'])
  })

  it('[MKS-15] 開始ちょうどはそのセッションに入る', () => {
    const display = toMarketDisplay(regularDay, at('2026-03-02T18:00:00+09:00'))

    expect(display.key).toBe('premarket')
    expect(currentCodes(display)).toEqual(['PRE'])
  })

  it('[MKS-16] 終了ちょうどは次のセッションに移る', () => {
    const display = toMarketDisplay(regularDay, at('2026-03-02T23:30:00+09:00'))

    expect(display.key).toBe('regular')
    expect(currentCodes(display)).toEqual(['REGULAR'])
  })

  it('[MKS-17] 日跨ぎのレギュラーは翌日でも現在のまま、JST の表記に (翌) が付く', () => {
    const display = toMarketDisplay(regularDay, at('2026-03-03T02:00:00+09:00'))

    expect(currentCodes(display)).toEqual(['REGULAR'])

    const regular = display.sessions[1]
    expect(regular.hoursJst).toBe('23:30 - 06:00(翌)')
    // ET 側は日を跨がないので目印を付けない
    expect(regular.hoursEt).toBe('09:30 - 16:00')
    expect(display.sessions[0].hoursJst).toBe('18:00 - 23:30')
  })

  it('[MKS-18] 休場は理由を添えて Closed になり、時間帯を出さない', () => {
    const display = toMarketDisplay(closedDay, at('2026-11-26T23:00:00+09:00'))

    expect(display.key).toBe('closed')
    expect(display.label).toBe('○ Closed')
    expect(display.note).toBe('休場（感謝祭）')
    expect(display.sessions).toEqual([])
  })

  it('[MKS-19] 休場理由が無ければ「休場」だけを出す', () => {
    const display = toMarketDisplay(
      { ...closedDay, closedReason: '' },
      at('2026-11-26T23:00:00+09:00'),
    )

    expect(display.note).toBe('休場')
  })

  it('[MKS-20] 最終セッションの終了後は Closed になるが、時間帯は残る', () => {
    const display = toMarketDisplay(regularDay, at('2026-03-03T11:00:00+09:00'))

    expect(display.key).toBe('closed')
    expect(display.label).toBe('○ Closed')
    expect(codes(display)).toEqual(['PRE', 'REGULAR', 'AFTER'])
    expect(currentCodes(display)).toEqual([])
  })

  it('[MKS-21] 開場前も Closed になるが、時間帯は残る', () => {
    const display = toMarketDisplay(regularDay, at('2026-03-02T12:00:00+09:00'))

    expect(display.key).toBe('closed')
    expect(codes(display)).toEqual(['PRE', 'REGULAR', 'AFTER'])
    expect(currentCodes(display)).toEqual([])
  })

  it('[MKS-22] 短縮取引日は目印が立ち、理由が title に入る', () => {
    const display = toMarketDisplay(shortenedDay, at('2026-03-03T01:00:00+09:00'))

    expect(display.shortened).toBe(true)
    expect(display.title).toContain('短縮取引: 感謝祭翌日')
    expect(toMarketDisplay(regularDay, at('2026-03-03T01:00:00+09:00')).shortened).toBe(false)
  })

  it('[MKS-23] 未取得のときは推定を出さず「—」にする', () => {
    const display = toMarketDisplay(null, at('2026-03-03T01:00:00+09:00'))

    expect(display.key).toBe('unknown')
    expect(display.label).toBe('—')
    expect(display.sessions).toEqual([])
    expect(display.note).toBe('')
  })

  it('[MKS-24] 一度も取れずに失敗したときは取得できない旨を出す', () => {
    const error = new ApiError('サーバーでエラーが発生しました。', { status: 500 })

    const display = toMarketDisplay(null, at('2026-03-03T01:00:00+09:00'), { error })

    expect(display.label).toBe('—')
    expect(display.note).toBe('市場状況を取得できません')
    expect(display.title).toBe('サーバーでエラーが発生しました。')
  })

  it('[MKS-25] 取得済みのあとで失敗しても、古い値を出し続ける', () => {
    const error = new ApiError('サーバーでエラーが発生しました。', { status: 500 })

    const display = toMarketDisplay(regularDay, at('2026-03-03T01:00:00+09:00'), { error })

    expect(display.key).toBe('regular')
    expect(display.label).toBe('● Regular')
    expect(display.note).toBe('')
  })

  it('[MKS-26] title に基準日・サマータイムの別と 3 セッションの JST / ET が並ぶ', () => {
    const display = toMarketDisplay(regularDay, at('2026-03-03T01:00:00+09:00'))

    expect(display.title).toContain('基準日 2026-03-02（EST）')
    expect(display.title).toContain('プレ JST 18:00 - 23:30 / ET 04:00 - 09:30')
    expect(display.title).toContain('レギュラー JST 23:30 - 06:00(翌) / ET 09:30 - 16:00')
    expect(display.title).toContain('アフター JST 06:00 - 10:00 / ET 16:00 - 20:00')
    // 夏時間なら EDT に変わる
    expect(toMarketDisplay({ ...regularDay, dst: true }, 0).title).toContain('（EDT）')
  })

  it('[MKS-27] 未知のセッション文字列でも落ちない', () => {
    const unknownSession = {
      ...regularDay,
      session: 'SNACK_TIME',
      sessions: [{ ...regularDay.sessions[1], code: 'SNACK_TIME' }],
    }

    const display = toMarketDisplay(unknownSession, at('2026-03-03T01:00:00+09:00'))

    expect(currentCodes(display)).toEqual(['SNACK_TIME'])
    // 色と丸印の割り当てが無いので Closed 扱いに落ちる（表示は壊れない）
    expect(display.key).toBe('closed')
    expect(display.label).toBe('○ Closed')
  })
})
