import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { activityLogs } from '@/mocks/fixtures/activityLogs'
import { users } from '@/mocks/fixtures/users'
import { ACTIVITY_LOGS_PAGE_SIZE, useActivityLogsStore } from './activityLogs'

/*
 * 既定の MSW ハンドラ（実 API と同じ絞り込み・並び順）に当てる。
 * 期待値はフィクスチャ（操作日時の降順）と表示件数から導き、件数を直接書かない。
 * 行は `対象種別:履歴ID`（アプリ内モデルの id）で特定する。
 */

const LIST_PATH = '*/api/operations/activity-logs'
const PAGE_SIZE = ACTIVITY_LOGS_PAGE_SIZE
const TOTAL = activityLogs.length

const idOf = (row) => `${row.対象種別}:${row.履歴ID}`
const expectedIds = activityLogs.map(idOf)

/** 条件に当たる行の id（フィクスチャの並びのまま） */
const idsMatching = (predicate) => activityLogs.filter(predicate).map(idOf)

const dateOf = (row) => row.操作日時.slice(0, 10)

const head = activityLogs[0]
// 期間はフィクスチャの 2 行目と 5 行目の日付で挟む（両端の日付の行が含まれることも見る）
const DATE_TO = dateOf(activityLogs[1])
const DATE_FROM = dateOf(activityLogs[4])
const OPERATOR = head.操作者
const TARGET_TYPE = head.対象種別
// 対象キーの一部（部分一致の確認用）
const TARGET_KEY_PART = activityLogs.find((row) => row.対象種別 === 'customers').対象キー.slice(0, 5)

const NO_MATCH = '該当なし'
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

function failList() {
  server.use(
    http.get(LIST_PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
  )
}

/**
 * 一覧の応答を遅らせる差し替え。offset ごとに待ち時間を変えられる。
 *
 * @param {(offset: number) => number} waitFor offset に対する待ち時間（ミリ秒）
 */
function slowList(waitFor) {
  server.use(
    http.get(LIST_PATH, async ({ request }) => {
      const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0)
      await delay(waitFor(offset))
      return HttpResponse.json({
        total: TOTAL,
        activity_logs: activityLogs.slice(offset, offset + PAGE_SIZE),
      })
    }),
  )
}

const idsOf = (store) => store.items.map((item) => item.id)

