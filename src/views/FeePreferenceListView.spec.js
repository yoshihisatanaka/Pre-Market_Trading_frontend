import { afterEach, describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { customers } from '@/mocks/fixtures/customers'
import { feePreferences } from '@/mocks/fixtures/feePreferences'
import { FEE_PREFERENCES_PAGE_SIZE } from '@/stores/feePreferences'
import { DEFAULT_FEE_PATTERN_FILTER, formatFeePattern } from '@/utils/feePreferenceOptions'
import FeePreferenceListView from './FeePreferenceListView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 4 状態の出し分けと「URL クエリが正」の単方向フロー、画面固有の分岐を検証する。
 * 期待値はフィクスチャと表示件数から導く（52 / 50 / 1230001 を直接書かない）。
 */
const PATH = '/masters/fee-preferences'
const LIST_PATH = '*/api/masters/fee-preferences'
const PREFIX = 'fee-preferences'

const PAGE_SIZE = FEE_PREFERENCES_PAGE_SIZE
const TOTAL = feePreferences.length

/** 実 API と同じ並び（口座番号の昇順） */
const sorted = [...feePreferences].sort((a, b) => a.口座番号 - b.口座番号)
const firstPage = sorted.slice(0, PAGE_SIZE)
const secondPage = sorted.slice(PAGE_SIZE)
const FIRST = sorted[0]

/** 優遇の登録が無い有効な口座（各部店の末尾）。新規追加に使う */
const registered = new Set(feePreferences.map((row) => row.口座番号))
const unregistered = customers
  .filter((customer) => customer.取消区分 === 0 && !registered.has(customer.口座番号))
  .map((customer) => String(customer.口座番号))

/** 手数料パターンマスタに無いパターン（モックの登録済みは A〜D） */
const UNREGISTERED_PATTERN = 'E'

/** 表の列の位置（columns の並び。0 始まり） */
const COL = { feePattern: 4, feeMultiplier: 5, feeRange: 6, basisRange: 8 }

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const errorHandler = (options) =>
  http.get(
    LIST_PATH,
    () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
    options,
  )
const emptyHandler = () =>
  http.get(LIST_PATH, () =>
    HttpResponse.json({ total: 0, limit: PAGE_SIZE, offset: 0, fee_preferences: [] }),
  )

/** 既定ハンドラに届いた一覧のクエリを記録する */
let listRequests = []
function listener({ request }) {
  const url = new URL(request.url)
  if (url.pathname === '/api/masters/fee-preferences') listRequests.push(url.searchParams)
}
function recordList() {
  listRequests = []
  server.events.on('request:start', listener)
}
afterEach(() => {
  server.events.removeListener('request:start', listener)
  listRequests = []
})

const Page = { render: () => h('div') }

async function mountView(query = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: PATH, component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push({ path: PATH, query })

  const wrapper = mount(FeePreferenceListView, {
    global: {
      plugins: [createPinia(), router],
      // teleport を stub して、ヘッダへ差し込むボタンを wrapper 内に描画させる
      stubs: { teleport: true },
    },
  })
  return { wrapper, router }
}

/** 1 回目でナビゲーションが確定して再取得が始まり、2 回目で応答が反映される */
async function settle() {
  await flushPromises()
  await flushPromises()
}

const byTestid = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const exists = (wrapper, testid) => byTestid(wrapper, testid).exists()
const rows = (wrapper) => wrapper.findAll('[data-testid="data-table-row"]')
const countText = (wrapper) => byTestid(wrapper, `${PREFIX}-count`).text()
const cells = (row) => row.findAll('td')
const rowOf = (wrapper, account) =>
  rows(wrapper).find((candidate) => candidate.text().includes(String(account)))

const addInput = (wrapper, name) => byTestid(wrapper, `${PREFIX}-add-${name}`)
const addSubmit = (wrapper) => byTestid(wrapper, `${PREFIX}-add-submit`)
const editInput = (wrapper, name) => byTestid(wrapper, `${PREFIX}-edit-${name}`)

const openAddModal = async (wrapper) => {
  await byTestid(wrapper, `${PREFIX}-add`).trigger('click')
}
const fillAdd = async (wrapper, values) => {
  for (const [name, value] of Object.entries(values)) {
    await addInput(wrapper, name).setValue(value)
  }
}
const submitAdd = async (wrapper) => {
  await addSubmit(wrapper).trigger('click')
  await settle()
}

const openEditModal = async (wrapper, id = String(FIRST.ID)) => {
  await byTestid(wrapper, `${PREFIX}-edit-${id}`).trigger('click')
}

/** 入力欄の直下に出ている理由（FormField が aria-describedby で結び付けている） */
const fieldError = (wrapper, input) => {
  const ids = (input.attributes('aria-describedby') ?? '').split(' ').filter(Boolean)
  const found = ids.map((id) => wrapper.find(`#${id}[role="alert"]`)).find((el) => el.exists())
  return found ? found.text() : ''
}

// シナリオ: docs/unit/views-fee-preference-list-view.md
describe('FeePreferenceListView', () => {
  it('[FPV-01] 応答を待つ間はローディングだけを出す', async () => {
    const { wrapper } = await mountView()

    expect(exists(wrapper, `${PREFIX}-loading`)).toBe(true)
    expect(exists(wrapper, `${PREFIX}-table`)).toBe(false)
    expect(exists(wrapper, `${PREFIX}-empty`)).toBe(false)
    expect(exists(wrapper, `${PREFIX}-error`)).toBe(false)

    await settle()
  })

  it('[FPV-02] 取得に失敗したときは理由と再試行を出し、表は出さない', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    const error = byTestid(wrapper, `${PREFIX}-error`)
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, `${PREFIX}-table`)).toBe(false)
  })

  it('[FPV-03] 0 件のときは空の旨を出し、表は出さない', async () => {
    server.use(emptyHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(byTestid(wrapper, `${PREFIX}-empty`).text()).toBe('該当する手数料優遇はありません。')
    expect(exists(wrapper, `${PREFIX}-table`)).toBe(false)
  })

  it('[FPV-04] 件数と 1 ページぶんの行を出し、1 行目は口座番号の昇順の先頭になる', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(rows(wrapper)).toHaveLength(firstPage.length)
    const first = rows(wrapper)[0].text()
    expect(first).toContain(String(FIRST.口座番号))
    expect(first).toContain(FIRST.顧客名)
  })

  it('[FPV-05] 再試行で読み直すと一覧が出る', async () => {
    // once を付けて、1 回目だけ 500・2 回目から既定ハンドラに戻す
    server.use(errorHandler({ once: true }))
    const { wrapper } = await mountView()
    await settle()

    await byTestid(wrapper, `${PREFIX}-error`).find('button').trigger('click')
    await settle()

    expect(exists(wrapper, `${PREFIX}-error`)).toBe(false)
    expect(rows(wrapper)).toHaveLength(firstPage.length)
  })

  it('[FPV-06] offset 付きで開くと 2 ページ目の行と範囲が出る', async () => {
    // 2 ページ目ができないと、このシナリオは意味を失う
    expect(secondPage.length).toBeGreaterThan(0)
    const { wrapper } = await mountView({ offset: String(PAGE_SIZE) })
    await settle()

    expect(rows(wrapper)).toHaveLength(secondPage.length)
    expect(byTestid(wrapper, 'pagination-range').text()).toBe(
      `${TOTAL} 件中 ${PAGE_SIZE + 1}–${TOTAL} 件`,
    )
  })

  it('[FPV-07] 口座番号で検索すると URL に account_no が乗り、その条件で再取得される', async () => {
    const account = String(sorted[1].口座番号)
    const { wrapper, router } = await mountView()
    await settle()

    await byTestid(wrapper, `${PREFIX}-account-number`).setValue(account)
    await byTestid(wrapper, `${PREFIX}-search`).trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ account_no: account })
    expect(rows(wrapper)).toHaveLength(1)
    expect(rows(wrapper)[0].text()).toContain(account)
  })

  it('[FPV-08] 未知の手数料パターンは条件なしとして捨てる', async () => {
    const { wrapper } = await mountView({ fee_pattern: 'ZZ' })
    await settle()

    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(byTestid(wrapper, `${PREFIX}-fee-pattern`).element.value).toBe('')
  })

  it('[FPV-09] fee_pattern=default で開くと「デフォルト」で絞り込み、API へ空文字で送る', async () => {
    recordList()
    const defaults = sorted.filter((row) => row.手数料パターン === '')
    const { wrapper } = await mountView({ fee_pattern: DEFAULT_FEE_PATTERN_FILTER })
    await settle()

    const select = byTestid(wrapper, `${PREFIX}-fee-pattern`)
    expect(select.element.value).toBe(DEFAULT_FEE_PATTERN_FILTER)
    expect(select.find('option:checked').text()).toBe(formatFeePattern(''))

    const params = listRequests.at(-1)
    expect(params.has('fee_pattern')).toBe(true)
    expect(params.get('fee_pattern')).toBe('')

    expect(defaults.length).toBeGreaterThan(0)
    expect(countText(wrapper)).toContain(String(defaults.length))
    const patterns = rows(wrapper).map((row) => cells(row)[COL.feePattern].text())
    expect(patterns).toHaveLength(Math.min(defaults.length, PAGE_SIZE))
    expect(new Set(patterns)).toEqual(new Set([formatFeePattern('')]))
  })

  it('[FPV-10] 2 ページ目で絞り込みを変えると offset が消えて 1 ページ目から出る', async () => {
    const pattern = 'A'
    const matched = sorted.filter((row) => row.手数料パターン === pattern)
    const { wrapper, router } = await mountView({ offset: String(PAGE_SIZE) })
    await settle()

    await byTestid(wrapper, `${PREFIX}-fee-pattern`).setValue(pattern)
    await byTestid(wrapper, `${PREFIX}-search`).trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ fee_pattern: pattern })
    expect(matched.length).toBeGreaterThan(0)
    expect(rows(wrapper)).toHaveLength(Math.min(matched.length, PAGE_SIZE))
    expect(rows(wrapper)[0].text()).toContain(String(matched[0].口座番号))
  })

  it('[FPV-11] 口座番号と数値の形が不正なら項目の直下に理由を出し、API へ送らない', async () => {
    let validateCalls = 0
    let createCalls = 0
    server.use(
      http.post(`${LIST_PATH}/validate`, () => {
        validateCalls += 1
        return HttpResponse.json({ valid: true, errors: [], warnings: [], details: null })
      }),
      http.post(LIST_PATH, () => {
        createCalls += 1
        return HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })
      }),
    )
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)

    await fillAdd(wrapper, { 'account-number': '12a', 'fee-multiplier': 'abc' })
    await submitAdd(wrapper)

    expect(exists(wrapper, `${PREFIX}-add-form`)).toBe(true)
    expect(fieldError(wrapper, addInput(wrapper, 'account-number'))).toBe(
      '口座番号は数字で入力してください。',
    )
    expect(fieldError(wrapper, addInput(wrapper, 'fee-multiplier'))).toBe(
      '掛目は 0 以上の数値で入力してください。',
    )
    expect(validateCalls).toBe(0)
    expect(createCalls).toBe(0)
  })

  it('[FPV-12] 警告が出たら「続行」に変わり、押し直すと登録される', async () => {
    const account = unregistered[1]
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)

    await fillAdd(wrapper, { 'account-number': account, 'fee-pattern': UNREGISTERED_PATTERN })
    await submitAdd(wrapper)

    expect(exists(wrapper, `${PREFIX}-add-form`)).toBe(true)
    const warnings = wrapper.findAll(`[data-testid="${PREFIX}-add-validation-warning"] li`)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.map((item) => item.text()).join()).toContain(
      `手数料パターン(${UNREGISTERED_PATTERN})`,
    )
    expect(addSubmit(wrapper).text()).toBe('続行')
    expect(exists(wrapper, `${PREFIX}-add-validation-error`)).toBe(false)
    expect(countText(wrapper)).toContain(String(TOTAL))

    await addSubmit(wrapper).trigger('click')
    // POST → 一覧の再取得 → 再描画 の 2 往復を待つ
    await settle()
    await settle()

    expect(exists(wrapper, `${PREFIX}-add-form`)).toBe(false)
    expect(byTestid(wrapper, `${PREFIX}-notice`).text()).toContain(account)
    expect(countText(wrapper)).toContain(String(TOTAL + 1))
  })

  it('[FPV-13] 警告が出たあと入力を変えると警告が消え「追加」に戻る', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)
    await fillAdd(wrapper, {
      'account-number': unregistered[1],
      'fee-pattern': UNREGISTERED_PATTERN,
    })
    await submitAdd(wrapper)
    expect(exists(wrapper, `${PREFIX}-add-validation-warning`)).toBe(true)

    await addInput(wrapper, 'fx-spread').setValue('0.1')
    await flushPromises()

    expect(exists(wrapper, `${PREFIX}-add-validation-warning`)).toBe(false)
    expect(addSubmit(wrapper).text()).toBe('追加')
  })

  it('[FPV-14] 変更の応答が返した警告を成功メッセージと一緒に出す', async () => {
    // 先頭行はパターン方式。ベイシスと掛目を同時に入れると、掛目が使われない旨の警告が返る
    expect(FIRST.ベイシス).toBeNull()
    const { wrapper } = await mountView()
    await settle()
    await openEditModal(wrapper)

    await editInput(wrapper, 'basis-points').setValue('30')
    await editInput(wrapper, 'fee-multiplier').setValue('80')
    await byTestid(wrapper, `${PREFIX}-edit-submit`).trigger('click')
    await settle()
    await settle()

    expect(exists(wrapper, `${PREFIX}-edit-form`)).toBe(false)
    expect(byTestid(wrapper, `${PREFIX}-notice`).text()).toContain(String(FIRST.口座番号))
    const warning = byTestid(wrapper, `${PREFIX}-notice-warning`).text()
    expect(warning).toContain('ベイシス方式のため')
    expect(warning).toContain('掛目')
  })

  it('[FPV-15] 編集を開くと為替スプレッドの 0 と掛目の未設定が区別されて入る', async () => {
    // 先頭行は為替スプレッド 0・掛目未設定（フィクスチャがこの形でないと意味を失う）
    expect(FIRST.スプレッド).toBe(0)
    expect(FIRST.掛目).toBeNull()
    const { wrapper } = await mountView()
    await settle()

    await openEditModal(wrapper)

    expect(editInput(wrapper, 'fx-spread').element.value).toBe('0')
    expect(editInput(wrapper, 'fee-multiplier').element.value).toBe('')
    const account = editInput(wrapper, 'account-number')
    expect(account.element.value).toBe(String(FIRST.口座番号))
    // パスキーが ID なので、口座番号も編集で変えられる
    expect(account.attributes('readonly')).toBeUndefined()
  })

  it('[FPV-16] 適用されない方式の列が淡色になる', async () => {
    const basis = firstPage.find((row) => row.適用方式 === 'BASIS')
    const pattern = firstPage.find((row) => row.適用方式 === 'PATTERN')
    expect(basis).toBeTruthy()
    expect(pattern).toBeTruthy()
    const { wrapper } = await mountView()
    await settle()

    const isUnused = (row, col) => cells(row)[col].find('.is-unused').exists()

    const basisRow = rowOf(wrapper, basis.口座番号)
    for (const col of [COL.feePattern, COL.feeMultiplier, COL.feeRange]) {
      expect(isUnused(basisRow, col)).toBe(true)
    }
    expect(isUnused(basisRow, COL.basisRange)).toBe(false)

    const patternRow = rowOf(wrapper, pattern.口座番号)
    for (const col of [COL.feePattern, COL.feeMultiplier, COL.feeRange]) {
      expect(isUnused(patternRow, col)).toBe(false)
    }
    expect(isUnused(patternRow, COL.basisRange)).toBe(true)
  })
})
