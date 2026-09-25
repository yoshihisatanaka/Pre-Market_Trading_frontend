import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { closedMarketStatusResponse, marketStatusResponse } from '@/mocks/fixtures/marketStatus'
import { reloadMarketStatusAfter, useMarketStatusStore } from './marketStatus'

/*
 * 「サーバが言ったこと」を持つだけのストア。表示の組み立て（toMarketDisplay）と
 * タイマー（useMarketStatus）はここの責務ではないので触らない。
 *
 * シナリオ: docs/unit/stores-market-status.md
 */

/** 固定の応答を返すハンドラを立てる（既定のハンドラは日付を「今日」へずらすため） */
function respond(body, status = 200) {
  server.use(http.get('*/api/market-status', () => HttpResponse.json(body, { status })))
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useMarketStatusStore', () => {
  it('[MSS-01] 作っただけでは何も取りに行かない', () => {
    const store = useMarketStatusStore()

    expect(store.status).toBeNull()
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('[MSS-02] load するとアプリ内モデルが入る', async () => {
    respond(marketStatusResponse)
    const store = useMarketStatusStore()

    await store.load()

    expect(store.status.baseDate).toBe('2026-03-02')
    expect(store.status.sessions).toHaveLength(3)
    expect(store.error).toBeNull()
  })

  it('[MSS-03] 取得中は loading が立ち、解決すると下りる', async () => {
    respond(marketStatusResponse)
    const store = useMarketStatusStore()

    const pending = store.load()
    expect(store.loading).toBe(true)

    await pending
    expect(store.loading).toBe(false)
  })

  it('[MSS-04] 失敗しても例外は外へ出ず、error に入る', async () => {
    respond({ detail: 'サーバーでエラーが発生しました。' }, 500)
    const store = useMarketStatusStore()

    await store.load()

    expect(store.error).toMatchObject({ name: 'ApiError', status: 500 })
    expect(store.status).toBeNull()
  })

  it('[MSS-05] 取得済みのあとで失敗しても、status は前の値のまま残る', async () => {
    respond(marketStatusResponse)
    const store = useMarketStatusStore()
    await store.load()
    const previous = store.status

    respond({ detail: 'サーバーでエラーが発生しました。' }, 500)
    await store.load()

    expect(store.error).toMatchObject({ name: 'ApiError' })
    // 画面が古い時間帯を出し続けられること（MKS-25 と対）
    expect(store.status).toBe(previous)
  })

  it('[MSS-06] 取り直すと status が差し替わり、error は消える', async () => {
    respond({ detail: 'サーバーでエラーが発生しました。' }, 500)
    const store = useMarketStatusStore()
    await store.load()
    expect(store.error).not.toBeNull()

    respond(closedMarketStatusResponse)
    await store.load()

    expect(store.error).toBeNull()
    expect(store.status.closed).toBe(true)
    expect(store.status.closedReason).toBe('感謝祭')
  })
})

describe('reloadMarketStatusAfter', () => {
  it('[MSS-07] 包んだ書き込みが成功すると市場状況を取り直し、戻り値はそのまま返す', async () => {
    const load = vi.spyOn(useMarketStatusStore(), 'load').mockResolvedValue(null)
    const write = vi.fn().mockResolvedValue({ id: '1' })

    const result = await reloadMarketStatusAfter(write)({ date: '2026-11-27' })

    expect(write).toHaveBeenCalledWith({ date: '2026-11-27' })
    expect(result).toEqual({ id: '1' })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('[MSS-08] 包んだ書き込みが失敗すると取り直さず、例外をそのまま伝える', async () => {
    const load = vi.spyOn(useMarketStatusStore(), 'load').mockResolvedValue(null)
    const failure = new Error('保存に失敗しました')

    await expect(
      reloadMarketStatusAfter(vi.fn().mockRejectedValue(failure))('1'),
    ).rejects.toBe(failure)

    expect(load).not.toHaveBeenCalled()
  })
})
