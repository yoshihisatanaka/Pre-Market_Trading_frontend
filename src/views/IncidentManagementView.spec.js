import { describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { suspensionHistories, suspensionTargets } from '@/mocks/fixtures/incidents'
import IncidentControlDialog from '@/components/incidents/IncidentControlDialog.vue'
import { INCIDENT_HISTORY_PAGE_SIZE, useIncidentsStore } from '@/stores/incidents'
import IncidentManagementView from './IncidentManagementView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 4 状態の出し分け・停止対象の表・履歴・停止 / 再開の導線を検証する。
 * 期待値はフィクスチャから導く（4 行 / 4 件 / 停止対象名を直接書かない）。
 *
 * 「IB だけが停止中」「全体が停止中」は、マウント前に同じ Pinia のストアから停止を実行して作る
 * （モックの状態遷移をそのまま使う。view の spec から api 層は import できない）。
 */
const PATH = '/operations/incidents'

const STATUS_PATH = '*/api/operations/order-suspensions'
const HISTORY_PATH = '*/api/operations/order-suspensions/history'
const SUSPEND_PATH = '*/api/operations/order-suspensions/suspend'

const TARGET_CODES = suspensionTargets.map((row) => row['停止対象'])
const ROUTE_CODES = TARGET_CODES.filter((code) => code !== 'ALL')
const nameOf = (code) => suspensionTargets.find((row) => row['停止対象'] === code)['停止対象名']

const IB_CODE = '1'
const REASON = 'IB回線障害'
// 停止理由が null の通常の行（「—」の確認用）
const NO_REASON_CODE = suspensionTargets.find((row) => row['停止理由'] === null)['停止対象']

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'
const LEAD_TEXT = '障害発生時に、全体または注文ルート別に発注を停止・再開します。'
const EMPTY_TEXT = '現在の発注停止状態を取得できませんでした。'
const HISTORY_EMPTY_TEXT = '障害対応履歴はありません。'
const REJECT_MESSAGE = `${nameOf(IB_CODE)}はすでに停止中です。`

/*
 * 実 API（とモック src/mocks/handlers/incidents.js）が返す成功文言。
 * 画面は応答の message をそのまま出すだけなので、届いた文言が通知に載ることを見る。
 */
const SUSPENDED_NOTICE = `${nameOf(IB_CODE)}の発注を停止しました。`
const RESUMED_NOTICE = `${nameOf(IB_CODE)}の発注を再開しました。`

const Page = { render: () => h('div') }

/**
 * 画面をマウントする。
 * @param {(store: ReturnType<typeof useIncidentsStore>) => Promise<void>} [prepare]
 *   マウント前にストア経由でモックの状態を作る（停止しておくなど）
 */
async function mountView(prepare) {
  const pinia = createPinia()
  if (prepare) {
    setActivePinia(pinia)
    await prepare(useIncidentsStore())
  }

  // この画面は route を見ないが、実アプリと同じく router の下にマウントする
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: PATH, component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push(PATH)

  const wrapper = mount(IncidentManagementView, {
    global: {
      plugins: [pinia, router],
      // teleport を stub して、ヘッダへ差し込む「再読み込み」とダイアログを wrapper 内に描画させる
      stubs: { teleport: true },
    },
  })
  return { wrapper, router }
}

const suspendIb = (store) => store.suspend({ target: IB_CODE, reason: REASON })
const suspendAll = (store) => store.suspend({ target: 'ALL', reason: REASON })

/**
 * 取得（状態 + 履歴）の応答が描画されるまで待つ。
 * 操作（POST → 取り直し）は 2 往復あるので settle を 2 回呼ぶ。
 */
async function settle() {
  await flushPromises()
  await flushPromises()
}

const find = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const exists = (wrapper, testid) => find(wrapper, testid).exists()
const targetRows = (wrapper) =>
  find(wrapper, 'incidents-targets').findAll('[data-testid="data-table-row"]')
const historyRows = (wrapper) =>
  find(wrapper, 'incidents-history').findAll('[data-testid="data-table-row"]')
const rowOf = (wrapper, code) => targetRows(wrapper)[TARGET_CODES.indexOf(code)]
// 行ごとの発注停止トグル（BaseSwitch。ON = 停止中）
const actionOf = (wrapper, code) => find(wrapper, `incidents-target-${code}-action`)
const isOn = (wrapper, code) => actionOf(wrapper, code).attributes('aria-checked') === 'true'
const stateText = (wrapper) => find(wrapper, 'incidents-state').text()
const dialog = (wrapper) => wrapper.findComponent(IncidentControlDialog)
const isDialogOpen = (wrapper) => exists(wrapper, 'incidents-control-dialog')

const errorHandler = (options) =>
  http.get(STATUS_PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }), options)
