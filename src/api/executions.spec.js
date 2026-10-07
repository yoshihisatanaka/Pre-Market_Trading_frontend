import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { executions } from '@/mocks/fixtures/executions'
import {
  EXECUTIONS_CSV_FILENAME,
  exportExecutionsCsv,
  fetchExecutions,
  toStatusQuery,
} from './executions'

/** 取消済の選択肢のコード（コードマスタ 約定出来状況）と、status に載せる値（取消済の 2 コード） */
const CANCELED = '034'
const CANCELED_QUERY = '032,034'

/*
 * API 層のテスト。ここだけが「バックエンドの形」を知ってよい層なので、
 * 送り出すクエリの形と、受け取った生データ（日本語キー・コード値・integer の ID）の変換を守る。
 * パス・クエリ名が仕様に在るかは契約テスト（src/api/contract.spec.js）が見る。
 *
 * 期待値はフィクスチャから導き、件数や値を直接書かない。
 */

/** 実 API と同じ並び（約定日時の降順。同じ日時なら ID の降順）。フィクスチャは生成順のまま */
const sortedDesc = [...executions].sort(
  (a, b) => b.約定日時.localeCompare(a.約定日時) || b.ID - a.ID,
)
const newest = sortedDesc[0]

/** 最後に届いたリクエストを覚えておくための入れ物 */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

/**
 * 既定ハンドラの前に立ち、リクエストを記録して指定の本文を返す。
 *
 * @param {unknown} body 返す本文
 */
function record(body) {
  server.use(
    http.get('*/api/executions', ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams }
      return HttpResponse.json(body)
    }),
  )
}

/** 既定ハンドラに当てたまま、届いたリクエストだけを記録する */
function spyDefault() {
  server.events.on('request:start', listener)
}

function listener({ request }) {
  const url = new URL(request.url)
  if (url.pathname === '/api/executions') lastRequest = { url, params: url.searchParams }
}

/** CSV 出力に最後に届いたリクエスト */
let lastExportRequest = null

afterEach(() => {
  server.events.removeListener('request:start', listener)
  server.events.removeListener('request:start', exportListener)
  lastExportRequest = null
})

/** 既定ハンドラに当てたまま、届いた /executions/export-csv のリクエストだけを記録する */
function spyExport() {
  server.events.on('request:start', exportListener)
}

function exportListener({ request }) {
  const url = new URL(request.url)
  if (url.pathname === '/api/executions/export-csv') {
    lastExportRequest = { url, params: url.searchParams }
  }
}

/**
 * CSV 出力の応答を差し替える（本文は短い CSV、ヘッダは指定のもの）。
 *
 * @param {Record<string, string>} headers 応答ヘッダ
 */
function respondCsv(headers) {
  server.use(
    http.get(
      '*/api/executions/export-csv',
      () =>
        new HttpResponse('a,b\r\n1,2\r\n', {
          headers: { 'Content-Type': 'text/csv; charset=utf-8', ...headers },
        }),
    ),
  )
}

/** jsdom の Blob をバイト列で読む（文字列で読むとデコード時に BOM が落ちる） */
const readBytes = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })

/** 指定の行だけを返す一覧の本文 */
const listBody = (rows, summary) => ({
  total: rows.length,
  limit: 50,
  offset: 0,
  ...(summary === undefined ? {} : { summary }),
  executions: rows,
})

