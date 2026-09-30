import { http, HttpResponse } from 'msw'
import { canceledSymbols, symbols } from '../fixtures/symbols'
import {
  detailError,
  isSameTimestamp,
  nowIsoTimestamp,
  requestValidationError,
  toNonNegativeInt,
} from './_shared'

/**
 * 銘柄マスタの行。登録したものが一覧に出るところまで再現したいので書き換え可能に持つ。
 * 取消済みも持つのは、一覧が取消区分で外していることを確かめられるようにするため。
 */
let symbolRows = [...symbols, ...canceledSymbols]

/** コード → 表示名。src/utils/symbolTypes.js と同じ対応表（規制情報は仮置きの値） */
const REGULATION_NAMES = { 0: '取引可', 1: '取引不可' }
const ORDER_ROUTE_NAMES = { 0: 'みずほ証券', 1: 'IB証券' }
const VWAP_TARGET_NAMES = { 0: '対象外', 1: '対象' }

/** モックの可変状態をフィクスチャの内容に戻す */
export function resetSymbolRows() {
  symbolRows = [...symbols, ...canceledSymbols]
}

export const symbolHandlers = [
  /*
   * 銘柄マスタの一覧。取消済み（取消区分 1）は既定で返さない。
   *
   * **クエリ名は英語**（`symbol` / `restriction` / `route` / `vwap_target`）。レスポンスのキーは
   * 日本語なので、リクエストとレスポンスで名前の系統が違う。`limit` は受け付ける（既定 50）。
   * `symbol` の絞り込みは実 API の `LIKE %s` に合わせた**部分一致**で、
   * 画面の検索欄 1 つで銘柄コードと Ticker のどちらにも当たるようにしてある
   * （実 API の `symbol` が Ticker にも当たるかは未確認。当たらないなら検索欄を 2 つに分ける）。
   * **銘柄名では絞らない**（実 API は `name_ja` / `name_en` を別のパラメータに分けている）。
   * 区分 3 つは完全一致。
   * `ticker`（新規注文のティッカー照会）は Ticker だけに当てる。一致の仕方は仕様に無いので
   * `symbol` と同じ部分一致にしておく（完全一致への絞り込みは呼び出し側がする）。
   *
   * CSV 入出力と更新履歴（/masters/symbols/export-csv ほか）は画面が使わないのでモックしない。
   */
  http.get('*/api/masters/symbols', ({ request }) => {
    const params = new URL(request.url).searchParams
    // DB 照合は大文字小文字を区別しないので、モックも大文字に寄せてから比べる
    const symbolCode = (params.get('symbol') ?? '').trim().toUpperCase()
    const ticker = (params.get('ticker') ?? '').trim().toUpperCase()
    const regulation = params.get('restriction') ?? ''
    const orderRoute = params.get('route') ?? ''
    const vwapTarget = params.get('vwap_target') ?? ''
    const includeDeleted = params.get('include_deleted') === 'true'
    const limit = toNonNegativeInt(params.get('limit'), 50)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    const filtered = symbolRows
      .filter(
        (symbol) =>
          (includeDeleted || symbol.取消区分 === 0) &&
          (!symbolCode ||
            symbol.銘柄コード.toUpperCase().includes(symbolCode) ||
            symbol.Ticker.toUpperCase().includes(symbolCode)) &&
          (!ticker || symbol.Ticker.toUpperCase().includes(ticker)) &&
          (!regulation || symbol.規制情報 === regulation) &&
          (!orderRoute || symbol.注文ルート === orderRoute) &&
          (!vwapTarget || symbol.VWAP対象区分 === vwapTarget),
      )
      /*
       * 実 API の ORDER BY は仕様に書かれていないので、銘柄コードの昇順を仮に置く。
       * 主キーが ID になっても ID 昇順には寄せない。画面は銘柄コードで探し、追加・更新の
       * 成功メッセージも銘柄コードで示すので、人が読む並びとしてはこちらが一貫する
       * （実 API の並びはバックエンドへの確認事項）。
       */
      .sort((a, b) => a.銘柄コード.localeCompare(b.銘柄コード))

    return HttpResponse.json({
      // total は絞り込み後・ページ切り出し前の件数
      total: filtered.length,
      limit,
      offset,
      // 配列名だけワイヤ上は stocks（SymbolListResponse の項目名）
      stocks: filtered.slice(offset, offset + limit),
    })
  }),

  /*
   * 銘柄の入力内容の事前検証（登録・更新はしない）。
   *
   * 仕様（`新規登録時の銘柄コード重複チェック / 変更時の銘柄存在チェック`）どおり、
   * `is_update` で見るものが切り替わる。
   *
   * **変更検証の対象はクエリの `symbol_id`（主キー）で指す**（CA の `ca_id` と同じ形。
   * 2026-09-18 の取り込みで仕様に入った）。その ID を currentId として渡すので、
   * 重複検査は自分自身を重複と見なさない。
   *
   * 必須と文字数は pydantic（SymbolRequest）が先に見るので、ここではなく 422 になる。
   * この事前検証に残るのはコードマスタの照合と、重複または存在の確認だけ。
   */
  http.post('*/api/masters/symbols/validate', async ({ request }) => {
    const body = await request.json().catch(() => null)
    const violation = symbolRequestViolation(body)
    if (violation) return violation

    const query = new URL(request.url).searchParams
    const isUpdate = query.get('is_update') === 'true'
    const currentId = query.has('symbol_id') ? Number(query.get('symbol_id')) : null
    const symbol = toSymbolInput(body)

    const target = isUpdate ? findSymbolRowById(currentId) : null
    const errors = symbolServiceErrors(symbol, { currentId: target?.ID ?? null })
    if (isUpdate && (!target || target.取消区分 === 1)) {
      errors.push(`指定された銘柄(ID=${currentId})は存在しません`)
    }

    return HttpResponse.json({
      valid: errors.length === 0,
      errors,
      /*
       * 銘柄マスタに「登録できるが確認したいこと」は無い。取消済みの銘柄コードは
       * 重複として弾かれ、再有効化という経路を持たないため（海外休場日はそれがある）。
       */
      warnings: [],
      details: errors.length === 0 ? toSymbolValidationDetails(symbol) : null,
    })
  }),

  // 銘柄の新規登録。ID はサーバが採番し、銘柄コードは一意制約で重複を弾く
  http.post('*/api/masters/symbols', async ({ request }) => {
    const body = await request.json().catch(() => null)
    const violation = symbolRequestViolation(body)
    if (violation) return violation

    const symbol = toSymbolInput(body)
    const errors = symbolServiceErrors(symbol)
    if (errors.length > 0) return detailError(400, errors[0])

    const created = toMockSymbolItem(symbol)
    symbolRows = [...symbolRows, created]

    return HttpResponse.json(
      // 1 件の入れ物もワイヤ上は stock（SymbolResponse の項目名）
      { success: true, stock: created, message: '銘柄を登録しました' },
      { status: 201 },
    )
  }),

  /*
   * 銘柄の更新（銘柄コード以外を変更できる）。
   *
   * 検査の順序は CA と同じ「本文の形(422) → 対象が居るか(404) → 値の妥当性(400) →
   * 盤面が古くないか(409)」。受注不可日の PUT にある「競合を重複より先に見る」という
   * 理由付けは写さないこと（あちらは主キーが日付そのもので、重複と競合が同じ行を指すため）。
   *
   * **パスキーは ID。** 取り込み時点の openapi.json はまだ `/masters/symbols/{symbol}`
   * （銘柄コード）だが、DB の主キーを id に寄せる方針に合わせて先に置いている
   * （src/api/symbols.js の updateSymbol と対）。実 API が {symbol} のままなら、
   * 直すのはここと api 層の 1 行ずつ。
   */
  http.put('*/api/masters/symbols/:id', async ({ params, request }) => {
    const body = await request.json().catch(() => null)
    const violation = symbolRequestViolation(body)
    if (violation) return violation

    const targetId = Number(params.id)
    const current = symbolRows.find((row) => row.ID === targetId && row.取消区分 === 0)
    if (!current) {
      return detailError(404, '指定された銘柄データが存在しません')
    }

    const symbol = toSymbolInput(body)
    const errors = symbolServiceErrors(symbol, { currentId: targetId })
    if (errors.length > 0) return detailError(400, errors[0])

    // 楽観的ロック。取得してから保存するまでに他の担当者が更新していれば弾く
    if (!isSameTimestamp(symbol.updatedAt, current.更新日時)) {
      return detailError(
        409,
        '他のユーザーによって銘柄データが更新されています。最新データを再取得してください。',
      )
    }

    const updated = {
      // 送られてこなかった項目は消える（保持はバックエンドの責務。理由は toMockSymbolItem）
      ...toMockSymbolItem(symbol, { id: targetId }),
      // 作成の記録だけは引き継ぐ（UPDATE は INSERT の記録を書き換えない）
      作成日時: current.作成日時,
      作成者: current.作成者,
    }
    symbolRows = symbolRows.map((row) => (row.ID === targetId ? updated : row))

    return HttpResponse.json({ success: true, stock: updated, message: '銘柄を更新しました' })
  }),

  /*
   * 銘柄の論理削除。行は残したまま 取消区分 を 1 にする（一覧は既定で取消済みを返さないので
   * 読み直すと消える）。CA と同じく ユーザー操作フラグ も 1 に立てる
   * （include_deleted=true で見たときに「画面から消された行」だと分かる）。
   *
   * 本文も合札も見ない。実 API の DELETE は本文を取らず 更新日時 を照合しないので、
   * PUT にある 409 の経路はここに無い。
   *
   * **パスキーは PUT と同じく ID**（src/api/symbols.js の deleteSymbol と対）。
   */
  http.delete('*/api/masters/symbols/:id', ({ params }) => {
    const targetId = Number(params.id)
    const target = symbolRows.find((row) => row.ID === targetId && row.取消区分 === 0)

    if (!target) {
      return detailError(404, '指定された銘柄が存在しないか、既に削除されています')
    }

    const deleted = {
      ...target,
      取消区分: 1,
      ユーザー操作フラグ: 1,
      取消日時: nowIsoTimestamp(),
      取消者: '006',
    }
    symbolRows = symbolRows.map((row) => (row.ID === targetId ? deleted : row))

    return HttpResponse.json({ success: true, stock: deleted, message: '銘柄を削除しました' })
  }),
]

