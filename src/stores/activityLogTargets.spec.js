import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { activityLogTargets } from '@/mocks/fixtures/activityLogTargets'
import { useActivityLogTargetsStore } from './activityLogTargets'

/*
 * 既定の MSW ハンドラに当てる。期待値はフィクスチャ（activityLogTargets）から導く。
 * 「一度取れたら読み直さない」は、リクエストが飛ばないこととして外から観察する。
 */

const TARGETS_PATH = '*/api/operations/activity-logs/targets'
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const expectedOptions = activityLogTargets.map((raw) => ({
  value: raw.対象種別,
  label: raw.対象種別名,
}))

/**
 * 届いたリクエストを数えるハンドラを立てる。
 *
 * @param {number} [wait] 応答までの待ち時間（ミリ秒）
 * @returns {{ count: number }} 呼ばれた回数（参照で読む）
 */
function countRequests(wait = 0) {
  const counter = { count: 0 }
  server.use(
    http.get(TARGETS_PATH, async () => {
      counter.count += 1
      if (wait > 0) await delay(wait)
      return HttpResponse.json({ targets: activityLogTargets })
    }),
  )
  return counter
}

const failTargets = (options) =>
  server.use(
    http.get(
      TARGETS_PATH,
      () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
      options,
    ),
  )

// シナリオ: docs/unit/stores-activity-log-targets.md
describe('stores/activityLogTargets', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[ALT-01] 未取得でも options と targets は空配列', () => {
    const store = useActivityLogTargetsStore()

    expect(store.options).toEqual([])
    expect(store.targets).toEqual([])
  })

  it('[ALT-02] ensureLoaded で対象種別の選択肢が埋まる', async () => {
    const store = useActivityLogTargetsStore()

    await store.ensureLoaded()

    expect(store.options).toEqual(expectedOptions)
    expect(expectedOptions.length).toBeGreaterThan(0)
  })

  it('[ALT-03] 選択肢は value / label の 2 キーだけを持つ', async () => {
    const store = useActivityLogTargetsStore()
    await store.ensureLoaded()

    expect(Object.keys(store.options[0]).sort()).toEqual(['label', 'value'])
  })

  it('[ALT-04] 取得済みなら ensureLoaded は読み直さない', async () => {
    const counter = countRequests()
    const store = useActivityLogTargetsStore()
    await store.ensureLoaded()

    await store.ensureLoaded()

    expect(counter.count).toBe(1)
    expect(store.options).toEqual(expectedOptions)
  })

  it('[ALT-05] 取得中に ensureLoaded を重ねてもリクエストは 1 本', async () => {
    const counter = countRequests(10)
    const store = useActivityLogTargetsStore()

    const first = store.ensureLoaded()
    const second = store.ensureLoaded()
    expect(store.loading).toBe(true)
    // 2 回目も待てる（画面が「区分」の展開のために完了を待つ）
    expect(second).toBeInstanceOf(Promise)

    await Promise.all([first, second])

    expect(counter.count).toBe(1)
    expect(store.loading).toBe(false)
    expect(store.options).toEqual(expectedOptions)
  })

  it('[ALT-06] 取得に失敗すると error に入り、選択肢は空のまま', async () => {
    failTargets()
    const store = useActivityLogTargetsStore()

    await store.ensureLoaded()

    expect(store.error?.message).toBe(ERROR_MESSAGE)
    expect(store.options).toEqual([])
  })

  it('[ALT-07] 失敗した後の ensureLoaded は読み直す', async () => {
    // once を付けて、1 回目だけ 500・2 回目から既定ハンドラに戻す
    failTargets({ once: true })
    const store = useActivityLogTargetsStore()
    await store.ensureLoaded()
    expect(store.error).not.toBeNull()

    await store.ensureLoaded()

    expect(store.error).toBeNull()
    expect(store.options).toEqual(expectedOptions)
  })

  it('[ALT-08] targets は応答の区分・区分名を持つ', async () => {
    const store = useActivityLogTargetsStore()

    await store.ensureLoaded()

    expect(store.targets.map(({ code, category, categoryName }) => ({ code, category, categoryName }))).toEqual(
      activityLogTargets.map((raw) => ({
        code: raw.対象種別,
        category: raw.区分,
        categoryName: raw.区分名,
      })),
    )
  })
})
