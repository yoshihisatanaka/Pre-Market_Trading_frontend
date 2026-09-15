import { describe, expect, it, vi } from 'vitest'
import { useAsync } from './useAsync'

/*
 * 非同期の loading / error / data をまとめる土台。
 *
 * 守るのは「失敗を例外として外へ出さない（画面が try-catch を書かない）」ことと、
 * 「投げられた値を加工せず error に入れる」ことの 2 点。
 * 文言や status の正規化は api/client.js の ApiError 側の責務なので、ここでは見ない。
 *
 * この層は HTTP を知らないため MSW は使わず、fn には vi.fn() のスタブを渡す。
 * 期待値はテスト内で作ったオブジェクトとの同一性で確かめ、値を直接書かない。
 *
 * シナリオ: docs/unit/composables-use-async.md
 */

/**
 * 外から解決／棄却できる Promise を作る。
 * 「解決前」の状態（loading が true のうち）を観察するために使う。
 *
 * @returns {{ promise: Promise<unknown>, resolve: (value?: unknown) => void, reject: (reason?: unknown) => void }}
 */
function defer() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** マイクロタスクを 1 周させ、解決済みの Promise の続きを走らせる */
function tick() {
  return Promise.resolve()
}

describe('useAsync', () => {
  it('[UAS-01] 生成しただけでは実行せず、data / error / loading が初期値になる', () => {
    const fn = vi.fn()
    const { data, error, loading } = useAsync(fn)

    expect(data.value).toBeNull()
    expect(error.value).toBeNull()
    expect(loading.value).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('[UAS-02] initialData を渡すと data の初期値になる', () => {
    const initialData = { items: [], total: 0 }
    const { data } = useAsync(vi.fn(), { initialData })

    expect(data.value).toBe(initialData)
  })

  it('[UAS-03] 実行中は loading が true、完了で false に戻る', async () => {
    const deferred = defer()
    const { loading, execute } = useAsync(() => deferred.promise)

    const running = execute()
    expect(loading.value).toBe(true)

    deferred.resolve({})
    await running
    expect(loading.value).toBe(false)
  })

  it('[UAS-04] 成功すると data が結果になり、戻り値も data.value と一致する', async () => {
    const result = { items: [{ id: 1 }], total: 1 }
    const { data, error, execute } = useAsync(vi.fn().mockResolvedValue(result))

    const returned = await execute()

    expect(data.value).toBe(result)
    expect(returned).toBe(data.value)
    expect(error.value).toBeNull()
  })

  it('[UAS-05] undefined を返す成功は undefined を返し、失敗の null と区別がつく', async () => {
    const { data, error, execute } = useAsync(vi.fn().mockResolvedValue(undefined))

    const returned = await execute()

    expect(returned).toBeUndefined()
    expect(returned).not.toBeNull()
    expect(data.value).toBeUndefined()
    expect(error.value).toBeNull()
  })

  it('[UAS-06] execute の引数がそのまま fn に渡る', async () => {
    const options = { c: 3 }
    const fn = vi.fn().mockResolvedValue(null)
    const { execute } = useAsync(fn)

    await execute('a', 2, options)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('a', 2, options)
    expect(fn.mock.calls[0][2]).toBe(options)
  })

  it('[UAS-07] 引数なしで呼ぶと fn も引数なしで呼ばれる', async () => {
    const fn = vi.fn().mockResolvedValue(null)
    const { execute } = useAsync(fn)

    await execute()

    expect(fn.mock.calls[0]).toHaveLength(0)
  })

  it('[UAS-08] 失敗しても例外を投げず null を返す', async () => {
    const { execute } = useAsync(vi.fn().mockRejectedValue(new Error('失敗')))

    await expect(execute()).resolves.toBeNull()
  })

  it('[UAS-09] 投げられた Error オブジェクトがそのまま error に入る', async () => {
    const thrown = new Error('サーバーでエラーが発生しました。')
    const { error, execute } = useAsync(vi.fn().mockRejectedValue(thrown))

    await execute()

    expect(error.value).toBe(thrown)
  })

  it('[UAS-10] 失敗しても loading が false に戻る', async () => {
    const { loading, execute } = useAsync(vi.fn().mockRejectedValue(new Error('失敗')))

    await execute()

    expect(loading.value).toBe(false)
  })

  it('[UAS-11] 失敗しても直前の data を保持する', async () => {
    const initialData = { items: [], total: 0 }
    const { data, execute } = useAsync(vi.fn().mockRejectedValue(new Error('失敗')), {
      initialData,
    })

    await execute()

    expect(data.value).toBe(initialData)
  })

  it('[UAS-12] Error でない値を投げてもラップせずそのまま error に入る', async () => {
    const thrown = '文字列で投げられた'
    const { error, execute } = useAsync(vi.fn().mockRejectedValue(thrown))

    const returned = await execute()

    expect(error.value).toBe(thrown)
    expect(returned).toBeNull()
  })

  it('[UAS-13] 再実行が成功すると前回の error がクリアされる', async () => {
    const result = { items: [], total: 0 }
    const fn = vi.fn().mockRejectedValueOnce(new Error('失敗')).mockResolvedValueOnce(result)
    const { data, error, execute } = useAsync(fn)

    await execute()
    expect(error.value).toBeInstanceOf(Error)

    await execute()
    expect(error.value).toBeNull()
    expect(data.value).toBe(result)
  })

  it('[UAS-14] 再実行では解決を待たず開始時点で error が null になる', async () => {
    const deferred = defer()
    const fn = vi.fn().mockRejectedValueOnce(new Error('失敗')).mockImplementation(() => deferred.promise)
    const { error, execute } = useAsync(fn)

    await execute()
    expect(error.value).toBeInstanceOf(Error)

    const running = execute()
    expect(error.value).toBeNull()

    deferred.resolve({})
    await running
  })

  it('[UAS-15] 続けて失敗すると error が新しい方に入れ替わる', async () => {
    const first = new Error('1 回目')
    const second = new Error('2 回目')
    const fn = vi.fn().mockRejectedValueOnce(first).mockRejectedValueOnce(second)
    const { error, execute } = useAsync(fn)

    await execute()
    expect(error.value).toBe(first)

    await execute()
    expect(error.value).toBe(second)
  })

  it('[UAS-17] 追い越しを防がず、最後に解決した応答で data が上書きされる', async () => {
    const oldResult = { items: [], total: 0 }
    const newResult = { items: [{ id: 1 }], total: 1 }
    const oldDeferred = defer()
    const newDeferred = defer()
    const fn = vi.fn((key) => (key === 'old' ? oldDeferred.promise : newDeferred.promise))
    const { data, execute } = useAsync(fn)

    const oldRunning = execute('old')
    const newRunning = execute('new')

    // 新しい方が先に解決する（= 古い方が追い越される）
    newDeferred.resolve(newResult)
    await newRunning
    expect(data.value).toBe(newResult)

    // 遅れて届いた古い応答がそのまま上書きする
    oldDeferred.resolve(oldResult)
    await oldRunning
    expect(data.value).toBe(oldResult)
  })

  it('[UAS-18] 同時実行中でも片方が完了した時点で loading が false になる', async () => {
    const first = defer()
    const second = defer()
    const fn = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    const { loading, execute } = useAsync(fn)

    const firstRunning = execute()
    const secondRunning = execute()
    expect(loading.value).toBe(true)

    first.resolve({})
    await firstRunning
    await tick()
    expect(loading.value).toBe(false)

    second.resolve({})
    await secondRunning
  })
})
