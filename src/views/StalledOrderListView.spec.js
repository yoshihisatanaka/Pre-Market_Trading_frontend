import { File as NodeFile } from 'node:buffer'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { stalledOrderErrors, stalledWorkingOrders } from '@/mocks/fixtures/stalledOrders'
import { downloadCsv } from '@/utils/download'
import {
  CONFIRMATION_SAMPLE_CSV_FILENAME,
  TWS_ORDER_CSV_FILENAME,
  TWS_ORDER_SAMPLE_CSV_FILENAME,
  buildConfirmationSampleCsv,
  buildTwsOrderCsv,
  buildTwsOrderSampleCsv,
} from '@/utils/stalledOrderCsv'
import StalledOrderListView from './StalledOrderListView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、一覧 2 本の 4 状態・
 * 「URL クエリが正」の単方向フロー・CSV の出力と取込を検証する。
 *
 * jsdom は URL.createObjectURL を持たないので、ダウンロードは utils/download を差し替えて
 * 「何を渡したか」だけを見る（書式は utils/stalledOrderCsv.spec.js と utils/csv.spec.js が持つ）。
 */
vi.mock('@/utils/download', () => ({ downloadCsv: vi.fn() }))

const PATH = '/operations/stalled-orders'
const LIST_PATH = '*/api/operations/stalled-orders'
const IMPORT_PATH = '*/api/operations/stalled-orders/confirmation-import'

/*
 * jsdom の FormData は MSW(node) の XHR インターセプタが Fetch の Request に変換できず、
 * POST が応答しないまま止まる（src/api/stalledOrders.spec.js の冒頭）。テストの間だけ
 * Node（undici）の FormData に差し替える。
 *
 * ただし画面では File は FileDropZone の v-model（prop の型が jsdom の File）を通るので、
 * Node の File をそのまま渡すと prop の型検査の警告が出る。そこで jsdom の File を継承した
 * UploadFile を選ばせ、差し替えた FormData の append で同じ中身の Node の File に詰め替える。
 */
class UploadFile extends File {
  #text

  constructor(text, name) {
    super([text], name, { type: 'text/csv' })
    this.#text = text
  }

