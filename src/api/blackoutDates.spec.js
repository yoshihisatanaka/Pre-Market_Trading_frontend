import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import {
  createBlackoutDate,
  deleteBlackoutDate,
  fetchBlackoutDates,
  updateBlackoutDate,
  validateBlackoutDate,
} from './blackoutDates'

/*
 * API 層のテスト。ここだけが「バックエンドの形」を知ってよい層なので、
 * **送り出すリクエストそのもの** を docs/api/openapi.json の宣言と突き合わせる。
 *
 * ストア・画面のテストはモックが返す結果を見ているので、モックとサーバの理解がずれていても
 * 気づけない。この層でクエリ名・値の型・本文のキーを固定しておくと、ずれが 1 か所で見つかる。
 *
 * シナリオ: docs/unit/api-blackout-dates.md
 */

/** 最後に届いたリクエストを覚えておくための入れ物 */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

/**
 * リクエストを記録して、指定の本文を返すハンドラを立てる。
 *
 * @param {'get'|'post'|'put'|'delete'} method
 * @param {string} path `*` 始まりのパス
 * @param {unknown} body 返す本文
 * @param {number} [status]
 */
function record(method, path, body, status = 200) {
  server.use(
    http[method](path, async ({ request }) => {
      const url = new URL(request.url)
      lastRequest = {
        url,
        params: url.searchParams,
        headers: request.headers,
        // GET / DELETE は本文が無いので読まない（読むと空文字で例外になる）
        body: method === 'post' || method === 'put' ? await request.json() : null,
      }
      return HttpResponse.json(body, { status })
    }),
  )
}

/** BlackoutDateItem 1 件（openapi.json の項目をひととおり埋めたもの） */
const blackoutDateItem = {
  // 主キー。openapi.json にはまだ無く、DB の主キーを id に寄せる方針で先行している
  ID: 12,
  受注不可日: 20261225,
  備考: 'クリスマス休業',
  取消区分: 0,
  ユーザー操作フラグ: 0,
  作成日時: '2026-08-10T14:16:42',
  作成者: '702',
  更新日時: '2026-08-10T14:16:43',
  更新者: '702',
  取消日時: null,
  取消者: null,
}

const listBody = (blackoutDates) => ({
  total: blackoutDates.length,
  limit: 50,
  offset: 0,
  blackout_dates: blackoutDates,
})

