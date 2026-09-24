import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { activityLogs } from '@/mocks/fixtures/activityLogs'
import { activityLogTargets } from '@/mocks/fixtures/activityLogTargets'
import { fetchActivityLogs, fetchActivityLogTargets } from './activityLogs'

/*
 * API 層のテスト。ここだけが「バックエンドの形」を知ってよい層なので、
 * **送り出すリクエストそのもの** と、日本語キーからアプリ内モデルへの変換を検証する。
 *
 * シナリオ: docs/unit/api-activity-logs.md
 */

const LIST_PATH = '*/api/operations/activity-logs'
const TARGETS_PATH = '*/api/operations/activity-logs/targets'

/** 最後に届いた一覧リクエスト */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

/**
 * 一覧のリクエストを記録して、指定の本文を返すハンドラを立てる。
 *
 * @param {unknown} body 返す本文
 * @param {number} [status]
 */
function record(body, status = 200) {
  server.use(
    http.get(LIST_PATH, ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams }
      return HttpResponse.json(body, { status })
    }),
  )
}

const listBody = (rows) => ({ total: rows.length, limit: 50, offset: 0, activity_logs: rows })

// 期待値の材料になる行はフィクスチャから取る
const updateItem = activityLogs.find((row) => row.操作区分 === 'UPDATE' && row.操作者)
const createItem = activityLogs.find((row) => row.操作区分 === 'CREATE')
const deleteItem = activityLogs.find((row) => row.操作区分 === 'DELETE')
const multiDiffItem = activityLogs.find((row) => Object.keys(row.差分).length >= 2)

/** 仕様（ActivityLogItem）から作るアプリ内モデルのキー */
const MODEL_KEYS = [
  'id',
  'historyId',
  'targetType',
  'targetTypeName',
  'targetId',
  'targetKey',
  'operation',
  'operator',
  'at',
  'before',
  'after',
  'diff',
  'changedFields',
]

