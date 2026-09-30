import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { mizuhoExecutions } from '@/mocks/fixtures/mizuhoExecutions'
import { ApiError } from './client'
import { EXECUTIONS_CSV_FILENAME } from './executions'
import { exportMizuhoExecutionsCsv, fetchMizuhoExecutions } from './mizuhoExecutions'

/*
 * API 層のテスト。ここだけが「バックエンドの形」を知ってよい層なので、
 * 送り出すクエリの値と、生の形 → アプリ内モデルの変換を固定する。
 * 期待値はフィクスチャの先頭行から導く。
 */

/** 最後に届いたリクエストのクエリ */
let lastParams = null

afterEach(() => {
  lastParams = null
})

/**
 * リクエストを記録して、指定の本文を返すハンドラを立てる。
 *
 * @param {unknown} body 返す本文
 */
function record(body) {
  server.use(
    http.get('*/api/executions', ({ request }) => {
      lastParams = new URL(request.url).searchParams
      return HttpResponse.json(body)
    }),
  )
}

const head = mizuhoExecutions[0]

/** ExecutionsResponse の形。summary を渡さなければキーごと落とす */
const listBody = (rows, summary) => ({
  total: rows.length,
  limit: 50,
  offset: 0,
  executions: rows,
  ...(summary ? { summary } : {}),
})

const emptySummary = { 件数: 0, 買件数: 0, 売件数: 0 }

const EXPORT_PATH = '*/api/executions/export-csv'
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** CSV 出力に最後に届いたクエリ */
let lastExportParams = null

afterEach(() => {
  lastExportParams = null
})

/** 既定ハンドラの前に立ち、クエリだけ記録して既定ハンドラへ落とす */
function recordExport() {
  server.use(
    http.get(EXPORT_PATH, ({ request }) => {
      lastExportParams = new URL(request.url).searchParams
    }),
  )
}

/**
 * CSV 出力の応答を差し替える（本文は短い CSV、ヘッダは指定のもの）。
 *
 * @param {Record<string, string>} headers 応答ヘッダ
 */
function respondCsv(headers) {
  server.use(
    http.get(
      EXPORT_PATH,
      () =>
        new HttpResponse('a,b\r\n1,2\r\n', {
          headers: { 'Content-Type': 'text/csv; charset=utf-8', ...headers },
        }),
    ),
  )
}

/** jsdom の Blob を文字列で読む */
const readText = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new TextDecoder().decode(new Uint8Array(reader.result)))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })

