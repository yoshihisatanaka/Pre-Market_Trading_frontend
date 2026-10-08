import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { activityLogs } from '@/mocks/fixtures/activityLogs'
import { activityLogTargets } from '@/mocks/fixtures/activityLogTargets'
import { codeEntries } from '@/mocks/fixtures/codes'
import { users } from '@/mocks/fixtures/users'
import { ACTIVITY_LOGS_PAGE_SIZE } from '@/stores/activityLogs'
import { useCodesStore } from '@/stores/codes'
import {
  ACTIVITY_ACTOR_GROUP_OPTIONS,
  ACTIVITY_CATEGORY_OPTIONS,
  OPERATION_TARGET_TYPES,
  categoryBadgeVariant,
  categoryLabel,
  categoryOf,
  formatActivityAt,
  resolveCategory,
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
const USERS_PATH = '*/api/masters/users'

const PAGE_SIZE = ACTIVITY_LOGS_PAGE_SIZE
const TOTAL = activityLogs.length
const firstPage = activityLogs.slice(0, PAGE_SIZE)
const secondPage = activityLogs.slice(PAGE_SIZE)
const head = activityLogs[0]
const oldest = activityLogs[TOTAL - 1]

const PLACEHOLDER = '-- 全て --'
const EMPTY = '—'
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 区分 → フィクスチャの対象種別コード（応答の 区分 で分ける） */
const targetTypesOf = (category, targets = activityLogTargets) =>
  targets.filter((raw) => raw.区分 === category).map((raw) => raw.対象種別)

const idOf = (row) => `${row.対象種別}:${row.履歴ID}`
const dateOf = (row) => row.操作日時.slice(0, 10)

/*
 * 実行者区分 → ロールコード。モック（src/mocks/handlers/activityLogs.js）の読み方で、
 * 期待値を users フィクスチャから導くために写す
 */
const ACTOR_GROUP_ROLES = {
  sales_ifa: ['sales', 'ifa'],
  manager: ['manager', 'supervisor'],
}
const roleOf = (operatorCode) => users.find((user) => user.操作者コード === operatorCode)?.ロールコード
/** 操作者コード → 実行者区分（操作者が無い・マスタに無いときは undefined） */
const actorGroupOf = (operatorCode) =>
  Object.keys(ACTOR_GROUP_ROLES).find((group) =>
    ACTOR_GROUP_ROLES[group].includes(roleOf(operatorCode)),
  )

/**
 * モックと同じ意味の絞り込み（期待値をフィクスチャから導くため）。
 * 期間は両端を含み、操作者・実行者区分・操作区分・対象種別は完全一致、対象キーは部分一致。
 */
function matches(row, { dateFrom, dateTo, operator, actorGroup, operation, targetTypes, targetKey }) {
  return (
    (!dateFrom || dateOf(row) >= dateFrom) &&
    (!dateTo || dateOf(row) <= dateTo) &&
    (!operator || row.操作者 === operator) &&
    (!actorGroup || actorGroupOf(row.操作者) === actorGroup) &&
    (!operation || row.操作区分 === operation) &&
    (!targetTypes?.length || targetTypes.includes(row.対象種別)) &&
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

  // App.vue はコードマスタを読み終えてから画面を描く。それに合わせて先に読んでおく
  const pinia = createPinia()
  await useCodesStore(pinia).load()

  const wrapper = mount(ActivityLogListView, {
    global: {
      plugins: [pinia, router],
      // 詳細ダイアログの Teleport を wrapper 内に描画させる
      stubs: { teleport: true },
    },
  })
  return { wrapper, router }
}

/**
 * 操作 → router.push → queryKey の watch → 再取得 → 再描画 までを待つ。
 * 1 回目でナビゲーションが確定して再取得が始まり、2 回目で応答が反映される。
 * 区分で絞るときは対象種別の取得を待ってから一覧を読むので、もう 1 回ぶん待つ。
 */
async function settle() {
  await flushPromises()
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
    expect(cells[1]).toBe(head.区分名)
    // 操作者は氏名と、実行者区分・コードの 2 段
    expect(cells[2]).toContain(head.操作者名)
    expect(cells[2]).toContain(`${head.実行者区分}・${head.操作者}`)
    // 対象機能・操作は対象機能名と操作内容（サーバの表示文）の 2 段
    expect(cells[3]).toContain(head.対象機能)
    expect(cells[3]).toContain(head.操作内容)
    expect(cells[4]).toBe(head.対象キー)
    expect(cells[5]).toBe(head.変更項目.join('、'))
  })

  it('[ALV-03] 列が 7 列で、最後が操作列', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(find(wrapper, 'activity-logs-table').findAll('th').map((th) => th.text())).toEqual([
      '操作日時',
      '操作区分',
      '操作者',
      '対象機能・操作',
      '対象キー',
      '変更項目',
      '',
    ])
  })

  it('[ALV-04] 対象キーと操作者コードを持たない行は、対象キーが — で操作者がサーバの氏名だけになる', async () => {
    const index = firstPage.findIndex((row) => row.対象キー === null && row.操作者 === null)
    // フィクスチャにその行が無いと、このシナリオは意味を失う
    expect(index).toBeGreaterThanOrEqual(0)

    const { wrapper } = await mountView()
    await settle()

    const cells = cellsOf(rows(wrapper)[index])
    // 操作者コードが無い行は、サーバが 操作者名 に入れる「システム」だけを出す（2 段目は無い）
    expect(cells[2].text()).toBe(firstPage[index].操作者名)
    expect(cells[4].text()).toBe(EMPTY)
  })

  it('[ALV-05] 操作区分は応答の区分名のバッジで、区分ごとの色で出る', async () => {
    const { wrapper } = await mountView()
    await settle()

    const seen = new Set()
    rows(wrapper).forEach((row, index) => {
      const raw = firstPage[index]
      const category = resolveCategory(raw.区分, raw.対象種別)
      const badge = cellsOf(row)[1].find('[data-variant]')
      expect(badge.text()).toBe(raw.区分名)
      expect(badge.attributes('data-variant')).toBe(categoryBadgeVariant(category))
      seen.add(category)
    })
    // 1 ページ目に 3 区分が出ていないと、色の出し分けを確かめたことにならない
    expect([...seen].sort()).toEqual(ACTIVITY_CATEGORY_OPTIONS.map(({ value }) => value).sort())
    expect(categoryBadgeVariant('business')).toBe('info')
    expect(categoryBadgeVariant('master')).toBe('success')
    expect(categoryBadgeVariant('operation')).toBe('gray')
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
      targetTypes: [head.対象種別],
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
    await find(wrapper, 'activity-logs-target-type').setValue(head.対象種別)
    await find(wrapper, 'activity-logs-target-key').setValue(conditions.targetKey)
    await find(wrapper, 'activity-logs-search').trigger('submit')
    await settle()

    // 条件を変えたら 1 ページ目に戻すので offset は付かない
    expect(router.currentRoute.value.query).toEqual({
      start_date: conditions.dateFrom,
      end_date: conditions.dateTo,
      operator: conditions.operator,
      operation: conditions.operation,
      target_types: head.対象種別,
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
      // 操作者と矛盾しない実行者区分にする（矛盾させると 0 件になり並びを確かめられない）
      actorGroup: actorGroupOf(sample.操作者),
      operation: sample.操作区分,
      targetTypes: [sample.対象種別],
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
        actor_group: conditions.actorGroup,
        category: 'master',
        operation: conditions.operation,
        target_types: sample.対象種別,
        target_key: conditions.targetKey,
        sort: 'asc',
      },
    })
    await settle()

    expect(find(wrapper, 'activity-logs-date-from').element.value).toBe(conditions.dateFrom)
    expect(find(wrapper, 'activity-logs-date-to').element.value).toBe(conditions.dateTo)
    expect(find(wrapper, 'activity-logs-operator').element.value).toBe(conditions.operator)
    expect(find(wrapper, 'activity-logs-actor-group').element.value).toBe(conditions.actorGroup)
    expect(find(wrapper, 'activity-logs-category').element.value).toBe('master')
    expect(find(wrapper, 'activity-logs-operation').element.value).toBe(conditions.operation)
    expect(find(wrapper, 'activity-logs-target-type').element.value).toBe(sample.対象種別)
    expect(find(wrapper, 'activity-logs-target-key').element.value).toBe(conditions.targetKey)
    expect(sortButton(wrapper, 'asc').attributes('aria-pressed')).toBe('true')
    expect(countText(wrapper)).toContain(String(expected.length))
    // 古い順で並ぶ
    expect(shownIds(wrapper)).toEqual(expected.slice(0, PAGE_SIZE).map(idOf))
  })

  it('[ALV-13] 選択肢に無い操作内容・区分・実行者区分・並び順は空に落ちる', async () => {
    const { wrapper } = await mountView({
      query: { operation: 'PURGE', category: 'BUSINESS', actor_group: 'sales', sort: 'desc' },
    })
    await settle()

    expect(find(wrapper, 'activity-logs-operation').element.value).toBe('')
    expect(find(wrapper, 'activity-logs-category').element.value).toBe('')
    expect(find(wrapper, 'activity-logs-actor-group').element.value).toBe('')
    expect(sortButton(wrapper, '').attributes('aria-pressed')).toBe('true')
    expect(sortButton(wrapper, 'asc').attributes('aria-pressed')).toBe('false')
    // 条件なし・既定の並び（新しい順）の全件
    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(shownIds(wrapper)).toEqual(firstPage.map(idOf))
  })

  it('[ALV-14] 対象機能の選択肢は API から、操作内容はコードマスタ 操作区分、操作区分は固定の 3 種', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(optionsOf(wrapper, 'activity-logs-target-type')).toEqual([
      { value: '', label: PLACEHOLDER },
      ...activityLogTargets.map((raw) => ({ value: raw.対象種別, label: raw.対象種別名 })),
    ])
    expect(optionsOf(wrapper, 'activity-logs-operation')).toEqual([
      { value: '', label: PLACEHOLDER },
      ...codeEntries('操作区分').map(({ code, label }) => ({ value: code, label })),
    ])
    // 業務操作 / マスタ更新 / 運用管理 の 3 つ
    expect(ACTIVITY_CATEGORY_OPTIONS).toHaveLength(3)
    expect(optionsOf(wrapper, 'activity-logs-category')).toEqual([
      { value: '', label: PLACEHOLDER },
      ...ACTIVITY_CATEGORY_OPTIONS,
    ])
  })

  it('[ALV-15] 対象機能を取得できなくても欄の下に理由を出し、検索はできる', async () => {
    server.use(errorHandler(TARGETS_PATH))
    const { wrapper, router } = await mountView()
    await settle()

    // 欄の下のエラー文言は aria-describedby でセレクトと結び付いている
    const select = find(wrapper, 'activity-logs-target-type')
    const describedBy = select.attributes('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(wrapper.find(`[id="${describedBy}"]`).text()).toBe(
      `対象機能を取得できませんでした（${ERROR_MESSAGE}）`,
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

  it('[ALV-18] 検索カードは 4 状態のいずれでも表示される', async () => {
    for (const handler of [null, emptyHandler(), errorHandler(LIST_PATH)]) {
      if (handler) server.use(handler)
      const { wrapper } = await mountView()
      await settle()

      expect(exists(wrapper, 'activity-logs-search')).toBe(true)
      // 画面モックに無い説明の帯は出さない
      expect(exists(wrapper, 'activity-logs-description')).toBe(false)
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

  it('[ALV-20] 操作区分で検索すると URL に category が乗り、その区分の対象種別だけに絞られる', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    for (const { value: category } of ACTIVITY_CATEGORY_OPTIONS) {
      const targetTypes = targetTypesOf(category)
      const expected = activityLogs.filter((row) => matches(row, { targetTypes }))
      expect(expected.length).toBeGreaterThan(0)
      expect(expected.length).toBeLessThan(TOTAL)

      await find(wrapper, 'activity-logs-category').setValue(category)
      await find(wrapper, 'activity-logs-search').trigger('submit')
      await settle()

      // 実 API に区分は無いので、URL には画面の言葉（category）だけが乗り、対象種別には展開しない
      expect(router.currentRoute.value.query).toEqual({ category })
      expect(countText(wrapper)).toContain(String(expected.length))
      expect(shownIds(wrapper)).toEqual(expected.slice(0, PAGE_SIZE).map(idOf))
      for (const row of rows(wrapper)) {
        expect(cellsOf(row)[1].text()).toBe(categoryLabel(category))
      }
    }
  })

  it('[ALV-21] 操作区分を選ぶと対象機能の選択肢がその区分に絞られ、外れた対象機能は選択が消える', async () => {
    const operationType = OPERATION_TARGET_TYPES[0]
    const masterType = targetTypesOf('master')[0]
    const { wrapper } = await mountView()
    await settle()

    await find(wrapper, 'activity-logs-target-type').setValue(masterType)
    await find(wrapper, 'activity-logs-category').setValue('operation')

    // 運用管理の対象種別だけが並び、マスタの対象機能は選択が外れる
    expect(optionsOf(wrapper, 'activity-logs-target-type').map(({ value }) => value)).toEqual([
      '',
      ...targetTypesOf('operation'),
    ])
    expect(find(wrapper, 'activity-logs-target-type').element.value).toBe('')

    // 同じ区分の対象機能は残る
    await find(wrapper, 'activity-logs-target-type').setValue(operationType)
    await find(wrapper, 'activity-logs-category').setValue('operation')
    expect(find(wrapper, 'activity-logs-target-type').element.value).toBe(operationType)

    // 区分を「全て」に戻すと対象機能の選択肢も全部に戻る
    await find(wrapper, 'activity-logs-category').setValue('')
    expect(optionsOf(wrapper, 'activity-logs-target-type')).toHaveLength(
      activityLogTargets.length + 1,
    )
  })

  it('[ALV-22] 区分と対象機能の両方があるときは対象機能で絞る', async () => {
    const targetType = targetTypesOf('master')[0]
    const expected = activityLogs.filter((row) => row.対象種別 === targetType)
    expect(expected.length).toBeGreaterThan(0)

    const { wrapper } = await mountView({
      query: { category: 'master', target_types: targetType },
    })
    await settle()

    expect(countText(wrapper)).toContain(String(expected.length))
    expect(shownIds(wrapper)).toEqual(expected.slice(0, PAGE_SIZE).map(idOf))
  })

  it('[ALV-23] 操作者の選択肢は無効な操作者も含めて「社員コード 氏名」で並ぶ', async () => {
    // 無効な操作者がフィクスチャにいないと、このシナリオは意味を失う
    expect(users.some((user) => user.有効フラグ !== 1)).toBe(true)
    const { wrapper } = await mountView()
    await settle()

    expect(optionsOf(wrapper, 'activity-logs-operator')).toEqual([
      { value: '', label: PLACEHOLDER },
      ...users.map((user) => ({
        value: user.操作者コード,
        label: user.氏名 ? `${user.操作者コード} ${user.氏名}` : user.操作者コード,
      })),
    ])
  })

  it('[ALV-24] 操作者を取得できなくても欄の下に理由を出し、検索はできる', async () => {
    server.use(errorHandler(USERS_PATH))
    const { wrapper, router } = await mountView()
    await settle()

    const select = find(wrapper, 'activity-logs-operator')
    const describedBy = select.attributes('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(wrapper.find(`[id="${describedBy}"]`).text()).toBe(
      `操作者を取得できませんでした（${ERROR_MESSAGE}）`,
    )
    expect(optionsOf(wrapper, 'activity-logs-operator')).toEqual([
      { value: '', label: PLACEHOLDER },
    ])
    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)

    await find(wrapper, 'activity-logs-operation').setValue('DELETE')
    await find(wrapper, 'activity-logs-search').trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ operation: 'DELETE' })
    expect(shownIds(wrapper)).toEqual(
      activityLogs.filter((row) => row.操作区分 === 'DELETE').map(idOf),
    )
  })

  it('[ALV-25] 実行者区分で検索すると URL に actor_group が乗り、そのロールの行だけになる', async () => {
    const actorGroup = 'manager'
    const expected = activityLogs.filter((row) => matches(row, { actorGroup }))
    expect(expected.length).toBeGreaterThan(0)
    expect(expected.length).toBeLessThan(TOTAL)

    const { wrapper, router } = await mountView()
    await settle()

    expect(optionsOf(wrapper, 'activity-logs-actor-group')).toEqual([
      { value: '', label: PLACEHOLDER },
      ...ACTIVITY_ACTOR_GROUP_OPTIONS,
    ])

    await find(wrapper, 'activity-logs-actor-group').setValue(actorGroup)
    await find(wrapper, 'activity-logs-search').trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ actor_group: actorGroup })
    expect(countText(wrapper)).toContain(String(expected.length))
    expect(shownIds(wrapper)).toEqual(expected.slice(0, PAGE_SIZE).map(idOf))
  })

  it('[ALV-26] 区分のバッジは応答の区分名をそのまま出す', async () => {
    const renamed = firstPage.map((row) => ({ ...row, 区分名: `${row.区分名}（応答）` }))
    server.use(http.get(LIST_PATH, () => HttpResponse.json(listBody(renamed))))
    const { wrapper } = await mountView()
    await settle()

    rows(wrapper).forEach((row, index) => {
      const badge = cellsOf(row)[1].find('[data-variant]')
      expect(badge.text()).toBe(renamed[index].区分名)
      expect(badge.attributes('data-variant')).toBe(categoryBadgeVariant(renamed[index].区分))
    })
  })

  it('[ALV-27] 区分を持たない応答は対象種別から区分を導いてバッジに出す', async () => {
    // 3 区分から 1 行ずつ取り、区分 / 区分名 を落とす
    const samples = ACTIVITY_CATEGORY_OPTIONS.map(({ value }) =>
      activityLogs.find((row) => row.区分 === value),
    ).map((row) => {
      const copy = { ...row }
      delete copy.区分
      delete copy.区分名
      return copy
    })
    server.use(http.get(LIST_PATH, () => HttpResponse.json(listBody(samples))))
    const { wrapper } = await mountView()
    await settle()

    expect(rows(wrapper)).toHaveLength(samples.length)
    rows(wrapper).forEach((row, index) => {
      const category = categoryOf(samples[index].対象種別)
      const badge = cellsOf(row)[1].find('[data-variant]')
      expect(badge.text()).toBe(categoryLabel(category))
      expect(badge.attributes('data-variant')).toBe(categoryBadgeVariant(category))
    })
  })

  it('[ALV-28] 対象機能の選択肢は応答の区分で絞る', async () => {
    // コードからはマスタ更新と導かれる対象種別を、応答が運用管理と言っている
    const promoted = targetTypesOf('master')[0]
    expect(OPERATION_TARGET_TYPES).not.toContain(promoted)
    const targets = activityLogTargets.map((raw) =>
      raw.対象種別 === promoted ? { ...raw, 区分: 'operation', 区分名: '運用管理' } : raw,
    )
    server.use(http.get(TARGETS_PATH, () => HttpResponse.json({ targets })))
    const { wrapper } = await mountView()
    await settle()

    await find(wrapper, 'activity-logs-category').setValue('operation')

    expect(optionsOf(wrapper, 'activity-logs-target-type').map(({ value }) => value)).toEqual([
      '',
      ...targetTypesOf('operation', targets),
    ])
    expect(targetTypesOf('operation', targets)).toContain(promoted)
  })
})
