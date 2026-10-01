import { expect } from '@playwright/test'

/*
 * 実 API に当てる E2E（e2e/*.real-api.spec.js）の共通部品。
 *
 * どの画面でも同じになる部分だけを置く。画面固有の操作（モーダルの開閉・入力・行の特定）は
 * 各 spec に残す。一覧の testid は `<接頭辞>-loading` / `-count` / `-table` / `-empty` /
 * `-error` / `-pagination` の命名で揃っている前提（src/components/masters の型に乗る画面はそうなる）。
 *
 * src/api/ や src/stores/ は import.meta.env を辿るので Playwright から import できない。
 * ページサイズなどの定数は spec 側で出典を書いて再掲する。
 */

// 誰が触ったかを実 DB に残す（実 API の更新系はこのヘッダが無いと弾かれるものがある）
export const USER_CODE = 'e2e'

// 実 API の一覧の limit の上限（マスタ系の GET は 1〜200）
export const API_LIMIT_MAX = 200

// 試験用のデータを置く年。実運用のデータと混ざらないよう遠い将来に寄せる
export const RESERVED_YEAR = 2035

/** describe の冒頭で呼ぶ。E2E_REAL_API=1 のときだけ実行する */
export function skipUnlessRealApi(test) {
  test.skip(
    process.env.E2E_REAL_API !== '1',
    '実 API に当てるテスト。E2E_REAL_API=1 のときだけ実行する',
  )
}

/** 下ごしらえ・後片付けで API を直接叩くための request context。使い終えたら dispose する */
export function apiContext(playwright, { userCode = USER_CODE } = {}) {
  return playwright.request.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://frontend:5173',
    extraHTTPHeaders: { 'X-User-Code': userCode },
  })
}

/** 実 API を見ているかを確かめる。MSW はサービスワーカーで横取りするので、それで判別できる */
export async function assertRealApi(page) {
  const mswActive = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller))
  expect(
    mswActive,
    'MSW が有効なままなので実 API を見ていない。VITE_ENABLE_MSW を false にして frontend を作り直すこと',
  ).toBe(false)
}

/**
 * 一覧 API を最後のページまで送って全件を集める。
 *
 * @param {import('@playwright/test').APIRequestContext} api
 * @param {string} path `/api/masters/ca` のような実 API のパス
 * @param {string} listKey 応答の配列のキー（`ca_list` / `holidays` など。openapi.json の *ListResponse を見る）
 * @param {object} [params] 追加のクエリ（`include_deleted: true` など）
 */
export async function fetchAll(api, path, listKey, params = {}) {
  const all = []
  let offset = 0

  for (;;) {
    const res = await api.get(path, { params: { ...params, limit: API_LIMIT_MAX, offset } })
    expect(res.ok(), `実 API から ${path} を取得できない。api コンテナが動いているか確認する`).toBe(
      true,
    )

    const body = await res.json()
    const items = body[listKey]
    expect(Array.isArray(items), `${path} の応答に配列 ${listKey} が無い`).toBe(true)
    all.push(...items)
    offset += items.length
    if (items.length === 0 || offset >= body.total) return all
  }
}

/**
 * 試験用データの目印。`prefix` で前回の残骸まで拾い、`value` で今回の行を特定する。
 * 自然キーの無いマスタ（POST が毎回 INSERT）では、備考などの自由入力欄にこれを入れる。
 */
export function marker(label = '実 API 接続確認') {
  const prefix = `${label}（E2E が削除する）`
  return { prefix, value: `${prefix} ${Date.now()}` }
}

/**
 * 目印の付いた有効な行を消す。前回が途中で落ちた残骸もここで片付く。消した行を返す（報告用）。
 *
 * @param {import('@playwright/test').APIRequestContext} api
 * @param {object} options
 * @param {() => Promise<object[]>} options.list 取消済みも含めた全行を返す（`fetchAll` を包む）
 * @param {(row: object) => boolean} options.isMarked 試験用の有効な行か
 * @param {(row: object) => string} options.deletePathOf 削除のパス（パスキーは openapi.json に従う）
 */
export async function cleanupMarked(api, { list, isMarked, deletePathOf }) {
  const marked = (await list()).filter(isMarked)

  for (const row of marked) {
    const path = deletePathOf(row)
    const res = await api.delete(path)
    expect(res.ok(), `試験用の行を削除できない: ${path} ${res.status()} ${await res.text()}`).toBe(
      true,
    )
  }
  return marked
}

/**
 * 一覧画面の定型操作。名前は既存の spec（assertRealApi / settleList / openList / countOf / rowsOf）に揃える。
 *
 * @param {object} options
 * @param {string} options.path 画面の path（`/masters/ca`）
 * @param {string} options.testIdPrefix 一覧の testid の接頭辞（`ca`）
 */
export function listHelpers({ path, testIdPrefix }) {
  const id = (suffix) => `${testIdPrefix}-${suffix}`

  /**
   * 取得が終わるのを待つ。件数の表示は取得中は出ない（確定前の値を見せないため）。
   * 値を読み取ってから比べる場面では、先にここを通すこと。
   */
  async function settleList(page) {
    await expect(page.getByTestId(id('loading'))).toHaveCount(0)
  }

  /** 一覧を開いて、実 API に当たっていることまで確認する */
  async function openList(page, query = '') {
    await page.goto(`${path}${query}`)
    await expect(page.getByTestId(id('count'))).toBeVisible()
    await settleList(page)
    await assertRealApi(page)
  }

  /** 「N 件」の表示から件数を読む */
  async function countOf(page) {
    await settleList(page)
    const text = await page.getByTestId(id('count')).textContent()
    return Number(text.replace(/[^0-9]/g, ''))
  }

  /** 表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
  function rowsOf(page) {
    return page.getByTestId(id('table')).getByTestId('data-table-row')
  }

  /**
   * スモーク（`-01`）の共通の期待値。件数表示と行数が食い違わず、4 状態のうち
   * 「データあり」か「空」に落ち、エラーが出ていない。ページ送りは件数の表示も兼ねるので 1 ページでも出る。
   */
  async function expectListConsistent(page, { pageSize, pagination = true }) {
    const total = await countOf(page)
    await expect(rowsOf(page)).toHaveCount(Math.min(total, pageSize))

    if (total > 0) {
      await expect(page.getByTestId(id('table'))).toBeVisible()
      if (pagination) await expect(page.getByTestId(id('pagination'))).toBeVisible()
    } else {
      await expect(page.getByTestId(id('empty'))).toBeVisible()
    }
    await expect(page.getByTestId(id('error'))).toHaveCount(0)
    return total
  }

  return { settleList, openList, countOf, rowsOf, expectListConsistent }
}

/** 20350611 → '2035-06-11'（8 桁でなければ空文字） */
export function toIsoDate(value) {
  const digits = String(value ?? '')
  if (!/^\d{8}$/.test(digits)) return ''
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

/** 画面から送られた更新系の本文・応答を標準出力に残す（実 API との食い違いを報告するための材料） */
export async function logExchange(label, res) {
  const body = await res.text()
  // spec から呼ぶ報告用の出力（spec は no-console の対象外だが、helpers は対象に入るため）
  // eslint-disable-next-line no-console
  console.log(
    `[${label}] ${res.request().method()} ${new URL(res.url()).pathname}\n` +
      `  request : ${res.request().postData()}\n` +
      `  status  : ${res.status()}\n` +
      `  response: ${body}`,
  )
  return body
}