  toNodeFile() {
    return new NodeFile([this.#text], this.name, { type: this.type })
  }
}

let TestFormData = null

beforeAll(async () => {
  const response = new Response('', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  const NodeFormData = (await response.formData()).constructor
  TestFormData = class extends NodeFormData {
    append(name, value, ...rest) {
      super.append(name, value instanceof UploadFile ? value.toNodeFile() : value, ...rest)
    }
  }
})

beforeEach(() => {
  vi.stubGlobal('FormData', TestFormData)
  vi.mocked(downloadCsv).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/* 期待値はフィクスチャから導く（件数・注文 ID を直接書かない） */
const BRANCH = '123'
const branchErrors = stalledOrderErrors.filter((row) => row.部店 === BRANCH)
const branchWorking = stalledWorkingOrders.filter((row) => row.部店 === BRANCH)
const SIDE_LABELS = { 1: '売', 3: '買' }
const orderedAt = (row) => `${row.受注日}T${row.受注時刻}`
const byOrderedAtDesc = (a, b) => orderedAt(b).localeCompare(orderedAt(a)) || b.ID - a.ID
const hashIds = (rows) => rows.map((row) => `#${row.ID}`)

// 取込の成功: 注文エラーの 1 件目を約定で消し、2 件目を注文中へ移す
const CLOSED_TARGET = stalledOrderErrors[0]
const WORKING_TARGET = stalledOrderErrors[1]
const IMPORT_SUCCESS_MESSAGE =
  'コンファメーションを 2 件取り込みました（約定・取消で除外 1 件 / 注文中 1 件）。'
// 滞留一覧に無い注文 ID
const UNKNOWN_ID = 999
const IMPORT_ROW_ERROR_MESSAGE =
  '1 行にエラーがあるため、取り込みませんでした。CSV を直して取り込み直してください。'

// コンファメーション CSV のヘッダはサンプルの 1 行目から取る
const CONFIRMATION_HEADER = buildConfirmationSampleCsv().slice(1).split('\r\n')[0]
const confirmationFile = (lines, header = CONFIRMATION_HEADER) =>
  new UploadFile([header, ...lines].join('\r\n'), 'confirmation.csv')
const confirmationLine = (orderId, status) =>
  `${orderId},TWS-TEST-${orderId},${status},0,0,2026-09-16 11:00:00,テスト`
const successFile = () =>
  confirmationFile([
    confirmationLine(CLOSED_TARGET.ID, 'FILLED'),
    confirmationLine(WORKING_TARGET.ID, 'WORKING'),
  ])
const rowErrorFile = () => confirmationFile([confirmationLine(UNKNOWN_ID, 'FILLED')])

// FileDropZone の既定の案内文（ファイルを選んでいないときに出る）
const DROP_ZONE_LABEL = 'クリックまたはドラッグ＆ドロップでファイルを選択'

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

  const wrapper = mount(StalledOrderListView, {
    global: {
      plugins: [createPinia(), router],
      // teleport を stub して、ヘッダへ差し込むボタンを wrapper 内に描画させる
      stubs: { teleport: true },
    },
  })
  return { wrapper, router }
}

/** 操作 → router.push → 再取得 → 再描画 までを待つ */
async function settle() {
  await flushPromises()
  await flushPromises()
}

const byTestId = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const exists = (wrapper, testid) => byTestId(wrapper, testid).exists()
const countText = (wrapper, prefix) => byTestId(wrapper, `${prefix}-count`).text()
const tableIds = (wrapper, testid) =>
  byTestId(wrapper, testid)
    .findAll('[data-testid="data-table-row"]')
    .map((row) => row.find('td').text())
const isDisabled = (wrapper, testid) => byTestId(wrapper, testid).attributes('disabled') !== undefined
const importButton = (wrapper) => byTestId(wrapper, 'stalled-orders-confirmation-import')
const dropZone = (wrapper) => byTestId(wrapper, 'stalled-orders-confirmation-file')

async function selectFile(wrapper, file) {
  const input = dropZone(wrapper).find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
}

/**
 * 取込を押し、結果の帯（成功 / 行エラー / 失敗）が出るまで待つ。
 * multipart の直列化は Node のストリームを通るので、flushPromises だけでは届かない。
 */
async function submitImport(wrapper) {
  await importButton(wrapper).trigger('click')
  await vi.waitFor(() => {
    const shown = [
      'stalled-orders-import-notice',
      'stalled-orders-import-errors',
      'stalled-orders-import-error',
    ].some((testid) => exists(wrapper, testid))
    if (!shown) throw new Error('取込の結果がまだ出ていない')
  })
  await settle()
}

/** 握っていた取込を放したあと、取込が終わるまで待つ（後始末用） */
async function submitImportSettled(wrapper) {
  await vi.waitFor(() => {
    if (importButton(wrapper).text() === '取込中…') throw new Error('取込がまだ終わっていない')
  })
  await settle()
}

/** 取込の応答を握る。呼ぶと（本文を読まずに）空の成功を返す */
function gateImport() {
  let release
  const opened = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http.post(IMPORT_PATH, async () => {
      await opened
      return HttpResponse.json({
        success: true,
        total_count: 0,
        success_count: 0,
        error_count: 0,
        errors: [],
        message: '',
      })
    }),
  )
  return release
}

const ERROR_MESSAGE = '滞留注文を取得できませんでした。'
const errorHandler = (options) =>
  http.get(LIST_PATH, () => HttpResponse.json({ message: ERROR_MESSAGE }, { status: 500 }), options)
const emptyHandler = (options) =>
  http.get(LIST_PATH, () => HttpResponse.json({ 注文エラー: [], 注文中: [] }), options)

/** CSV 本文の order_id 列（BOM とヘッダを除く） */
const csvOrderIds = (text) =>
  text
    .slice(1)
    .split('\r\n')
    .filter(Boolean)
    .slice(1)
    .map((line) => line.split(',')[0])

// シナリオ: docs/unit/views-stalled-order-list-view.md
describe('StalledOrderListView', () => {
  it('[SOV-01] 取得中は 2 つのカードに読み込み中を出し、表は出さない', async () => {
    const { wrapper } = await mountView()

    expect(exists(wrapper, 'stalled-order-errors-loading')).toBe(true)
    expect(exists(wrapper, 'stalled-working-orders-loading')).toBe(true)
    expect(exists(wrapper, 'stalled-order-errors-table')).toBe(false)
    expect(exists(wrapper, 'stalled-working-orders-table')).toBe(false)
  })

  it('[SOV-02] 取得できると 2 本の件数と注文エラーの 1 行目が出る', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(countText(wrapper, 'stalled-order-errors')).toBe(`${stalledOrderErrors.length} 件`)
    expect(countText(wrapper, 'stalled-working-orders')).toBe(`${stalledWorkingOrders.length} 件`)

    const first = stalledOrderErrors[0]
    const firstRow = byTestId(wrapper, 'stalled-order-errors-table')
      .findAll('[data-testid="data-table-row"]')[0]
      .text()
    expect(first.指成区分).toBe('MO')
    expect(firstRow).toContain(first.銘柄コード)
    expect(firstRow).toContain(SIDE_LABELS[first.売買区分])
    expect(firstRow).toContain('成行')
    expect(firstRow).toContain(first.処理状況名)
  })

  it('[SOV-03] 500 のとき 2 つのカードにその message と「再試行」が出て表は出ない', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    for (const prefix of ['stalled-order-errors', 'stalled-working-orders']) {
      const error = byTestId(wrapper, `${prefix}-error`)
      expect(error.text()).toContain(ERROR_MESSAGE)
      expect(error.find('button').text()).toBe('再試行')
      expect(exists(wrapper, `${prefix}-table`)).toBe(false)
    }
  })

  it('[SOV-04] 500 のときも説明文・手動運用フロー・検索カードは残る', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'stalled-order-errors-error')).toBe(true)
    expect(exists(wrapper, 'stalled-orders-description')).toBe(true)
    expect(exists(wrapper, 'stalled-orders-flow')).toBe(true)
    expect(exists(wrapper, 'stalled-orders-search')).toBe(true)
  })

  it('[SOV-05] 部店コードで検索すると URL に載り一覧が絞り込まれる', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await byTestId(wrapper, 'stalled-orders-branch-code').setValue(BRANCH)
    await byTestId(wrapper, 'stalled-orders-search').trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ branch_code: BRANCH })
    expect(countText(wrapper, 'stalled-order-errors')).toBe(`${branchErrors.length} 件`)
    expect(countText(wrapper, 'stalled-working-orders')).toBe(`${branchWorking.length} 件`)
    expect(branchWorking).toHaveLength(0)
  })

  it('[SOV-06] URL の部店コードが入力欄に入る', async () => {
    const { wrapper } = await mountView({ branch_code: BRANCH })
    await settle()

    expect(byTestId(wrapper, 'stalled-orders-branch-code').element.value).toBe(BRANCH)
  })

  it('[SOV-07] クリアで URL のクエリが消え件数が戻る', async () => {
    const { wrapper, router } = await mountView({ branch_code: BRANCH })
    await settle()
    expect(countText(wrapper, 'stalled-order-errors')).toBe(`${branchErrors.length} 件`)

    await byTestId(wrapper, 'stalled-orders-search-clear').trigger('click')
    await settle()

    expect(router.currentRoute.value.query).toEqual({})
    expect(countText(wrapper, 'stalled-order-errors')).toBe(`${stalledOrderErrors.length} 件`)
    expect(countText(wrapper, 'stalled-working-orders')).toBe(`${stalledWorkingOrders.length} 件`)
  })

  it('[SOV-08] 両方 0 件ならそれぞれの空の文言が出る', async () => {
    server.use(emptyHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(byTestId(wrapper, 'stalled-order-errors-empty').text()).toBe(
      '別システムで発注する注文エラーはありません',
    )
    expect(byTestId(wrapper, 'stalled-working-orders-empty').text()).toBe(
      'コンファメーション取込後に未約定となっている注文はありません',
    )
  })

  it('[SOV-09] 権限のバッジ「操作可能」と CSV のボタン 3 つが出る', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(byTestId(wrapper, 'stalled-orders-permission').text()).toBe('操作可能')
    expect(byTestId(wrapper, 'stalled-orders-order-sample').text()).toBe('別システム発注CSVサンプル')
    expect(byTestId(wrapper, 'stalled-orders-export').text()).toBe('注文エラーをCSV出力')
    expect(byTestId(wrapper, 'stalled-orders-confirmation-sample').text()).toBe(
      'コンファメーションCSVサンプル',
    )
  })

  it('[SOV-10] ファイルを選ぶまでは取込ボタンが押せない', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(isDisabled(wrapper, 'stalled-orders-confirmation-import')).toBe(true)
  })

  it('[SOV-11] 「再読み込み」で件数が更新される', async () => {
    server.use(emptyHandler({ once: true }))
    const { wrapper } = await mountView()
    await settle()
    expect(countText(wrapper, 'stalled-order-errors')).toBe('0 件')

    await byTestId(wrapper, 'stalled-orders-reload').trigger('click')
    await settle()

    expect(countText(wrapper, 'stalled-order-errors')).toBe(`${stalledOrderErrors.length} 件`)
    expect(countText(wrapper, 'stalled-working-orders')).toBe(`${stalledWorkingOrders.length} 件`)
  })

  it('[SOV-12] 「別システム発注CSVサンプル」でサンプルをダウンロードさせる', async () => {
    const { wrapper } = await mountView()
    await settle()

    await byTestId(wrapper, 'stalled-orders-order-sample').trigger('click')

    expect(downloadCsv).toHaveBeenCalledWith(TWS_ORDER_SAMPLE_CSV_FILENAME, buildTwsOrderSampleCsv())
  })

  it('[SOV-13] 「コンファメーションCSVサンプル」でサンプルをダウンロードさせる', async () => {
    const { wrapper } = await mountView()
    await settle()

    await byTestId(wrapper, 'stalled-orders-confirmation-sample').trigger('click')

    expect(downloadCsv).toHaveBeenCalledWith(
      CONFIRMATION_SAMPLE_CSV_FILENAME,
      buildConfirmationSampleCsv(),
    )
  })

  it('[SOV-14] 「注文エラーをCSV出力」で画面の注文エラーを発注 CSV にして出す', async () => {
    const { wrapper } = await mountView()
    await settle()

    await byTestId(wrapper, 'stalled-orders-export').trigger('click')

    expect(downloadCsv).toHaveBeenCalledTimes(1)
    const [filename, text] = vi.mocked(downloadCsv).mock.calls[0]
    expect(filename).toBe(TWS_ORDER_CSV_FILENAME)
    // ヘッダは 0 件の出力と同じ行、データ行は画面の並びどおり
    expect(text.startsWith(buildTwsOrderCsv([]))).toBe(true)
    expect(csvOrderIds(text)).toEqual(stalledOrderErrors.map((row) => String(row.ID)))
  })

  it('[SOV-15] 検索中の条件で絞り込んだ行だけが出力される', async () => {
    const { wrapper } = await mountView({ branch_code: BRANCH })
    await settle()

    await byTestId(wrapper, 'stalled-orders-export').trigger('click')

    const [, text] = vi.mocked(downloadCsv).mock.calls[0]
    expect(csvOrderIds(text)).toEqual(branchErrors.map((row) => String(row.ID)))
  })

  it('[SOV-16] 取得中は「注文エラーをCSV出力」が押せない', async () => {
    const { wrapper } = await mountView()

    expect(exists(wrapper, 'stalled-order-errors-loading')).toBe(true)
    expect(isDisabled(wrapper, 'stalled-orders-export')).toBe(true)
  })

  it('[SOV-17] 取得に失敗したら「注文エラーをCSV出力」が押せない', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(isDisabled(wrapper, 'stalled-orders-export')).toBe(true)
  })

  it('[SOV-18] 注文エラーが 0 件なら「注文エラーをCSV出力」が押せない', async () => {
    server.use(
      http.get(LIST_PATH, () => HttpResponse.json({ 注文エラー: [], 注文中: stalledWorkingOrders })),
    )
    const { wrapper } = await mountView()
    await settle()

    expect(countText(wrapper, 'stalled-working-orders')).toBe(`${stalledWorkingOrders.length} 件`)
    expect(isDisabled(wrapper, 'stalled-orders-export')).toBe(true)
  })

  it('[SOV-19] 取込の応答待ちの間は「注文エラーをCSV出力」が押せない', async () => {
    const { wrapper } = await mountView()
    await settle()
    expect(isDisabled(wrapper, 'stalled-orders-export')).toBe(false)
    await selectFile(wrapper, successFile())
    const release = gateImport()

    await importButton(wrapper).trigger('click')

    expect(isDisabled(wrapper, 'stalled-orders-export')).toBe(true)

    release()
    await submitImportSettled(wrapper)
  })

  it('[SOV-20] 取込の応答待ちの間は取込ボタンが押せず「取込中…」になる', async () => {
    const { wrapper } = await mountView()
    await settle()
    await selectFile(wrapper, successFile())
    expect(isDisabled(wrapper, 'stalled-orders-confirmation-import')).toBe(false)
    const release = gateImport()

    await importButton(wrapper).trigger('click')

    expect(isDisabled(wrapper, 'stalled-orders-confirmation-import')).toBe(true)
    expect(importButton(wrapper).text()).toBe('取込中…')

    release()
    await submitImportSettled(wrapper)
  })

  it('[SOV-21] 取込が成功すると通知が出て一覧が入れ替わり、ファイルの選択が外れる', async () => {
    const { wrapper } = await mountView()
    await settle()
    const file = successFile()
    await selectFile(wrapper, file)
    expect(dropZone(wrapper).text()).toContain(file.name)

    await submitImport(wrapper)

    expect(byTestId(wrapper, 'stalled-orders-import-notice').text()).toBe(IMPORT_SUCCESS_MESSAGE)
    const remainingErrors = stalledOrderErrors.filter(
      (row) => row !== CLOSED_TARGET && row !== WORKING_TARGET,
    )
    const nextWorking = [...stalledWorkingOrders, WORKING_TARGET].sort(byOrderedAtDesc)
    expect(tableIds(wrapper, 'stalled-order-errors-table')).toEqual(hashIds(remainingErrors))
    expect(tableIds(wrapper, 'stalled-working-orders-table')).toEqual(hashIds(nextWorking))
    expect(countText(wrapper, 'stalled-order-errors')).toBe(`${remainingErrors.length} 件`)
    expect(countText(wrapper, 'stalled-working-orders')).toBe(`${nextWorking.length} 件`)
    // 選択が外れ、案内文に戻って取込ボタンが押せなくなる
    expect(dropZone(wrapper).text()).toContain(DROP_ZONE_LABEL)
    expect(dropZone(wrapper).text()).not.toContain(file.name)
    expect(isDisabled(wrapper, 'stalled-orders-confirmation-import')).toBe(true)
  })

  it('[SOV-22] 行エラーのときは警告の帯と行エラーの表が出て、一覧とファイルの選択は残る', async () => {
    const { wrapper } = await mountView()
    await settle()
    const file = rowErrorFile()
    await selectFile(wrapper, file)

    await submitImport(wrapper)

    const errors = byTestId(wrapper, 'stalled-orders-import-errors')
    expect(errors.text()).toContain(IMPORT_ROW_ERROR_MESSAGE)
    const rows = errors.findAll('[data-testid="data-table-row"]')
    expect(rows).toHaveLength(1)
    expect(rows[0].findAll('td').map((td) => td.text())).toEqual([
      '2',
      String(UNKNOWN_ID),
      `注文ID「${UNKNOWN_ID}」は滞留注文にありません。`,
    ])
    expect(exists(wrapper, 'stalled-orders-import-notice')).toBe(false)
    expect(countText(wrapper, 'stalled-order-errors')).toBe(`${stalledOrderErrors.length} 件`)
    expect(countText(wrapper, 'stalled-working-orders')).toBe(`${stalledWorkingOrders.length} 件`)
    expect(dropZone(wrapper).text()).toContain(file.name)
    expect(isDisabled(wrapper, 'stalled-orders-confirmation-import')).toBe(false)
  })

  it('[SOV-23] ファイルごと拒否される（400）とその理由が出て、ファイルの選択は残る', async () => {
    const { wrapper } = await mountView()
    await settle()
    // 既定のモックはヘッダ違いを 400 で拒否する
    const file = confirmationFile([confirmationLine(CLOSED_TARGET.ID, 'FILLED')], 'id,status')
    await selectFile(wrapper, file)

    await submitImport(wrapper)

    expect(byTestId(wrapper, 'stalled-orders-import-error').text()).toContain('ヘッダが違います。')
    expect(exists(wrapper, 'stalled-orders-import-notice')).toBe(false)
    expect(exists(wrapper, 'stalled-orders-import-errors')).toBe(false)
    expect(dropZone(wrapper).text()).toContain(file.name)
    expect(countText(wrapper, 'stalled-order-errors')).toBe(`${stalledOrderErrors.length} 件`)
  })

  it('[SOV-24] 取込が 500 のときその理由が出て、ファイルの選択は残る', async () => {
    const message = '取込の途中でエラーが発生しました。'
    server.use(http.post(IMPORT_PATH, () => HttpResponse.json({ detail: message }, { status: 500 })))
    const { wrapper } = await mountView()
    await settle()
    const file = successFile()
    await selectFile(wrapper, file)

    await submitImport(wrapper)

    expect(byTestId(wrapper, 'stalled-orders-import-error').text()).toBe(message)
    expect(dropZone(wrapper).text()).toContain(file.name)
    expect(isDisabled(wrapper, 'stalled-orders-confirmation-import')).toBe(false)
  })

  it('[SOV-25] 行エラーのあと取込を押し直すと、応答待ちの間に前回の帯が消える', async () => {
    const { wrapper } = await mountView()
    await settle()
    await selectFile(wrapper, rowErrorFile())
    await submitImport(wrapper)
    expect(exists(wrapper, 'stalled-orders-import-errors')).toBe(true)
    const release = gateImport()

    await importButton(wrapper).trigger('click')

    expect(exists(wrapper, 'stalled-orders-import-errors')).toBe(false)
    expect(exists(wrapper, 'stalled-orders-import-notice')).toBe(false)

    release()
    await submitImportSettled(wrapper)
  })

  it('[SOV-26] 失敗のあと取込を押し直すと、応答待ちの間に前回のエラーが消える', async () => {
    server.use(
      http.post(IMPORT_PATH, () => HttpResponse.json({ detail: '失敗' }, { status: 500 }), {
        once: true,
      }),
    )
    const { wrapper } = await mountView()
    await settle()
    await selectFile(wrapper, successFile())
    await submitImport(wrapper)
    expect(exists(wrapper, 'stalled-orders-import-error')).toBe(true)
    const release = gateImport()

    await importButton(wrapper).trigger('click')

    expect(exists(wrapper, 'stalled-orders-import-error')).toBe(false)

    release()
    await submitImportSettled(wrapper)
  })
})
