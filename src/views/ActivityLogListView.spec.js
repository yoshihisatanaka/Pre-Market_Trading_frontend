import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { activityLogs } from '@/mocks/fixtures/activityLogs'
import { activityLogTargets } from '@/mocks/fixtures/activityLogTargets'
import { ACTIVITY_LOGS_PAGE_SIZE } from '@/stores/activityLogs'
import {
  ACTIVITY_OPERATION_OPTIONS,
  formatActivityAt,
  operationBadgeVariant,
  operationLabel,
} from '@/utils/activityLogTypes'
import ActivityLogListView from './ActivityLogListView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 4 状態の出し分けと「URL クエリが正」の単方向フローを検証する。
 *
 * ヘッダへの Teleport は無いが、詳細ダイアログ（BaseModal）が body へ Teleport するので
 * teleport を stub して wrapper 内に描画させる。
 */
const PATH = '/operations/activity-logs'
const LIST_PATH = '*/api/operations/activity-logs'
const TARGETS_PATH = '*/api/operations/activity-logs/targets'

const PAGE_SIZE = ACTIVITY_LOGS_PAGE_SIZE
const TOTAL = activityLogs.length
const firstPage = activityLogs.slice(0, PAGE_SIZE)
const secondPage = activityLogs.slice(PAGE_SIZE)
const head = activityLogs[0]
const oldest = activityLogs[TOTAL - 1]

const PLACEHOLDER = '-- 全て --'
const EMPTY = '—'
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const idOf = (row) => `${row.対象種別}:${row.履歴ID}`
const dateOf = (row) => row.操作日時.slice(0, 10)

/**
 * モックと同じ意味の絞り込み（期待値をフィクスチャから導くため）。
 * 期間は両端を含み、操作者・操作区分・対象種別は完全一致、対象キーは部分一致。
 */
function matches(row, { dateFrom, dateTo, operator, operation, targetType, targetKey }) {
  return (
    (!dateFrom || dateOf(row) >= dateFrom) &&
    (!dateTo || dateOf(row) <= dateTo) &&
    (!operator || row.操作者 === operator) &&
    (!operation || row.操作区分 === operation) &&
    (!targetType || row.対象種別 === targetType) &&
    (!targetKey || (row.対象キー ?? '').includes(targetKey))
  )
}

const listBody = (rows, total = rows.length) => ({ total, activity_logs: rows })

const errorHandler = (path, options) =>
  http.get(path, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }), options)
const emptyHandler = () => http.get(LIST_PATH, () => HttpResponse.json(listBody([])))

const Page = { render: () => h('div') }

/**
 * 画面をマウントする。
 *
 * @param {{ query?: object }} [options]
 */
async function mountView({ query = {} } = {}) {
  // 実 router/index.js は createWebHistory 固定で差し替えられないため、テスト用に最小定義する
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: PATH, component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push({ path: PATH, query })

  const wrapper = mount(ActivityLogListView, {
    global: {
      plugins: [createPinia(), router],
      // 詳細ダイアログの Teleport を wrapper 内に描画させる
      stubs: { teleport: true },
    },
  })
  return { wrapper, router }
}

/**
 * 操作 → router.push → queryKey の watch → 再取得 → 再描画 までを待つ。
 * 1 回目でナビゲーションが確定して再取得が始まり、2 回目で応答が反映される。
 */
async function settle() {
  await flushPromises()
  await flushPromises()
}

const find = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const exists = (wrapper, testid) => find(wrapper, testid).exists()
const rows = (wrapper) =>
  find(wrapper, 'activity-logs-table').findAll('[data-testid="data-table-row"]')
const cellsOf = (row) => row.findAll('td')
const countText = (wrapper) => find(wrapper, 'activity-logs-count').text()
const pageButton = (wrapper, page) =>
  wrapper.find(`[data-testid="pagination-page"][data-page="${page}"]`)
const optionsOf = (wrapper, testid) =>
  wrapper.findAll(`[data-testid="${testid}"] option`).map((option) => ({
    value: option.element.value,
    label: option.text(),
  }))
const sortButton = (wrapper, value) =>
  wrapper.find(`[data-testid="activity-logs-sort"] button[data-value="${value}"]`)
