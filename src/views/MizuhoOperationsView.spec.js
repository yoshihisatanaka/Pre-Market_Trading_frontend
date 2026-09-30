import { beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { closedMizuhoClosingStatus, mizuhoClosingStatus } from '@/mocks/fixtures/closing'
import { mizuhoExecutions } from '@/mocks/fixtures/mizuhoExecutions'
import { mizuhoOrders } from '@/mocks/fixtures/mizuhoOrders'
import { downloadBlob } from '@/utils/download'
import MizuhoOperationsView from './MizuhoOperationsView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 締めカードと約定一覧の 4 状態をカードごとに出し分けることと、
 * 「検索条件は URL クエリが正」の単方向フロー、締めカードの操作（確認 → 実行 → 通知）を検証する。
 * 期待値はフィクスチャから導く（12 件 / MSFT などを直接書かない）。
 *
 * jsdom はダウンロードを実装していないので、utils/download を差し替えて「何を渡したか」を見る。
 * MSW の締め状態はハンドラの中で書き換わり、注文ファイルは締め済でないと 400 になるので、
 * 注文ファイルのテストは画面の「みずほ注文締め」で締めてから進める。
 */
vi.mock('@/utils/download', () => ({ downloadBlob: vi.fn() }))

const PATH = '/executions/mizuho-operations'

const EXECUTIONS_PATH = '*/api/executions'
const STATUS_PATH = '*/api/closing/status'
const CLOSE_PATH = '*/api/closing/mizuho'
const EXPORT_PATH = '*/api/mizuho/export-orders'

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'
const FORBIDDEN_MESSAGE = '操作権限がありません。'
const NOT_CLOSED_MESSAGE = '注文ファイルは、みずほ注文締め後に作成してください。'
const EMPTY_TEXT = '該当する約定はありません。'
const CLOSING_EMPTY_TEXT = 'みずほ注文の締め状態を取得できませんでした。'
const USER_CODE = 'test-user'

const TOTAL = mizuhoExecutions.length
const head = mizuhoExecutions[0]
const SELL = '1'

// 注文ファイルのファイル名と件数（既定のフィクスチャから数える。Dream 登録済だけが載る）
const BUY_FILENAME = `オーダーシート_${mizuhoClosingStatus.基準日}_BUY_US.xlsx`
const SELL_FILENAME = `オーダーシート_${mizuhoClosingStatus.基準日}_SELL_US.xlsx`
const ordersOf = (sideCode) => mizuhoOrders.filter((row) => row.売買区分 === sideCode)
const registeredCount = (sideCode) =>
  ordersOf(sideCode).filter((row) => row.Dream登録状況 === '2').length
const unregisteredCount = (sideCode) =>
  ordersOf(sideCode).filter((row) => row.Dream登録状況 !== '2').length

const Page = { render: () => h('div') }

async function mountView({ query = {} } = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: PATH, component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push({ path: PATH, query })

  const wrapper = mount(MizuhoOperationsView, {
    global: {
      plugins: [createPinia(), router],
      // teleport を stub して、ヘッダへ差し込むボタンとダイアログを wrapper 内に描画させる
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
  find(wrapper, 'mizuho-executions-table').findAll('[data-testid="data-table-row"]')
const isDialogOpen = (wrapper) => exists(wrapper, 'mizuho-closing-dialog')
const downloadedFilenames = () => vi.mocked(downloadBlob).mock.calls.map(([filename]) => filename)

/** 開いている確認ダイアログの主ボタンを押し、操作の応答が画面に反映されるまで待つ */
async function submitDialog(wrapper) {
  await find(wrapper, 'mizuho-closing-dialog-submit').trigger('click')
  await settle()
}

/** 受付中の締めカードから「みずほ注文締め」→「締める」まで進める */
async function closeFromPanel(wrapper) {
  await find(wrapper, 'mizuho-closing-close').trigger('click')
  await submitDialog(wrapper)
  await vi.waitFor(() => expect(find(wrapper, 'mizuho-closing-state').text()).toBe('締め済'))
}

/** 締め済の締めカードから「注文ファイル作成」→「作成する」まで進める */
async function createOrderFilesFromPanel(wrapper) {
  await find(wrapper, 'mizuho-closing-order-file').trigger('click')
  await submitDialog(wrapper)
}

const jsonError = () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })
const executionsError = (options) => http.get(EXECUTIONS_PATH, jsonError, options)
const closingError = (options) => http.get(STATUS_PATH, jsonError, options)

/** 指定のパスの応答を release() まで止める（既定のハンドラへ落として返す） */
function gated(path) {
  let open = null
  server.use(
    http.get(path, async () => {
      await new Promise((resolve) => (open = resolve))
      // 何も返さず既定のハンドラへ落とす
    }),
  )
  return {
    async release() {
      await vi.waitFor(() => expect(open).toBeTypeOf('function'))
      open()
    },
  }
}

// シナリオ: docs/unit/views-mizuho-operations-view.md
describe('MizuhoOperationsView', () => {
  beforeEach(() => {
    vi.mocked(downloadBlob).mockClear()
  })

  it('[MZV-01] 応答待ちのあいだは両カードにローディングだけを出し、件数カードは —', async () => {
    const executions = gated(EXECUTIONS_PATH)
    const closing = gated(STATUS_PATH)
    const { wrapper } = await mountView()
    await flushPromises()

    expect(exists(wrapper, 'mizuho-closing-loading')).toBe(true)
    expect(exists(wrapper, 'mizuho-closing-error')).toBe(false)
    expect(exists(wrapper, 'mizuho-closing-empty')).toBe(false)
    expect(exists(wrapper, 'mizuho-closing-state')).toBe(false)

    expect(exists(wrapper, 'mizuho-executions-loading')).toBe(true)
    expect(exists(wrapper, 'mizuho-executions-table')).toBe(false)
    expect(exists(wrapper, 'mizuho-executions-empty')).toBe(false)
    expect(exists(wrapper, 'mizuho-executions-error')).toBe(false)

    for (const key of ['total', 'buy', 'sell', 'partial']) {
      expect(find(wrapper, `mizuho-summary-${key}`).text()).toBe('—')
    }

    await executions.release()
    await closing.release()
    await settle()
  })

  it('[MZV-02] 約定一覧が 500 なら一覧にエラーと「再試行」を出し、締めカードは受付中のまま', async () => {
    server.use(executionsError())
    const { wrapper } = await mountView()
    await settle()

    const error = find(wrapper, 'mizuho-executions-error')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'mizuho-executions-table')).toBe(false)
    expect(find(wrapper, 'mizuho-closing-state').text()).toBe('受付中')
  })

  it('[MZV-03] 締め状態が 500 なら締めカードにエラーと「再試行」を出し、一覧は出たまま', async () => {
    server.use(closingError())
    const { wrapper } = await mountView()
    await settle()

    const error = find(wrapper, 'mizuho-closing-error')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'mizuho-closing-state')).toBe(false)
    expect(rows(wrapper)).toHaveLength(TOTAL)
  })

  it('[MZV-04] 締め状態の本文が空なら締めカードに空状態の文言を出す', async () => {
    server.use(http.get(STATUS_PATH, () => new HttpResponse(null, { status: 204 })))
    const { wrapper } = await mountView()
    await settle()

    expect(find(wrapper, 'mizuho-closing-empty').text()).toBe(CLOSING_EMPTY_TEXT)
    expect(exists(wrapper, 'mizuho-closing-state')).toBe(false)
  })

  it('[MZV-05] 0 件なら空状態を出し、表は描画しない', async () => {
    server.use(
      http.get(EXECUTIONS_PATH, () =>
        HttpResponse.json({
          total: 0,
          executions: [],
          summary: { 件数: 0, 買件数: 0, 売件数: 0 },
        }),
      ),
    )
    const { wrapper } = await mountView()
    await settle()

    expect(find(wrapper, 'mizuho-executions-empty').text()).toBe(EMPTY_TEXT)
    expect(exists(wrapper, 'mizuho-executions-table')).toBe(false)
  })

  it('[MZV-06] 既定モックでは件数と全行を出し、1 行目がフィクスチャ先頭行になる', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(find(wrapper, 'mizuho-executions-count').text()).toContain(String(TOTAL))
    expect(find(wrapper, 'mizuho-summary-total').text()).toBe(String(TOTAL))
    expect(rows(wrapper)).toHaveLength(TOTAL)

    const cells = rows(wrapper)[0].findAll('td')
    expect(cells[0].text()).toBe(`#${head.ID}`)
    expect(cells[4].text()).toBe(head.Ticker)
  })

  it('[MZV-07] 一覧の「再試行」で読み直すと表が出る', async () => {
    server.use(executionsError({ once: true }))
    const { wrapper } = await mountView()
    await settle()
    expect(exists(wrapper, 'mizuho-executions-error')).toBe(true)

    await find(wrapper, 'mizuho-executions-error').find('button').trigger('click')
    await settle()

    expect(exists(wrapper, 'mizuho-executions-error')).toBe(false)
    expect(rows(wrapper)).toHaveLength(TOTAL)
  })

  it('[MZV-08] 売買区分「売り」で検索すると URL に side=1 が乗り、その条件で読み直す', async () => {
    const sentSides = []
    server.use(
      http.get(EXECUTIONS_PATH, ({ request }) => {
        sentSides.push(new URL(request.url).searchParams.get('side'))
        // 記録だけして既定のハンドラへ落とす
      }),
    )
    const sellRows = mizuhoExecutions.filter((row) => row.売買区分 === SELL)
    const { wrapper, router } = await mountView()
    await settle()

    const select = find(wrapper, 'mizuho-executions-side')
    const sellOption = select.findAll('option').find((option) => option.text() === '売り')
    await select.setValue(sellOption.element.value)
    await find(wrapper, 'mizuho-executions-search').trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ side: SELL })
    expect(sentSides.at(-1)).toBe(SELL)
    expect(rows(wrapper)).toHaveLength(sellRows.length)
    expect(find(wrapper, 'mizuho-summary-sell').text()).toBe(String(sellRows.length))
    expect(find(wrapper, 'mizuho-summary-buy').text()).toBe('0')
  })

  it('[MZV-09] 未知の出来状況がクエリにあっても落ちず、条件なしの全件を出す', async () => {
    const sentStatuses = []
    server.use(
      http.get(EXECUTIONS_PATH, ({ request }) => {
        sentStatuses.push(new URL(request.url).searchParams.has('status'))
      }),
    )
    const { wrapper } = await mountView({ query: { status: 'unknown' } })
    await settle()

    expect(sentStatuses).toEqual([false])
    expect(exists(wrapper, 'mizuho-executions-error')).toBe(false)
    expect(rows(wrapper)).toHaveLength(TOTAL)
  })

  it('[MZV-10] 受付中の「みずほ注文締め」で確認が開き、「キャンセル」なら要求を出さずに閉じる', async () => {
    // 既定モックが受付中であることが前提
    expect(mizuhoClosingStatus.締め状態).toBe(0)
    let closeRequests = 0
    server.use(
      http.post(CLOSE_PATH, () => {
        closeRequests += 1
      }),
    )
    const { wrapper } = await mountView()
    await settle()
    expect(isDialogOpen(wrapper)).toBe(false)

    await find(wrapper, 'mizuho-closing-close').trigger('click')

    expect(isDialogOpen(wrapper)).toBe(true)
    const submit = find(wrapper, 'mizuho-closing-dialog-submit')
    expect(submit.text()).toBe('締める')
    expect(submit.attributes('disabled')).toBeUndefined()

    await find(wrapper, 'mizuho-closing-dialog-cancel').trigger('click')
    await settle()

    expect(isDialogOpen(wrapper)).toBe(false)
    expect(closeRequests).toBe(0)
    expect(find(wrapper, 'mizuho-closing-state').text()).toBe('受付中')
  })

  it('[MZV-11] 締め済の「注文ファイル作成」で、2 冊作ることと取消・訂正できないことを確認させる', async () => {
    server.use(http.get(STATUS_PATH, () => HttpResponse.json(closedMizuhoClosingStatus)))
    const { wrapper } = await mountView()
    await settle()
    expect(find(wrapper, 'mizuho-closing-state').text()).toBe('締め済')

    const orderFile = find(wrapper, 'mizuho-closing-order-file')
    expect(orderFile.attributes('disabled')).toBeUndefined()
    await orderFile.trigger('click')

    expect(isDialogOpen(wrapper)).toBe(true)
    expect(wrapper.find('[role="dialog"]').attributes('aria-label')).toBe('注文ファイル作成の確認')
    const dialog = find(wrapper, 'mizuho-closing-dialog')
    expect(dialog.text()).toContain('買い・売りの 2 冊')
    expect(dialog.text()).toContain('以降は取消・訂正できません')
    const submit = find(wrapper, 'mizuho-closing-dialog-submit')
    expect(submit.text()).toBe('作成する')
    expect(submit.attributes('disabled')).toBeUndefined()
  })

  it('[MZV-12] 「締める」で締め済になり、履歴に実行者の 1 行と成功の通知が出る', async () => {
    const { wrapper } = await mountView()
    await settle()

    await closeFromPanel(wrapper)

    expect(isDialogOpen(wrapper)).toBe(false)
    const history = find(wrapper, 'mizuho-closing-history-row')
    expect(history.text()).toContain('締め実行')
    expect(history.text()).toContain(USER_CODE)
    const notice = find(wrapper, 'mizuho-operations-notice')
    expect(notice.attributes('data-variant')).toBe('success')
    expect(notice.text()).toBe('みずほ注文を締めました。')
  })

  it('[MZV-13] 締めが 403 ならダイアログ内に理由を出し、締め状態も通知も変えない', async () => {
    server.use(
      http.post(CLOSE_PATH, () =>
        HttpResponse.json({ detail: FORBIDDEN_MESSAGE }, { status: 403 }),
      ),
    )
    const { wrapper } = await mountView()
    await settle()

    await find(wrapper, 'mizuho-closing-close').trigger('click')
    await submitDialog(wrapper)
    await vi.waitFor(() =>
      expect(find(wrapper, 'mizuho-closing-dialog-error').exists()).toBe(true),
    )

    expect(isDialogOpen(wrapper)).toBe(true)
    expect(find(wrapper, 'mizuho-closing-dialog-error').text()).toBe(FORBIDDEN_MESSAGE)
    expect(find(wrapper, 'mizuho-closing-state').text()).toBe('受付中')
    expect(exists(wrapper, 'mizuho-operations-notice')).toBe(false)
  })

  it('[MZV-14] 締め済から「締めを解除する」で受付中に戻り、成功の通知が出る', async () => {
    const { wrapper } = await mountView()
    await settle()
    await closeFromPanel(wrapper)

    await find(wrapper, 'mizuho-closing-reopen').trigger('click')
    await submitDialog(wrapper)
    await vi.waitFor(() => expect(find(wrapper, 'mizuho-closing-state').text()).toBe('受付中'))

    expect(isDialogOpen(wrapper)).toBe(false)
    const notice = find(wrapper, 'mizuho-operations-notice')
    expect(notice.attributes('data-variant')).toBe('success')
    expect(notice.text()).toBe('みずほ注文締めを解除しました。')
  })

  it('[MZV-15] 「作成する」で買い → 売りの 2 冊を落とし、件数と Dream 未登録の注意を通知する', async () => {
    const { wrapper } = await mountView()
    await settle()
    await closeFromPanel(wrapper)

    await createOrderFilesFromPanel(wrapper)
    await vi.waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(2))

    expect(downloadedFilenames()).toEqual([BUY_FILENAME, SELL_FILENAME])
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBeInstanceOf(Blob)
    await vi.waitFor(() => expect(isDialogOpen(wrapper)).toBe(false))

    const buy = registeredCount('3')
    const sell = registeredCount('1')
    const notice = find(wrapper, 'mizuho-operations-notice')
    expect(notice.attributes('data-variant')).toBe('warning')
    expect(notice.text()).toContain(`買い ${buy} 件・売り ${sell} 件`)
    expect(notice.text()).toContain(`今回発注済にした注文 ${buy + sell} 件`)
    expect(notice.text()).toContain(
      `Dream 未登録のため載せていない注文があります（売り ${unregisteredCount('1')} 件）`,
    )
  })

  it('[MZV-16] 売りだけ失敗したら買いの 1 冊を落とし、ダイアログを閉じて何が残ったかを通知する', async () => {
    const { wrapper } = await mountView()
    await settle()
    await closeFromPanel(wrapper)
    server.use(
      http.get(EXPORT_PATH, ({ request }) => {
        if (new URL(request.url).searchParams.get('side') !== 'sell') return
        return jsonError()
      }),
    )

    await createOrderFilesFromPanel(wrapper)
    await vi.waitFor(() => expect(isDialogOpen(wrapper)).toBe(false))

    expect(downloadedFilenames()).toEqual([BUY_FILENAME])
    const notice = find(wrapper, 'mizuho-operations-notice')
    expect(notice.attributes('data-variant')).toBe('error')
    expect(notice.text()).toContain(
      '買いの注文ファイルは作成しましたが、売りの注文ファイルを作成できませんでした。',
    )
    expect(notice.text()).toContain(ERROR_MESSAGE)
  })

  it('[MZV-17] 買いから 400 なら何も落とさず、ダイアログ内に理由を出す', async () => {
    // 照会だけ締め済にする。MSW の中の締め状態は受付中のままなので、注文ファイルは 400 になる
    server.use(http.get(STATUS_PATH, () => HttpResponse.json(closedMizuhoClosingStatus)))
    const { wrapper } = await mountView()
    await settle()

    await createOrderFilesFromPanel(wrapper)
    await vi.waitFor(() =>
      expect(find(wrapper, 'mizuho-closing-dialog-error').exists()).toBe(true),
    )

    expect(find(wrapper, 'mizuho-closing-dialog-error').text()).toBe(NOT_CLOSED_MESSAGE)
    expect(isDialogOpen(wrapper)).toBe(true)
    expect(downloadBlob).not.toHaveBeenCalled()
    expect(exists(wrapper, 'mizuho-operations-notice')).toBe(false)
  })
})
