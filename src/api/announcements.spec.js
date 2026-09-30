import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import {
  announcement,
  announcementHistories,
  initialAnnouncement,
} from '@/mocks/fixtures/announcements'
import { ApiError } from './client'
import { fetchAnnouncement, fetchAnnouncementHistory, updateAnnouncement } from './announcements'

/*
 * API 層のテスト。ここだけが「バックエンドの形」（日本語キー・表示フラグの 0/1・nullable の本文）を
 * 知ってよい層なので、送り出すリクエストそのものと、受け取った生データの変換を固定する。
 * 拒否（400 / 422 / 409）は既定ハンドラ（src/mocks/handlers/announcements.js）に当てて確かめる。
 */

const ANNOUNCEMENTS_PATH = '*/api/operations/announcements'
const HISTORY_PATH = '*/api/operations/announcements/history'

/** AnnouncementUpdateRequest.本文 の maxLength（openapi.json） */
const MESSAGE_MAX_LENGTH = 500

/** 最後に届いたリクエストを覚えておくための入れ物 */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

/**
 * リクエストを覗いて記録し、応答は既定ハンドラに任せる（何も返さないと次のハンドラへ落ちる）。
 *
 * @param {'get'|'put'} method
 * @param {string} path
 */
function peek(method, path) {
  server.use(
    http[method](path, async ({ request }) => {
      const url = new URL(request.url)
      lastRequest = {
        url,
        params: url.searchParams,
        headers: request.headers,
        body: method === 'put' ? await request.clone().json() : null,
      }
    }),
  )
}

/** 応答を差し替える */
function respondWith(method, path, body) {
  server.use(http[method](path, () => HttpResponse.json(body)))
}

/** 更新の入力。合札は既定でフィクスチャの現在値（競合しない） */
const updateInput = (overrides = {}) => ({
  enabled: true,
  message: '計画メンテナンスのお知らせ（テスト）',
  updatedAt: announcement.更新日時,
  ...overrides,
})

/** 拒否を ApiError として受け取る */
async function rejectionOf(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('拒否されなかった')
}

/** 履歴 1 行（AnnouncementHistoryItem）をアプリ内モデルに直した期待値 */
const toHistory = (raw) => ({
  id: raw.ID,
  operation: raw.操作区分,
  operationLabel: raw.操作区分名,
  operator: raw.操作者,
  // フィクスチャは仕様どおり object で持つ
  message: raw.変更後データ?.本文 ?? '',
  operatedAt: raw.操作日時,
})