const historyErrorHandler = (options) =>
  http.get(HISTORY_PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }), options)

/*
 * 履歴のページング用。フィクスチャの履歴は 1 ページに収まるので、total が 3 ページ分ある応答を差し込む。
 * 行の 更新者 を offset から導き、表がどのページを出しているかを見分ける。
 */
const PAGE = INCIDENT_HISTORY_PAGE_SIZE
const PAGED_TOTAL = PAGE * 2 + 1
const operatorOf = (offset) => `op-${offset}`
const pageBody = (offset) => ({
  total: PAGED_TOTAL,
  limit: PAGE,
  offset,
  histories: [{ ...suspensionHistories[0], 操作者: operatorOf(offset) }],
})
const offsetOf = (request) => Number(new URL(request.url).searchParams.get('offset'))

/** 履歴の要求の offset を記録し、offset に応じたページを返す */
function pagedHistories() {
  const offsets = []
  server.use(
    http.get(HISTORY_PATH, ({ request }) => {
      offsets.push(offsetOf(request))
      return HttpResponse.json(pageBody(offsetOf(request)))
    }),
  )
  return offsets
}

/** 応答を release() まで止める履歴ハンドラ（応答待ちの画面を見るため） */
function gatedHistories() {
  let open = null
  server.use(
    http.get(HISTORY_PATH, async ({ request }) => {
      await new Promise((resolve) => (open = resolve))
      return HttpResponse.json(pageBody(offsetOf(request)))
    }),
  )
  return {
    async release() {
      await vi.waitFor(() => expect(open).not.toBeNull())
      open()
    },
  }
}

const pagination = (wrapper) => find(wrapper, 'incidents-history-pagination')
const pageButton = (wrapper, page) =>
  pagination(wrapper).find(`[data-testid="pagination-page"][data-page="${page}"]`)
const currentPage = (wrapper) =>
  pagination(wrapper).find('[data-testid="pagination-page"][aria-current="page"]').text()
const pagerButtons = (wrapper) => pagination(wrapper).findAll('button')
// 更新者（4 列目）
const historyOperators = (wrapper) =>
  historyRows(wrapper).map((row) => row.findAll('td')[3].text())