/**
 * `SymbolRequest` の宣言（pydantic）で弾かれるもの。
 * 必須 3 項目と、文字数の上限を持つ項目・数値項目の型を見る。
 *
 * 画面は必須 3 項目を先に弾き、maxlength も入力欄に付けてあるので、
 * 通常の操作でここに落ちることは無い（API 層の単体テストと直叩きのための関門）。
 */
function symbolRequestViolation(body) {
  const required = [
    { field: '銘柄コード', max: 14 },
    { field: 'Ticker', max: 10 },
    { field: '銘柄名', max: 200 },
  ]
  for (const { field, max } of required) {
    const value = body?.[field]
    if (typeof value !== 'string') {
      return requestValidationError(['body', field], 'Field required', 'missing')
    }
    if (value.length < 1) {
      return requestValidationError(
        ['body', field],
        'String should have at least 1 character',
        'string_too_short',
      )
    }
    if (value.length > max) {
      return requestValidationError(
        ['body', field],
        `String should have at most ${max} characters`,
        'string_too_long',
      )
    }
  }

  // 任意の文字列項目は null を許す。長さだけを見る
  for (const [field, max] of [
    ['銘柄名_英字', 200],
    ['市場名', 20],
    ['規制情報', 20],
    ['備考', 200],
  ]) {
    const value = body?.[field]
    if (typeof value === 'string' && value.length > max) {
      return requestValidationError(
        ['body', field],
        `String should have at most ${max} characters`,
        'string_too_long',
      )
    }
  }

  // 注文ルート は nullable でない（null を送ると型で弾かれる）
  const orderRoute = body?.注文ルート
  if (orderRoute !== undefined && typeof orderRoute !== 'string') {
    return requestValidationError(
      ['body', '注文ルート'],
      'Input should be a valid string',
      'string_type',
    )
  }

  const previousClose = body?.前日終値
  if (previousClose !== null && previousClose !== undefined) {
    if (!Number.isFinite(previousClose)) {
      return requestValidationError(
        ['body', '前日終値'],
        'Input should be a valid number',
        'float_type',
      )
    }
    if (previousClose < 0) {
      return requestValidationError(
        ['body', '前日終値'],
        'Input should be greater than or equal to 0',
        'greater_than_equal',
      )
    }
  }

  for (const field of ['前日出来高', '平均出来高']) {
    const value = body?.[field]
    if (value === null || value === undefined) continue
    if (!Number.isInteger(value)) {
      return requestValidationError(['body', field], 'Input should be a valid integer', 'int_type')
    }
    if (value < 0) {
      return requestValidationError(
        ['body', field],
        'Input should be greater than or equal to 0',
        'greater_than_equal',
      )
    }
  }

  return null
}

