import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { apiContext, listHelpers, logExchange, skipUnlessRealApi } from './helpers/realApi.js'

/*
 * みずほ注文締を「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/mizuho-operations-real-api.md（タイトル先頭の [MZR-xx] が対応 ID）
 *
 * mizuho-operations.spec.js（MZ）とは目的が違う。MZ は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせ（締め状態の往復・route=0 の固定・
 * クエリ名の変換・summary・CSV 出力）だけを見るので、期待値に**データの中身を書かない**。
 * 絞り込みの値は、開いた時点（条件なし）に画面自身が受け取った GET /executions の応答から読む
 * （テストから API を直接引くと X-User-Code が画面と違い、部店の限定で見える約定が変わるため）。
 * 0 件・値が空ならその行はスキップする。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test mizuho-operations.real-api
 *
 * MZR-02 は実 DB のみずほ締め状態（基準日ごとに 1 つ）を書き換える。ローカルの開発 DB 前提。
 * 実行前の状態から往復して戻し、beforeAll で退避した 締め状態 を afterAll でも確かめて戻す。
 * 締め・解除の履歴（ClosingStatusResponse.history）は 1 回の実行で 2 行積まれ、戻せない。
 * 約定一覧と CSV 出力は GET だけ。注文ファイル作成（発注済に進めて戻せない）は扱わない。
 */

const PATH = '/executions/mizuho-operations'
// 実 API のパス（openapi.json）。dev サーバの /api プロキシ越しに届く
const CLOSING_STATUS_PATH = '/api/closing/status'
const CLOSE_PATH = '/api/closing/mizuho'
const REOPEN_PATH = '/api/closing/mizuho/reset'
const EXECUTIONS_PATH = '/api/executions'
const CSV_PATH = '/api/executions/export-csv'

// src/api/closing.js の MIZUHO_CLOSING_TYPE（GET /closing/status の closing_type）
const CLOSING_TYPE = 'MIZUHO'
// src/api/mizuhoExecutions.js の MIZUHO_ROUTE。一覧と CSV に必ず付く
const MIZUHO_ROUTE = '0'

// src/stores/mizuhoExecutions.js の MIZUHO_EXECUTIONS_PAGE_SIZE（= utils/pagination.js の DEFAULT_PAGE_SIZE）と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

// openapi.json の /executions/export-csv の説明「上限10,000件」
const CSV_LIMIT = 10000

/** 絞り込みのクエリ名（実 API 側。src/api/mizuhoExecutions.js の toSearchParams。route は固定なので含めない） */
const FILTER_QUERIES = ['branch_code', 'symbol', 'side', 'status', 'start_date', 'end_date']

/** 売買区分。URL も実 API も同じコード（MizuhoOperationsView の SIDE_OPTIONS / openapi.json の 1:売 / 3:買） */
const SIDES = {
  sell: { code: '1', option: '売り', cell: '売', card: 'mizuho-summary-sell' },
  buy: { code: '3', option: '買い', cell: '買', card: 'mizuho-summary-buy' },
}

/** 列の並び（src/components/mizuho/MizuhoExecutionTable.vue の COLUMNS） */
const COLUMNS = [
  '約定ID',
  '注文ID',
  '口座番号',
  '顧客名',
  '銘柄',
  '売買',
  '元注文数量',
  '約定数量',
  '約定単価(USD)',
  '約定金額(円)',
  '約定日時',
  '出来状況',
]

// 出来状況の表示名（src/api/mizuhoExecutions.js の FILL_STATUS_BY_CODE × utils/fillStatusTypes.js）。知らないコードは応答の 処理状況名
const STATUS_LABELS = {
  '011': '全部出来',
  '010': '一部出来',
  '032': '取消済（出来有）',
  '034': '取消済（出来有）',
}

// 値が無いときの表示（セル・件数カード）
const EMPTY_CELL = '—'

// 締めカードの語（src/components/mizuho/MizuhoClosingPanel.vue）と通知の文（MizuhoOperationsView.vue）
const CLOSING = {
  close: {
    button: 'mizuho-closing-close',
    apiPath: CLOSE_PATH,
    stateAfter: '締め済',
    historyAfter: '締め実行',
    notice: 'みずほ注文を締めました。',
  },
  reopen: {
    button: 'mizuho-closing-reopen',
    apiPath: REOPEN_PATH,
    stateAfter: '受付中',
    historyAfter: '締め解除',
    notice: 'みずほ注文締めを解除しました。',
  },
}