// シナリオ: docs/unit/views-incident-management-view.md
describe('IncidentManagementView', () => {
  it('[INV-01] 取得中は回転マークだけを出し、表も履歴も出さない', async () => {
    const { wrapper } = await mountView()

    expect(exists(wrapper, 'incidents-loading')).toBe(true)
    expect(exists(wrapper, 'incidents-targets')).toBe(false)
    expect(exists(wrapper, 'incidents-history')).toBe(false)
    await settle()
  })

  it('[INV-02] 取得が 500 ならエラーと「再試行」を出し、表も履歴も出さない', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    const error = find(wrapper, 'incidents-error')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'incidents-targets')).toBe(false)
    expect(exists(wrapper, 'incidents-history')).toBe(false)
  })

  it('[INV-03] 回復後に「再試行」を押すとエラーが消え運用状態と表が出る', async () => {
    server.use(errorHandler({ once: true }))
    const { wrapper } = await mountView()
    await settle()
    expect(exists(wrapper, 'incidents-error')).toBe(true)

    await find(wrapper, 'incidents-error').find('button').trigger('click')
    await settle()

    expect(exists(wrapper, 'incidents-error')).toBe(false)
    expect(exists(wrapper, 'incidents-state')).toBe(true)
    expect(targetRows(wrapper)).toHaveLength(TARGET_CODES.length)
  })

  it('[INV-04] 停止状態が本文なしなら空状態の文言を出す', async () => {
    server.use(http.get(STATUS_PATH, () => new HttpResponse(null, { status: 204 })))
    const { wrapper } = await mountView()
    await settle()

    expect(find(wrapper, 'incidents-empty').text()).toBe(EMPTY_TEXT)
    expect(exists(wrapper, 'incidents-targets')).toBe(false)
  })

  it('[INV-05] 既定モックでは「通常運用」と停止対象の表を出す', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(stateText(wrapper)).toBe('通常運用')
    expect(targetRows(wrapper)).toHaveLength(TARGET_CODES.length)
    targetRows(wrapper).forEach((row, index) => {
      expect(row.text()).toContain(nameOf(TARGET_CODES[index]))
    })
  })

  it('[INV-06] 説明文は取得の成否によらず出る', async () => {
    const { wrapper } = await mountView()
    await settle()
    expect(wrapper.text()).toContain(LEAD_TEXT)

    server.use(errorHandler())
    const { wrapper: failed } = await mountView()
    await settle()
    expect(exists(failed, 'incidents-error')).toBe(true)
    expect(failed.text()).toContain(LEAD_TEXT)
  })

  it('[INV-07] 履歴 0 件は履歴の空文言だけを出し、表は残り画面の空状態にはしない', async () => {
    server.use(
      http.get(HISTORY_PATH, () =>
        HttpResponse.json({ total: 0, limit: 50, offset: 0, histories: [] }),
      ),
    )
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'incidents-history')).toBe(false)
    expect(find(wrapper, 'incidents-history-empty').text()).toBe(HISTORY_EMPTY_TEXT)
    expect(targetRows(wrapper)).toHaveLength(TARGET_CODES.length)
    expect(exists(wrapper, 'incidents-empty')).toBe(false)
  })

  it('[INV-08] 全体停止中は「全体停止中」を通常運用とは別の危険色で出す', async () => {
    const { wrapper: normal } = await mountView()
    await settle()
    const normalClasses = [...find(normal, 'incidents-state').element.parentElement.classList]

    const { wrapper } = await mountView(suspendAll)
    await settle()

    expect(stateText(wrapper)).toBe('全体停止中')
    const classes = [...find(wrapper, 'incidents-state').element.parentElement.classList]
    expect(classes).toContain('is-danger')
    expect(normalClasses).not.toContain('is-danger')
  })

  it('[INV-09] 全体のトグルで全体を対象に停止の確認ダイアログが開く', async () => {
    const { wrapper } = await mountView()
    await settle()
    expect(isDialogOpen(wrapper)).toBe(false)

    await actionOf(wrapper, 'ALL').trigger('click')

    expect(isDialogOpen(wrapper)).toBe(true)
    expect(dialog(wrapper).props('mode')).toBe('suspend')
    expect(dialog(wrapper).props('target').target).toBe('ALL')
  })

  it('[INV-10] IB のトグルで IB を対象に停止の確認ダイアログが開く', async () => {
    const { wrapper } = await mountView()
    await settle()

    await actionOf(wrapper, IB_CODE).trigger('click')

    expect(isDialogOpen(wrapper)).toBe(true)
    expect(dialog(wrapper).props('mode')).toBe('suspend')
    expect(dialog(wrapper).props('target')).toMatchObject({
      target: IB_CODE,
      targetName: nameOf(IB_CODE),
    })
  })

  it('[INV-11] ダイアログの close で閉じ、運用状態は変わらない', async () => {
    const { wrapper } = await mountView()
    await settle()
    const before = stateText(wrapper)
    await actionOf(wrapper, 'ALL').trigger('click')

    dialog(wrapper).vm.$emit('close')
    await settle()

    expect(isDialogOpen(wrapper)).toBe(false)
    expect(stateText(wrapper)).toBe(before)
  })

  it('[INV-12] 「再読み込み」で取得がやり直され、運用状態が出たままになる', async () => {
    let statusCalls = 0
    server.use(
      http.get(STATUS_PATH, () => {
        statusCalls += 1
        // 応答は返さず既定のハンドラへ落とす
      }),
    )
    const { wrapper } = await mountView()
    await settle()
    expect(statusCalls).toBe(1)

    await find(wrapper, 'incidents-reload').trigger('click')
    await settle()

    expect(statusCalls).toBe(2)
    expect(stateText(wrapper)).toBe('通常運用')
  })

  it('[INV-13] 履歴の列見出しが決まった順で並び、履歴の件数だけ行が出る', async () => {
    const { wrapper } = await mountView()
    await settle()

    const headers = find(wrapper, 'incidents-history')
      .findAll('th')
      .map((th) => th.text())
    expect(headers).toEqual(['変更日時', '制御内容', '停止理由', '更新者'])
    expect(historyRows(wrapper)).toHaveLength(suspensionHistories.length)

    // 制御内容（2 列目）は「停止対象名：操作区分名」
    const latest = suspensionHistories[0]
    expect(historyRows(wrapper)[0].findAll('td')[1].text()).toBe(
      `${latest['停止対象名']}：${latest['操作区分名']}`,
    )
  })

  it('[INV-14] 停止中の行は「停止中」、通常の行は「通常」、停止理由が null の行は「—」', async () => {
    const { wrapper } = await mountView(suspendIb)
    await settle()

    expect(rowOf(wrapper, IB_CODE).text()).toContain('停止中')
    TARGET_CODES.filter((code) => code !== IB_CODE).forEach((code) => {
      const text = rowOf(wrapper, code).text()
      expect(text).toContain('通常')
      expect(text).not.toContain('停止中')
    })
    // 停止理由の列（3 列目）
    expect(rowOf(wrapper, NO_REASON_CODE).findAll('td')[2].text()).toBe('—')
  })

  it('[INV-15] 停止の確定でダイアログが閉じ、サーバの文言が成功通知に出る', async () => {
    const { wrapper } = await mountView()
    await settle()
    await actionOf(wrapper, IB_CODE).trigger('click')

    dialog(wrapper).vm.$emit('confirm', { reason: REASON })
    // POST → 状態と履歴の取り直し の 2 往復を待つ
    await settle()
    await settle()

    expect(isDialogOpen(wrapper)).toBe(false)
    expect(find(wrapper, 'incidents-notice').text()).toBe(SUSPENDED_NOTICE)
    expect(rowOf(wrapper, IB_CODE).text()).toContain('停止中')
  })

  it('[INV-16] 停止が 400 ならダイアログは開いたままサーバの文言が渡り、成功通知は出ない', async () => {
    server.use(
      http.post(SUSPEND_PATH, () =>
        HttpResponse.json({ detail: REJECT_MESSAGE }, { status: 400 }),
      ),
    )
    const { wrapper } = await mountView()
    await settle()
    await actionOf(wrapper, IB_CODE).trigger('click')

    dialog(wrapper).vm.$emit('confirm', { reason: REASON })
    await settle()
    await settle()

    expect(isDialogOpen(wrapper)).toBe(true)
    expect(dialog(wrapper).props('error').message).toBe(REJECT_MESSAGE)
    expect(find(wrapper, 'incidents-control-error').text()).toBe(REJECT_MESSAGE)
    expect(exists(wrapper, 'incidents-notice')).toBe(false)
  })

  it('[INV-17] 成功通知は「再読み込み」で消える', async () => {
    const { wrapper } = await mountView()
    await settle()
    await actionOf(wrapper, IB_CODE).trigger('click')
    dialog(wrapper).vm.$emit('confirm', { reason: REASON })
    await settle()
    await settle()
    expect(exists(wrapper, 'incidents-notice')).toBe(true)

    await find(wrapper, 'incidents-reload').trigger('click')
    await settle()

    expect(exists(wrapper, 'incidents-notice')).toBe(false)
  })

  it('[INV-19] IB だけが停止中なら IB のトグルだけが ON で、どれも押せる', async () => {
    const { wrapper } = await mountView(suspendIb)
    await settle()

    TARGET_CODES.forEach((code) => {
      const action = actionOf(wrapper, code)
      expect(action.attributes('role')).toBe('switch')
      expect(isOn(wrapper, code)).toBe(code === IB_CODE)
      expect(action.attributes('aria-label')).toBe(`${nameOf(code)}の発注停止`)
      expect(action.attributes('disabled')).toBeUndefined()
    })
    expect(exists(wrapper, 'incidents-locked')).toBe(false)
  })

  it('[INV-20] IB のトグル（ON）で再開の確認が開き、確定で再開されて成功通知が出る', async () => {
    const { wrapper } = await mountView(suspendIb)
    await settle()

    await actionOf(wrapper, IB_CODE).trigger('click')
    expect(isDialogOpen(wrapper)).toBe(true)
    expect(dialog(wrapper).props('mode')).toBe('resume')
    expect(dialog(wrapper).props('target').target).toBe(IB_CODE)

    dialog(wrapper).vm.$emit('confirm', { reason: null })
    await settle()
    await settle()

    expect(isDialogOpen(wrapper)).toBe(false)
    expect(find(wrapper, 'incidents-notice').text()).toBe(RESUMED_NOTICE)
    expect(isOn(wrapper, IB_CODE)).toBe(false)
    expect(stateText(wrapper)).toBe('通常運用')
  })

  it('[INV-21] 全体停止中は全体のトグル（ON）だけが押せ、ルートは押せず注意書きが出る', async () => {
    const { wrapper } = await mountView(suspendAll)
    await settle()

    expect(isOn(wrapper, 'ALL')).toBe(true)
    expect(actionOf(wrapper, 'ALL').attributes('disabled')).toBeUndefined()
    ROUTE_CODES.forEach((code) => {
      expect(actionOf(wrapper, code).attributes('disabled')).toBeDefined()
    })
    expect(exists(wrapper, 'incidents-locked')).toBe(true)
  })

  it('[INV-22] トグルを押しただけでは切り替わらず、閉じても OFF のまま停止されない', async () => {
    const { wrapper } = await mountView()
    await settle()

    await actionOf(wrapper, IB_CODE).trigger('click')
    expect(isDialogOpen(wrapper)).toBe(true)
    expect(isOn(wrapper, IB_CODE)).toBe(false)

    dialog(wrapper).vm.$emit('close')
    await settle()

    expect(isDialogOpen(wrapper)).toBe(false)
    expect(isOn(wrapper, IB_CODE)).toBe(false)
    expect(rowOf(wrapper, IB_CODE).text()).not.toContain('停止中')
    expect(stateText(wrapper)).toBe('通常運用')
  })

  it('[INV-23] 履歴が 1 ページより多ければページャーが出て 1 ページ目を示す', async () => {
    pagedHistories()
    const { wrapper } = await mountView()
    await settle()

    expect(pagination(wrapper).exists()).toBe(true)
    expect(pagination(wrapper).find('[data-testid="pagination-range"]').text()).toBe(
      `${PAGED_TOTAL} 件中 1–${PAGE} 件`,
    )
    expect(currentPage(wrapper)).toBe('1')
  })

  it('[INV-24] 履歴が 0 件ならページャーは出ない', async () => {
    server.use(
      http.get(HISTORY_PATH, () =>
        HttpResponse.json({ total: 0, limit: PAGE, offset: 0, histories: [] }),
      ),
    )
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'incidents-history-empty')).toBe(true)
    expect(pagination(wrapper).exists()).toBe(false)
  })

  it('[INV-25] ページ番号「2」で 2 ページ目の offset で取り直し、表が替わる', async () => {
    const offsets = pagedHistories()
    const { wrapper } = await mountView()
    await settle()
    expect(historyOperators(wrapper)).toEqual([operatorOf(0)])

    await pageButton(wrapper, 2).trigger('click')
    await settle()

    expect(offsets.at(-1)).toBe(PAGE)
    expect(historyOperators(wrapper)).toEqual([operatorOf(PAGE)])
    expect(currentPage(wrapper)).toBe('2')
  })

  it('[INV-26] ページ送りが 500 なら履歴カード内にエラーと「再試行」を出し、停止対象の表は残る', async () => {
    pagedHistories()
    const { wrapper } = await mountView()
    await settle()
    server.use(historyErrorHandler())

    await pageButton(wrapper, 2).trigger('click')
    await settle()

    const historyError = find(wrapper, 'incidents-history-error')
    expect(historyError.exists()).toBe(true)
    expect(historyError.text()).toContain(ERROR_MESSAGE)
    expect(historyError.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'incidents-history')).toBe(false)
    expect(pagination(wrapper).exists()).toBe(false)
    expect(targetRows(wrapper)).toHaveLength(TARGET_CODES.length)
    expect(exists(wrapper, 'incidents-error')).toBe(false)
  })

  it('[INV-27] 回復後に履歴の「再試行」で失敗したページを読み直し、表とページャーが戻る', async () => {
    const offsets = pagedHistories()
    const { wrapper } = await mountView()
    await settle()
    server.use(historyErrorHandler({ once: true }))
    await pageButton(wrapper, 2).trigger('click')
    await settle()
    expect(exists(wrapper, 'incidents-history-error')).toBe(true)

    await find(wrapper, 'incidents-history-error').find('button').trigger('click')
    await settle()

    expect(offsets.at(-1)).toBe(PAGE)
    expect(exists(wrapper, 'incidents-history-error')).toBe(false)
    expect(historyOperators(wrapper)).toEqual([operatorOf(PAGE)])
    expect(currentPage(wrapper)).toBe('2')
  })

  it('[INV-28] 2 ページ目で「再読み込み」しても同じページを読み直し、ページ位置を保つ', async () => {
    const offsets = pagedHistories()
    const { wrapper } = await mountView()
    await settle()
    await pageButton(wrapper, 2).trigger('click')
    await settle()
    const before = offsets.length

    await find(wrapper, 'incidents-reload').trigger('click')
    await settle()

    expect(offsets.length).toBe(before + 1)
    expect(offsets.at(-1)).toBe(PAGE)
    expect(currentPage(wrapper)).toBe('2')
    expect(historyOperators(wrapper)).toEqual([operatorOf(PAGE)])
  })

  it('[INV-29] ページ送りの応答待ちはページャーを押せず、応答後は押せる', async () => {
    pagedHistories()
    const { wrapper } = await mountView()
    await settle()
    const gate = gatedHistories()

    await pageButton(wrapper, 2).trigger('click')
    await nextTick()

    pagerButtons(wrapper).forEach((button) => {
      expect(button.attributes('disabled')).toBeDefined()
    })

    await gate.release()
    await settle()
    expect(pageButton(wrapper, 1).attributes('disabled')).toBeUndefined()
  })

  it('[INV-30] 停止の実行中はページャーを押せない', async () => {
    pagedHistories()
    const { wrapper } = await mountView()
    await settle()
    await actionOf(wrapper, IB_CODE).trigger('click')

    dialog(wrapper).vm.$emit('confirm', { reason: REASON })
    await nextTick()

    pagerButtons(wrapper).forEach((button) => {
      expect(button.attributes('disabled')).toBeDefined()
    })
    await settle()
    await settle()
  })
})
