import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { orderCsvColumns } from '@/mocks/fixtures/orderCsv'
import { ApiError } from './client'
import { fetchOrderCsvSpec } from './orderCsv'

/*
 * API 層のテスト。CsvHeaderSpecResponse の生の形（列ごとに型が違う example / null の condition /
 * 順不同の列）がアプリ内モデルに揃うことを守る。
 */

const PATH = '*/api/orders/csv-spec'

/** 応答を差し替える（列だけ渡せば total_columns はその件数にする） */
function respondWithColumns(columns) {
  server.use(
    http.get(PATH, () => HttpResponse.json({ total_columns: columns.length, columns })),
  )
}

// 期待値はフィクスチャから導く（22 列・列名を直接書かない）
const byIndex = [...orderCsvColumns].sort((a, b) => a.index - b.index)
const withCondition = orderCsvColumns.filter((column) => column.condition)
const typesOfExample = new Set(orderCsvColumns.map((column) => typeof column.example))
const numericExample = orderCsvColumns.find((column) => typeof column.example === 'number')

// シナリオ: docs/unit/api-order-csv.md
describe('api/orderCsv', () => {
  it('[OCA-01] 既定モックの全列を 6 つのキーだけのアプリ内モデルで返す', async () => {
    const columns = await fetchOrderCsvSpec()

    expect(columns).toHaveLength(orderCsvColumns.length)
    for (const column of columns) {
      expect(Object.keys(column).sort()).toEqual(
        ['condition', 'description', 'example', 'index', 'name', 'required'].sort(),
      )
    }
    expect(columns.map((column) => column.name)).toEqual(byIndex.map((column) => column.name))
  })

  it('[OCA-02] 列が順不同で来ても index の昇順に並べ直す', async () => {
    respondWithColumns([...orderCsvColumns].reverse())

    const columns = await fetchOrderCsvSpec()

    expect(columns.map((column) => column.index)).toEqual(byIndex.map((column) => column.index))
    expect(columns.map((column) => column.name)).toEqual(byIndex.map((column) => column.name))
  })

  it('[OCA-03] 型の違う例をすべて文字列にする', async () => {
    // 前提: フィクスチャに string 以外の例が混ざっている
    expect(typesOfExample.size).toBeGreaterThan(1)

    const columns = await fetchOrderCsvSpec()

    for (const column of columns) {
      expect(typeof column.example).toBe('string')
    }
    const expected = byIndex.map((column) => String(column.example))
    expect(columns.map((column) => column.example)).toEqual(expected)
    const numeric = columns.find((column) => column.index === numericExample.index)
    expect(numeric.example).toBe(String(numericExample.example))
  })

  it('[OCA-04] 例が null の列と、例が無い列は空文字になる', async () => {
    const [first, second] = byIndex
    const withoutExample = { ...second }
    delete withoutExample.example
    respondWithColumns([{ ...first, example: null }, withoutExample])

    const columns = await fetchOrderCsvSpec()

    expect(columns.map((column) => column.example)).toEqual(['', ''])
  })

  it('[OCA-05] condition は文言があればそのまま、null は空文字になる', async () => {
    // 前提: condition を持つ列がフィクスチャにある
    expect(withCondition.length).toBeGreaterThan(0)

    const columns = await fetchOrderCsvSpec()

    for (const column of columns) {
      const raw = orderCsvColumns.find((item) => item.index === column.index)
      expect(column.condition).toBe(raw.condition ?? '')
    }
    const conditioned = columns.filter((column) => column.condition !== '')
    expect(conditioned.map((column) => column.name)).toEqual(
      withCondition.map((column) => column.name),
    )
  })

  it('[OCA-06] required は true のときだけ必須になる', async () => {
    const [base] = byIndex
    const withoutRequired = { ...base }
    delete withoutRequired.required
    respondWithColumns([
      { ...base, index: 1, required: false },
      { ...withoutRequired, index: 2 },
      { ...base, index: 3, required: 'true' },
      { ...base, index: 4, required: 1 },
      { ...base, index: 5, required: true },
    ])

    const columns = await fetchOrderCsvSpec()

    expect(columns.map((column) => column.required)).toEqual([false, false, false, false, true])
  })

  it('[OCA-07] columns が無い応答は空配列になる', async () => {
    server.use(http.get(PATH, () => HttpResponse.json({})))

    await expect(fetchOrderCsvSpec()).resolves.toEqual([])
  })

  it('[OCA-08] 500 は detail を message に持つ ApiError になる', async () => {
    const detail = 'サーバーでエラーが発生しました。'
    server.use(http.get(PATH, () => HttpResponse.json({ detail }, { status: 500 })))

    const error = await fetchOrderCsvSpec().catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toBe(detail)
  })
})
