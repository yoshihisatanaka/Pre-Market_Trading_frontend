import { describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useListQuery } from './useListQuery'

/*
 * 一覧の「ページ位置と検索条件は URL クエリを正とする単方向フロー」。
 *
 * 見るのは 3 点。
 *   - 読み込みの入口は URL だけ（操作は push するだけで load を直接呼ばない）
 *   - 既定値（offset 0 / 空の条件）は URL に出さず、正規化後に同じなら再取得しない
 *   - ページ移動は入力欄ではなく URL 側の条件を引き継ぐ
 *
 * この層は HTTP もストアも知らないので MSW / Pinia は使わず、load には vi.fn() を渡す。
 * offset の正規化規則そのものは utils/queryParams（QRY-01〜08）の担当なので、
 * ここでは「正規化を通った値が load と再取得の判定に届く」ことだけを確かめる。
 *
 * シナリオ: docs/unit/composables-use-list-query.md
 */

const PATH = '/masters/ca'

// 選択肢が決まっている条件の代表値と、選択肢に無い値（parse が捨てる側）
const KNOWN_TYPE = 'dividend'
const UNKNOWN_TYPE = 'not-a-ca-type'
const STOCK_CODE = 'AAPL'
const OTHER_STOCK_CODE = 'MSFT'
// 2 ページ目の先頭。表示件数はこの層の関心事ではないので素の数値で書く
const OFFSET = 50

/** 呼び出し側（CorporateActionListView）と同じ形の filters 定義 */
const FILTERS = [
  { key: 'stockCode', query: 'stock_code' },
  {
    key: 'caType',
    query: 'ca_type',
    parse: (value) => (value === KNOWN_TYPE ? value : ''),
  },
]

/** 条件なし・1 ページ目のときに load へ渡るはずの params */
const emptyParams = () => ({ offset: 0, stockCode: '', caType: '' })

/**
 * 操作 → router.push → queryKey の watch → load までを待つ。
 * 1 回目でナビゲーションが確定し、2 回目で watch の副作用が流れる。
 */
async function settle() {
  await flushPromises()
  await flushPromises()
}

/**
 * composable を setup 中に同期で呼ぶだけのホストをマウントする。
 * （watch の登録が onMounted へ遅れると初回読み込みが走らないため、実際の使われ方に揃える）
 */
async function setup({ query = {}, filters = FILTERS, withoutFilters = false } = {}) {
  const load = vi.fn()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: PATH, component: { render: () => h('div') } }],
  })
  // mount 前に遷移を済ませておけば router.isReady() を待たなくてよい
  await router.push({ path: PATH, query })

  let api
  const Host = {
    setup() {
      // filters を省略したときの既定（ページ位置だけ）も実際の呼び方で確かめる
      api = withoutFilters ? useListQuery({ load }) : useListQuery({ filters, load })
      return () => h('div')
    },
  }
  mount(Host, { global: { plugins: [router] } })
  await settle()

  const currentQuery = () => ({ ...router.currentRoute.value.query })
  const lastParams = () => load.mock.calls.at(-1)[0]
  return { api, load, router, currentQuery, lastParams }
}