// シナリオ: docs/unit/api-mizuho-executions.md
describe('api/mizuhoExecutions', () => {
  it('[MZE-01] 既定モックの応答を { items, total, summary } の camelCase に変換する', async () => {
    const result = await fetchMizuhoExecutions()

    expect(Object.keys(result).sort()).toEqual(['items', 'summary', 'total'])
    expect(result.total).toBe(mizuhoExecutions.length)
    const first = result.items[0]
    // キーはすべて ASCII の camelCase（日本語や snake_case を外へ漏らさない）
    Object.keys(first).forEach((key) => {
      expect(key).toMatch(/^[a-z][a-zA-Z]*$/)
    })
    expect(first).toMatchObject({
      id: String(head.ID),
      quantity: head.注文数量,
      executedPrice: head.約定単価,
    })
    expect(typeof first.id).toBe('string')
  })

  it('[MZE-02] 条件なしでも route=0 を送り、空文字の条件はクエリに載せない', async () => {
    record(listBody([], emptySummary))

    await fetchMizuhoExecutions({
      branchCode: '',
      symbol: '',
      side: '',
      fillStatus: '',
      dateFrom: '',
      dateTo: '',
    })

    expect(lastParams.get('route')).toBe('0')
    expect([...lastParams.keys()].sort()).toEqual(['limit', 'offset', 'route'])
  })

  it('[MZE-03] 約定日の範囲は start_date / end_date にそのまま送る', async () => {
    record(listBody([], emptySummary))

    await fetchMizuhoExecutions({ dateFrom: '2026-09-01', dateTo: '2026-09-30' })

    expect(lastParams.get('start_date')).toBe('2026-09-01')
    expect(lastParams.get('end_date')).toBe('2026-09-30')
  })

  it('[MZE-04] 知らない売買区分は side を送らず、1 / 3 だけ送る', async () => {
    record(listBody([], emptySummary))
    await fetchMizuhoExecutions({ side: '9' })
    expect(lastParams.has('side')).toBe(false)

    for (const side of ['1', '3']) {
      record(listBody([], emptySummary))
      await fetchMizuhoExecutions({ side })
      expect(lastParams.get('side')).toBe(side)
    }
  })

  it('[MZE-05] 出来状況の区分を処理状況コードに直して送り、取消済（出来有）は送らない', async () => {
    const sent = {}
    for (const fillStatus of ['filled', 'partial', 'canceled_filled']) {
      record(listBody([], emptySummary))
      await fetchMizuhoExecutions({ fillStatus })
      sent[fillStatus] = lastParams.get('status')
    }

    expect(sent).toEqual({ filled: '011', partial: '010', canceled_filled: null })
  })

  it('[MZE-06] 売買区分 3 / 1 / 未知 は buy / sell / 空文字 になる', async () => {
    record(
      listBody([
        { ...head, ID: 1, 売買区分: '3' },
        { ...head, ID: 2, 売買区分: '1' },
        { ...head, ID: 3, 売買区分: '9' },
      ]),
    )

    const { items } = await fetchMizuhoExecutions()

    expect(items.map((item) => item.side)).toEqual(['buy', 'sell', ''])
  })

  it('[MZE-07] 処理状況コードを出来状況の区分に寄せ、statusName はサーバの名称のまま', async () => {
    const codes = ['011', '010', '032', '034', '999']
    record(
      listBody(
        codes.map((code, index) => ({
          ...head,
          ID: index + 1,
          処理状況: code,
          処理状況名: `名称${code}`,
        })),
      ),
    )

    const { items } = await fetchMizuhoExecutions()

    expect(items.map((item) => item.fillStatus)).toEqual([
      'filled',
      'partial',
      'canceled_filled',
      'canceled_filled',
      '',
    ])
    expect(items.map((item) => item.statusName)).toEqual(codes.map((code) => `名称${code}`))
  })

  it('[MZE-08] Ticker が null なら symbol は銘柄コードになる', async () => {
    record(listBody([{ ...head, Ticker: null, 銘柄コード: 'CODE1' }]))

    const { items } = await fetchMizuhoExecutions()

    expect(items[0].symbol).toBe('CODE1')
  })

  it('[MZE-09] 約定単価が null なら executedPrice は null のまま（0 に潰さない）', async () => {
    record(listBody([{ ...head, 約定単価: null }]))

    const { items } = await fetchMizuhoExecutions()

    expect(items[0].executedPrice).toBeNull()
  })

  it('[MZE-10] summary が欠けた応答でも件数 0 の集計として扱う', async () => {
    record(listBody([head]))

    const { summary } = await fetchMizuhoExecutions()

    expect(summary).toEqual({ executionCount: 0, buyCount: 0, sellCount: 0 })
  })

  it('[MZE-11] CSV 出力は一覧と同じクエリに route=0 を載せ、limit / offset は送らない', async () => {
    recordExport()

    await exportMizuhoExecutionsCsv({
      branchCode: head.部店,
      symbol: head.Ticker,
      side: '1',
      fillStatus: 'filled',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    })

    expect(lastExportParams.get('route')).toBe('0')
    expect(lastExportParams.get('branch_code')).toBe(head.部店)
    expect(lastExportParams.get('symbol')).toBe(head.Ticker)
    expect(lastExportParams.get('side')).toBe('1')
    expect(lastExportParams.get('status')).toBe('011')
    expect(lastExportParams.get('start_date')).toBe('2026-09-01')
    expect(lastExportParams.get('end_date')).toBe('2026-09-30')
    expect(lastExportParams.has('limit')).toBe(false)
    expect(lastExportParams.has('offset')).toBe(false)
  })

  it('[MZE-12] 条件なしの CSV 出力は route=0 だけを送る', async () => {
    recordExport()

    await exportMizuhoExecutionsCsv()

    expect([...lastExportParams.keys()]).toEqual(['route'])
    expect(lastExportParams.get('route')).toBe('0')
  })

  it('[MZE-13] 本文は Blob で返り、みずほの約定の全件と応答のファイル名が入る', async () => {
    const NAME = 'mizuho_executions_test.csv'
    expect(NAME).not.toBe(EXECUTIONS_CSV_FILENAME)
    // 本文は既定ハンドラ（みずほの全件。一覧の既定 limit で切られない）
    const { blob } = await exportMizuhoExecutionsCsv()

    expect(Object.prototype.toString.call(blob)).toBe('[object Blob]')
    const lines = (await readText(blob)).split('\r\n').filter(Boolean)
    expect(lines).toHaveLength(mizuhoExecutions.length + 1)

    // ファイル名は既定名と見分けられる名前を返させて確かめる
    respondCsv({ 'Content-Disposition': `attachment; filename=${NAME}` })
    const { filename } = await exportMizuhoExecutionsCsv()
    expect(filename).toBe(NAME)
  })

  it('[MZE-14] Content-Disposition が無ければ既定のファイル名にする', async () => {
    respondCsv({})

    const { filename } = await exportMizuhoExecutionsCsv()

    expect(filename).toBe(EXECUTIONS_CSV_FILENAME)
  })

  it('[MZE-15] 500 なら detail を message に持つ ApiError で reject する', async () => {
    server.use(
      http.get(EXPORT_PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
    )

    const error = await exportMizuhoExecutionsCsv().catch((reason) => reason)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toBe(ERROR_MESSAGE)
  })
})