describe('api/blackoutDates', () => {
  it('[BDA-01] 条件なしのときは offset だけを送る', async () => {
    record('get', '*/api/masters/blackout-dates', listBody([]))

    await fetchBlackoutDates()

    expect(lastRequest.url.pathname).toBe('/api/masters/blackout-dates')
    expect(lastRequest.params.get('offset')).toBe('0')
    // 空の条件はキーごと送らない（サーバ側で「空文字での絞り込み」にしないため）
    expect(lastRequest.params.has('start_date')).toBe(false)
    expect(lastRequest.params.has('end_date')).toBe(false)
    // 既定 false のものは送らない（取消済みを含めない）
    expect(lastRequest.params.has('include_deleted')).toBe(false)
  })

  it('[BDA-02] 日付の絞り込みは start_date / end_date に YYYYMMDD の整数で載る', async () => {
    record('get', '*/api/masters/blackout-dates', listBody([]))

    await fetchBlackoutDates({ dateFrom: '2026-01-01', dateTo: '2026-12-31' })

    expect(lastRequest.params.get('start_date')).toBe('20260101')
    expect(lastRequest.params.get('end_date')).toBe('20261231')
    // 旧仕様のクエリ名で送っていないこと
    expect(lastRequest.params.has('date_from')).toBe(false)
    expect(lastRequest.params.has('date_to')).toBe(false)
  })

  it('[BDA-03] limit は渡されても送らない（実 API が受け付けない）', async () => {
    record('get', '*/api/masters/blackout-dates', listBody([]))

    // ストア（useCrudList）は表示件数を limit として渡してくるが、
    // 実 API の一覧は 1 ページ 50 件で固定されていて limit というクエリを持たない
    await fetchBlackoutDates({ limit: 50, offset: 50 })

    expect(lastRequest.params.has('limit')).toBe(false)
    expect(lastRequest.params.get('offset')).toBe('50')
  })

  it('[BDA-04] BlackoutDateItem がアプリ内モデルに変換される', async () => {
    record('get', '*/api/masters/blackout-dates', listBody([blackoutDateItem]))

    const { items, total } = await fetchBlackoutDates()

    expect(total).toBe(1)
    expect(items).toEqual([
      {
        id: '12',
        date: '2026-12-25',
        reason: 'クリスマス休業',
        updatedAt: '2026-08-10T14:16:43',
      },
    ])
    // 対象市場に相当する項目は実 API に無いので、アプリ内モデルにも持たない
    expect(items[0]).not.toHaveProperty('market')
  })

  it('[BDA-05] 備考と更新日時が null の行は空文字になる', async () => {
    record('get', '*/api/masters/blackout-dates', listBody([{ ...blackoutDateItem, 備考: null, 更新日時: null }]))

    const { items } = await fetchBlackoutDates()

    expect(items[0].reason).toBe('')
    // 合札が無い行。undefined のままだと更新時の JSON で「送っていない」と区別できなくなる
    expect(items[0].updatedAt).toBe('')
  })

  it('[BDA-06] blackout_dates を持たない応答でも空の一覧になる', async () => {
    record('get', '*/api/masters/blackout-dates', { total: 0, limit: 50, offset: 0 })

    const { items, total } = await fetchBlackoutDates()

    expect(items).toEqual([])
    expect(total).toBe(0)
  })

  it('[BDA-07] 新規の事前検証は日本語キーの本文を送り、is_update を付けない', async () => {
    record('post', '*/api/masters/blackout-dates/validate', { valid: true, errors: [], warnings: [] })

    await validateBlackoutDate({ date: '2026-12-25', reason: 'クリスマス休業' })

    expect(lastRequest.url.pathname).toBe('/api/masters/blackout-dates/validate')
    expect(lastRequest.body).toEqual({ 受注不可日: 20261225, 備考: 'クリスマス休業' })
    expect(lastRequest.params.has('is_update')).toBe(false)
  })

  it('[BDA-08] 日付を変えない編集の事前検証は is_update=true と対象の id を付ける', async () => {
    record('post', '*/api/masters/blackout-dates/validate', { valid: true, errors: [], warnings: [] })

    await validateBlackoutDate({ id: '12', date: '2026-12-25', reason: '文言だけ直す' })

    // 変更検証にしないと、自分自身が重複として弾かれる
    expect(lastRequest.params.get('is_update')).toBe('true')
    // 対象は本文の受注不可日ではなくクエリの id で指す（CA の ca_id と同じ形）
    expect(lastRequest.params.get('blackout_date_id')).toBe('12')
  })

  it('[BDA-09] 日付を変える編集の事前検証も is_update=true と対象の id を付ける', async () => {
    record('post', '*/api/masters/blackout-dates/validate', { valid: true, errors: [], warnings: [] })

    await validateBlackoutDate({ id: '12', date: '2030-01-01', reason: 'クリスマス休業' })

    /*
     * 主キーが ID になったので、対象は日付と切り離してクエリで指せる。
     * 日付を変えても対象を見失わず、自分自身が重複として弾かれることもない。
     * （主キーが受注不可日だった頃は、ここで新規検証に切り替えて回避していた）
     */
    expect(lastRequest.params.get('is_update')).toBe('true')
    expect(lastRequest.params.get('blackout_date_id')).toBe('12')
    // 本文に載るのは変更後の日付
    expect(lastRequest.body).toEqual({ 受注不可日: 20300101, 備考: 'クリスマス休業' })
  })

  it('[BDA-10] 事前検証の valid / errors をそのまま返す', async () => {
    record('post', '*/api/masters/blackout-dates/validate', {
      valid: false,
      errors: ['受注不可日(20261225)は既に登録されています'],
      warnings: [],
      details: null,
    })

    const result = await validateBlackoutDate({ date: '2026-12-25', reason: 'クリスマス休業' })

    // 不合格は例外にしない（通信・サーバ障害と区別するため）
    expect(result).toEqual({
      valid: false,
      errors: ['受注不可日(20261225)は既に登録されています'],
    })
  })

  it('[BDA-11] errors が無い応答でも空配列になる', async () => {
    record('post', '*/api/masters/blackout-dates/validate', { valid: true })

    const result = await validateBlackoutDate({ date: '2026-12-25', reason: 'クリスマス休業' })

    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('[BDA-12] 登録は日本語キーの本文を送り、応答の blackout_date を変換して返す', async () => {
    record(
      'post',
      '*/api/masters/blackout-dates',
      { success: true, blackout_date: blackoutDateItem, message: 'ok' },
      201,
    )

    const created = await createBlackoutDate({ date: '2026-12-25', reason: 'クリスマス休業' })

    expect(lastRequest.url.pathname).toBe('/api/masters/blackout-dates')
    expect(lastRequest.body).toEqual({ 受注不可日: 20261225, 備考: 'クリスマス休業' })
    expect(created).toEqual({
      id: '12',
      date: '2026-12-25',
      reason: 'クリスマス休業',
      updatedAt: '2026-08-10T14:16:43',
    })
  })

  it('[BDA-13] 更新はパスが対象の id、本文が変更後の日付と合札になる', async () => {
    const moved = { ...blackoutDateItem, 受注不可日: 20300101 }
    record('put', '*/api/masters/blackout-dates/:id', {
      success: true,
      blackout_date: moved,
      message: 'ok',
    })

    const updated = await updateBlackoutDate({
      id: '12',
      date: '2030-01-01',
      reason: '年末年始休業',
      updatedAt: '2026-08-10T14:16:43',
    })

    // 主キーは ID なので、日付を変えてもパスは変わらない
    expect(lastRequest.url.pathname).toBe('/api/masters/blackout-dates/12')
    expect(lastRequest.body).toEqual({
      受注不可日: 20300101,
      備考: '年末年始休業',
      更新日時: '2026-08-10T14:16:43',
    })
    // 日付を変えても同じ行なので id は変わらない
    expect(updated.id).toBe('12')
    expect(updated.date).toBe('2030-01-01')
  })

  it('[BDA-14] 合札が空のときは更新日時をキーごと送らない', async () => {
    record('put', '*/api/masters/blackout-dates/:id', {
      success: true,
      blackout_date: blackoutDateItem,
      message: 'ok',
    })

    await updateBlackoutDate({
      id: '12',
      date: '2026-12-25',
      reason: 'クリスマス休業',
      updatedAt: '',
    })

    // 登録直後の行は実 API 側の更新日時が未設定で、照合する相手が無い。
    // 空文字を送るとサーバから見て「空の合札」になるため、キーごと落とす
    expect(lastRequest.body).toEqual({ 受注不可日: 20261225, 備考: 'クリスマス休業' })
  })

  it('[BDA-15] 削除は id をパスに置き、渡した id を返す', async () => {
    record('delete', '*/api/masters/blackout-dates/:id', {
      success: true,
      blackout_date: { ...blackoutDateItem, 取消区分: 1 },
      message: 'ok',
    })

    const deleted = await deleteBlackoutDate('12')

    expect(lastRequest.url.pathname).toBe('/api/masters/blackout-dates/12')
    expect(deleted).toBe('12')
  })

  /*
   * 実 API が ID を返し始めるまでの穴を見張るテスト。受注不可日へフォールバックすると
   * 「動いているように見える」まま実 API で行のキーが壊れるので、空文字のまま出す。
   */
  it('[BDA-17] 応答に ID が無いとき id は空文字のまま（受注不可日へフォールバックしない）', async () => {
    const { ID: _id, ...withoutId } = blackoutDateItem
    record('get', '*/api/masters/blackout-dates', listBody([withoutId]))

    const { items } = await fetchBlackoutDates()

    expect(items[0].id).toBe('')
    // 日付は主キーではなくなったが、業務上の値としてそのまま出る
    expect(items[0].date).toBe('2026-12-25')
  })

  it('[BDA-16] 更新系には X-User-Code ヘッダが載る', async () => {
    record(
      'post',
      '*/api/masters/blackout-dates',
      { success: true, blackout_date: blackoutDateItem, message: 'ok' },
      201,
    )

    await createBlackoutDate({ date: '2026-12-25', reason: 'クリスマス休業' })

    // 値は運用で決まる（テストでは vitest.config.js が固定している）。載っていることを見る
    expect(lastRequest.headers.get('X-User-Code')).toBeTruthy()
  })
})
