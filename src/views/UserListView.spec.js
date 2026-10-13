import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { branches } from '@/mocks/fixtures/codes'
import { rolePermissions } from '@/mocks/fixtures/permissions'
import { users } from '@/mocks/fixtures/users'
import { useCodesStore } from '@/stores/codes'
import { USER_STATUS_ACTIVE } from '@/stores/users'
import UserListView from './UserListView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 4 状態の出し分けと「URL クエリが正」の単方向フロー、編集モーダルが送る本文を検証する。
 *
 * この画面はコードマスタを自分では読み込まない（main.js が起動時に 1 回だけ読む）ので、
 * 所属部店名や部店の選択肢を見るテストだけ、マウント前に codes ストアを読み込んでおく。
 */
const PATH = '/masters/users'
const USERS_PATH = '*/api/masters/users'
const PERMISSIONS_PATH = '*/api/masters/permissions'

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const head = users[0]
const inactiveUser = users.find((user) => user.有効フラグ !== 1)
const activeUser = users.find((user) => user.有効フラグ === 1)
const withBranch = users.find((user) => user.部店コード)
const withoutBranch = users.find((user) => !user.部店コード)
/** 受注者コードを持つ有効な利用者（更新で送り返されることを見る） */
const withOrderTaker = users.find((user) => user.受注者コード && user.有効フラグ === 1)

const branchNameOf = (code) => branches.find((branch) => branch.code === code)?.name
const roleOptionsExpected = rolePermissions.map((row) => ({
  value: row.ロールコード,
  label: row.ロール名,
}))
/** 今と違うロール */
const otherRole = (raw) => rolePermissions.find((row) => row.ロールコード !== raw.ロールコード)

const listBody = (rows) => ({ total: rows.length, limit: 50, offset: 0, operators: rows })

const Page = { render: () => h('div') }

/**
 * 画面をマウントする。
 *
 * @param {{ query?: object, withCodes?: boolean }} [options]
 *   withCodes を立てるとコードマスタを先に読み込む（部店の選択肢と所属部店名が入る）
 */
async function mountView({ query = {}, withCodes = false } = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: PATH, component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push({ path: PATH, query })

  const pinia = createPinia()
  if (withCodes) {
    setActivePinia(pinia)
    await useCodesStore().load()
  }

  const wrapper = mount(UserListView, {
    global: {
      plugins: [pinia, router],
      // 編集モーダル（BaseModal）が body へ Teleport するので、wrapper 内に描かせる
      stubs: { teleport: true },
    },
  })
  return { wrapper, router }
}

/**
 * 操作 → router.push → 再取得 → 再描画 までを待つ。
 * 1 回目でナビゲーションが確定して再取得が始まり、2 回目で応答が反映される。
 */
async function settle() {
  await flushPromises()
  await flushPromises()
}

const byTestid = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const exists = (wrapper, testid) => byTestid(wrapper, testid).exists()
const rows = (wrapper) => wrapper.findAll('[data-testid="data-table-row"]')
const countText = (wrapper) => byTestid(wrapper, 'users-count').text()
const headers = (wrapper) =>
  byTestid(wrapper, 'users-table')
    .findAll('th')
    .map((th) => th.text())
const optionsOf = (wrapper, testid) =>
  wrapper.findAll(`[data-testid="${testid}"] option`).map((option) => ({
    value: option.element.value,
    label: option.text(),
  }))
const rowCodes = (wrapper) => rows(wrapper).map((row) => row.findAll('td')[0].text())
const codesOf = (list) => list.map((user) => user.操作者コード)

/** 社員コード（1 列目）で行を特定する */
const rowFor = (wrapper, code) => rows(wrapper).find((row) => row.findAll('td')[0].text() === code)
const cellsFor = (wrapper, code) => rowFor(wrapper, code).findAll('td')

const openEdit = (wrapper, raw) => byTestid(wrapper, `users-edit-${raw.ID}`).trigger('click')

