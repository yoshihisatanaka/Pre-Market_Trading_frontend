import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { announcement, announcementHistories } from '@/mocks/fixtures/announcements'
import { incidentBannerResponse } from '@/mocks/fixtures/banner'
import { ANNOUNCEMENT_HISTORY_PAGE_SIZE, useAnnouncementsStore } from '@/stores/announcements'
import { formatMonthDayTime } from '@/utils/format'
import AnnouncementsView from './AnnouncementsView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * お知らせ本体と履歴の別々の 4 状態、保存の入力検証とサーバの拒否、履歴のページングを検証する。
 * 期待値はフィクスチャと表示件数から導く（56 / 50 を直接書かない）。
 */
const PATH = '/operations/announcements'

const PAGE_SIZE = ANNOUNCEMENT_HISTORY_PAGE_SIZE
const HISTORY_TOTAL = announcementHistories.length
const FIRST_PAGE_LENGTH = Math.min(PAGE_SIZE, HISTORY_TOTAL)
const SECOND_PAGE_LENGTH = announcementHistories.slice(PAGE_SIZE, PAGE_SIZE * 2).length

const CURRENT_MESSAGE = announcement.本文 ?? ''
const CURRENT_ENABLED = announcement.表示フラグ === 1

/** AnnouncementUpdateRequest.本文 の maxLength（openapi.json） */
const MESSAGE_MAX_LENGTH = 500

const NEW_MESSAGE = '9月30日 06:00〜07:00 に計画メンテナンスを予定しています（テスト）。'
const OTHER_USER_MESSAGE = '他の担当者が書き換えたお知らせ（テスト）'
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'
const REQUIRED_ERROR = 'お知らせを表示するには本文を入力してください。'

/*
 * 実 API（とモック src/mocks/handlers/announcements.js）が返す成功文言。
 * 画面は応答の message をそのまま出すだけなので、ここでは届いた文言が通知に載ることを見る。
 */
const UPDATED_MESSAGE = 'お知らせを更新しました。'
const HIDDEN_MESSAGE = 'お知らせを非表示にしました。'
const UNCHANGED_MESSAGE = '変更はありません。'

// 操作区分名はサーバが添える。表示名はフィクスチャの同じ操作区分の行から取る
const HIDE_LABEL = announcementHistories.find((row) => row.操作区分 === 'HIDE').操作区分名

const ANNOUNCEMENTS_PATH = '*/api/operations/announcements'
const HISTORY_PATH = '*/api/operations/announcements/history'
const BANNER_PATH = '*/api/operations/banner'

const Page = { render: () => h('div') }

async function mountView() {
  // この画面は route を見ないが、実アプリと同じく router の下にマウントする
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: PATH, component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push(PATH)

  const wrapper = mount(AnnouncementsView, {
    global: {
      plugins: [createPinia(), router],
      // teleport を stub して、ヘッダへ差し込む「再読み込み」を wrapper 内に描画させる
      stubs: { teleport: true },
    },
  })
  return { wrapper, router }
}

/**
 * 保存 → 履歴の再取得 → 再描画 までを待つ。
 * 1 回目で PUT の応答が反映され、2 回目で履歴の取得が始まり、3 回目でその応答が描画される。
 */
async function settle() {
  await flushPromises()
  await flushPromises()
  await flushPromises()
}

/**
 * 応答を握るハンドラ。解放するまで応答せず、解放後は既定ハンドラへ落ちる。
 *
 * @returns {{ release: () => void, calls: () => number }}
 */
function gate(method, path) {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  let count = 0
  server.use(
    http[method](path, async () => {
      count += 1
      await promise
    }),
  )
  return { release, calls: () => count }
}

/** 届いたリクエストを数える（応答は既定ハンドラに任せる） */
function countRequests(method, path) {
  const seen = []
  server.use(
    http[method](path, ({ request }) => {
      seen.push(new URL(request.url))
    }),
  )
  return seen
}

const errorHandler = (method, path, detail = ERROR_MESSAGE) =>
  http[method](path, () => HttpResponse.json({ detail }, { status: 500 }))

/**
 * 別の担当者のストア。画面とは別の Pinia に作るので、画面の現在値（合札）とは独立に動く
 * （view から api 層は import できないため、他の担当者の操作もストア経由で再現する）。
 */
async function otherUserStore() {
  const store = useAnnouncementsStore(createPinia())
  await store.load()
  return store
}

