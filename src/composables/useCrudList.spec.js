import { describe, expect, it, vi } from 'vitest'
import { useCrudList } from './useCrudList'

/*
 * ページャー付きマスタ一覧の足回り（取得・競合防止・登録・更新・削除）。
 *
 * 守るのは 4 点。
 * - 古い応答で新しい結果を上書きしない（useAsync は追い越しを防がない。UAS-17 参照）
 * - 持っていない操作の名前を公開しない（createItem などを渡さない一覧にはキーごと生やさない）
 * - 事前検証の不合格・警告は例外にせず validationErrors / validationWarnings に入れる
 * - 登録と更新の検証理由を混ぜない（updateValidationErrors は別 ref）
 *
 * この層は HTTP を知らないため MSW は使わず、fetchPage / createItem / validateItem /
 * updateItem / deleteItem には vi.fn() のスタブを渡す。期待値はテスト内で作った
 * オブジェクトとの同一性で確かめ、件数や文言を直接書かない。
 *
 * シナリオ: docs/unit/composables-use-crud-list.md
 */

/** 1 ページあたりの件数（この値が limit と fetchPage の params に出ることだけを見る） */
const PAGE_SIZE = 20

/**
 * 外から解決／棄却できる Promise を作る。
 * 「解決前」の状態（loading / creating が true のうち）と応答の追い越しを観察するために使う。
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

/** マイクロタスクを数周させ、解決済みの Promise の続きを走らせる */
async function tick() {
  for (let i = 0; i < 3; i += 1) await Promise.resolve()
}

/** 1 ページ分の応答（中身は同一参照の照合にしか使わないので目印だけ持たせる） */
function page(label, total = 1) {
  return { items: [{ label }], total }
}

/** fetchPage だけを持つ、読むだけの一覧 */
function setupList(overrides = {}) {
  const fetchPage = vi.fn().mockResolvedValue(page('initial'))
  const list = useCrudList({ pageSize: PAGE_SIZE, fetchPage, ...overrides })
  return { fetchPage, list }
}