/**
 * SymbolRequest（日本語キー）を、このモックが扱いやすい形に読み替える。
 * symbolRequestViolation を通した本文にだけ使う（型はそこで保証されている）。
 */
function toSymbolInput(body) {
  return {
    symbolCode: body.銘柄コード,
    ticker: body.Ticker,
    name: body.銘柄名,
    // nullable な項目は空文字に寄せず、送られてきた形のまま保存する
    nameEn: typeof body.銘柄名_英字 === 'string' ? body.銘柄名_英字 : null,
    marketName: typeof body.市場名 === 'string' ? body.市場名 : null,
    regulation: typeof body.規制情報 === 'string' ? body.規制情報 : null,
    // 既定を持つ 2 つは、送られてこなければ実 API と同じ '0' になる
    orderRoute: typeof body.注文ルート === 'string' ? body.注文ルート : '0',
    vwapTarget: typeof body.VWAP対象区分 === 'string' ? body.VWAP対象区分 : '0',
    preFlag: Number.isInteger(body.Pre区分) ? body.Pre区分 : 0,
    note: typeof body.備考 === 'string' ? body.備考 : null,
    previousClose: body.前日終値 ?? null,
    previousVolume: body.前日出来高 ?? null,
    averageVolume: body.平均出来高 ?? null,
    updatedAt: typeof body.更新日時 === 'string' ? body.更新日時 : null,
  }
}

