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

const DURING_REGULAR = at('2026-03-03T01:00:00+09:00')

describe('toMarketDisplay', () => {
  it('[MKS-14] 窓に入っているセッションのラベルと JST / ET の時間帯を出す', () => {
    const display = toMarketDisplay(regularDay, DURING_REGULAR)

    expect(display.key).toBe('regular')
    expect(display.label).toBe('Regular')
    expect(display.jst).toBe('日本時間 23:30–翌06:00（冬時間）')
    expect(display.et).toBe('ET 09:30–16:00')
  })

  it('[MKS-15] 開始ちょうどはそのセッションに入る', () => {
    const display = toMarketDisplay(regularDay, at('2026-03-02T18:00:00+09:00'))

    expect(display.key).toBe('premarket')
    expect(display.label).toBe('Pre-Market')
    expect(display.jst).toBe('日本時間 18:00–23:30（冬時間）')
    expect(display.et).toBe('ET 04:00–09:30')
  })

  it('[MKS-16] 終了ちょうどは次のセッションに移る', () => {
    const display = toMarketDisplay(regularDay, at('2026-03-02T23:30:00+09:00'))

    expect(display.key).toBe('regular')
  })

  it('[MKS-17] 日跨ぎ後もレギュラーのまま、翌日の端点には 翌 が前置される', () => {
    expect(toMarketDisplay(regularDay, at('2026-03-03T02:00:00+09:00')).key).toBe('regular')

    const after = toMarketDisplay(regularDay, at('2026-03-03T07:00:00+09:00'))
    expect(after.key).toBe('afterhours')
    expect(after.label).toBe('After-Hours')
    expect(after.jst).toBe('日本時間 翌06:00–翌10:00（冬時間）')
    // ET 側は日を跨がないので目印を付けない
    expect(after.et).toBe('ET 16:00–20:00')
  })

  it('[MKS-18] 休場は Closed になり、理由を JST 側に出す', () => {
    const display = toMarketDisplay(closedDay, at('2026-11-26T23:00:00+09:00'))

    expect(display.key).toBe('holiday')
    expect(display.label).toBe('Closed')
    expect(display.jst).toBe('休場（感謝祭）')
    expect(display.et).toBe('ET Market Holiday')
  })

  it('[MKS-19] 休場理由が無ければ「休場」だけを出す', () => {
    const display = toMarketDisplay(
      { ...closedDay, closedReason: '' },
      at('2026-11-26T23:00:00+09:00'),
    )

    expect(display.jst).toBe('休場')
  })

  it('[MKS-20] 最終セッションの終了後は Closed になり、次に開くまでの窓を出す', () => {
    const display = toMarketDisplay(regularDay, at('2026-03-03T11:00:00+09:00'))

    expect(display.key).toBe('closed')
    expect(display.label).toBe('Closed')
    expect(display.jst).toBe('日本時間 10:00–18:00（冬時間）')
    expect(display.et).toBe('ET 20:00–04:00')
  })

  it('[MKS-21] 開場前もセッション外と同じ表示になる', () => {
    const before = toMarketDisplay(regularDay, at('2026-03-02T12:00:00+09:00'))
    const after = toMarketDisplay(regularDay, at('2026-03-03T11:00:00+09:00'))

    expect(before.key).toBe('closed')
    expect({ jst: before.jst, et: before.et }).toEqual({ jst: after.jst, et: after.et })
  })

  it('[MKS-22] 短縮取引日は理由が title に入り、時間帯はサーバの値のまま', () => {
    const shortened = {
      ...shortenedDay,
      sessions: [
        regularDay.sessions[0],
        { ...regularDay.sessions[1], hoursJst: '23:30 - 03:00', hoursEt: '09:30 - 13:00' },
      ],
    }

    const display = toMarketDisplay(shortened, DURING_REGULAR)

    expect(display.title).toContain('短縮取引: 感謝祭翌日')
    expect(display.et).toBe('ET 09:30–13:00')
    expect(toMarketDisplay(regularDay, DURING_REGULAR).title).not.toContain('短縮取引')
  })

  it('[MKS-23] 未取得のときは推定を出さず「—」にする', () => {
    const display = toMarketDisplay(null, DURING_REGULAR)

    expect(display.key).toBe('unknown')
    expect(display.label).toBe('—')
    expect(display.jst).toBe('')
    expect(display.et).toBe('')
  })

  it('[MKS-24] 一度も取れずに失敗したときは取得できない旨を出す', () => {
    const error = new ApiError('サーバーでエラーが発生しました。', { status: 500 })

    const display = toMarketDisplay(null, DURING_REGULAR, { error })

    expect(display.label).toBe('—')
    expect(display.jst).toBe('市場状況を取得できません')
    expect(display.title).toBe('サーバーでエラーが発生しました。')
  })

  it('[MKS-25] 取得済みのあとで失敗しても、古い値を出し続ける', () => {
    const error = new ApiError('サーバーでエラーが発生しました。', { status: 500 })

    const display = toMarketDisplay(regularDay, DURING_REGULAR, { error })

    expect(display.key).toBe('regular')
    expect(display.label).toBe('Regular')
    expect(display.jst).toBe('日本時間 23:30–翌06:00（冬時間）')
  })

  it('[MKS-26] title に基準日・サマータイムの別と 3 セッションの JST / ET が並ぶ', () => {
    const display = toMarketDisplay(regularDay, DURING_REGULAR)

    expect(display.title).toContain('基準日 2026-03-02（EST）')
    expect(display.title).toContain('プレ JST 18:00–23:30 / ET 04:00–09:30')
    expect(display.title).toContain('レギュラー JST 23:30–翌06:00 / ET 09:30–16:00')
    expect(display.title).toContain('アフター JST 翌06:00–翌10:00 / ET 16:00–20:00')
  })

  it('[MKS-27] 未知のセッション文字列でも落ちない', () => {
    const unknownSession = {
      ...regularDay,
      session: 'SNACK_TIME',
      sessions: [{ ...regularDay.sessions[1], code: 'SNACK_TIME' }],
    }

    const display = toMarketDisplay(unknownSession, DURING_REGULAR)

    // 配色とラベルの割り当てが無いので Closed 扱いに落ちる（表示は壊れない）
    expect(display.key).toBe('closed')
    expect(display.label).toBe('Closed')
    expect(display.et).toBe('ET 09:30–16:00')
  })

  it('[MKS-28] 土日の休場はモックの週末表記になる', () => {
    const display = toMarketDisplay(
      { ...closedDay, closedReason: '土日' },
      at('2026-11-28T23:00:00+09:00'),
    )

    expect(display.key).toBe('holiday')
    expect(display.jst).toBe('休場（週末）')
    expect(display.et).toBe('ET Weekend')
  })

  it('[MKS-29] 夏時間は（夏時間）と EDT になる', () => {
    const display = toMarketDisplay({ ...regularDay, dst: true }, DURING_REGULAR)

    expect(display.jst).toBe('日本時間 23:30–翌06:00（夏時間）')
    expect(display.title).toContain('（EDT）')
  })

  it('[MKS-30] 時間帯の文字列が想定外の形でも落ちない', () => {
    const odd = {
      ...regularDay,
      sessions: regularDay.sessions.map((s) => ({ ...s, hoursJst: '未定', hoursEt: '' })),
    }

    const during = toMarketDisplay(odd, DURING_REGULAR)
    expect(during.key).toBe('regular')
    expect(during.jst).toBe('日本時間 未定（冬時間）')
    expect(during.et).toBe('')

    const outside = toMarketDisplay(odd, at('2026-03-03T11:00:00+09:00'))
    expect(outside.key).toBe('closed')
    expect(outside.jst).toBe('')
    expect(outside.et).toBe('')
  })
})