/** 表示中の行の id（「詳細」ボタンの testid から読む） */
const shownIds = (wrapper) =>
  rows(wrapper).map((row) =>
    row
      .find('[data-testid^="activity-logs-detail-"]')
      .attributes('data-testid')
      .replace('activity-logs-detail-', ''),
  )

// シナリオ: docs/unit/views-activity-log-list-view.md
describe('ActivityLogListView', () => {
  it('[ALV-01] 応答を待つ間はローディングだけを出し、検索を押せない', async () => {
    const { wrapper } = await mountView()

    expect(exists(wrapper, 'activity-logs-loading')).toBe(true)
    expect(exists(wrapper, 'activity-logs-table')).toBe(false)
    expect(exists(wrapper, 'activity-logs-empty')).toBe(false)
    expect(exists(wrapper, 'activity-logs-error')).toBe(false)
    expect(exists(wrapper, 'activity-logs-count')).toBe(false)
    expect(find(wrapper, 'activity-logs-search-submit').element.disabled).toBe(true)
  })

  it('[ALV-02] 1 ページ目の件数と行がフィクスチャと一致する', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)

    const cells = cellsOf(rows(wrapper)[0]).map((cell) => cell.text())
    expect(cells[0]).toBe(formatActivityAt(head.操作日時))
    expect(cells[1]).toBe(head.対象種別名)
    expect(cells[2]).toBe(operationLabel(head.操作区分))
    expect(cells[3]).toBe(head.操作者)
    expect(cells[4]).toBe(head.対象キー)
    expect(cells[5]).toBe(head.変更項目.join('、'))
  })

  it('[ALV-03] 列が 7 列で、最後が操作列', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(find(wrapper, 'activity-logs-table').findAll('th').map((th) => th.text())).toEqual([
      '操作日時',
      '対象種別',
      '操作区分',
      '操作者',
      '対象キー',
      '変更項目',
      '',
    ])
  })

  it('[ALV-04] 対象キーと操作者を持たない行は — を出す', async () => {
    const index = firstPage.findIndex((row) => row.対象キー === null && row.操作者 === null)
    // フィクスチャにその行が無いと、このシナリオは意味を失う
    expect(index).toBeGreaterThanOrEqual(0)

    const { wrapper } = await mountView()
    await settle()

    const cells = cellsOf(rows(wrapper)[index])
    expect(cells[3].text()).toBe(EMPTY)
    expect(cells[4].text()).toBe(EMPTY)
  })

  it('[ALV-05] 操作区分は表示名のバッジで、区分ごとの色で出る', async () => {
    const { wrapper } = await mountView()
    await settle()

    const seen = new Set()
    rows(wrapper).forEach((row, index) => {
      const operation = firstPage[index].操作区分
      const badge = cellsOf(row)[2].find('[data-variant]')
      expect(badge.text()).toBe(operationLabel(operation))
      expect(badge.attributes('data-variant')).toBe(operationBadgeVariant(operation))
      seen.add(operation)
    })
    // 1 ページ目に全区分が出ていないと、色の出し分けを確かめたことにならない
    expect([...seen].sort()).toEqual(ACTIVITY_OPERATION_OPTIONS.map(({ value }) => value).sort())
    expect(operationBadgeVariant('CREATE')).toBe('success')
    expect(operationBadgeVariant('UPDATE')).toBe('info')
    expect(operationBadgeVariant('DELETE')).toBe('warning')
    expect(operationBadgeVariant('BATCH')).toBe('gray')
  })

  it('[ALV-06] 0 件のときは空状態を出し、表は描画しない', async () => {
    server.use(emptyHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(find(wrapper, 'activity-logs-empty').text()).toBe('該当する操作ログはありません。')
    expect(exists(wrapper, 'activity-logs-table')).toBe(false)
  })

  it('[ALV-07] 取得に失敗したときは理由と再試行を出す', async () => {
    server.use(errorHandler(LIST_PATH))
    const { wrapper } = await mountView()
    await settle()

    const error = find(wrapper, 'activity-logs-error')
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'activity-logs-table')).toBe(false)
    expect(exists(wrapper, 'activity-logs-empty')).toBe(false)
  })

  it('[ALV-08] 再試行で読み直すと表が出る', async () => {
    server.use(errorHandler(LIST_PATH, { once: true }))
    const { wrapper } = await mountView()
    await settle()

    await find(wrapper, 'activity-logs-error').find('button').trigger('click')
    await settle()

    expect(exists(wrapper, 'activity-logs-error')).toBe(false)
    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)
  })

  it('[ALV-09] ページ番号を click すると URL に offset が乗り表が入れ替わる', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await pageButton(wrapper, 2).trigger('click')
    await settle()

    expect(router.currentRoute.value.query.offset).toBe(String(PAGE_SIZE))
    expect(shownIds(wrapper)).toEqual(secondPage.map(idOf))
  })

  it('[ALV-10] 検索すると URL に実 API と同じクエリ名で条件が乗り絞り込まれる', async () => {
    const conditions = {
      dateFrom: dateOf(head),
      dateTo: dateOf(head),
      operator: head.操作者,
      operation: head.操作区分,
      targetType: head.対象種別,
      targetKey: head.対象キー.slice(0, 2),
    }
    const expected = activityLogs.filter((row) => matches(row, conditions))
    expect(expected.length).toBeGreaterThan(0)

    const { wrapper, router } = await mountView()
    await settle()

    await find(wrapper, 'activity-logs-date-from').setValue(conditions.dateFrom)
    await find(wrapper, 'activity-logs-date-to').setValue(conditions.dateTo)
    await find(wrapper, 'activity-logs-operator').setValue(conditions.operator)
    await find(wrapper, 'activity-logs-operation').setValue(conditions.operation)
    await find(wrapper, 'activity-logs-target-type').setValue(conditions.targetType)
    await find(wrapper, 'activity-logs-target-key').setValue(conditions.targetKey)
    await find(wrapper, 'activity-logs-search').trigger('submit')
    await settle()

    // 条件を変えたら 1 ページ目に戻すので offset は付かない
    expect(router.currentRoute.value.query).toEqual({
      start_date: conditions.dateFrom,
      end_date: conditions.dateTo,
      operator: conditions.operator,
      operation: conditions.operation,
      target_types: conditions.targetType,
      target_key: conditions.targetKey,
    })
    expect(shownIds(wrapper)).toEqual(expected.map(idOf))
  })

  it('[ALV-11] クリアで URL クエリが空になり全件に戻る', async () => {
    const { wrapper, router } = await mountView({ query: { operation: 'DELETE' } })
    await settle()
    expect(rows(wrapper).length).toBeLessThan(PAGE_SIZE)

    await find(wrapper, 'activity-logs-search-clear').trigger('click')
    await settle()

    expect(router.currentRoute.value.query).toEqual({})
    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)
  })

  it('[ALV-12] URL クエリの条件が入力欄と一覧に反映される', async () => {
    const sample = activityLogs.find(
      (row) => row.対象種別 === 'customers' && row.操作区分 === 'UPDATE' && row.操作者,
    )
    const conditions = {
      dateFrom: dateOf(oldest),
      dateTo: dateOf(head),
      operator: sample.操作者,
      operation: sample.操作区分,
      targetType: sample.対象種別,
      // 水増しの行（口座番号 12301xx）にも当たる長さの部分一致にする
      targetKey: sample.対象キー.slice(0, 4),
    }
    const expected = activityLogs.filter((row) => matches(row, conditions)).reverse()
    expect(expected.length).toBeGreaterThan(1)

    const { wrapper } = await mountView({
      query: {
        start_date: conditions.dateFrom,
        end_date: conditions.dateTo,
        operator: conditions.operator,
        operation: conditions.operation,
        target_types: conditions.targetType,
        target_key: conditions.targetKey,
        sort: 'asc',
      },
    })
    await settle()

    expect(find(wrapper, 'activity-logs-date-from').element.value).toBe(conditions.dateFrom)
    expect(find(wrapper, 'activity-logs-date-to').element.value).toBe(conditions.dateTo)
    expect(find(wrapper, 'activity-logs-operator').element.value).toBe(conditions.operator)
    expect(find(wrapper, 'activity-logs-operation').element.value).toBe(conditions.operation)
    expect(find(wrapper, 'activity-logs-target-type').element.value).toBe(conditions.targetType)
    expect(find(wrapper, 'activity-logs-target-key').element.value).toBe(conditions.targetKey)
    expect(sortButton(wrapper, 'asc').attributes('aria-pressed')).toBe('true')
    expect(countText(wrapper)).toContain(String(expected.length))
    // 古い順で並ぶ
    expect(shownIds(wrapper)).toEqual(expected.slice(0, PAGE_SIZE).map(idOf))
  })

  it('[ALV-13] 選択肢に無い操作区分と並び順は空に落ちる', async () => {
    const { wrapper } = await mountView({ query: { operation: 'PURGE', sort: 'desc' } })
    await settle()

    expect(find(wrapper, 'activity-logs-operation').element.value).toBe('')
    expect(sortButton(wrapper, '').attributes('aria-pressed')).toBe('true')
    expect(sortButton(wrapper, 'asc').attributes('aria-pressed')).toBe('false')
    // 条件なし・既定の並び（新しい順）の全件
    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(shownIds(wrapper)).toEqual(firstPage.map(idOf))
  })

  it('[ALV-14] 対象種別の選択肢は API から、操作区分は定数から来る', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(optionsOf(wrapper, 'activity-logs-target-type')).toEqual([
      { value: '', label: PLACEHOLDER },
      ...activityLogTargets.map((raw) => ({ value: raw.対象種別, label: raw.対象種別名 })),
    ])
    expect(optionsOf(wrapper, 'activity-logs-operation')).toEqual([
      { value: '', label: PLACEHOLDER },
      ...ACTIVITY_OPERATION_OPTIONS,
    ])
  })

  it('[ALV-15] 対象種別を取得できなくても欄の下に理由を出し、検索はできる', async () => {
    server.use(errorHandler(TARGETS_PATH))
    const { wrapper, router } = await mountView()
    await settle()

    // 欄の下のエラー文言は aria-describedby でセレクトと結び付いている
    const select = find(wrapper, 'activity-logs-target-type')
    const describedBy = select.attributes('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(wrapper.find(`[id="${describedBy}"]`).text()).toBe(
      `対象種別を取得できませんでした（${ERROR_MESSAGE}）`,
    )
    expect(optionsOf(wrapper, 'activity-logs-target-type')).toEqual([
      { value: '', label: PLACEHOLDER },
    ])
    // 一覧は出ていて、検索もできる
    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)

    await find(wrapper, 'activity-logs-operation').setValue('DELETE')
    await find(wrapper, 'activity-logs-search').trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ operation: 'DELETE' })
    expect(shownIds(wrapper)).toEqual(
      activityLogs.filter((row) => row.操作区分 === 'DELETE').map(idOf),
    )
  })

  it('[ALV-16] 「詳細」でその行のダイアログが開き、「閉じる」で消える', async () => {
    const { wrapper } = await mountView()
    await settle()
    expect(exists(wrapper, 'activity-log-detail')).toBe(false)

    await find(wrapper, `activity-logs-detail-${idOf(head)}`).trigger('click')

    const detail = find(wrapper, 'activity-log-detail')
    expect(detail.exists()).toBe(true)
    expect(detail.text()).toContain(head.対象種別名)
    expect(detail.text()).toContain(formatActivityAt(head.操作日時))
    expect(detail.text()).toContain(String(head.履歴ID))

    await find(wrapper, 'activity-log-detail-close').trigger('click')

    expect(exists(wrapper, 'activity-log-detail')).toBe(false)
  })

  it('[ALV-17] 古い順を選んで検索すると sort=asc が乗り最古の行が先頭になる', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await sortButton(wrapper, 'asc').trigger('click')
    await find(wrapper, 'activity-logs-search').trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ sort: 'asc' })
    expect(shownIds(wrapper)[0]).toBe(idOf(oldest))
  })

  it('[ALV-18] 説明バナーと検索カードは 4 状態のいずれでも表示される', async () => {
    for (const handler of [null, emptyHandler(), errorHandler(LIST_PATH)]) {
      if (handler) server.use(handler)
      const { wrapper } = await mountView()
      await settle()

      expect(exists(wrapper, 'activity-logs-description')).toBe(true)
      expect(exists(wrapper, 'activity-logs-search')).toBe(true)
    }
  })

  it('[ALV-19] 読むだけの画面なので行の操作は「詳細」だけ', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'activity-logs-add')).toBe(false)
    for (const row of rows(wrapper)) {
      const buttons = row.findAll('button')
      expect(buttons).toHaveLength(1)
      expect(buttons[0].text()).toBe('詳細')
    }
  })
})