const CSV_FILENAME = 'executions.csv'
const BOM = '﻿'

const { openList, countOf, rowsOf, settleList, expectListConsistent } = listHelpers({
  path: PATH,
  testIdPrefix: 'mizuho-executions',
})

/** 表の 1 列ぶんのセル（全行） */
function columnOf(page, column) {
  return rowsOf(page).locator(`td:nth-child(${COLUMNS.indexOf(column) + 1})`)
}

/** 絞り込みのクエリが 1 つも載っておらず、route=0 が付いているか */
function isUnfilteredMizuho(url) {
  return (
    url.searchParams.get('route') === MIZUHO_ROUTE &&
    FILTER_QUERIES.every((query) => !url.searchParams.has(query))
  )
}

/** 実 API のリクエストのうち、メソッドとパスが合い、条件（URL を受ける関数）を満たすものの応答を待つ */
function waitForApi(page, pathname, matches = () => true, method = 'GET') {
  return page.waitForResponse((res) => {
    const url = new URL(res.url())
    return res.request().method() === method && url.pathname === pathname && matches(url)
  })
}

/** クエリの値が合う GET /executions の応答を待つ（route=0 も必ず付く） */
function waitForList(page, query, value) {
  return waitForApi(
    page,
    EXECUTIONS_PATH,
    (url) =>
      url.searchParams.get('route') === MIZUHO_ROUTE && url.searchParams.get(query) === value,
  )
}

/** 締め状態の取得完了を待つ */
async function settleClosing(page) {
  await expect(page.getByTestId('mizuho-closing-loading')).toHaveCount(0)
}

/**
 * みずほ注文締を開き、画面が受け取った GET /closing/status と条件なしの GET /executions の応答を返す。
 * 絞り込みの値はここから読む（テストから API を直接引かない理由はファイル冒頭）
 */
async function openAndCapture(page) {
  const closingResponse = waitForApi(
    page,
    CLOSING_STATUS_PATH,
    (url) => url.searchParams.get('closing_type') === CLOSING_TYPE,
  )
  const listResponse = waitForApi(page, EXECUTIONS_PATH, isUnfilteredMizuho)
  await openList(page)

  const closingRes = await closingResponse
  expect(closingRes.ok(), `${CLOSING_STATUS_PATH} が ${closingRes.status()} を返した`).toBe(true)
  const listRes = await listResponse
  expect(listRes.ok(), `${EXECUTIONS_PATH} が ${listRes.status()} を返した`).toBe(true)
  await settleClosing(page)

  const body = await listRes.json()
  return {
    closing: await closingRes.json(),
    body,
    total: await countOf(page),
    first: body.executions?.[0] ?? null,
  }
}

/** 開いて、約定が 0 件ならスキップする */
async function openOrSkip(page) {
  const opened = await openAndCapture(page)
  test.skip(opened.total === 0 || !opened.first, '約定が 0 件なので絞り込みを確かめられない')
  return opened
}

/** 「検索」を押して、条件に合う応答と描画を待つ */
async function submit(page, response) {
  await page.getByTestId('mizuho-executions-search-submit').click()
  const res = await response
  expect(res.ok(), `${EXECUTIONS_PATH} が ${res.status()} を返した`).toBe(true)
  await settleList(page)
}

/** 件数カードの値（値の要素だけが testid を持つ）。'—' なら null */
async function statValue(page, testId) {
  const text = ((await page.getByTestId(testId).textContent()) ?? '').trim()
  return text === EMPTY_CELL ? null : Number(text.replace(/[^0-9]/g, ''))
}

/** 絞り込んだあとの共通の期待値。件数が 1 以上かつ全件以下で、表示行・総約定件数と合う */
async function expectNarrowed(page, total) {
  const filtered = await countOf(page)
  expect(filtered).toBeGreaterThan(0)
  expect(filtered).toBeLessThanOrEqual(total)
  await expect(page.getByTestId('mizuho-executions-error')).toHaveCount(0)
  expect(await statValue(page, 'mizuho-summary-total')).toBe(filtered)

  const shown = Math.min(filtered, PAGE_SIZE)
  await expect(rowsOf(page)).toHaveCount(shown)
  return { filtered, shown }
}