/**
 * サービス層が見る妥当性（コードマスタの照合と銘柄コードの重複）。
 * pydantic と違い**まとめて全件返す**（事前検証の応答は errors の配列なので、
 * 直せるところを一度に見せられる）。
 *
 * **重複検査の根拠は主キーではなく一意制約。** 主キーが ID になっても、実 API が
 * `/masters/symbols/{symbol}`（詳細照会・更新履歴）として銘柄コードで 1 件を指し続ける以上、
 * 銘柄コードは行を一意に指せなければならない。ここはその一意制約を模すもので、
 * 「同じコードの行が既にあるが、それが自分ではない」を違反とする。
 *
 * 取消済みの行も母数に入れるのは、その一意制約が取消区分を条件に持たない
 * （部分索引ではない）と見ているため。**この点はバックエンド未確認。**
 * 論理削除した銘柄コードを再登録できるようにするなら、ここを 取消区分 === 0 に絞り、
 * 同時に「再有効化」の経路（海外休場日の warnings のような）が要る。
 *
 * 対象の存在確認はここに入れない（本文だけを見る関数のままにしておく）。
 * validate と PUT のハンドラがそれぞれ見る（CA と同じ形）。
 *
 * @param {{ currentId?: number|null }} [options]
 *   currentId は更新対象の行 ID。新規登録では null（自分自身が存在しないため）
 * @returns {string[]} 問題が無ければ空配列
 */
function symbolServiceErrors({ symbolCode, orderRoute, vwapTarget }, { currentId = null } = {}) {
  const errors = []

  const duplicate = findSymbolRow(symbolCode)
  if (duplicate && duplicate.ID !== currentId) {
    errors.push(`銘柄コード(${symbolCode})は既に登録されています`)
  }

  for (const [label, value, names] of [
    ['注文ルート', orderRoute, ORDER_ROUTE_NAMES],
    ['VWAP対象区分', vwapTarget, VWAP_TARGET_NAMES],
  ]) {
    if (value !== null && !Object.hasOwn(names, value)) {
      errors.push(`${label}(${value})はコードマスタに存在しません`)
    }
  }

  return errors
}