// シナリオ: docs/unit/api-announcements.md
describe('api/announcements', () => {
  it('[ANA-01] 現在のお知らせをアプリ内モデルに変換して返す', async () => {
    peek('get', ANNOUNCEMENTS_PATH)

    const result = await fetchAnnouncement()

    expect(lastRequest.url.pathname).toBe('/api/operations/announcements')
    expect(result).toEqual({
      id: announcement.ID,
      enabled: announcement.表示フラグ === 1,
      visible: announcement.表示中,
      message: announcement.本文,
      userEdited: announcement.ユーザー操作フラグ === 1,
      updatedAt: announcement.更新日時,
      updatedBy: announcement.更新者,
    })
    // フィクスチャは表示 ON（0/1 の integer が boolean になったことを確かめる前提）
    expect(result.enabled).toBe(true)
  })

  it('[ANA-02] 初期状態の null と 0 は空文字・false・null に寄る', async () => {
    respondWith('get', ANNOUNCEMENTS_PATH, initialAnnouncement)

    const result = await fetchAnnouncement()

    expect(result).toEqual({
      id: initialAnnouncement.ID,
      enabled: false,
      visible: false,
      message: '',
      userEdited: false,
      // 合札が無い。空文字にしておくと更新時に「送らない」を選べる
      updatedAt: '',
      updatedBy: null,
    })
  })

  it('[ANA-03] レスポンスボディが null のときは null を返す', async () => {
    respondWith('get', ANNOUNCEMENTS_PATH, null)

    expect(await fetchAnnouncement()).toBeNull()
  })

  it('[ANA-04] 更新は表示フラグ 1・本文・更新日時を日本語キーで送る', async () => {
    peek('put', ANNOUNCEMENTS_PATH)
    const input = updateInput()

    await updateAnnouncement(input)

    expect(lastRequest.url.pathname).toBe('/api/operations/announcements')
    expect(lastRequest.body).toEqual({
      表示フラグ: 1,
      本文: input.message,
      更新日時: input.updatedAt,
    })
  })

  it('[ANA-05] 表示 OFF は表示フラグ 0 の integer で送る', async () => {
    peek('put', ANNOUNCEMENTS_PATH)

    await updateAnnouncement(updateInput({ enabled: false }))

    expect(lastRequest.body.表示フラグ).toBe(0)
  })

  it('[ANA-06] 合札が空のときは更新日時をキーごと送らない', async () => {
    peek('put', ANNOUNCEMENTS_PATH)

    await updateAnnouncement(updateInput({ updatedAt: '' }))

    expect(lastRequest.body).not.toHaveProperty('更新日時')
  })

  it('[ANA-07] 更新の応答を announcement と成功文言に分けて返す', async () => {
    const input = updateInput()

    const result = await updateAnnouncement(input)

    expect(result.announcement.enabled).toBe(true)
    expect(result.announcement.message).toBe(input.message)
    expect(result.announcement.visible).toBe(true)
    // 更新日時はサーバが振り直す（次の保存の合札になる）
    expect(result.announcement.updatedAt).toBeTruthy()
    expect(result.announcement.updatedAt).not.toBe(announcement.更新日時)
    expect(typeof result.message).toBe('string')
    expect(result.message).not.toBe('')
  })

  it('[ANA-08] 表示 ON で本文が空なら 400 の ApiError で拒否される', async () => {
    const error = await rejectionOf(updateAnnouncement(updateInput({ message: '' })))

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(400)
    // detail の文言がそのまま message になる（既定の「入力内容に誤りがあります。」に落ちない）
    expect(error.message).not.toBe('')
    expect(error.message).not.toBe('入力内容に誤りがあります。')
  })

  it('[ANA-09] 本文が上限を超えると 422 の ApiError で拒否される', async () => {
    const tooLong = 'あ'.repeat(MESSAGE_MAX_LENGTH + 1)

    const error = await rejectionOf(updateAnnouncement(updateInput({ message: tooLong })))

    expect(error).toBeInstanceOf(ApiError)
    // pydantic の maxLength が先に弾くので 400 ではなく 422
    expect(error.status).toBe(422)
    expect(error.message).toContain('本文')
    expect(error.message).toContain(String(MESSAGE_MAX_LENGTH))
  })

  it('[ANA-10] 合札が現在値と違うと 409 の ApiError で拒否される', async () => {
    const error = await rejectionOf(
      updateAnnouncement(updateInput({ updatedAt: '2000-01-01T00:00:00' })),
    )

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(409)
  })

  it('[ANA-11] 履歴は既定で limit=50 / offset=0 を送り、先頭ページと総件数を返す', async () => {
    peek('get', HISTORY_PATH)

    const { items, total } = await fetchAnnouncementHistory()

    expect(lastRequest.url.pathname).toBe('/api/operations/announcements/history')
    expect(lastRequest.params.get('limit')).toBe('50')
    expect(lastRequest.params.get('offset')).toBe('0')
    expect(total).toBe(announcementHistories.length)
    expect(items).toHaveLength(Math.min(50, announcementHistories.length))
    expect(items[0]).toEqual(toHistory(announcementHistories[0]))
  })

  it('[ANA-12] limit / offset を渡すとそのままクエリに載り、その範囲が返る', async () => {
    peek('get', HISTORY_PATH)
    const limit = 10
    const offset = 20

    const { items, total } = await fetchAnnouncementHistory({ limit, offset })

    expect(lastRequest.params.get('limit')).toBe(String(limit))
    expect(lastRequest.params.get('offset')).toBe(String(offset))
    expect(total).toBe(announcementHistories.length)
    expect(items).toEqual(announcementHistories.slice(offset, offset + limit).map(toHistory))
  })

  it('[ANA-13] 変更後データの形が違う行は本文が空文字になる', async () => {
    const base = announcementHistories[0]
    respondWith('get', HISTORY_PATH, {
      total: 5,
      limit: 50,
      offset: 0,
      histories: [
        { ...base, ID: 1, 変更後データ: null },
        { ...base, ID: 2, 変更後データ: JSON.stringify({ 表示フラグ: 1, 本文: 123 }) },
        { ...base, ID: 3, 変更後データ: JSON.stringify({ 表示フラグ: 0, 本文: null }) },
        { ...base, ID: 4, 変更後データ: '{壊れた JSON' },
        { ...base, ID: 5, 変更後データ: '"本文"' },
      ],
    })

    const { items } = await fetchAnnouncementHistory()

    expect(items.map((item) => item.message)).toEqual(['', '', '', '', ''])
  })

  it('[ANA-16] 変更後データが JSON 文字列でも object でも本文を読む', async () => {
    const base = announcementHistories[0]
    respondWith('get', HISTORY_PATH, {
      total: 2,
      limit: 50,
      offset: 0,
      histories: [
        // 実 API の形（2026-09-29 実測）。行の全項目の写しが文字列で入る
        {
          ...base,
          ID: 1,
          変更後データ: JSON.stringify({
            ID: 1,
            本文: '文字列で来た本文',
            更新日時: '2026-09-29 11:24:05',
            表示フラグ: 1,
          }),
        },
        { ...base, ID: 2, 変更後データ: { 表示フラグ: 1, 本文: 'object で来た本文' } },
      ],
    })

    const { items } = await fetchAnnouncementHistory()

    expect(items.map((item) => item.message)).toEqual(['文字列で来た本文', 'object で来た本文'])
  })

  it('[ANA-14] histories と total を持たない応答は空の一覧になる', async () => {
    respondWith('get', HISTORY_PATH, { limit: 50, offset: 0 })

    expect(await fetchAnnouncementHistory()).toEqual({ items: [], total: 0 })
  })

  it('[ANA-15] 更新には X-User-Code ヘッダが載る', async () => {
    peek('put', ANNOUNCEMENTS_PATH)

    await updateAnnouncement(updateInput())

    // 値は運用で決まる（テストでは vitest.config.js が固定している）。載っていることを見る
    expect(lastRequest.headers.get('X-User-Code')).toBeTruthy()
  })
})