// シナリオ: docs/unit/api-executions.md
describe('api/executions', () => {
  it('[EXA-01] 一覧・件数・集計を返し、1 件のキーはすべて camelCase になる', async () => {
    const result = await fetchExecutions()

    expect(Object.keys(result).sort()).toEqual(['items', 'summary', 'total'])
    expect(result.total).toBe(executions.length)

    const [first] = result.items
    for (const key of Object.keys(first)) {
      expect(key).toMatch(/^[a-z][A-Za-z]*$/)
    }
    // 日本語キーの値が、対応する camelCase のキーへ移っている
    expect(first.quantity).toBe(newest.約定数量)
    expect(first.amountUsd).toBe(newest.約定代金)
    expect(first.orderQuantity).toBe(newest.注文数量)
    expect(first.price).toBe(newest.約定単価)
    expect(first.executedAt).toBe(newest.約定日時)
    expect(first.branchCode).toBe(newest.部店)
    expect(first.branchName).toBe(newest.部店名)
    expect(first.customerName).toBe(newest.顧客名)
    expect(first.symbolCode).toBe(newest.銘柄コード)
    expect(first.ticker).toBe(newest.Ticker)
    expect(first.symbolName).toBe(newest.銘柄名)
    expect(first.route).toBe(newest.注文ルート)
    expect(first.routeName).toBe(newest.注文ルート名)
    expect(first.status).toBe(newest.処理状況)
    expect(first.statusName).toBe(newest.処理状況名)
  })

  it('[EXA-02] 空文字の条件はクエリに載せない', async () => {
    spyDefault()

    await fetchExecutions({
      branchCode: '',
      symbol: '',
      side: '',
      status: '',
      dateFrom: '',
      dateTo: '',
      route: '',
    })

    for (const key of [
      'branch_code',
      'symbol',
      'side',
      'status',
      'start_date',
      'end_date',
      'route',
    ]) {
      expect(lastRequest.params.has(key)).toBe(false)
    }
  })

  it('[EXA-03] 各条件は仕様のクエリ名で送る', async () => {
    record(listBody([]))

    await fetchExecutions({
      branchCode: newest.部店,
      symbol: newest.Ticker,
      status: newest.処理状況,
      dateFrom: '2026-09-24',
      dateTo: '2026-09-28',
      route: newest.注文ルート,
    })

    expect(lastRequest.params.get('branch_code')).toBe(newest.部店)
    expect(lastRequest.params.get('symbol')).toBe(newest.Ticker)
    expect(lastRequest.params.get('status')).toBe(newest.処理状況)
    expect(lastRequest.params.get('start_date')).toBe('2026-09-24')
    expect(lastRequest.params.get('end_date')).toBe('2026-09-28')
    expect(lastRequest.params.get('route')).toBe(newest.注文ルート)
    // アプリ内の名前やレスポンスの日本語キーでは送らない
    expect(lastRequest.params.has('branchCode')).toBe(false)
    expect(lastRequest.params.has('dateFrom')).toBe(false)
    expect(lastRequest.params.has('部店')).toBe(false)
  })

  it('[EXA-04] 売買区分はコードに直して送り、知らない値は送らない', async () => {
    record(listBody([]))

    await fetchExecutions({ side: 'buy' })
    expect(lastRequest.params.get('side')).toBe('3')

    await fetchExecutions({ side: 'sell' })
    expect(lastRequest.params.get('side')).toBe('1')

    await fetchExecutions({ side: 'x' })
    expect(lastRequest.params.has('side')).toBe(false)
  })

  it('[EXA-05] 応答の売買区分のコードをアプリ内の向きに直す', async () => {
    record(
      listBody([
        { ...newest, ID: 1, 売買区分: '3' },
        { ...newest, ID: 2, 売買区分: '1' },
        { ...newest, ID: 3, 売買区分: '9' },
      ]),
    )

    const { items } = await fetchExecutions()

    // 知らないコードをどちらかに丸めると、買いと売りを取り違える
    expect(items.map((item) => item.side)).toEqual(['buy', 'sell', ''])
  })

  it('[EXA-06] nullable の文字列は空文字、数値は null のまま通す', async () => {
    record(listBody([{ ...newest, 顧客名: null, Ticker: null, 約定単価: null, 約定日時: null }]))

    const { items } = await fetchExecutions()

    expect(items[0]).toMatchObject({ customerName: '', ticker: '', executedAt: '' })
    // 0 に寄せると「未取得」と「0」が区別できなくなる
    expect(items[0].price).toBeNull()
  })

  it('[EXA-07] integer の ID・注文ID・口座番号は文字列になる', async () => {
    const { items } = await fetchExecutions()

    expect(items[0].id).toBe(String(newest.ID))
    expect(items[0].orderId).toBe(String(newest.注文ID))
    expect(items[0].accountNumber).toBe(String(newest.口座番号))
    expect(typeof items[0].id).toBe('string')
    expect(typeof items[0].orderId).toBe('string')
    expect(typeof items[0].accountNumber).toBe('string')
  })

  it('[EXA-08] 集計をアプリ内モデルに変換し、欠けていれば全項目 0 にする', async () => {
    const sells = executions.filter((row) => row.売買区分 === '1')
    const buys = executions.filter((row) => row.売買区分 === '3')
    // 一部出来は約定の行数ではなく注文の件数（処理状況 010 の注文 ID の数）
    const partialOrders = new Set(
      executions.filter((row) => row.処理状況 === '010').map((row) => row.注文ID),
    )

    const { summary } = await fetchExecutions()

    expect(Object.keys(summary).sort()).toEqual(
      [
        'count',
        'orderCount',
        'buyCount',
        'sellCount',
        'partialCount',
        'totalQuantity',
        'totalAmountUsd',
        'totalFeeUsd',
      ].sort(),
    )
    expect(summary.count).toBe(executions.length)
    expect(summary.orderCount).toBe(new Set(executions.map((row) => row.注文ID)).size)
    expect(summary.buyCount).toBe(buys.length)
    expect(summary.sellCount).toBe(sells.length)
    expect(summary.partialCount).toBe(partialOrders.size)
    expect(summary.totalQuantity).toBe(executions.reduce((sum, row) => sum + row.約定数量, 0))
    expect(summary.totalAmountUsd).toBeCloseTo(
      executions.reduce((sum, row) => sum + row.約定代金, 0),
      2,
    )
    expect(summary.totalFeeUsd).toBeCloseTo(
      executions.reduce((sum, row) => sum + row.手数料, 0),
      2,
    )

    // summary を持たない応答
    record(listBody([newest]))
    const missing = await fetchExecutions()

    expect(missing.summary).toEqual({
      count: 0,
      orderCount: 0,
      buyCount: 0,
      sellCount: 0,
      partialCount: 0,
      totalQuantity: 0,
      totalAmountUsd: 0,
      totalFeeUsd: 0,
    })
  })

  it('[EXA-09] CSV 出力は一覧と同じクエリ名で送り、limit / offset は送らない', async () => {
    spyExport()

    await exportExecutionsCsv({
      branchCode: newest.部店,
      symbol: newest.Ticker,
      side: 'buy',
      status: newest.処理状況,
      dateFrom: '2026-09-24',
      dateTo: '2026-09-28',
      route: newest.注文ルート,
    })

    expect(lastExportRequest.url.pathname).toBe('/api/executions/export-csv')
    expect(lastExportRequest.params.get('branch_code')).toBe(newest.部店)
    expect(lastExportRequest.params.get('symbol')).toBe(newest.Ticker)
    expect(lastExportRequest.params.get('side')).toBe('3')
    expect(lastExportRequest.params.get('status')).toBe(newest.処理状況)
    expect(lastExportRequest.params.get('start_date')).toBe('2026-09-24')
    expect(lastExportRequest.params.get('end_date')).toBe('2026-09-28')
    expect(lastExportRequest.params.get('route')).toBe(newest.注文ルート)
    // ページ位置は無い（条件に合う全件を落とす）
    expect(lastExportRequest.params.has('limit')).toBe(false)
    expect(lastExportRequest.params.has('offset')).toBe(false)
  })

  it('[EXA-10] CSV 出力でも空文字の条件と知らない売買区分は送らない', async () => {
    spyExport()

    await exportExecutionsCsv({
      branchCode: '',
      symbol: '',
      side: 'x',
      status: '',
      dateFrom: '',
      dateTo: '',
      route: '',
    })

    expect([...lastExportRequest.params.keys()]).toEqual([])
  })

  it('[EXA-11] 本文は文字列にせず Blob のまま返り、条件に合う全件が入る', async () => {
    const { blob } = await exportExecutionsCsv()

    expect(Object.prototype.toString.call(blob)).toBe('[object Blob]')
    const bytes = await readBytes(blob)

    // 見出し 1 行 + 全件（一覧の既定 limit で切られない）
    const lines = new TextDecoder().decode(bytes).split('\r\n').filter(Boolean)
    expect(lines).toHaveLength(executions.length + 1)
  })

  it("[EXA-12] Content-Disposition の filename*=UTF-8'' を filename= より優先してデコードする", async () => {
    const NAME = '約定一覧_20260929.csv'
    respondCsv({
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(NAME)}; filename="fallback.csv"`,
    })

    const { filename } = await exportExecutionsCsv()

    expect(filename).toBe(NAME)
  })

  it('[EXA-13] 引用符つきの filename="…" は中身をそのまま使う', async () => {
    const NAME = 'executions 2026-09-29.csv'
    respondCsv({ 'Content-Disposition': `attachment; filename="${NAME}"` })

    const { filename } = await exportExecutionsCsv()

    expect(filename).toBe(NAME)
  })

  it('[EXA-14] 引用符なしの filename=… はその値を使う', async () => {
    const NAME = 'executions_20260929.csv'
    expect(NAME).not.toBe(EXECUTIONS_CSV_FILENAME)
    respondCsv({ 'Content-Disposition': `attachment; filename=${NAME}` })

    const { filename } = await exportExecutionsCsv()

    expect(filename).toBe(NAME)
  })

  it('[EXA-15] Content-Disposition が無ければ既定のファイル名にする', async () => {
    respondCsv({})

    const { filename } = await exportExecutionsCsv()

    expect(filename).toBe(EXECUTIONS_CSV_FILENAME)
  })

  it('[EXA-16] filename* のエンコードが壊れていれば filename="…" の値を使う', async () => {
    const NAME = 'fallback.csv'
    respondCsv({
      'Content-Disposition': `attachment; filename*=UTF-8''%E7%B4%; filename="${NAME}"`,
    })

    const { filename } = await exportExecutionsCsv()

    expect(filename).toBe(NAME)
  })

  it('[EXA-18] toStatusQuery は取消済（034）だけを 032,034 に広げ、空は送らない', () => {
    expect(toStatusQuery(CANCELED)).toBe(CANCELED_QUERY)
    expect(toStatusQuery('011')).toBe('011')
    expect(toStatusQuery('010')).toBe('010')
    expect(toStatusQuery('')).toBeUndefined()
    expect(toStatusQuery(undefined)).toBeUndefined()
  })

  it('[EXA-19] 取消済で絞ると status=032,034 を送り、一覧にも CSV にも 032 と 034 の行が入る', async () => {
    const canceled = executions.filter((row) => ['032', '034'].includes(row.処理状況))
    // 032 の行が混ざっていないと「広げた」ことを確かめられない
    expect(canceled.some((row) => row.処理状況 === '032')).toBe(true)
    spyDefault()
    spyExport()

    const { items, total } = await fetchExecutions({ status: CANCELED })
    expect(lastRequest.params.get('status')).toBe(CANCELED_QUERY)
    expect(total).toBe(canceled.length)
    expect(items.map((item) => item.id).sort()).toEqual(canceled.map((row) => String(row.ID)).sort())

    await exportExecutionsCsv({ status: CANCELED })
    expect(lastExportRequest.params.get('status')).toBe(CANCELED_QUERY)
  })

  it('[EXA-20] 約定代金_JPY は amountJpy になり、null（為替未登録）は null のまま', async () => {
    // フィクスチャには円貨のある行と、為替未登録（null）の行の両方がある
    const withJpy = sortedDesc.find((row) => row.約定代金_JPY !== null)
    const withoutJpy = sortedDesc.find((row) => row.約定代金_JPY === null)
    record(listBody([withJpy, withoutJpy]))

    const { items } = await fetchExecutions()

    expect(items[0].amountJpy).toBe(withJpy.約定代金_JPY)
    expect(items[1].amountJpy).toBeNull()
  })

  it('[EXA-21] 預託先が null の応答（預託先参照権限なし）でも route / routeName は空文字になる', async () => {
    record(listBody([{ ...newest, 注文ルート: null, 注文ルート名: null }]))

    const { items } = await fetchExecutions()

    expect(items).toHaveLength(1)
    expect(items[0].route).toBe('')
    expect(items[0].routeName).toBe('')
    expect(items[0].id).toBe(String(newest.ID))
  })

  it('[EXA-17] 本文先頭の UTF-8 BOM がバイト列のまま残る', async () => {
    const { blob } = await exportExecutionsCsv()

    const bytes = await readBytes(blob)
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  })
})