/** 他の担当者の更新。サーバ側の本文と更新日時を進める */
async function updateByOtherUser() {
  const store = await otherUserStore()
  await store.save({ enabled: true, message: OTHER_USER_MESSAGE })
}

const find = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const exists = (wrapper, testid) => find(wrapper, testid).exists()
const messageInput = (wrapper) => find(wrapper, 'announcements-message')
const enabledInput = (wrapper) => find(wrapper, 'announcements-enabled')
const saveButton = (wrapper) => find(wrapper, 'announcements-save')
const submitForm = (wrapper) => find(wrapper, 'announcements-form').trigger('submit')
const noticeText = (wrapper) => find(wrapper, 'announcements-notice').text()
const historyRows = (wrapper) =>
  find(wrapper, 'announcements-history-table').findAll('[data-testid="data-table-row"]')
const historyCells = (row) => row.findAll('td').map((td) => td.text())
const historyRange = (wrapper) =>
  find(wrapper, 'announcements-history-pagination').find('[data-testid="pagination-range"]').text()
const pageButton = (wrapper, page) =>
  wrapper.find(`[data-testid="pagination-page"][data-page="${page}"]`)

/** 入力欄の aria-describedby から、FormField のヒント / エラーの文言を引く */
const describedTexts = (wrapper, input) =>
  (input.attributes('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => wrapper.find(`#${id}`))
const fieldError = (wrapper, input) => {
  const found = describedTexts(wrapper, input).find((el) => el.attributes('role') === 'alert')
  return found ? found.text() : ''
}
const fieldHint = (wrapper, input) => {
  const found = describedTexts(wrapper, input).find((el) => el.attributes('role') !== 'alert')
  return found ? found.text() : ''
}

/** 履歴 1 行の表示（操作日時・操作区分名・本文・操作者）をフィクスチャの生の行から作る */
const expectedCells = (raw) => [
  formatMonthDayTime(raw.操作日時),
  raw.操作区分名,
  // フィクスチャは仕様どおり object で持つ
  raw.変更後データ?.本文 || '—',
  raw.操作者 || '—',
]

const rangeLabel = (total, offset) =>
  `${total} 件中 ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} 件`

// シナリオ: docs/unit/views-announcements-view.md
describe('AnnouncementsView', () => {
  it('[ANV-01] 取得中はお知らせと履歴の両方にローディングを表示する', async () => {
    const announcementGate = gate('get', ANNOUNCEMENTS_PATH)
    const historyGate = gate('get', HISTORY_PATH)
    const bannerGate = gate('get', BANNER_PATH)
    const { wrapper } = await mountView()
    await flushPromises()

    expect(exists(wrapper, 'announcements-loading')).toBe(true)
    expect(exists(wrapper, 'announcements-history-loading')).toBe(true)
    expect(exists(wrapper, 'announcements-form')).toBe(false)
    expect(exists(wrapper, 'announcements-empty')).toBe(false)
    expect(exists(wrapper, 'announcements-error')).toBe(false)
    expect(exists(wrapper, 'announcements-history-table')).toBe(false)
    expect(exists(wrapper, 'announcements-history-empty')).toBe(false)
    expect(exists(wrapper, 'announcements-history-error')).toBe(false)

    announcementGate.release()
    historyGate.release()
    bannerGate.release()
    await settle()
  })

  it('[ANV-02] お知らせの取得が失敗すると理由と再試行が出て、履歴は表示される', async () => {
    server.use(errorHandler('get', ANNOUNCEMENTS_PATH))
    const { wrapper } = await mountView()
    await settle()

    const error = find(wrapper, 'announcements-error')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'announcements-form')).toBe(false)
    // 履歴は本体と別に取得するので、本体の失敗に巻き込まれない
    expect(historyRows(wrapper)).toHaveLength(FIRST_PAGE_LENGTH)
  })

  it('[ANV-03] お知らせが無いときは空状態を表示しフォームは出さない', async () => {
    server.use(http.get(ANNOUNCEMENTS_PATH, () => HttpResponse.json(null)))
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'announcements-empty')).toBe(true)
    expect(exists(wrapper, 'announcements-form')).toBe(false)
  })

  it('[ANV-04] 取得できたらフォームに現在の表示フラグと本文が入る', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'announcements-form')).toBe(true)
    expect(enabledInput(wrapper).element.checked).toBe(CURRENT_ENABLED)
    expect(messageInput(wrapper).element.value).toBe(CURRENT_MESSAGE)
    expect(fieldHint(wrapper, messageInput(wrapper))).toContain(
      `残り ${MESSAGE_MAX_LENGTH - CURRENT_MESSAGE.length} 文字`,
    )
  })

  it('[ANV-05] 取得失敗から「再試行」でフォームが表示される', async () => {
    server.use(errorHandler('get', ANNOUNCEMENTS_PATH))
    const { wrapper } = await mountView()
    await settle()
    expect(exists(wrapper, 'announcements-error')).toBe(true)

    server.resetHandlers()
    await find(wrapper, 'announcements-error').find('button').trigger('click')
    await settle()

    expect(exists(wrapper, 'announcements-error')).toBe(false)
    expect(exists(wrapper, 'announcements-form')).toBe(true)
    expect(messageInput(wrapper).element.value).toBe(CURRENT_MESSAGE)
  })

  it('[ANV-06] 履歴の表に 1 ページぶんの行と件数が出る', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(historyRows(wrapper)).toHaveLength(FIRST_PAGE_LENGTH)
    expect(historyCells(historyRows(wrapper)[0])).toEqual(expectedCells(announcementHistories[0]))
    expect(historyRange(wrapper)).toBe(rangeLabel(HISTORY_TOTAL, 0))
    expect(exists(wrapper, 'announcements-history-empty')).toBe(false)
    expect(exists(wrapper, 'announcements-history-error')).toBe(false)
  })

  it('[ANV-07] 履歴だけ失敗してもフォームは使え、保存できる', async () => {
    server.use(errorHandler('get', HISTORY_PATH, '履歴を取得できませんでした。'))
    const { wrapper } = await mountView()
    await settle()

    const historyError = find(wrapper, 'announcements-history-error')
    expect(historyError.exists()).toBe(true)
    expect(historyError.text()).toContain('履歴を取得できませんでした。')
    expect(historyError.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'announcements-history-pagination')).toBe(false)
    expect(exists(wrapper, 'announcements-form')).toBe(true)

    await messageInput(wrapper).setValue(NEW_MESSAGE)
    await submitForm(wrapper)
    await settle()

    expect(noticeText(wrapper)).toBe(UPDATED_MESSAGE)
    expect(exists(wrapper, 'announcements-save-error')).toBe(false)
  })

  it('[ANV-08] 履歴が 0 件のときは空状態を表示し表とページャーは出さない', async () => {
    server.use(
      http.get(HISTORY_PATH, () =>
        HttpResponse.json({ total: 0, limit: PAGE_SIZE, offset: 0, histories: [] }),
      ),
    )
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'announcements-history-empty')).toBe(true)
    expect(exists(wrapper, 'announcements-history-table')).toBe(false)
    expect(exists(wrapper, 'announcements-history-pagination')).toBe(false)
  })

  it('[ANV-09] 履歴の「再試行」で表が表示される', async () => {
    server.use(errorHandler('get', HISTORY_PATH))
    const { wrapper } = await mountView()
    await settle()
    expect(exists(wrapper, 'announcements-history-error')).toBe(true)

    server.resetHandlers()
    await find(wrapper, 'announcements-history-error').find('button').trigger('click')
    await settle()

    expect(exists(wrapper, 'announcements-history-error')).toBe(false)
    expect(historyRows(wrapper)).toHaveLength(FIRST_PAGE_LENGTH)
  })

  it('[ANV-10] ページャーの 2 で offset 付きで取得し 2 ページ目が出る', async () => {
    const { wrapper } = await mountView()
    await settle()
    const requests = countRequests('get', HISTORY_PATH)

    await pageButton(wrapper, 2).trigger('click')
    await settle()

    expect(requests.map((url) => url.searchParams.get('offset'))).toEqual([String(PAGE_SIZE)])
    expect(historyRows(wrapper)).toHaveLength(SECOND_PAGE_LENGTH)
    expect(historyCells(historyRows(wrapper)[0])).toEqual(
      expectedCells(announcementHistories[PAGE_SIZE]),
    )
    expect(historyRange(wrapper)).toBe(rangeLabel(HISTORY_TOTAL, PAGE_SIZE))
  })

  it('[ANV-11] 本文を変えて保存すると成功文言が出て、履歴の先頭に積まれる', async () => {
    const { wrapper } = await mountView()
    await settle()

    await messageInput(wrapper).setValue(NEW_MESSAGE)
    await submitForm(wrapper)
    await settle()

    expect(noticeText(wrapper)).toBe(UPDATED_MESSAGE)
    expect(messageInput(wrapper).element.value).toBe(NEW_MESSAGE)
    expect(historyRange(wrapper)).toBe(rangeLabel(HISTORY_TOTAL + 1, 0))
    expect(historyCells(historyRows(wrapper)[0])[2]).toBe(NEW_MESSAGE)
    expect(exists(wrapper, 'announcements-save-error')).toBe(false)
  })

  it('[ANV-12] 履歴の 2 ページ目で保存すると先頭ページに戻る', async () => {
    const { wrapper } = await mountView()
    await settle()
    await pageButton(wrapper, 2).trigger('click')
    await settle()
    expect(historyRange(wrapper)).toBe(rangeLabel(HISTORY_TOTAL, PAGE_SIZE))

    await messageInput(wrapper).setValue(NEW_MESSAGE)
    await submitForm(wrapper)
    await settle()

    expect(historyRange(wrapper)).toBe(rangeLabel(HISTORY_TOTAL + 1, 0))
    expect(pageButton(wrapper, 1).attributes('aria-current')).toBe('page')
    expect(historyCells(historyRows(wrapper)[0])[2]).toBe(NEW_MESSAGE)
  })

  it('[ANV-13] 表示を外し本文を空にして保存すると履歴の先頭が「非表示」で本文が「—」', async () => {
    const { wrapper } = await mountView()
    await settle()

    await enabledInput(wrapper).setValue(false)
    await messageInput(wrapper).setValue('')
    await submitForm(wrapper)
    await settle()

    expect(noticeText(wrapper)).toBe(HIDDEN_MESSAGE)
    expect(enabledInput(wrapper).element.checked).toBe(false)
    const [, label, message] = historyCells(historyRows(wrapper)[0])
    expect(label).toBe(HIDE_LABEL)
    expect(message).toBe('—')
  })

  it('[ANV-14] 何も変えずに保存すると「変更はありません。」が出て履歴は増えない', async () => {
    const { wrapper } = await mountView()
    await settle()

    await submitForm(wrapper)
    await settle()

    expect(noticeText(wrapper)).toBe(UNCHANGED_MESSAGE)
    expect(historyRange(wrapper)).toBe(rangeLabel(HISTORY_TOTAL, 0))
    expect(historyCells(historyRows(wrapper)[0])).toEqual(expectedCells(announcementHistories[0]))
  })

  it('[ANV-15] 表示 ON で本文が空白だけなら項目のエラーを出して PUT しない', async () => {
    const puts = countRequests('put', ANNOUNCEMENTS_PATH)
    const { wrapper } = await mountView()
    await settle()
    expect(enabledInput(wrapper).element.checked).toBe(true)

    await messageInput(wrapper).setValue('   ')
    await submitForm(wrapper)
    await settle()

    expect(fieldError(wrapper, messageInput(wrapper))).toBe(REQUIRED_ERROR)
    expect(puts).toHaveLength(0)
    expect(exists(wrapper, 'announcements-notice')).toBe(false)
    expect(exists(wrapper, 'announcements-save-error')).toBe(false)
  })

  it('[ANV-16] PUT が 400 のときはフォーム先頭に理由が出て入力が残る', async () => {
    const detail = 'お知らせを表示する場合は本文を入力してください。（テスト）'
    server.use(http.put(ANNOUNCEMENTS_PATH, () => HttpResponse.json({ detail }, { status: 400 })))
    const { wrapper } = await mountView()
    await settle()

    await messageInput(wrapper).setValue(NEW_MESSAGE)
    await submitForm(wrapper)
    await settle()

    expect(find(wrapper, 'announcements-save-error').text()).toContain(detail)
    expect(messageInput(wrapper).element.value).toBe(NEW_MESSAGE)
    expect(exists(wrapper, 'announcements-notice')).toBe(false)
    // サーバの拒否は項目のエラーには混ぜない
    expect(fieldError(wrapper, messageInput(wrapper))).toBe('')
  })

  it('[ANV-17] 本文が上限を超えると 422 の理由がフォーム先頭に出て入力が残る', async () => {
    const tooLong = 'あ'.repeat(MESSAGE_MAX_LENGTH + 1)
    const { wrapper } = await mountView()
    await settle()

    // maxlength はユーザ入力にしか効かないので、値を直に入れてサーバの拒否を起こす
    await messageInput(wrapper).setValue(tooLong)
    await submitForm(wrapper)
    await settle()

    const saveError = find(wrapper, 'announcements-save-error').text()
    expect(saveError).toContain('本文')
    expect(saveError).toContain(String(MESSAGE_MAX_LENGTH))
    expect(messageInput(wrapper).element.value).toBe(tooLong)
    expect(exists(wrapper, 'announcements-notice')).toBe(false)
  })

  it('[ANV-18] 本文欄は maxlength が上限で、残り文字数が入力に追従する', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(messageInput(wrapper).attributes('maxlength')).toBe(String(MESSAGE_MAX_LENGTH))

    await messageInput(wrapper).setValue(NEW_MESSAGE)

    expect(fieldHint(wrapper, messageInput(wrapper))).toContain(
      `残り ${MESSAGE_MAX_LENGTH - NEW_MESSAGE.length} 文字`,
    )
  })

  it('[ANV-19] 表示後に他の担当者が更新していると 409 の理由が出て入力が残る', async () => {
    const { wrapper } = await mountView()
    await settle()
    // 409 の文言は、画面と同じ時点の合札を持つ別のストアで起こして得る（直書きしない）
    const stale = await otherUserStore()
    await updateByOtherUser()

    await messageInput(wrapper).setValue(NEW_MESSAGE)
    await submitForm(wrapper)
    await settle()

    await stale.save({ enabled: true, message: NEW_MESSAGE })
    expect(stale.saveError.status).toBe(409)

    expect(find(wrapper, 'announcements-save-error').text()).toContain(stale.saveError.message)
    expect(messageInput(wrapper).element.value).toBe(NEW_MESSAGE)
    expect(exists(wrapper, 'announcements-notice')).toBe(false)
  })

  it('[ANV-20] 保存の応答待ちに再送しても PUT は 1 回で、ボタンは押せない', async () => {
    const putGate = gate('put', ANNOUNCEMENTS_PATH)
    const { wrapper } = await mountView()
    await settle()

    await messageInput(wrapper).setValue(NEW_MESSAGE)
    await submitForm(wrapper)
    await submitForm(wrapper)
    await flushPromises()

    expect(putGate.calls()).toBe(1)
    expect(saveButton(wrapper).text()).toBe('更新中…')
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()

    putGate.release()
    await settle()

    expect(putGate.calls()).toBe(1)
    expect(noticeText(wrapper)).toBe(UPDATED_MESSAGE)
    expect(saveButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('[ANV-21] 通常運用のときは運用状態が「通常運用」で警告は出ない', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(find(wrapper, 'announcements-status').text()).toContain('通常運用')
    expect(exists(wrapper, 'announcements-suspended')).toBe(false)
  })

  it('[ANV-22] 発注停止中は運用状態が「発注停止中」になり警告が出る', async () => {
    server.use(http.get(BANNER_PATH, () => HttpResponse.json(incidentBannerResponse)))
    const { wrapper } = await mountView()
    await settle()

    expect(find(wrapper, 'announcements-status').text()).toContain('発注停止中')
    expect(exists(wrapper, 'announcements-suspended')).toBe(true)
    // 発注停止中でもお知らせの編集は止めない
    expect(exists(wrapper, 'announcements-form')).toBe(true)
  })

  it('[ANV-23] バナーの取得が失敗しても運用状態が「—」になるだけで保存できる', async () => {
    server.use(errorHandler('get', BANNER_PATH))
    const { wrapper } = await mountView()
    await settle()

    expect(find(wrapper, 'announcements-status').text()).toContain('—')
    expect(exists(wrapper, 'announcements-suspended')).toBe(false)
    expect(exists(wrapper, 'announcements-form')).toBe(true)

    await messageInput(wrapper).setValue(NEW_MESSAGE)
    await submitForm(wrapper)
    await settle()

    expect(noticeText(wrapper)).toBe(UPDATED_MESSAGE)
  })

  it('[ANV-24] 「再読み込み」で通知が消え、最新の本文に洗い替わる', async () => {
    const { wrapper } = await mountView()
    await settle()
    await submitForm(wrapper)
    await settle()
    expect(exists(wrapper, 'announcements-notice')).toBe(true)

    await updateByOtherUser()
    await find(wrapper, 'announcements-reload').trigger('click')
    await settle()

    expect(exists(wrapper, 'announcements-notice')).toBe(false)
    expect(messageInput(wrapper).element.value).toBe(OTHER_USER_MESSAGE)
  })
})