/** URL（画面）のクエリの値 */
function urlQuery(page, name) {
  return new URL(page.url()).searchParams.get(name)
}

/** 開いた時点の件数カードから、件数が 1 以上の側（売りを優先）を選ぶ。どちらも 0 なら null */
async function pickSide(page) {
  const sellCount = await statValue(page, SIDES.sell.card)
  const buyCount = await statValue(page, SIDES.buy.card)
  if (sellCount) return { side: 'sell', expected: sellCount }
  if (buyCount) return { side: 'buy', expected: buyCount }
  return null
}

/** 「CSV出力」を押し、export-csv のリクエストとダウンロードを待つ */
async function download(page) {
  const request = page.waitForRequest((req) => new URL(req.url()).pathname === CSV_PATH)
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('mizuho-executions-export').click(),
  ])
  return {
    url: new URL((await request).url()),
    name: file.suggestedFilename(),
    text: readFileSync(await file.path(), 'utf8'),
  }
}

/**
 * CSV を行×列に割る。`"` で囲まれた値の中の `,` `""` 改行を扱い、改行は CRLF / LF のどちらでも受ける
 * （実 API の改行コードは openapi.json に書かれていない）。BOM は落とす。
 * executions.real-api.spec.js と同じもの（共通化の候補。helpers/realApi.js はこの spec から書き換えない）
 */
function parseCsv(text) {
  const body = text.startsWith(BOM) ? text.slice(BOM.length) : text
  const records = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < body.length; i += 1) {
    const c = body[i]
    if (quoted) {
      if (c !== '"') field += c
      else if (body[i + 1] === '"') {
        field += '"'
        i += 1
      } else quoted = false
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && body[i + 1] === '\n') i += 1
      row.push(field)
      records.push(row)
      row = []
      field = ''
    } else field += c
  }
  // 末尾に改行が無いときの最後の行
  if (field !== '' || row.length > 0) {
    row.push(field)
    records.push(row)
  }
  return records
}

/** 実 API の締め状態（ClosingStatusResponse の生の形） */
async function fetchClosing(api) {
  const res = await api.get(CLOSING_STATUS_PATH, { params: { closing_type: CLOSING_TYPE } })
  expect(res.ok(), '実 API から締め状態を取得できない。api コンテナが動いているか確認する').toBe(
    true,
  )
  return res.json()
}

/** 締め状態に応じたカードの期待値（語とボタンの出し分け） */
async function expectClosingCard(page, closed) {
  await expect(page.getByTestId('mizuho-closing-state')).toHaveText(closed ? '締め済' : '受付中')
  await expect(page.getByTestId('mizuho-closing-reopen')).toHaveCount(closed ? 1 : 0)
  await expect(page.getByTestId('mizuho-closing-close')).toHaveCount(closed ? 0 : 1)
  const orderFile = page.getByTestId('mizuho-closing-order-file')
  if (closed) await expect(orderFile).toBeEnabled()
  else await expect(orderFile).toBeDisabled()
  await expect(page.getByTestId('mizuho-closing-error')).toHaveCount(0)
}

/** 締めカードの操作（'close' / 'reopen'）を確認ダイアログまで通し、応答と画面の切り替わりを見る */
async function operateClosing(page, action) {
  const spec = CLOSING[action]
  await page.getByTestId(spec.button).click()
  await expect(page.getByRole('dialog')).toBeVisible()

  const response = waitForApi(page, spec.apiPath, () => true, 'POST')
  await page.getByTestId('mizuho-closing-dialog-submit').click()
  const res = await response
  const body = await logExchange(`MZR-02 ${action}`, res)
  expect(res.status(), `実 API が ${action} を受理しない: ${body}`).toBe(200)

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expectClosingCard(page, action === 'close')
  await expect(page.getByTestId('mizuho-operations-notice')).toContainText(spec.notice)
  // 操作の応答には 更新日時 / 実行者 が載るので、履歴の 1 行がこの操作で出る
  await expect(page.getByTestId('mizuho-closing-history-row')).toContainText(spec.historyAfter)
  return JSON.parse(body)
}

/** beforeAll で退避した 締め状態（0 / 1） */
let savedClosingState = null

// MZR-01 → MZR-02 は締め状態の退避・往復・復元が絡むので順に実行する
test.describe.configure({ mode: 'serial' })