describe('useListQuery', () => {
  it('[ULQ-01] クエリなしでも初回に 1 回だけ既定の params で読み込む', async () => {
    const { load } = await setup()

    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith(emptyParams())
  })

  it('[ULQ-02] URL の条件をモデル側のキーに直して読み込む', async () => {
    const { load } = await setup({
      query: { offset: String(OFFSET), stock_code: STOCK_CODE },
    })

    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith({ offset: OFFSET, stockCode: STOCK_CODE, caType: '' })
  })

  it('[ULQ-03] 初期表示の入力欄が URL の条件で埋まる', async () => {
    const { api } = await setup({
      query: { offset: String(OFFSET), stock_code: STOCK_CODE },
    })

    expect({ ...api.inputs }).toEqual({ stockCode: STOCK_CODE, caType: '' })
  })

  it('[ULQ-04] 不正な offset は 0 として読み込まれる', async () => {
    const { lastParams } = await setup({ query: { offset: 'abc' } })

    expect(lastParams().offset).toBe(0)
  })

  it('[ULQ-05] parse が捨てた条件は params にも入力欄にも残らない', async () => {
    const { api, lastParams } = await setup({ query: { ca_type: UNKNOWN_TYPE } })

    expect(lastParams().caType).toBe('')
    expect(api.inputs.caType).toBe('')
  })

  it('[ULQ-06] 同名クエリが 2 つある（値が配列の）条件は空文字になる', async () => {
    const { api, lastParams } = await setup({
      query: { stock_code: [STOCK_CODE, OTHER_STOCK_CODE] },
    })

    expect(lastParams().stockCode).toBe('')
    expect(api.inputs.stockCode).toBe('')
  })

  it('[ULQ-07] filters を省略すると params は offset だけになり入力欄を持たない', async () => {
    const { api, load } = await setup({ withoutFilters: true })

    expect(load).toHaveBeenCalledWith({ offset: 0 })
    expect(Object.keys(api.inputs)).toEqual([])
  })

  it('[ULQ-08] 入力欄を書き換えただけでは URL も読み込みも動かない', async () => {
    const { api, load, currentQuery } = await setup()

    api.inputs.stockCode = STOCK_CODE
    await settle()

    expect(currentQuery()).toEqual({})
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('[ULQ-09] submitSearch で入力欄の条件が URL のクエリ名になり読み込まれる', async () => {
    const { api, load, currentQuery } = await setup()

    api.inputs.stockCode = STOCK_CODE
    api.inputs.caType = KNOWN_TYPE
    api.submitSearch()
    await settle()

    expect(currentQuery()).toEqual({ stock_code: STOCK_CODE, ca_type: KNOWN_TYPE })
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenLastCalledWith({
      offset: 0,
      stockCode: STOCK_CODE,
      caType: KNOWN_TYPE,
    })
  })

  it('[ULQ-10] submitSearch は 1 ページ目に戻す', async () => {
    const { api, currentQuery, lastParams } = await setup({ query: { offset: String(OFFSET) } })

    api.inputs.stockCode = STOCK_CODE
    api.submitSearch()
    await settle()

    expect(currentQuery()).toEqual({ stock_code: STOCK_CODE })
    expect(lastParams().offset).toBe(0)
  })

  it('[ULQ-11] 条件が空のまま submitSearch すると URL に既定値を書かない', async () => {
    const { api, currentQuery } = await setup({ query: { stock_code: STOCK_CODE } })

    api.inputs.stockCode = ''
    api.submitSearch()
    await settle()

    expect(currentQuery()).toEqual({})
  })

  it('[ULQ-12] goToOffset は入力欄ではなく URL 側の条件を引き継ぐ', async () => {
    const { api, currentQuery, lastParams } = await setup({ query: { stock_code: STOCK_CODE } })

    // 検索は押さずに入力欄だけ編集した状態でページ送りする
    api.inputs.stockCode = OTHER_STOCK_CODE
    api.goToOffset(OFFSET)
    await settle()

    expect(currentQuery()).toEqual({ offset: String(OFFSET), stock_code: STOCK_CODE })
    expect(lastParams()).toEqual({ offset: OFFSET, stockCode: STOCK_CODE, caType: '' })
  })

  it('[ULQ-13] goToOffset(0) は URL から offset を消す', async () => {
    const { api, currentQuery, lastParams } = await setup({ query: { offset: String(OFFSET) } })

    api.goToOffset(0)
    await settle()

    expect(currentQuery()).toEqual({})
    expect(lastParams().offset).toBe(0)
  })

  it('[ULQ-14] goToOffset でページを進めると 1 回だけ読み込み直す', async () => {
    const { api, load, currentQuery } = await setup()

    api.goToOffset(OFFSET)
    await settle()

    expect(currentQuery()).toEqual({ offset: String(OFFSET) })
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenLastCalledWith({ offset: OFFSET, stockCode: '', caType: '' })
  })

  it('[ULQ-15] clearSearch で条件もページ位置も入力欄も消える', async () => {
    const { api, currentQuery, lastParams } = await setup({
      query: { offset: String(OFFSET), stock_code: STOCK_CODE, ca_type: KNOWN_TYPE },
    })

    api.clearSearch()
    await settle()

    expect(currentQuery()).toEqual({})
    expect({ ...api.inputs }).toEqual({ stockCode: '', caType: '' })
    expect(lastParams()).toEqual(emptyParams())
  })

  it('[ULQ-16] 同じ条件で submitSearch を繰り返しても二重に読み込まない', async () => {
    const { api, load } = await setup()

    api.inputs.stockCode = STOCK_CODE
    api.submitSearch()
    await settle()
    expect(load).toHaveBeenCalledTimes(2)

    api.submitSearch()
    await settle()

    expect(load).toHaveBeenCalledTimes(2)
  })

  it('[ULQ-17] 正規化すると同じになる URL へ移っても読み込み直さない', async () => {
    const { load, router } = await setup()

    await router.push({ path: PATH, query: { offset: '0' } })
    await settle()

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('[ULQ-18] ブラウザバックで前の条件を読み直し入力欄も戻る', async () => {
    const { api, router, lastParams } = await setup({ query: { stock_code: STOCK_CODE } })

    await router.push({ path: PATH, query: { stock_code: OTHER_STOCK_CODE } })
    await settle()
    expect(lastParams().stockCode).toBe(OTHER_STOCK_CODE)

    router.back()
    await settle()

    expect(lastParams().stockCode).toBe(STOCK_CODE)
    expect(api.inputs.stockCode).toBe(STOCK_CODE)
  })

  it('[ULQ-19] filters に無いクエリは操作のたびに URL から落ちる', async () => {
    const { api, currentQuery } = await setup({ query: { foo: '1' } })

    api.goToOffset(OFFSET)
    await settle()

    expect(currentQuery()).toEqual({ offset: String(OFFSET) })
  })
})
