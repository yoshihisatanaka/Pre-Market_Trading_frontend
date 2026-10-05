import { expect, test } from '@playwright/test'
import { categoryLabel, categoryOf } from '../src/utils/activityLogTypes'

/*
 * 操作ログを「実 API に当てて」確かめる E2E（スモーク 2 本）。
 * シナリオ: docs/e2e/activity-logs-real-api.md（タイトル先頭の [ALR-xx] が対応 ID）
 *
 * activity-logs.spec.js（AL）とは目的が違う。AL は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせだけを見るので、
 * 期待値に**データの中身を書かない**（件数・対象種別・操作区分は実行時に API から読む）。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test activity-logs.real-api
 *
 * 操作ログは参照専用の画面なので、このファイルは実 DB に書き込まない（GET だけ）。
 */

const PATH = '/operations/activity-logs'

// src/stores/activityLogs.js の ACTIVITY_LOGS_PAGE_SIZE と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

/**
 * 画面の「操作内容」で選べる操作区分（実 API の operation クエリ。/codes の 操作区分 と同じ 9 種）。
 * 検索の前提を探す順。先頭の 4 種はマスタの行、後ろの 5 種は運用管理・VWAP の行に付く
 */
const OPERATIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'BATCH',
  'SUSPEND',
  'RESUME',
  'SHOW',
  'HIDE',
  'VWAP_BULK',
]

/** 列の並び（activity-logs.spec.js の COLUMNS と同じ）。セルを列名で引く索引 */
const COLUMNS = ['操作日時', '操作区分', '操作者', '対象機能・操作', '対象キー', '変更項目', '']

/** 実 API を直接叩く宛先。dev サーバの /api プロキシ越しに実 API へ届く */
const baseURL = process.env.E2E_BASE_URL || 'http://frontend:5173'

/** 実 API を直接叩くためのコンテキスト。beforeAll で作り afterAll で捨てる */
let api = null

/** 実 API を見ているかを確かめる。MSW はサービスワーカーで横取りするので、それで判別できる */
async function assertRealApi(page) {
  const mswActive = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller))
  expect(
    mswActive,
    'MSW が有効なままなので実 API を見ていない。VITE_ENABLE_MSW を false にして frontend を作り直すこと',
  ).toBe(false)
}

/** GET して JSON を返す。失敗したら理由付きで落とす */
async function getJson(path, params = {}) {
  const res = await api.get(path, { params })
  expect(
    res.ok(),
    `実 API の ${path} が失敗した: ${res.status()} ${await res.text()}（api コンテナが動いているか確認する）`,
  ).toBe(true)
  return res.json()
}

/** 操作ログの total を API から直接引く（件数だけ欲しいので limit=1） */
async function apiTotalOf(params = {}) {
  const body = await getJson('/api/operations/activity-logs', { limit: 1, ...params })
  return body.total
}

/**
 * 取得が終わるのを待つ。
 *
 * 件数表示は取得中も出ていて、そのあいだは 0 件。先にローディングの消滅を待たないと 0 を掴む。
 */
async function settleList(page) {
  await expect(page.getByTestId('activity-logs-loading')).toHaveCount(0)
  await expect(page.getByTestId('activity-logs-error')).toHaveCount(0)
}

/** 一覧を開いて、実 API に当たっていることまで確認する */
async function openList(page) {
  await page.goto(PATH)
  // 画面の描画を待ってからローディングを見る（描画前はローディングも無いので素通りする）
  await expect(page.getByTestId('activity-logs-search')).toBeVisible()
  await settleList(page)
  await expect(page.getByTestId('activity-logs-count')).toBeVisible()
  await assertRealApi(page)
}

/** 「N 件」の表示から件数を読む */
async function countOf(page) {
  await settleList(page)
  const text = await page.getByTestId('activity-logs-count').textContent()
  return Number(text.replace(/[^0-9]/g, ''))
}

/** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function rowsOf(page) {
  return page.getByTestId('activity-logs-table').getByTestId('data-table-row')
}

/** 表の 1 列ぶんのセル（全行） */
function columnOf(page, column) {
  return page
    .getByTestId('activity-logs-table')
    .locator(`td:nth-child(${COLUMNS.indexOf(column) + 1})`)
}