describe('useCrudList', () => {
  describe('一覧の取得', () => {
    it('[UCL-01] 生成しただけでは取得せず、各値が初期値になる', () => {
      const { fetchPage, list } = setupList()

      expect(list.items.value).toEqual([])
      expect(list.total.value).toBe(0)
      expect(list.limit.value).toBe(PAGE_SIZE)
      expect(list.offset.value).toBe(0)
      expect(list.loading.value).toBe(false)
      expect(list.error.value).toBeNull()
      expect(list.isEmpty.value).toBe(true)
      expect(fetchPage).not.toHaveBeenCalled()
    })

    it('[UCL-02] filterKeys と同名のキーが空文字の ref として公開される', () => {
      const { list } = setupList({ filterKeys: ['dateFrom', 'holidayType'] })

      expect(list.dateFrom.value).toBe('')
      expect(list.holidayType.value).toBe('')
    })

    it('[UCL-03] filterKeys を省略すると limit と offset だけで取得する', async () => {
      const { fetchPage, list } = setupList()

      await list.load()

      expect(fetchPage).toHaveBeenCalledWith({ limit: PAGE_SIZE, offset: 0 })
    })

    it('[UCL-04] 引数なしの load は offset 0 と空の条件で取得する', async () => {
      const { fetchPage, list } = setupList({ filterKeys: ['dateFrom', 'holidayType'] })

      await list.load()

      expect(fetchPage).toHaveBeenCalledWith({
        limit: PAGE_SIZE,
        offset: 0,
        dateFrom: '',
        holidayType: '',
      })
    })

    it('[UCL-05] load に渡した offset と条件が取得にも公開 ref にも反映される', async () => {
      const { fetchPage, list } = setupList({ filterKeys: ['dateFrom', 'holidayType'] })
      const params = { offset: PAGE_SIZE, dateFrom: '2026-01-01', holidayType: 'NYSE' }

      await list.load(params)

      expect(fetchPage).toHaveBeenCalledWith({ limit: PAGE_SIZE, ...params })
      expect(list.offset.value).toBe(params.offset)
      expect(list.dateFrom.value).toBe(params.dateFrom)
      expect(list.holidayType.value).toBe(params.holidayType)
    })

    it('[UCL-06] filterKeys に無いキーは取得に渡らない', async () => {
      const { fetchPage, list } = setupList({ filterKeys: ['dateFrom'] })

      await list.load({ offset: 0, dateFrom: '2026-01-01', unknownKey: 'x' })

      expect(fetchPage).toHaveBeenCalledWith({
        limit: PAGE_SIZE,
        offset: 0,
        dateFrom: '2026-01-01',
      })
    })

    it('[UCL-07] 条件を省いて load し直すと前回の条件が残らない', async () => {
      const { fetchPage, list } = setupList({ filterKeys: ['dateFrom'] })
      await list.load({ offset: 0, dateFrom: '2026-01-01' })

      await list.load({ offset: 0 })

      expect(list.dateFrom.value).toBe('')
      expect(fetchPage).toHaveBeenLastCalledWith({ limit: PAGE_SIZE, offset: 0, dateFrom: '' })
    })

    it('[UCL-08] 成功すると items と total が応答の中身になる', async () => {
      const result = page('loaded', 123)
      const { list } = setupList({ fetchPage: vi.fn().mockResolvedValue(result) })

      await list.load()

      expect(list.items.value).toBe(result.items)
      expect(list.total.value).toBe(result.total)
      expect(list.isEmpty.value).toBe(false)
    })

    it('[UCL-09] 0 件の応答では isEmpty が true になる', async () => {
      const { list } = setupList({ fetchPage: vi.fn().mockResolvedValue({ items: [], total: 0 }) })

      await list.load()

      expect(list.items.value).toEqual([])
      expect(list.isEmpty.value).toBe(true)
    })

    it('[UCL-10] 読み込み中は loading が true で、空表示にはしない', async () => {
      const deferred = defer()
      const { list } = setupList({ fetchPage: vi.fn().mockReturnValue(deferred.promise) })

      const running = list.load()
      await tick()

      expect(list.loading.value).toBe(true)
      expect(list.isEmpty.value).toBe(false)

      deferred.resolve(page('loaded'))
      await running

      expect(list.loading.value).toBe(false)
    })

    it('[UCL-11] 失敗しても例外を投げず、error に理由が入り空表示にもしない', async () => {
      const failure = new Error('取得に失敗しました')
      const { list } = setupList({ fetchPage: vi.fn().mockRejectedValue(failure) })

      await list.load()

      expect(list.error.value).toBe(failure)
      expect(list.items.value).toEqual([])
      expect(list.total.value).toBe(0)
      expect(list.isEmpty.value).toBe(false)
    })

    it('[UCL-12] 失敗のあと読み直しに成功すると error が消える', async () => {
      const result = page('retried')
      const fetchPage = vi.fn().mockRejectedValueOnce(new Error('失敗')).mockResolvedValue(result)
      const { list } = setupList({ fetchPage })
      await list.load()

      await list.reload()

      expect(list.error.value).toBeNull()
      expect(list.items.value).toBe(result.items)
    })

    it('[UCL-13] reload はいまの offset と条件のまま読み直す', async () => {
      const { fetchPage, list } = setupList({ filterKeys: ['dateFrom'] })
      const params = { offset: PAGE_SIZE, dateFrom: '2026-01-01' }
      await list.load(params)

      await list.reload()

      expect(fetchPage).toHaveBeenLastCalledWith({ limit: PAGE_SIZE, ...params })
      expect(list.offset.value).toBe(params.offset)
    })

    it('[UCL-14] 先に投げた遅い応答が、あとの結果を上書きしない', async () => {
      const slow = defer()
      const fast = defer()
      const fetchPage = vi.fn().mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)
      const { list } = setupList({ fetchPage })
      const oldResult = page('old', 1)
      const newResult = page('new', 2)

      const first = list.load({ offset: 0 })
      const second = list.load({ offset: PAGE_SIZE })

      fast.resolve(newResult)
      await second
      slow.resolve(oldResult)
      await first

      expect(list.items.value).toBe(newResult.items)
      expect(list.total.value).toBe(newResult.total)
    })

    it('[UCL-15] 追い越しが起きなければ最後に始めた取得の結果が残る', async () => {
      const first = defer()
      const second = defer()
      const fetchPage = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
      const { list } = setupList({ fetchPage })
      const newResult = page('new')

      const firstLoad = list.load({ offset: 0 })
      const secondLoad = list.load({ offset: PAGE_SIZE })

      first.resolve(page('old'))
      await firstLoad
      second.resolve(newResult)
      await secondLoad

      expect(list.items.value).toBe(newResult.items)
    })

    it('[UCL-16] 追い越しの判定は生成ごとに独立し、別の一覧の結果を捨てない', async () => {
      const aFirst = defer()
      const aSecond = defer()
      const bOnly = defer()
      const a = setupList({
        fetchPage: vi.fn().mockReturnValueOnce(aFirst.promise).mockReturnValueOnce(aSecond.promise),
      })
      const b = setupList({ fetchPage: vi.fn().mockReturnValue(bOnly.promise) })
      const bResult = page('b')

      const aFirstLoad = a.list.load({ offset: 0 })
      const bLoad = b.list.load({ offset: 0 })
      const aSecondLoad = a.list.load({ offset: PAGE_SIZE })

      aSecond.resolve(page('a2'))
      await aSecondLoad
      bOnly.resolve(bResult)
      await bLoad
      aFirst.resolve(page('a1'))
      await aFirstLoad

      expect(b.list.items.value).toBe(bResult.items)
    })
  })

  describe('公開する操作', () => {
    it('[UCL-17] createItem を渡さない一覧は登録系の名前を持たない', () => {
      const { list } = setupList()

      expect(list).not.toHaveProperty('create')
      expect(list).not.toHaveProperty('creating')
      expect(list).not.toHaveProperty('createError')
      expect(list).not.toHaveProperty('validationErrors')
      expect(list).not.toHaveProperty('validationWarnings')
      expect(list).not.toHaveProperty('clearCreateError')
    })

    it('[UCL-18] updateItem を渡さない一覧は更新系の名前を持たない', () => {
      const { list } = setupList()

      expect(list).not.toHaveProperty('update')
      expect(list).not.toHaveProperty('updating')
      expect(list).not.toHaveProperty('updateError')
      expect(list).not.toHaveProperty('updateValidationErrors')
      expect(list).not.toHaveProperty('clearUpdateError')
    })

    it('[UCL-19] deleteItem を渡さない一覧は削除系の名前を持たない', () => {
      const { list } = setupList()

      expect(list).not.toHaveProperty('remove')
      expect(list).not.toHaveProperty('deleting')
      expect(list).not.toHaveProperty('deleteError')
      expect(list).not.toHaveProperty('clearDeleteError')
    })

    it('[UCL-20] 3 つとも渡すと各系統の名前が初期値付きで生える', () => {
      const { list } = setupList({
        createItem: vi.fn(),
        updateItem: vi.fn(),
        deleteItem: vi.fn(),
      })

      expect(typeof list.create).toBe('function')
      expect(typeof list.update).toBe('function')
      expect(typeof list.remove).toBe('function')
      expect(list.creating.value).toBe(false)
      expect(list.updating.value).toBe(false)
      expect(list.deleting.value).toBe(false)
      expect(list.createError.value).toBeNull()
      expect(list.updateError.value).toBeNull()
      expect(list.deleteError.value).toBeNull()
      expect(list.validationErrors.value).toEqual([])
      expect(list.validationWarnings.value).toEqual([])
      expect(list.updateValidationErrors.value).toEqual([])
    })
  })

  describe('登録', () => {
    it('[UCL-21] 事前検証の無い一覧は payload をそのまま登録し、登録された 1 件を返す', async () => {
      const created = { label: 'created' }
      const createItem = vi.fn().mockResolvedValue(created)
      const { list } = setupList({ createItem })
      const payload = { date: '2026-01-01' }

      const returned = await list.create(payload)

      expect(createItem).toHaveBeenCalledWith(payload)
      expect(returned).toBe(created)
    })

    it('[UCL-22] 登録に成功すると、いまの offset と条件のまま一覧を読み直す', async () => {
      const afterCreate = page('after-create')
      const fetchPage = vi.fn().mockResolvedValueOnce(page('before')).mockResolvedValue(afterCreate)
      const { list } = setupList({
        fetchPage,
        filterKeys: ['dateFrom'],
        createItem: vi.fn().mockResolvedValue({ label: 'created' }),
      })
      const params = { offset: PAGE_SIZE, dateFrom: '2026-01-01' }
      await list.load(params)

      await list.create({ date: '2026-02-01' })

      expect(fetchPage).toHaveBeenLastCalledWith({ limit: PAGE_SIZE, ...params })
      expect(list.items.value).toBe(afterCreate.items)
    })

    it('[UCL-23] 登録中は creating だけが true になり、一覧の loading は立たない', async () => {
      const deferred = defer()
      const { list } = setupList({ createItem: vi.fn().mockReturnValue(deferred.promise) })

      const running = list.create({})
      await tick()

      expect(list.creating.value).toBe(true)
      expect(list.loading.value).toBe(false)

      deferred.resolve({ label: 'created' })
      await running

      expect(list.creating.value).toBe(false)
    })

    it('[UCL-24] 事前検証に合格すると、検証してから登録する', async () => {
      const created = { label: 'created' }
      const validateItem = vi.fn().mockResolvedValue({ valid: true, errors: [] })
      const createItem = vi.fn().mockResolvedValue(created)
      const { list } = setupList({ validateItem, createItem })
      const payload = { date: '2026-01-01' }

      const returned = await list.create(payload)

      expect(validateItem).toHaveBeenCalledWith(payload)
      expect(createItem).toHaveBeenCalledWith(payload)
      expect(returned).toBe(created)
    })

    it('[UCL-25] 事前検証で弾かれると登録せず、理由が validationErrors に入る', async () => {
      const errors = ['すでに登録されています']
      const createItem = vi.fn()
      const { fetchPage, list } = setupList({
        validateItem: vi.fn().mockResolvedValue({ valid: false, errors }),
        createItem,
      })

      const returned = await list.create({ date: '2026-01-01' })

      expect(returned).toBeNull()
      expect(createItem).not.toHaveBeenCalled()
      expect(list.validationErrors.value).toEqual(errors)
      expect(list.createError.value).toBeNull()
      expect(fetchPage).not.toHaveBeenCalled()
    })

    it('[UCL-26] 警告付きの合格は、承認が無ければ登録せず validationWarnings に入る', async () => {
      const warnings = ['取消済みの日付を再有効化します']
      const createItem = vi.fn()
      const { list } = setupList({
        validateItem: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings }),
        createItem,
      })

      const returned = await list.create({ date: '2026-01-01' })

      expect(returned).toBeNull()
      expect(createItem).not.toHaveBeenCalled()
      expect(list.validationWarnings.value).toEqual(warnings)
      expect(list.validationErrors.value).toEqual([])
      expect(list.createError.value).toBeNull()
    })

    it('[UCL-27] 警告を承認した payload なら登録する', async () => {
      const created = { label: 'created' }
      const createItem = vi.fn().mockResolvedValue(created)
      const { list } = setupList({
        validateItem: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: ['警告'] }),
        createItem,
      })
      const payload = { date: '2026-01-01', acknowledgedWarnings: true }

      const returned = await list.create(payload)

      expect(createItem).toHaveBeenCalledWith(payload)
      expect(returned).toBe(created)
      expect(list.validationWarnings.value).toEqual([])
    })

    it('[UCL-28] 警告が 0 件の合格は確認を挟まず登録する', async () => {
      const created = { label: 'created' }
      const createItem = vi.fn().mockResolvedValue(created)
      const { list } = setupList({
        validateItem: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }),
        createItem,
      })

      const returned = await list.create({ date: '2026-01-01' })

      expect(returned).toBe(created)
      expect(list.validationWarnings.value).toEqual([])
    })

    it('[UCL-29] 登録が例外で失敗すると createError に入り、一覧も読み直さない', async () => {
      const failure = new Error('登録に失敗しました')
      const { fetchPage, list } = setupList({
        createItem: vi.fn().mockRejectedValue(failure),
      })

      const returned = await list.create({ date: '2026-01-01' })

      expect(returned).toBeNull()
      expect(list.createError.value).toBe(failure)
      expect(list.validationErrors.value).toEqual([])
      expect(fetchPage).not.toHaveBeenCalled()
    })

    it('[UCL-30] 事前検証が例外で落ちた場合は不合格ではなく createError として扱う', async () => {
      const failure = new Error('検証に失敗しました')
      const createItem = vi.fn()
      const { list } = setupList({
        validateItem: vi.fn().mockRejectedValue(failure),
        createItem,
      })

      const returned = await list.create({ date: '2026-01-01' })

      expect(returned).toBeNull()
      expect(list.createError.value).toBe(failure)
      expect(list.validationErrors.value).toEqual([])
      expect(list.validationWarnings.value).toEqual([])
      expect(createItem).not.toHaveBeenCalled()
    })

    it('[UCL-31] 登録に成功すると前回の検証理由と警告が消える', async () => {
      const validateItem = vi
        .fn()
        .mockResolvedValueOnce({ valid: false, errors: ['理由'] })
        .mockResolvedValueOnce({ valid: true, errors: [], warnings: ['警告'] })
        .mockResolvedValue({ valid: true, errors: [] })
      const { list } = setupList({
        validateItem,
        createItem: vi.fn().mockResolvedValue({ label: 'created' }),
      })
      await list.create({ date: '2026-01-01' })
      await list.create({ date: '2026-01-01' })

      await list.create({ date: '2026-01-01' })

      expect(list.validationErrors.value).toEqual([])
      expect(list.validationWarnings.value).toEqual([])
    })

    it('[UCL-32] clearCreateError は登録の失敗理由と警告をまとめて消す', async () => {
      const { list } = setupList({
        validateItem: vi.fn().mockResolvedValue({ valid: false, errors: ['理由'] }),
        createItem: vi.fn().mockRejectedValue(new Error('失敗')),
      })
      await list.create({ date: '2026-01-01' })
      list.createError.value = new Error('失敗')
      list.validationWarnings.value = ['警告']

      list.clearCreateError()

      expect(list.createError.value).toBeNull()
      expect(list.validationErrors.value).toEqual([])
      expect(list.validationWarnings.value).toEqual([])
    })
  })

  describe('更新', () => {
    it('[UCL-33] 更新に成功すると更新後の 1 件を返し、いまの条件のまま読み直す', async () => {
      const updated = { label: 'updated' }
      const afterUpdate = page('after-update')
      const fetchPage = vi.fn().mockResolvedValueOnce(page('before')).mockResolvedValue(afterUpdate)
      const updateItem = vi.fn().mockResolvedValue(updated)
      const { list } = setupList({ fetchPage, filterKeys: ['dateFrom'], updateItem })
      const params = { offset: PAGE_SIZE, dateFrom: '2026-01-01' }
      await list.load(params)
      const payload = { id: '1', date: '2026-02-01' }

      const returned = await list.update(payload)

      expect(updateItem).toHaveBeenCalledWith(payload)
      expect(returned).toBe(updated)
      expect(fetchPage).toHaveBeenLastCalledWith({ limit: PAGE_SIZE, ...params })
      expect(list.items.value).toBe(afterUpdate.items)
    })

    it('[UCL-34] 更新中は updating が true になり、完了で false に戻る', async () => {
      const deferred = defer()
      const { list } = setupList({ updateItem: vi.fn().mockReturnValue(deferred.promise) })

      const running = list.update({ id: '1' })
      await tick()

      expect(list.updating.value).toBe(true)

      deferred.resolve({ label: 'updated' })
      await running

      expect(list.updating.value).toBe(false)
    })

    it('[UCL-35] 更新の事前検証で弾かれた理由は updateValidationErrors に入る', async () => {
      const errors = ['すでに登録されています']
      const updateItem = vi.fn()
      const { list } = setupList({
        validateItem: vi.fn().mockResolvedValue({ valid: false, errors }),
        createItem: vi.fn(),
        updateItem,
      })

      const returned = await list.update({ id: '1' })

      expect(returned).toBeNull()
      expect(updateItem).not.toHaveBeenCalled()
      expect(list.updateValidationErrors.value).toEqual(errors)
      expect(list.validationErrors.value).toEqual([])
    })

    it('[UCL-36] 更新は警告を扱わず、承認が無くてもそのまま更新する', async () => {
      const updated = { label: 'updated' }
      const updateItem = vi.fn().mockResolvedValue(updated)
      const { list } = setupList({
        validateItem: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: ['警告'] }),
        createItem: vi.fn(),
        updateItem,
      })
      const payload = { id: '1' }

      const returned = await list.update(payload)

      expect(updateItem).toHaveBeenCalledWith(payload)
      expect(returned).toBe(updated)
      expect(list.validationWarnings.value).toEqual([])
    })

    it('[UCL-37] 更新が例外で失敗すると updateError に入り、一覧も読み直さない', async () => {
      const failure = new Error('更新に失敗しました')
      const { fetchPage, list } = setupList({
        updateItem: vi.fn().mockRejectedValue(failure),
      })

      const returned = await list.update({ id: '1' })

      expect(returned).toBeNull()
      expect(list.updateError.value).toBe(failure)
      expect(list.updateValidationErrors.value).toEqual([])
      expect(fetchPage).not.toHaveBeenCalled()
    })

    it('[UCL-38] clearUpdateError は更新側だけを消し、登録側の理由は残す', async () => {
      const { list } = setupList({
        validateItem: vi.fn().mockResolvedValue({ valid: false, errors: ['理由'] }),
        createItem: vi.fn(),
        updateItem: vi.fn(),
      })
      await list.create({})
      await list.update({ id: '1' })
      list.updateError.value = new Error('失敗')

      list.clearUpdateError()

      expect(list.updateError.value).toBeNull()
      expect(list.updateValidationErrors.value).toEqual([])
      expect(list.validationErrors.value).toEqual(['理由'])
    })
  })

  describe('削除', () => {
    it('[UCL-39] 削除に成功すると true を返し、いまの offset と条件のまま読み直す', async () => {
      const afterDelete = page('after-delete')
      const fetchPage = vi.fn().mockResolvedValueOnce(page('before')).mockResolvedValue(afterDelete)
      const deleteItem = vi.fn().mockImplementation((id) => Promise.resolve(id))
      const { list } = setupList({ fetchPage, filterKeys: ['dateFrom'], deleteItem })
      const params = { offset: PAGE_SIZE, dateFrom: '2026-01-01' }
      await list.load(params)

      const returned = await list.remove('target-id')

      expect(deleteItem).toHaveBeenCalledWith('target-id')
      expect(returned).toBe(true)
      expect(fetchPage).toHaveBeenLastCalledWith({ limit: PAGE_SIZE, ...params })
      expect(list.items.value).toBe(afterDelete.items)
    })

    it('[UCL-40] 削除中は deleting が true になり、完了で false に戻る', async () => {
      const deferred = defer()
      const { list } = setupList({ deleteItem: vi.fn().mockReturnValue(deferred.promise) })

      const running = list.remove('target-id')
      await tick()

      expect(list.deleting.value).toBe(true)

      deferred.resolve('target-id')
      await running

      expect(list.deleting.value).toBe(false)
    })

    it('[UCL-41] 削除が例外で失敗すると false を返し、deleteError に理由が入る', async () => {
      const failure = new Error('削除に失敗しました')
      const { fetchPage, list } = setupList({
        deleteItem: vi.fn().mockRejectedValue(failure),
      })

      const returned = await list.remove('target-id')

      expect(returned).toBe(false)
      expect(list.deleteError.value).toBe(failure)
      expect(fetchPage).not.toHaveBeenCalled()
    })

    it('[UCL-42] deleteItem が値を返さないと、削除できていても false になり読み直さない', async () => {
      const { fetchPage, list } = setupList({
        deleteItem: vi.fn().mockResolvedValue(undefined),
      })

      const returned = await list.remove('target-id')

      expect(returned).toBe(false)
      expect(list.deleteError.value).toBeNull()
      expect(fetchPage).not.toHaveBeenCalled()
    })

    it('[UCL-43] clearDeleteError は削除の失敗理由を消す', async () => {
      const { list } = setupList({
        deleteItem: vi.fn().mockRejectedValue(new Error('削除に失敗しました')),
      })
      await list.remove('target-id')

      list.clearDeleteError()

      expect(list.deleteError.value).toBeNull()
    })
  })
})