/**
 * 銘柄コードで 1 行引く（DB 照合は大文字小文字を区別しないのでモックも寄せる）。
 *
 * export しているのは、残高マスタのモックが実 API の「m_銘柄情報 と結合して Ticker・銘柄名を
 * 返す」を模すため。行の配列そのものは export しない（他のファイルから書き換えられないように）。
 */
export function findSymbolRow(symbolCode) {
  const needle = String(symbolCode ?? '').toUpperCase()

  return symbolRows.find((row) => row.銘柄コード.toUpperCase() === needle) ?? null
}

/** 主キー（ID）で 1 行引く。変更検証の対象を指すのに使う（取消済みの行も返す） */
function findSymbolRowById(id) {
  return symbolRows.find((row) => row.ID === id) ?? null
}

/** ID の採番。実 API の AUTO_INCREMENT と同じく単調増加（取消済みの行も母数に入れる） */
function nextSymbolId() {
  return Math.max(0, ...symbolRows.map((symbol) => symbol.ID)) + 1
}

/**
 * SymbolItem を組み立てる（登録・更新の応答用）。
 *
 * **更新でも「現在の行を広げて上書き」はしない。** 引き継ぐのは ID と作成の記録だけで
 * （それはハンドラ側がやる）、残りは送られてきた本文だけから組む。こうすると
 * `市場名` / `前日出来高` / `Pre区分` のように **画面が送らない項目が更新で消える**ことが
 * モックの上でもそのまま起きる。送られてこなかった項目を保つのはバックエンドの責務だが、
 * それは**まだ確認中**なので、モックが先回りして保つと「実 API に繋いだ瞬間に値が消える」
 * 事故を隠してしまう。CA の PUT は `{ ...current, … }` と書いているが、
 * CA は全項目をフォームが持つので差が出ない。**ここへは写さないこと。**
 *
 * @param {object} [options]
 * @param {number} [options.id] 更新のときは対象の ID。省略すると新しい ID を採番する
 */
function toMockSymbolItem(symbol, { id = nextSymbolId() } = {}) {
  return {
    ID: id,
    銘柄コード: symbol.symbolCode,
    Ticker: symbol.ticker,
    銘柄名: symbol.name,
    銘柄名_英字: symbol.nameEn,
    市場名: symbol.marketName,
    規制情報: symbol.regulation,
    // 区分名 3 つは DB の列ではなく、応答を組み立てるときにコードマスタから付ける表示項目
    規制情報名: REGULATION_NAMES[symbol.regulation] ?? null,
    注文ルート: symbol.orderRoute,
    注文ルート名: ORDER_ROUTE_NAMES[symbol.orderRoute] ?? null,
    VWAP対象区分: symbol.vwapTarget,
    VWAP対象区分名: VWAP_TARGET_NAMES[symbol.vwapTarget] ?? null,
    Pre区分: symbol.preFlag,
    備考: symbol.note,
    前日終値: symbol.previousClose,
    前日出来高: symbol.previousVolume,
    平均出来高: symbol.averageVolume,
    取消区分: 0,
    // 画面からの登録なので 1（システム連携ではない）
    ユーザー操作フラグ: 1,
    作成日時: nowIsoTimestamp(),
    作成者: '006',
    // CA と違い、実 API は登録時にも更新日時を入れる（次の更新で合札として送り返される）
    更新日時: nowIsoTimestamp(),
    更新者: '006',
    取消日時: null,
    取消者: null,
  }
}

/**
 * SymbolValidationResponse の details（事前検証が返す入力の解析結果）。
 * openapi.json では `additionalProperties: true` で中身が未定義なので、
 * 「解析した入力 + サーバが補完した名称」を返すという推測で置いている。
 * **フロントはこの値を読まない**（読み始めるならバックエンドに形を確認すること）。
 */
function toSymbolValidationDetails(symbol) {
  return {
    銘柄コード: symbol.symbolCode,
    Ticker: symbol.ticker,
    銘柄名: symbol.name,
    規制情報: symbol.regulation,
    規制情報名: REGULATION_NAMES[symbol.regulation] ?? null,
    注文ルート: symbol.orderRoute,
    注文ルート名: ORDER_ROUTE_NAMES[symbol.orderRoute] ?? null,
    VWAP対象区分: symbol.vwapTarget,
    VWAP対象区分名: VWAP_TARGET_NAMES[symbol.vwapTarget] ?? null,
  }
}