// シナリオ: docs/unit/stores-activity-logs.md
describe('stores/activityLogs', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[ALS-01] 既定の読み込みで 1 ページ目が操作日時の降順で入る', async () => {
    const store = useActivityLogsStore()

    await store.load()

    expect(store.total).toBe(TOTAL)
    expect(store.offset).toBe(0)
    expect(store.limit).toBe(PAGE_SIZE)
    expect(idsOf(store)).toEqual(expectedIds.slice(0, PAGE_SIZE))
  })

  it('[ALS-02] offset を渡すとその位置から読み込む', async () => {
    const store = useActivityLogsStore()

    await store.load({ offset: PAGE_SIZE })

    expect(store.offset).toBe(PAGE_SIZE)
    expect(idsOf(store)).toEqual(expectedIds.slice(PAGE_SIZE))
    // 全件がちょうど 1 ページに収まっていたら、このシナリオは意味を失う
    expect(store.items.length).toBeGreaterThan(0)
  })

  it('[ALS-03] 期間（両端を含む）で絞り込む', async () => {
    const expected = idsMatching((row) => dateOf(row) >= DATE_FROM && dateOf(row) <= DATE_TO)
    const store = useActivityLogsStore()

    await store.load({ dateFrom: DATE_FROM, dateTo: DATE_TO })

    expect(store.dateFrom).toBe(DATE_FROM)
    expect(store.dateTo).toBe(DATE_TO)
    expect(idsOf(store)).toEqual(expected)
    expect(idsOf(store)).toContain(idOf(activityLogs[1]))
    expect(idsOf(store)).toContain(idOf(activityLogs[4]))
    // 範囲外の行が落ちていること
    expect(expected.length).toBeLessThan(TOTAL)
  })

  it('[ALS-04] 操作者は完全一致で絞り込む', async () => {
    const expected = idsMatching((row) => row.操作者 === OPERATOR)
    const store = useActivityLogsStore()

    await store.load({ operator: OPERATOR })

    expect(store.operator).toBe(OPERATOR)
    expect(idsOf(store)).toEqual(expected.slice(0, PAGE_SIZE))
    expect(expected.length).toBeGreaterThan(0)
  })

  it('[ALS-05] 操作区分で絞り込む', async () => {
    const expected = idsMatching((row) => row.操作区分 === 'DELETE')
    const store = useActivityLogsStore()

    await store.load({ operation: 'DELETE' })

    expect(store.operation).toBe('DELETE')
    expect(idsOf(store)).toEqual(expected)
    expect(expected.length).toBeGreaterThan(0)
  })

  it('[ALS-06] 対象種別（複数）で絞り込む', async () => {
    const second = activityLogs.find((row) => row.対象種別 !== TARGET_TYPE).対象種別
    const targetTypes = [TARGET_TYPE, second]
    const expected = idsMatching((row) => targetTypes.includes(row.対象種別))
    const store = useActivityLogsStore()

    await store.load({ targetTypes })

    expect(store.targetTypes).toEqual(targetTypes)
    expect(idsOf(store)).toEqual(expected.slice(0, PAGE_SIZE))
    // 2 種とも含まれていること（1 種だけに絞られていないこと）
    expect(new Set(store.items.map((item) => item.targetType))).toEqual(new Set(targetTypes))
  })

  it('[ALS-07] 対象キーは部分一致で絞り込み、対象キーの無い行は含まない', async () => {
    const expected = idsMatching((row) => (row.対象キー ?? '').includes(TARGET_KEY_PART))
    const store = useActivityLogsStore()

    await store.load({ targetKey: TARGET_KEY_PART })

    expect(store.targetKey).toBe(TARGET_KEY_PART)
    expect(store.total).toBe(expected.length)
    expect(idsOf(store)).toEqual(expected.slice(0, PAGE_SIZE))
    expect(store.items.every((item) => item.targetKey.includes(TARGET_KEY_PART))).toBe(true)
  })

  it('[ALS-08] sort=asc で操作日時の昇順になる', async () => {
    const store = useActivityLogsStore()

    await store.load({ sort: 'asc' })

    expect(store.sort).toBe('asc')
    expect(idsOf(store)).toEqual([...expectedIds].reverse().slice(0, PAGE_SIZE))
  })

  it('[ALS-09] 該当が無いときは空とみなす', async () => {
    const store = useActivityLogsStore()

    await store.load({ targetKey: NO_MATCH })

    expect(store.items).toEqual([])
    expect(store.total).toBe(0)
    expect(store.isEmpty).toBe(true)
  })

  it('[ALS-10] 取得に失敗したときは error に入り、空状態にはしない', async () => {
    failList()
    const store = useActivityLogsStore()

    await store.load()

    expect(store.error?.message).toBe(ERROR_MESSAGE)
    expect(store.items).toEqual([])
    expect(store.isEmpty).toBe(false)
  })

  it('[ALS-11] 取得中は loading が立つ', async () => {
    slowList(() => 10)
    const store = useActivityLogsStore()

    const pending = store.load()
    expect(store.loading).toBe(true)

    await pending
    expect(store.loading).toBe(false)
  })

  it('[ALS-12] reload は条件とページ位置を保ったまま読み直す', async () => {
    const expected = idsMatching((row) => row.対象種別 === TARGET_TYPE)
    const store = useActivityLogsStore()
    await store.load({ offset: 0, targetTypes: [TARGET_TYPE], sort: 'asc' })

    await store.reload()

    expect(store.targetTypes).toEqual([TARGET_TYPE])
    expect(store.sort).toBe('asc')
    expect(store.offset).toBe(0)
    expect(idsOf(store)).toEqual([...expected].reverse())
  })

  it('[ALS-13] 読むだけの一覧なので登録・更新・削除を公開しない', () => {
    const store = useActivityLogsStore()

    expect(store.create).toBeUndefined()
    expect(store.update).toBeUndefined()
    expect(store.remove).toBeUndefined()
    expect(store.creating).toBeUndefined()
    expect(store.deleting).toBeUndefined()
  })

  it('[ALS-14] 古い応答が新しい結果を上書きしない', async () => {
    // 先に投げる 2 ページ目を遅く、後から投げる 1 ページ目を速く返す
    slowList((offset) => (offset === 0 ? 10 : 60))
    const store = useActivityLogsStore()

    const stale = store.load({ offset: PAGE_SIZE })
    const latest = store.load({ offset: 0 })
    await Promise.all([stale, latest])

    expect(idsOf(store)).toEqual(expectedIds.slice(0, PAGE_SIZE))
  })

  it('[ALS-15] 実行者区分で絞り込む', async () => {
    // 管理者・管理責任者に入るロール（モックの読み方。src/mocks/handlers/activityLogs.js）
    const managerCodes = new Set(
      users
        .filter((user) => ['manager', 'supervisor'].includes(user.ロールコード))
        .map((user) => user.操作者コード),
    )
    const expected = idsMatching((row) => managerCodes.has(row.操作者))
    const store = useActivityLogsStore()

    await store.load({ actorGroup: 'manager' })

    expect(store.actorGroup).toBe('manager')
    expect(store.total).toBe(expected.length)
    expect(idsOf(store)).toEqual(expected.slice(0, PAGE_SIZE))
    // 絞り込みが効いていること（全件でも 0 件でもない）
    expect(expected.length).toBeGreaterThan(0)
    expect(expected.length).toBeLessThan(TOTAL)
  })
})
