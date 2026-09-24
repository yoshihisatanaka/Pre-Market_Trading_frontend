import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { announcement, announcementHistories } from '@/mocks/fixtures/announcements'
import { updateAnnouncement } from '@/api/announcements'
import { ANNOUNCEMENT_HISTORY_PAGE_SIZE, useAnnouncementsStore } from './announcements'

/*
 * ストアのテスト。既定ハンドラ（src/mocks/handlers/announcements.js）に当てて、
 * 現在値・保存・履歴の 3 系統と、楽観的ロック・履歴のページ位置を確かめる。
 * 期待値はフィクスチャと表示件数から導く（56 / 50 を直接書かない）。
 */
const PAGE_SIZE = ANNOUNCEMENT_HISTORY_PAGE_SIZE
const HISTORY_TOTAL = announcementHistories.length
const SECOND_PAGE_LENGTH = announcementHistories.slice(PAGE_SIZE, PAGE_SIZE * 2).length

/** AnnouncementUpdateRequest.本文 の maxLength（openapi.json） */
const MESSAGE_MAX_LENGTH = 500

const ANNOUNCEMENTS_PATH = '*/api/operations/announcements'
const HISTORY_PATH = '*/api/operations/announcements/history'

const NEW_MESSAGE = '9月30日 06:00〜07:00 に計画メンテナンスを予定しています（テスト）。'

/** 現在値のまま（変更なし）の保存入力 */
const unchangedInput = () => ({
  enabled: announcement.表示フラグ === 1,
  message: announcement.本文 ?? '',
})

/** PUT の本文を覗いて記録する。応答は既定ハンドラに任せる（何も返さないと次のハンドラへ落ちる） */
function recordPutBodies() {
  const bodies = []
  server.use(
    http.put(ANNOUNCEMENTS_PATH, async ({ request }) => {
      bodies.push(await request.clone().json())
    }),
  )
  return bodies
}

/** 履歴の取得で送られた offset を記録する */
function recordHistoryOffsets() {
  const offsets = []
  server.use(
    http.get(HISTORY_PATH, ({ request }) => {
      offsets.push(new URL(request.url).searchParams.get('offset'))
    }),
  )
  return offsets
}