test.describe('みずほ注文締（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test.beforeAll(async ({ playwright }) => {
    const api = await apiContext(playwright)
    const current = await fetchClosing(api)
    await api.dispose()
    savedClosingState = current.締め状態
    console.log(`[beforeAll] 退避した締め状態: ${JSON.stringify(current)}`)
  })

  test.afterAll(async ({ playwright }) => {
    if (savedClosingState === null) return
    const api = await apiContext(playwright)
    const latest = await fetchClosing(api)
    if (latest.締め状態 !== savedClosingState) {
      // MZR-02 が途中で落ちて往復しきれなかったときだけ、API を直接叩いて戻す
      const path = savedClosingState === 1 ? CLOSE_PATH : REOPEN_PATH
      const res = await api.post(path, { data: {} })
      const body = await res.text()
      console.log(`[afterAll] 復元 POST ${path} → ${res.status()} ${body}`)
      expect(res.ok(), `締め状態を戻せない: ${res.status()} ${body}`).toBe(true)
    }
    const after = await fetchClosing(api)
    await api.dispose()
    console.log(`[afterAll] 復元後の締め状態: ${after.締め状態}（退避値 ${savedClosingState}）`)
    expect(after.締め状態).toBe(savedClosingState)
  })

  test('[MZR-01] 開くと締め状態と route=0 の約定一覧が実 API から読まれ、件数・一覧・件数カードが食い違わない', async ({
    page,
  }) => {
    const { closing, body } = await openAndCapture(page)

    // 締めカードは応答の 締め状態（0 / 1）で語とボタンが決まる
    await expectClosingCard(page, closing.締め状態 === 1)
    await expect(page.getByTestId('mizuho-closing-empty')).toHaveCount(0)

    const total = await expectListConsistent(page, { pageSize: PAGE_SIZE })
    // 件数表示は応答の total、総約定件数は応答の summary から出る。同じ条件の値なので一致する
    expect(body.total).toBe(total)
    expect(await statValue(page, 'mizuho-summary-total')).toBe(total)
    const buy = await statValue(page, 'mizuho-summary-buy')
    const sell = await statValue(page, 'mizuho-summary-sell')
    expect(buy + sell).toBeLessThanOrEqual(total)
    // 一部出来は注文の件数（ExecutionSummary の 一部出来件数）。約定 1 行は注文 1 件以上に属するので総約定件数以下
    const partial = await statValue(page, 'mizuho-summary-partial')
    expect(partial).not.toBeNull()
    expect(partial).toBeGreaterThanOrEqual(0)
    expect(partial).toBeLessThanOrEqual(total)
  })

  test('[MZR-02] 締めと締め解除を往復すると実 API に受理され、実行前の状態に戻る', async ({
    page,
    playwright,
  }) => {
    // 画面の読み込みと POST 2 回の往復が重なるので既定の 30 秒では足りないことがある
    test.setTimeout(60_000)

    const { closing } = await openAndCapture(page)
    const startedClosed = closing.締め状態 === 1
    expect(closing.締め状態, '退避した締め状態と開いた時点の締め状態が違う').toBe(savedClosingState)

    // 受付中なら 締め → 解除、締め済なら 解除 → 締め。どちらでも実行前の状態に戻る
    const steps = startedClosed ? ['reopen', 'close'] : ['close', 'reopen']
    for (const action of steps) {
      const result = await operateClosing(page, action)
      expect(result.締め状態).toBe(action === 'close' ? 1 : 0)
    }

    // 再読み込みしても実行前の状態のまま
    await page.reload()
    await settleClosing(page)
    await expectClosingCard(page, startedClosed)

    // API を直接引いても実行前の値
    const api = await apiContext(playwright)
    const now = await fetchClosing(api)
    await api.dispose()
    console.log(`[MZR-02] 往復後の締め状態: ${JSON.stringify(now)}`)
    expect(now.締め状態).toBe(savedClosingState)
  })

  test('[MZR-03] 「CSV出力」で route=0 の条件なしの全件が BOM 付きで保存され、行数が件数と合う', async ({
    page,
  }) => {
    const { total } = await openOrSkip(page)
    test.skip(total > CSV_LIMIT, `約定が ${total} 件で CSV の上限（${CSV_LIMIT} 件）を超える`)

    const file = await download(page)

    expect(isUnfilteredMizuho(file.url), '条件なしの CSV 出力に route=0 以外のクエリが載っている').toBe(
      true,
    )
    expect(file.name).toBe(CSV_FILENAME)
    expect(file.text.startsWith(BOM)).toBe(true)

    const [header, ...data] = parseCsv(file.text)
    expect(header.length).toBeGreaterThan(0)
    expect(data).toHaveLength(total)

    // 列の並びはバックエンドが決める。約定日時の列があれば昇順（openapi.json の説明「約定日時昇順」）
    const at = header.indexOf('約定日時')
    if (at >= 0) {
      const values = data.map((row) => row[at])
      expect(values).toEqual([...values].sort())
    }
  })

  test('[MZR-04] 売買区分で絞り込むと、実 API へコードで送られ、件数カードと同じ件数が出る', async ({
    page,
  }) => {
    await openAndCapture(page)

    const picked = await pickSide(page)
    test.skip(!picked, '売り約定・買い約定がどちらも 0 件')
    const { side, expected } = picked

    await page.getByTestId('mizuho-executions-side').selectOption({ label: SIDES[side].option })
    await submit(page, waitForList(page, 'side', SIDES[side].code))

    // この画面は URL も実 API も同じコード（side=1 / 3）
    expect(urlQuery(page, 'side')).toBe(SIDES[side].code)
    await expect(page.getByTestId('mizuho-executions-count')).toHaveText(`${expected} 件`)
    expect(await statValue(page, 'mizuho-summary-total')).toBe(expected)
    const shown = Math.min(expected, PAGE_SIZE)
    // クエリが黙って無視されていれば反対の売買が混ざる
    await expect(columnOf(page, '売買')).toHaveText(Array(shown).fill(SIDES[side].cell))
  })

  test('[MZR-05] 1 行目の銘柄で絞り込むと、その銘柄の約定だけが出る', async ({ page }) => {
    const { total } = await openOrSkip(page)

    const symbol = ((await columnOf(page, '銘柄').first().textContent()) ?? '').trim()
    test.skip(symbol === '' || symbol === EMPTY_CELL, '1 行目の銘柄が空')

    await page.getByTestId('mizuho-executions-symbol').fill(symbol)
    await submit(page, waitForList(page, 'symbol', symbol))

    expect(urlQuery(page, 'symbol')).toBe(symbol)
    const { shown } = await expectNarrowed(page, total)
    // 銘柄の列はティッカー（無ければ銘柄コード）。symbol は銘柄コードか Ticker の一致
    await expect(columnOf(page, '銘柄')).toHaveText(Array(shown).fill(symbol))
  })

  test('[MZR-06] 先頭の約定の出来状況で絞り込むと、その出来状況の約定だけが出る', async ({
    page,
  }) => {
    const { total, first } = await openOrSkip(page)

    const code = String(first.処理状況 ?? '')
    // 選択肢はコードマスタ `約定出来状況`（契約提案）から来る。実 API に無ければ選べない
    const select = page.getByTestId('mizuho-executions-fill-status')
    const options = await select.locator('option').evaluateAll((els) => els.map((el) => el.value))
    test.skip(code === '' || !options.includes(code), `出来状況のプルダウンに ${code} が無い`)
    const expectedLabel = STATUS_LABELS[code] ?? (first.処理状況名 || EMPTY_CELL)

    await select.selectOption(code)
    await submit(page, waitForList(page, 'status', code))

    expect(urlQuery(page, 'status')).toBe(code)
    const { shown } = await expectNarrowed(page, total)
    await expect(columnOf(page, '出来状況')).toHaveText(Array(shown).fill(expectedLabel))
  })

  test('[MZR-07] 先頭の約定の約定日で期間を絞ると、実 API へ start_date / end_date が送られる', async ({
    page,
  }) => {
    const { total, first } = await openOrSkip(page)

    const date = /^\d{4}-\d{2}-\d{2}/.exec(String(first.約定日時 ?? ''))?.[0]
    test.skip(!date, `先頭の約定の約定日時が YYYY-MM-DD で始まらない（${first.約定日時}）`)

    await page.getByTestId('mizuho-executions-date-from').fill(date)
    await page.getByTestId('mizuho-executions-date-to').fill(date)
    await submit(
      page,
      waitForApi(
        page,
        EXECUTIONS_PATH,
        (url) => url.searchParams.get('start_date') === date && url.searchParams.get('end_date') === date,
      ),
    )

    // URL は date_from / date_to、実 API へは start_date / end_date（変換は api 層）
    expect(urlQuery(page, 'date_from')).toBe(date)
    expect(urlQuery(page, 'date_to')).toBe(date)
    // 約定日時の列は「MM/DD HH:mm」で年が無いので、行の中身は見ない
    await expectNarrowed(page, total)
  })

  test('[MZR-08] 先頭の約定の部店で絞り込むと、実 API へ branch_code が送られ、エラーにならない', async ({
    page,
  }) => {
    const { total, first } = await openOrSkip(page)

    const branchCode = String(first.部店 ?? '')
    test.skip(branchCode === '', '先頭の約定の部店が空')

    await page.getByTestId('mizuho-executions-branch-code').fill(branchCode)
    await submit(page, waitForList(page, 'branch_code', branchCode))

    expect(urlQuery(page, 'branch_code')).toBe(branchCode)
    // 表に部店の列は無いので、件数と食い違いだけを見る（他店の指定は 403 になるが、見えている約定の部店なので通る）
    await expectNarrowed(page, total)
  })

  test('[MZR-09] 絞り込んだあと「クリア」で条件なしの一覧に戻る', async ({ page }) => {
    const { total } = await openAndCapture(page)

    const picked = await pickSide(page)
    test.skip(!picked, '売り約定・買い約定がどちらも 0 件')
    const { side } = picked

    await page.getByTestId('mizuho-executions-side').selectOption({ label: SIDES[side].option })
    await submit(page, waitForList(page, 'side', SIDES[side].code))

    const response = waitForApi(page, EXECUTIONS_PATH, isUnfilteredMizuho)
    await page.getByTestId('mizuho-executions-search-clear').click()
    expect((await response).ok()).toBe(true)
    await settleList(page)

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('mizuho-executions-count')).toHaveText(`${total} 件`)
    await expect(page.getByTestId('mizuho-executions-side')).toHaveValue('')
  })

  test('[MZR-10] 51 件以上あるとき「次のページ」で 2 ページ目が実 API から読まれる', async ({
    page,
  }) => {
    const { total } = await openAndCapture(page)
    test.skip(total <= PAGE_SIZE, `約定が ${total} 件で 2 ページ目が無い`)

    const response = waitForList(page, 'offset', String(PAGE_SIZE))
    await page
      .getByTestId('mizuho-executions-pagination')
      .getByRole('button', { name: '次のページ' })
      .click()
    expect((await response).ok()).toBe(true)
    await settleList(page)

    expect(urlQuery(page, 'offset')).toBe(String(PAGE_SIZE))
    await expect(page.getByTestId('mizuho-executions-count')).toHaveText(`${total} 件`)
    await expect(rowsOf(page)).toHaveCount(Math.min(total - PAGE_SIZE, PAGE_SIZE))
  })

  test('[MZR-11] 1 行目の銘柄で絞り込んだ「CSV出力」は、同じ条件で一覧と同じ行数になる', async ({
    page,
  }) => {
    await openOrSkip(page)

    const symbol = ((await columnOf(page, '銘柄').first().textContent()) ?? '').trim()
    test.skip(symbol === '' || symbol === EMPTY_CELL, '1 行目の銘柄が空')

    await page.getByTestId('mizuho-executions-symbol').fill(symbol)
    await submit(page, waitForList(page, 'symbol', symbol))
    const filtered = await countOf(page)
    expect(filtered).toBeGreaterThan(0)

    const file = await download(page)

    // 一覧と同じ条件で送られる（ストアが最後に読んだ条件 + route=0）
    expect(file.url.searchParams.get('route')).toBe(MIZUHO_ROUTE)
    expect(file.url.searchParams.get('symbol')).toBe(symbol)
    const [header, ...data] = parseCsv(file.text)
    expect(data).toHaveLength(filtered)

    const codeAt = header.indexOf('銘柄コード')
    const tickerAt = header.indexOf('Ticker')
    if (codeAt >= 0 || tickerAt >= 0) {
      for (const row of data) {
        expect([row[codeAt], row[tickerAt]], `CSV に ${symbol} 以外の行がある`).toContain(symbol)
      }
    }
  })
})