test.describe('操作ログ（実 API 接続）', () => {
  test.skip(
    process.env.E2E_REAL_API !== '1',
    '実 API に当てるテスト。E2E_REAL_API=1 のときだけ実行する',
  )

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext({ baseURL })
  })

  test.afterAll(async () => {
    await api?.dispose()
  })

  test('[ALR-01] 実データで件数・行数・対象種別の選択肢が API と一致する', async ({ page }) => {
    await openList(page)

    const total = await apiTotalOf()
    const { targets } = await getJson('/api/operations/activity-logs/targets')

    // 件数表示は API の total と一致し、表は 1 ページ分（最大 PAGE_SIZE 行）
    await expect(page.getByTestId('activity-logs-count')).toHaveText(`${total} 件`)
    if (total === 0) {
      await expect(page.getByTestId('activity-logs-empty')).toBeVisible()
      await expect(page.getByTestId('activity-logs-table')).toBeHidden()
    } else {
      await expect(rowsOf(page)).toHaveCount(Math.min(total, PAGE_SIZE))
      await expect(page.getByTestId('activity-logs-empty')).toHaveCount(0)
    }

    // 対象機能の選択肢は API の件数 +「全て」
    const options = page.getByTestId('activity-logs-target-type').locator('option')
    await expect(options).toHaveCount(targets.length + 1)
    for (const target of targets) {
      await expect(options.filter({ hasText: target['対象種別名'] })).toHaveCount(1)
    }

    // 4 状態のうちローディング・エラーは残らない
    await expect(page.getByTestId('activity-logs-loading')).toHaveCount(0)
    await expect(page.getByTestId('activity-logs-error')).toHaveCount(0)
  })

  test('[ALR-02] 対象機能と操作内容で検索すると API と同じ件数に絞られる', async ({ page }) => {
    /*
     * 1 件以上ある「対象種別 × 操作区分」の組を API から探す（その組は必ず 1 件以上ある）。
     * 操作区分は画面の「操作内容」で選べる 9 種（= 実 API の operation クエリが受け付ける値。
     * 2026-10-05 の実測で SUSPEND なども 200 になった）。
     */
    // 操作区分ごとに最新の 1 行を引き、その行の対象種別と組にする（API 呼び出しは最大 9 回）
    let picked = null
    for (const operation of OPERATIONS) {
      const body = await getJson('/api/operations/activity-logs', { limit: 1, operation })
      const [row] = body.activity_logs ?? []
      if (row) {
        picked = {
          targetType: row['対象種別'],
          targetTypeName: row['対象種別名'],
          operation,
          operationText: row['操作内容'],
        }
        break
      }
    }
    test.skip(
      picked === null,
      '画面で選べる操作内容（CREATE … VWAP_BULK）の操作ログが 1 件も無いので絞り込みを確かめられない',
    )
    const { targetType, targetTypeName, operation, operationText } = picked

    await openList(page)
    const total = await countOf(page)

    await page.getByTestId('activity-logs-target-type').selectOption(targetType)
    await page.getByTestId('activity-logs-operation').selectOption(operation)
    await page.getByTestId('activity-logs-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`target_types=${targetType}`))
    await expect(page).toHaveURL(new RegExp(`operation=${operation}`))
    await settleList(page)

    const expected = await apiTotalOf({ target_types: targetType, operation })
    expect(expected).toBeGreaterThan(0)
    expect(expected).toBeLessThanOrEqual(total)
    await expect(page.getByTestId('activity-logs-count')).toHaveText(`${expected} 件`)

    // 表示行がすべて条件どおり。クエリ名が黙って無視されていれば他の種別・区分が混ざる。
    // 対象機能・操作のセルは「<対象機能>\n<操作内容>」、操作区分は対象種別から導いた区分（マスタ更新 / 運用管理）
    const shown = Math.min(expected, PAGE_SIZE)
    await expect(rowsOf(page)).toHaveCount(shown)
    await expect(columnOf(page, '対象機能・操作')).toHaveText(
      Array(shown).fill(new RegExp(`^${targetTypeName}[\\s\\S]*${operationText ?? ''}$`)),
    )
    await expect(columnOf(page, '操作区分')).toHaveText(
      Array(shown).fill(categoryLabel(categoryOf(targetType))),
    )
  })
})