// シナリオ: docs/unit/stores-announcements.md
describe('useAnnouncementsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[ANS-01] load() で現在のお知らせが入る', async () => {
    const store = useAnnouncementsStore()

    await store.load()

    expect(store.announcement.enabled).toBe(announcement.表示フラグ === 1)
    expect(store.announcement.message).toBe(announcement.本文)
    expect(store.announcement.updatedAt).toBe(announcement.更新日時)
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
    expect(store.isEmpty).toBe(false)
  })

  it('[ANS-02] 取得が 500 のときは error に理由が入り isEmpty にはならない', async () => {
    server.use(
      http.get(ANNOUNCEMENTS_PATH, () =>
        HttpResponse.json({ detail: 'サーバーでエラーが発生しました。' }, { status: 500 }),
      ),
    )
    const store = useAnnouncementsStore()

    await store.load()

    expect(store.error.message).toBe('サーバーでエラーが発生しました。')
    expect(store.announcement).toBeNull()
    expect(store.isEmpty).toBe(false)
    expect(store.loading).toBe(false)
  })

  it('[ANS-03] レスポンスボディが null のときは isEmpty が true', async () => {
    server.use(http.get(ANNOUNCEMENTS_PATH, () => HttpResponse.json(null)))
    const store = useAnnouncementsStore()

    await store.load()

    expect(store.isEmpty).toBe(true)
  })

  it('[ANS-04] loadHistory(0) で先頭ページと総件数が入る', async () => {
    const store = useAnnouncementsStore()

    await store.loadHistory(0)

    expect(store.history).toHaveLength(Math.min(PAGE_SIZE, HISTORY_TOTAL))
    expect(store.history[0].id).toBe(announcementHistories[0].ID)
    expect(store.historyTotal).toBe(HISTORY_TOTAL)
    expect(store.historyOffset).toBe(0)
    expect(store.historyIsEmpty).toBe(false)
  })

  it('[ANS-05] loadHistory(PAGE_SIZE) で 2 ページ目を offset 付きで取得する', async () => {
    const offsets = recordHistoryOffsets()
    const store = useAnnouncementsStore()

    await store.loadHistory(PAGE_SIZE)

    expect(offsets).toEqual([String(PAGE_SIZE)])
    expect(store.history).toHaveLength(SECOND_PAGE_LENGTH)
    expect(store.history[0].id).toBe(announcementHistories[PAGE_SIZE].ID)
    expect(store.historyOffset).toBe(PAGE_SIZE)
  })

  it('[ANS-06] 履歴だけ失敗しても現在値と本体の error は影響を受けない', async () => {
    server.use(
      http.get(HISTORY_PATH, () =>
        HttpResponse.json({ detail: '履歴を取得できませんでした。' }, { status: 500 }),
      ),
    )
    const store = useAnnouncementsStore()
    await store.load()

    await store.loadHistory(0)

    expect(store.historyError.message).toBe('履歴を取得できませんでした。')
    expect(store.historyIsEmpty).toBe(false)
    expect(store.announcement.message).toBe(announcement.本文)
    expect(store.error).toBeNull()
  })

  it('[ANS-07] 履歴が 0 件なら historyIsEmpty が true', async () => {
    server.use(
      http.get(HISTORY_PATH, () => HttpResponse.json({ total: 0, limit: 50, offset: 0, histories: [] })),
    )
    const store = useAnnouncementsStore()

    await store.loadHistory(0)

    expect(store.historyIsEmpty).toBe(true)
  })

  it('[ANS-08] 保存が成功すると現在値と履歴が新しくなる', async () => {
    const store = useAnnouncementsStore()
    await store.load()
    await store.loadHistory(0)

    const result = await store.save({ enabled: true, message: NEW_MESSAGE })

    expect(result.message).toBeTruthy()
    expect(store.saveError).toBeNull()
    expect(store.announcement.message).toBe(NEW_MESSAGE)
    expect(store.announcement.updatedAt).not.toBe(announcement.更新日時)
    expect(store.historyTotal).toBe(HISTORY_TOTAL + 1)
    expect(store.history[0].message).toBe(NEW_MESSAGE)
  })

  it('[ANS-09] 合札は直近に取得・保存した更新日時を送る', async () => {
    const bodies = recordPutBodies()
    const store = useAnnouncementsStore()
    await store.load()

    const first = await store.save({ enabled: true, message: NEW_MESSAGE })
    const second = await store.save({ enabled: true, message: `${NEW_MESSAGE}（再）` })

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(bodies).toHaveLength(2)
    // 1 回目は取得したときの更新日時
    expect(bodies[0].更新日時).toBe(announcement.更新日時)
    // 2 回目は 1 回目の応答で振り直された更新日時（古い合札のままなら 409 になる）
    expect(bodies[1].更新日時).toBe(first.announcement.updatedAt)
    expect(store.saveError).toBeNull()
  })

  it('[ANS-10] 2 ページ目を見ていても保存が成功すると履歴は先頭ページに戻る', async () => {
    const store = useAnnouncementsStore()
    await store.load()
    await store.loadHistory(PAGE_SIZE)
    expect(store.historyOffset).toBe(PAGE_SIZE)

    await store.save({ enabled: true, message: NEW_MESSAGE })

    expect(store.historyOffset).toBe(0)
    expect(store.history).toHaveLength(Math.min(PAGE_SIZE, HISTORY_TOTAL + 1))
    expect(store.history[0].message).toBe(NEW_MESSAGE)
  })

  it('[ANS-11] 変更が無ければ「変更はありません。」を返し履歴は増えない', async () => {
    const store = useAnnouncementsStore()
    await store.load()
    await store.loadHistory(0)

    const result = await store.save(unchangedInput())

    expect(result.message).toBe('変更はありません。')
    expect(store.historyTotal).toBe(HISTORY_TOTAL)
    expect(store.announcement.updatedAt).toBe(announcement.更新日時)
  })

  it('[ANS-12] 表示 ON で本文が空なら 400 の理由が saveError に入り何も変わらない', async () => {
    const store = useAnnouncementsStore()
    await store.load()
    await store.loadHistory(0)

    const result = await store.save({ enabled: true, message: '' })

    expect(result).toBeNull()
    expect(store.saveError.status).toBe(400)
    expect(store.saveError.message).toBeTruthy()
    expect(store.announcement.message).toBe(announcement.本文)
    expect(store.historyTotal).toBe(HISTORY_TOTAL)
  })

  it('[ANS-13] 本文が上限を超えると saveError が 422 になる', async () => {
    const store = useAnnouncementsStore()
    await store.load()

    const result = await store.save({
      enabled: true,
      message: 'あ'.repeat(MESSAGE_MAX_LENGTH + 1),
    })

    expect(result).toBeNull()
    expect(store.saveError.status).toBe(422)
    expect(store.saveError.message).toContain('本文')
    expect(store.announcement.message).toBe(announcement.本文)
  })

  it('[ANS-14] 取得後に他の担当者が更新していると 409 になり現在値は取得時のまま', async () => {
    const store = useAnnouncementsStore()
    await store.load()
    // 他の担当者の更新（ストアを通さず API を直に叩き、サーバ側の更新日時を進める）
    await updateAnnouncement({
      enabled: true,
      message: '他の担当者の更新',
      updatedAt: announcement.更新日時,
    })

    const result = await store.save({ enabled: true, message: NEW_MESSAGE })

    expect(result).toBeNull()
    expect(store.saveError.status).toBe(409)
    expect(store.saveError.message).toBeTruthy()
    expect(store.announcement.message).toBe(announcement.本文)
    expect(store.announcement.updatedAt).toBe(announcement.更新日時)
  })

  it('[ANS-15] 読み込む前は保存しない', async () => {
    const bodies = recordPutBodies()
    const store = useAnnouncementsStore()

    const result = await store.save({ enabled: true, message: NEW_MESSAGE })

    expect(result).toBeNull()
    expect(bodies).toHaveLength(0)
  })

  it('[ANS-16] clearSaveError() で saveError が消える', async () => {
    const store = useAnnouncementsStore()
    await store.load()
    await store.save({ enabled: true, message: '' })
    expect(store.saveError).not.toBeNull()

    store.clearSaveError()

    expect(store.saveError).toBeNull()
  })

  it('[ANS-17] 保存の応答待ちの間だけ saving が true になる', async () => {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    server.use(
      http.put(ANNOUNCEMENTS_PATH, async () => {
        await gate
      }),
    )
    const store = useAnnouncementsStore()
    await store.load()

    const pending = store.save({ enabled: true, message: NEW_MESSAGE })
    expect(store.saving).toBe(true)

    release()
    await pending

    expect(store.saving).toBe(false)
  })
})