// シナリオ: docs/unit/api-activity-logs.md
describe('api/activityLogs', () => {
  it('[ALA-01] 引数なしの一覧取得は limit と offset だけを送る', async () => {
    record(listBody([]))

    await fetchActivityLogs()

    expect(lastRequest.url.pathname).toBe('/api/operations/activity-logs')
    expect(lastRequest.params.get('limit')).toBe('50')
    expect(lastRequest.params.get('offset')).toBe('0')
    expect([...lastRequest.params.keys()]).toEqual(['limit', 'offset'])
  })

  it('[ALA-02] 検索条件は実 API のクエリ名で送り、それ以外は送らない', async () => {
    record(listBody([]))
    const conditions = {
      dateFrom: '2026-09-01',
      dateTo: '2026-09-16',
      operator: updateItem.操作者,
      operation: updateItem.操作区分,
      targetType: updateItem.対象種別,
      targetKey: updateItem.対象キー,
      sort: 'asc',
    }

    await fetchActivityLogs(conditions)

    expect(lastRequest.params.get('start_date')).toBe(conditions.dateFrom)
    expect(lastRequest.params.get('end_date')).toBe(conditions.dateTo)
    expect(lastRequest.params.get('operator')).toBe(conditions.operator)
    expect(lastRequest.params.get('operation')).toBe(conditions.operation)
    expect(lastRequest.params.get('target_types')).toBe(conditions.targetType)
    expect(lastRequest.params.get('target_key')).toBe(conditions.targetKey)
    expect(lastRequest.params.get('sort')).toBe(conditions.sort)
    expect([...lastRequest.params.keys()].sort()).toEqual(
      [
        'end_date',
        'limit',
        'offset',
        'operation',
        'operator',
        'sort',
        'start_date',
        'target_key',
        'target_types',
      ].sort(),
    )
  })

  it('[ALA-03] 空文字の条件はクエリに載せない（sort も送らない）', async () => {
    record(listBody([]))

    await fetchActivityLogs({
      dateFrom: '',
      dateTo: '',
      operator: '',
      operation: '',
      targetType: '',
      targetKey: '',
      sort: '',
    })

    // sort を空で送らず、実 API の既定（desc）に任せる
    expect([...lastRequest.params.keys()]).toEqual(['limit', 'offset'])
  })

  it('[ALA-04] limit と offset をそのまま送る', async () => {
    record(listBody([]))

    await fetchActivityLogs({ limit: 20, offset: 50 })

    expect(lastRequest.params.get('limit')).toBe('20')
    expect(lastRequest.params.get('offset')).toBe('50')
  })

  it('[ALA-05] 対象種別を読み、アプリ内モデルに変換する', async () => {
    let requestedPath = null
    server.use(
      http.get(TARGETS_PATH, ({ request }) => {
        requestedPath = new URL(request.url).pathname
        return HttpResponse.json({ targets: activityLogTargets })
      }),
    )

    const targets = await fetchActivityLogTargets()

    expect(requestedPath).toBe('/api/operations/activity-logs/targets')
    expect(targets).toEqual(
      activityLogTargets.map((raw) => ({
        code: raw.対象種別,
        name: raw.対象種別名,
        keyLabel: raw.対象キー項目,
        historyTable: raw.履歴テーブル,
      })),
    )
  })

  it('[ALA-06] targets を持たない応答でも空配列を返す', async () => {
    server.use(http.get(TARGETS_PATH, () => HttpResponse.json({})))

    expect(await fetchActivityLogTargets()).toEqual([])
  })

  it('[ALA-07] ActivityLogItem をアプリ内モデルに変換する', async () => {
    record(listBody([updateItem]))

    const { items, total } = await fetchActivityLogs()

    expect(total).toBe(1)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      // 履歴ID は履歴テーブルごとの連番なので、対象種別と組にして行キーにする
      id: `${updateItem.対象種別}:${updateItem.履歴ID}`,
      historyId: updateItem.履歴ID,
      targetType: updateItem.対象種別,
      targetTypeName: updateItem.対象種別名,
      targetId: updateItem.対象ID,
      targetKey: updateItem.対象キー,
      operation: updateItem.操作区分,
      operator: updateItem.操作者,
      at: updateItem.操作日時,
    })
    expect(items[0].before).toEqual(updateItem.変更前データ)
    expect(items[0].after).toEqual(updateItem.変更後データ)
    expect(items[0].changedFields).toEqual(updateItem.変更項目)
  })

  it('[ALA-08] null の対象ID・対象キー・操作者は空文字に寄せる', async () => {
    record(listBody([{ ...updateItem, 対象ID: null, 対象キー: null, 操作者: null }]))

    const { items } = await fetchActivityLogs()

    expect(items[0]).toMatchObject({ targetId: '', targetKey: '', operator: '' })
  })

  it('[ALA-09] 変更前データ・変更後データの null はそのまま残す', async () => {
    // フィクスチャが登録・削除の行を持っていないと、このシナリオは意味を失う
    expect(createItem.変更前データ).toBeNull()
    expect(deleteItem.変更後データ).toBeNull()
    record(listBody([createItem, deleteItem]))

    const { items } = await fetchActivityLogs()

    expect(items[0].before).toBeNull()
    expect(items[0].after).toEqual(createItem.変更後データ)
    expect(items[1].before).toEqual(deleteItem.変更前データ)
    expect(items[1].after).toBeNull()
  })

  it('[ALA-10] 差分は項目ごとの配列に並べ直し、欠けた値は null にする', async () => {
    const extraField = '欠けた項目'
    record(listBody([{ ...multiDiffItem, 差分: { ...multiDiffItem.差分, [extraField]: {} } }]))

    const { items } = await fetchActivityLogs()

    expect(items[0].diff).toEqual([
      ...Object.entries(multiDiffItem.差分).map(([field, change]) => ({
        field,
        before: change.before,
        after: change.after,
      })),
      { field: extraField, before: null, after: null },
    ])
  })

  it('[ALA-11] 配列でない変更項目と null の差分は空配列になる', async () => {
    record(
      listBody([
        { ...updateItem, 履歴ID: 1, 変更項目: null, 差分: null },
        { ...updateItem, 履歴ID: 2, 変更項目: '規制区分', 差分: null },
      ]),
    )

    const { items } = await fetchActivityLogs()

    for (const item of items) {
      expect(item.changedFields).toEqual([])
      expect(item.diff).toEqual([])
    }
  })

  it('[ALA-12] 仕様に無い契約提案の 5 項目は変換結果に出さない', async () => {
    // フィクスチャに契約提案の項目が載っていないと、このシナリオは意味を失う
    expect(updateItem).toHaveProperty('操作者名')
    record(listBody([updateItem]))

    const { items } = await fetchActivityLogs()

    expect(Object.keys(items[0]).sort()).toEqual([...MODEL_KEYS].sort())
    const values = Object.values(items[0])
    for (const key of ['操作者名', '実行者区分', '操作内容']) {
      expect(values).not.toContain(updateItem[key])
    }
  })

  it('[ALA-13] 履歴ID が重複しても行キーは一意になる', async () => {
    const { items } = await fetchActivityLogs({ limit: activityLogs.length })

    expect(items).toHaveLength(activityLogs.length)
    const historyIds = new Set(items.map((item) => item.historyId))
    // 対象種別をまたいで履歴ID が重複するフィクスチャでないと、このシナリオは意味を失う
    expect(historyIds.size).toBeLessThan(items.length)
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
  })

  it('[ALA-14] activity_logs を持たない応答でも空の一覧として扱う', async () => {
    record({ total: 0 })

    const { items, total } = await fetchActivityLogs()

    expect(items).toEqual([])
    expect(total).toBe(0)
  })

  it('[ALA-15] サーバエラーは例外になる', async () => {
    const detail = { detail: 'サーバーでエラーが発生しました。' }
    record(detail, 500)
    server.use(http.get(TARGETS_PATH, () => HttpResponse.json(detail, { status: 500 })))

    await expect(fetchActivityLogs()).rejects.toBeTruthy()
    await expect(fetchActivityLogTargets()).rejects.toBeTruthy()
  })
})