async function submitEdit(wrapper) {
  await byTestid(wrapper, 'users-edit-submit').trigger('click')
  await settle()
}

/** 入力欄の直下に出ている理由（FormField が aria-describedby で結び付けている） */
const fieldError = (wrapper, input) => {
  const ids = (input.attributes('aria-describedby') ?? '').split(' ').filter(Boolean)
  const found = ids.map((id) => wrapper.find(`#${id}[role="alert"]`)).find((el) => el.exists())
  return found ? found.text() : ''
}

/**
 * 更新リクエストの本文を記録しつつ、既定のハンドラへ流す
 * （何も返さないハンドラは次のハンドラへ素通しされる）
 */
function recordPut() {
  const bodies = []
  server.use(
    http.put(`${USERS_PATH}/:operatorCode`, async ({ request }) => {
      bodies.push(await request.clone().json())
    }),
  )
  return bodies
}

/** 一覧を 500 → 既定に戻せる差し替え（once） */
const failListOnce = () =>
  server.use(
    http.get(USERS_PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }), {
      once: true,
    }),
  )
const failRolesOnce = () =>
  server.use(
    http.get(
      PERMISSIONS_PATH,
      () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
      { once: true },
    ),
  )

// シナリオ: docs/unit/views-user-list-view.md
describe('UserListView', () => {
  it('[USV-01] 応答を待つ間はローディングだけを出す', async () => {
    const { wrapper } = await mountView()

    expect(exists(wrapper, 'users-loading')).toBe(true)
    expect(exists(wrapper, 'users-table')).toBe(false)
    expect(exists(wrapper, 'users-empty')).toBe(false)
    expect(exists(wrapper, 'users-error')).toBe(false)
    expect(exists(wrapper, 'users-count')).toBe(false)
  })

  it('[USV-02] 無効を含む全員が出て、1 行目がフィクスチャ先頭行と一致する', async () => {
    const { wrapper } = await mountView({ withCodes: true })
    await settle()

    expect(countText(wrapper)).toContain(String(users.length))
    expect(rows(wrapper)).toHaveLength(users.length)

    const cells = rows(wrapper)[0].findAll('td')
    expect(cells[0].text()).toBe(head.操作者コード)
    expect(cells[1].text()).toBe(head.氏名)
    expect(cells[2].text()).toBe(head.部店コード)
    expect(cells[3].text()).toBe(branchNameOf(head.部店コード))
    expect(cells[4].text()).toBe(head.ロール名)
    expect(cells[5].text()).toBe(head.有効フラグ === 1 ? '有効' : '無効')
  })

  it('[USV-03] 列が画面モックの並びになる', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(headers(wrapper)).toEqual([
      '社員コード',
      '氏名',
      '所属部店コード',
      '所属部店名',
      'ロール',
      '状態',
      '操作',
    ])
  })

  it('[USV-04] 0 件のときは空の表示を出し、表は出さない', async () => {
    server.use(http.get(USERS_PATH, () => HttpResponse.json(listBody([]))))
    const { wrapper } = await mountView()
    await settle()

    expect(byTestid(wrapper, 'users-empty').text()).toBe('該当するユーザがありません。')
    expect(exists(wrapper, 'users-table')).toBe(false)
  })

  it('[USV-05] 失敗したら理由と再試行を出し、表も空表示も出さない', async () => {
    failListOnce()
    const { wrapper } = await mountView()
    await settle()

    const error = byTestid(wrapper, 'users-error')
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'users-table')).toBe(false)
    expect(exists(wrapper, 'users-empty')).toBe(false)
  })

  it('[USV-06] 再試行で表が出てエラーが消える', async () => {
    failListOnce()
    const { wrapper } = await mountView()
    await settle()

    await byTestid(wrapper, 'users-error').find('button').trigger('click')
    await settle()

    expect(exists(wrapper, 'users-error')).toBe(false)
    expect(rows(wrapper)).toHaveLength(users.length)
  })

  it('[USV-07] 状態のバッジは有効／無効を出し分ける', async () => {
    expect(inactiveUser).toBeDefined()
    const { wrapper } = await mountView()
    await settle()

    expect(cellsFor(wrapper, activeUser.操作者コード)[5].text()).toBe('有効')
    expect(cellsFor(wrapper, inactiveUser.操作者コード)[5].text()).toBe('無効')
  })

  it('[USV-08] 所属部店名は部店の選択肢から引き、部店が無い行は — になる', async () => {
    expect(withBranch).toBeDefined()
    expect(withoutBranch).toBeDefined()
    const { wrapper } = await mountView({ withCodes: true })
    await settle()

    const named = cellsFor(wrapper, withBranch.操作者コード)
    expect(named[2].text()).toBe(withBranch.部店コード)
    expect(named[3].text()).toBe(branchNameOf(withBranch.部店コード))

    const blank = cellsFor(wrapper, withoutBranch.操作者コード)
    expect(blank[2].text()).toBe('—')
    expect(blank[3].text()).toBe('—')
  })

  it('[USV-09] コードマスタが未取得でも表は描かれ、所属部店名は — になる', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(rows(wrapper)).toHaveLength(users.length)
    expect(rows(wrapper).map((row) => row.findAll('td')[3].text())).toEqual(users.map(() => '—'))
    expect(cellsFor(wrapper, withBranch.操作者コード)[2].text()).toBe(withBranch.部店コード)
  })

  it('[USV-10] 検索すると URL に条件が乗り、条件に合う行だけになる', async () => {
    const target = withOrderTaker
    const keyword = target.氏名.slice(0, 2)
    const { wrapper, router } = await mountView({ withCodes: true })
    await settle()

    await byTestid(wrapper, 'users-branch-code').setValue(target.部店コード)
    await byTestid(wrapper, 'users-role').setValue(target.ロールコード)
    await byTestid(wrapper, 'users-status').setValue(USER_STATUS_ACTIVE)
    await byTestid(wrapper, 'users-keyword').setValue(keyword)
    // 「検索」は submit ボタン。jsdom は文書に付いていないフォームを送信しないので form に直接送る
    await byTestid(wrapper, 'users-search').trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({
      branch_code: target.部店コード,
      role: target.ロールコード,
      status: USER_STATUS_ACTIVE,
      keyword,
    })
    const expected = users.filter(
      (user) =>
        user.有効フラグ === 1 &&
        user.部店コード === target.部店コード &&
        user.ロールコード === target.ロールコード &&
        (user.操作者コード.includes(keyword) || user.氏名?.includes(keyword)),
    )
    expect(expected.length).toBeGreaterThan(0)
    expect(rowCodes(wrapper)).toEqual(codesOf(expected))
  })

  it('[USV-11] URL の条件が入力欄に反映され、その条件で絞り込まれる', async () => {
    const role = inactiveUser.ロールコード
    const keyword = inactiveUser.氏名.slice(0, 1)
    const { wrapper } = await mountView({
      query: { role, keyword, status: USER_STATUS_ACTIVE },
    })
    await settle()

    expect(byTestid(wrapper, 'users-role').element.value).toBe(role)
    expect(byTestid(wrapper, 'users-keyword').element.value).toBe(keyword)
    expect(byTestid(wrapper, 'users-status').element.value).toBe(USER_STATUS_ACTIVE)
    const expected = users.filter(
      (user) =>
        user.有効フラグ === 1 &&
        user.ロールコード === role &&
        (user.操作者コード.includes(keyword) || user.氏名?.includes(keyword)),
    )
    expect(rowCodes(wrapper)).toEqual(codesOf(expected))
    expect(rowCodes(wrapper)).not.toContain(inactiveUser.操作者コード)
  })

  it('[USV-12] 未知の status は「すべて」に寄せ、無効も含めて出す', async () => {
    const { wrapper } = await mountView({ query: { status: 'inactive' } })
    await settle()

    expect(byTestid(wrapper, 'users-status').element.value).toBe('')
    expect(rowCodes(wrapper)).toEqual(codesOf(users))
  })

  it('[USV-13] クリアで URL クエリが空になり、全員に戻る', async () => {
    const { wrapper, router } = await mountView({ query: { role: head.ロールコード } })
    await settle()
    expect(rows(wrapper).length).toBeLessThan(users.length)

    await byTestid(wrapper, 'users-search-clear').trigger('click')
    await settle()

    expect(router.currentRoute.value.query).toEqual({})
    expect(rowCodes(wrapper)).toEqual(codesOf(users))
  })

  it('[USV-14] offset 付きで開くとその位置以降の行が出る', async () => {
    const offset = 2
    const { wrapper } = await mountView({ query: { offset: String(offset) } })
    await settle()

    expect(rowCodes(wrapper)).toEqual(codesOf(users.slice(offset)))
  })

  it('[USV-15] 編集を開くと現在値が入り、社員コード・氏名・所属部店は読み取り専用', async () => {
    const { wrapper } = await mountView({ withCodes: true })
    await settle()

    await openEdit(wrapper, withBranch)

    expect(exists(wrapper, 'users-edit-form')).toBe(true)
    expect(wrapper.text()).toContain('ユーザの権限設定')
    const code = byTestid(wrapper, 'users-edit-code')
    const name = byTestid(wrapper, 'users-edit-name')
    const branch = byTestid(wrapper, 'users-edit-branch')
    expect(code.element.value).toBe(withBranch.操作者コード)
    expect(name.element.value).toBe(withBranch.氏名)
    expect(branch.element.value).toBe(
      `${withBranch.部店コード} ${branchNameOf(withBranch.部店コード)}`,
    )
    for (const input of [code, name, branch]) {
      expect(input.attributes('readonly')).toBeDefined()
    }

    const role = byTestid(wrapper, 'users-edit-role')
    const active = byTestid(wrapper, 'users-edit-active')
    expect(role.element.value).toBe(withBranch.ロールコード)
    expect(active.element.value).toBe(String(withBranch.有効フラグ === 1))
    expect(role.attributes('readonly')).toBeUndefined()
    expect(active.attributes('readonly')).toBeUndefined()
  })

  it('[USV-16] 部店の無い利用者の所属部店は — になる', async () => {
    const { wrapper } = await mountView()
    await settle()

    await openEdit(wrapper, withoutBranch)

    expect(byTestid(wrapper, 'users-edit-branch').element.value).toBe('—')
  })

  it('[USV-17] ロールを変えて保存すると今の受注者コードも送り、通知と一覧に反映される', async () => {
    expect(withOrderTaker).toBeDefined()
    const nextRole = otherRole(withOrderTaker)
    const bodies = recordPut()
    const { wrapper } = await mountView()
    await settle()

    await openEdit(wrapper, withOrderTaker)
    await byTestid(wrapper, 'users-edit-role').setValue(nextRole.ロールコード)
    await submitEdit(wrapper)

    expect(bodies).toEqual([
      {
        氏名: withOrderTaker.氏名,
        ロールコード: nextRole.ロールコード,
        部店コード: withOrderTaker.部店コード,
        受注者コード: withOrderTaker.受注者コード,
        有効フラグ: 1,
      },
    ])
    expect(exists(wrapper, 'users-edit-form')).toBe(false)
    expect(byTestid(wrapper, 'users-notice').text()).toBe(
      `${withOrderTaker.氏名}の権限設定を更新しました。`,
    )
    expect(cellsFor(wrapper, withOrderTaker.操作者コード)[4].text()).toBe(nextRole.ロール名)
  })

  it('[USV-18] 状態を無効にして保存すると有効フラグ 0 を送り、行のバッジが無効になる', async () => {
    const bodies = recordPut()
    const { wrapper } = await mountView()
    await settle()

    await openEdit(wrapper, activeUser)
    await byTestid(wrapper, 'users-edit-active').setValue('false')
    await submitEdit(wrapper)

    expect(bodies).toHaveLength(1)
    expect(bodies[0].有効フラグ).toBe(0)
    expect(cellsFor(wrapper, activeUser.操作者コード)[5].text()).toBe('無効')
    expect(rows(wrapper)).toHaveLength(users.length)
  })

  it('[USV-19] ロールが未設定のまま保存すると項目の直下に理由を出し、API へ送らない', async () => {
    const noRole = { ...head, ロールコード: null, ロール名: null }
    server.use(http.get(USERS_PATH, () => HttpResponse.json(listBody([noRole]))))
    let putCalls = 0
    server.use(
      http.put(`${USERS_PATH}/:operatorCode`, () => {
        putCalls += 1
        return HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })
      }),
    )
    const { wrapper } = await mountView()
    await settle()

    await openEdit(wrapper, noRole)
    await submitEdit(wrapper)

    expect(exists(wrapper, 'users-edit-form')).toBe(true)
    expect(fieldError(wrapper, byTestid(wrapper, 'users-edit-role'))).toBe(
      'ロールを選択してください。',
    )
    expect(putCalls).toBe(0)
    expect(exists(wrapper, 'users-notice')).toBe(false)
  })

  it('[USV-20] 更新の 400 はモーダル内のエラー枠に出し、モーダルは開いたまま', async () => {
    const detail = 'ロールコードが不正です: xxx'
    server.use(
      http.put(`${USERS_PATH}/:operatorCode`, () =>
        HttpResponse.json({ detail }, { status: 400 }),
      ),
    )
    const { wrapper } = await mountView()
    await settle()

    await openEdit(wrapper, head)
    await submitEdit(wrapper)

    expect(exists(wrapper, 'users-edit-form')).toBe(true)
    expect(byTestid(wrapper, 'users-edit-error').text()).toContain(detail)
    expect(exists(wrapper, 'users-notice')).toBe(false)
  })

  it('[USV-21] ロールの選択肢の失敗は帯で知らせ、一覧は出したまま', async () => {
    failRolesOnce()
    const { wrapper } = await mountView()
    await settle()

    const alert = byTestid(wrapper, 'users-roles-error')
    expect(alert.text()).toContain(ERROR_MESSAGE)
    expect(exists(wrapper, 'users-roles-retry')).toBe(true)
    expect(rows(wrapper)).toHaveLength(users.length)
    expect(optionsOf(wrapper, 'users-role')).toEqual([{ value: '', label: 'すべて' }])
  })

  it('[USV-22] 再読み込みで帯が消え、ロールの選択肢が権限マスタの並びになる', async () => {
    failRolesOnce()
    const { wrapper } = await mountView()
    await settle()

    await byTestid(wrapper, 'users-roles-retry').trigger('click')
    await settle()

    expect(exists(wrapper, 'users-roles-error')).toBe(false)
    expect(optionsOf(wrapper, 'users-role')).toEqual([
      { value: '', label: 'すべて' },
      ...roleOptionsExpected,
    ])
  })

  it('[USV-23] ロールの選択肢が無くても、編集では今のロールが選ばれて出る', async () => {
    failRolesOnce()
    const { wrapper } = await mountView()
    await settle()

    await openEdit(wrapper, head)

    const role = byTestid(wrapper, 'users-edit-role')
    expect(role.element.value).toBe(head.ロールコード)
    expect(optionsOf(wrapper, 'users-edit-role')).toEqual([
      { value: head.ロールコード, label: head.ロール名 },
    ])
  })

  it('[USV-24] 行の操作は編集だけで、新規追加・削除は無い', async () => {
    const { wrapper } = await mountView()
    await settle()

    for (const user of users) {
      expect(exists(wrapper, `users-edit-${user.ID}`)).toBe(true)
    }
    expect(exists(wrapper, 'users-add')).toBe(false)
    const buttonLabels = wrapper.findAll('button').map((button) => button.text())
    expect(buttonLabels).not.toContain('新規追加')
    expect(buttonLabels).not.toContain('削除')
  })
})
