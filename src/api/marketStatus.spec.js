import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { ApiError } from './client'
import {
  closedMarketStatusResponse,
  marketStatusResponse,
  shortenedMarketStatusResponse,
} from '@/mocks/fixtures/marketStatus'
import { fetchMarketStatus } from './marketStatus'

/*
 * API 層のテスト。ここだけが「バックエンドの形」を知ってよい層なので、
 * **送り出すリクエスト**と**日本語キー・空白入りキーの読み替え**を突き合わせる。
 *
 * フィクスチャは固定日（2026-03-02）のものをそのまま使う。既定のハンドラは日付を
 * 「今日」へずらして返すので、変換結果を固定値で確かめたいこのファイルでは必ず
 * server.use() で応答を差し替える。
 *
 * シナリオ: docs/unit/api-market-status.md
 */

/** 最後に届いたリクエストを覚えておくための入れ物 */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

/**
 * リクエストを記録して、指定の本文を返すハンドラを立てる。
 *
 * @param {unknown} body 返す本文
 * @param {number} [status]
 */
function record(body, status = 200) {
  server.use(
    http.get('*/api/market-status', ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams }
      return HttpResponse.json(body, { status })
    }),
  )
}

describe('api/marketStatus', () => {
  it('[MSA-01] クエリを付けずに GET /market-status を呼ぶ', async () => {
    record(marketStatusResponse)

    await fetchMarketStatus()

    expect(lastRequest.url.pathname).toBe('/api/market-status')
    // date クエリは実装していない（ヘッダが欲しいのは常に「いま」）
    expect([...lastRequest.params.keys()]).toEqual([])
  })

  it('[MSA-02] 日本語キーを camelCase のアプリ内モデルに直す', async () => {
    record(marketStatusResponse)

    const status = await fetchMarketStatus()

    expect(status).toMatchObject({
      dst: false,
      extendedPre: false,
      closed: false,
      shortened: false,
      session: 'REGULAR',
      sessionName: 'レギュラー',
      sessionNameEn: 'Regular',
      nowJst: '2026-03-03T01:00:00+09:00',
      nowEt: '2026-03-02T11:00:00-05:00',
    })
  })

  it('[MSA-03] sessions の各項目を読み替える（名称 → name / name → nameEn / US ET → hoursEt）', async () => {
    record(marketStatusResponse)

    const { sessions } = await fetchMarketStatus()

    expect(sessions).toHaveLength(3)
    expect(sessions[1]).toEqual({
      code: 'REGULAR',
      name: 'レギュラー',
      nameEn: 'Regular',
      hoursJst: '23:30 - 06:00',
      // 空白を含むキーから読めていること（ドット記法では取れない）
      hoursEt: '09:30 - 16:00',
      startJst: '2026-03-02T23:30:00+09:00',
      endJst: '2026-03-03T06:00:00+09:00',
      current: true,
    })
  })

  it('[MSA-04] 基準日の integer を YYYY-MM-DD にする（Date を経由しない）', async () => {
    record(marketStatusResponse)

    const { baseDate } = await fetchMarketStatus()

    // Date に通すと UTC 深夜と解釈され、UTC より西のタイムゾーンで 2026-03-01 にずれる
    expect(baseDate).toBe('2026-03-02')
  })

  it('[MSA-05] null の理由は空文字にする', async () => {
    record(marketStatusResponse)

    const status = await fetchMarketStatus()

    expect(status.closedReason).toBe('')
    expect(status.shortenedReason).toBe('')
  })

  it('[MSA-06] 休場の応答では sessions が空になり、休場理由が載る', async () => {
    record(closedMarketStatusResponse)

    const status = await fetchMarketStatus()

    expect(status.closed).toBe(true)
    expect(status.closedReason).toBe('感謝祭')
    expect(status.sessions).toEqual([])
  })

  it('[MSA-07] sessions キーごと欠けていても落ちない', async () => {
    const { sessions, ...withoutSessions } = marketStatusResponse
    expect(sessions).toBeDefined()
    record(withoutSessions)

    const status = await fetchMarketStatus()

    expect(status.sessions).toEqual([])
  })

  it('[MSA-08] 400 は ApiError になり、detail の文言を持つ', async () => {
    record({ detail: '判定対象日の形式が正しくありません。' }, 400)

    await expect(fetchMarketStatus()).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: '判定対象日の形式が正しくありません。',
    })
  })

  it('[MSA-09] 500 は ApiError になる', async () => {
    record({ detail: 'サーバーでエラーが発生しました。' }, 500)

    const error = await fetchMarketStatus().catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(500)
  })

  it('[MSA-10] 短縮取引の応答は理由と短縮後の終了時刻をそのまま渡す', async () => {
    record(shortenedMarketStatusResponse)

    const status = await fetchMarketStatus()

    expect(status.shortened).toBe(true)
    expect(status.shortenedReason).toBe('感謝祭翌日')
    expect(status.sessions[1].hoursEt).toBe('09:30 - 13:00')
  })
})
