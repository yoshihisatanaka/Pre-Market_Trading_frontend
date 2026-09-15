import { apiClient } from './client'

/*
 * 銘柄マスタ（実 API `/masters/symbols`）。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次の 5 点。
 *   - レスポンスのプロパティ名が日本語（銘柄コード / Ticker / 銘柄名_英字 / 前日終値 …）
 *   - **検索クエリ名だけは英語**（`symbol` / `ticker` / `restriction` / `route` / `vwap_target`）。
 *     レスポンスの日本語キーと対応しないので、両者を混同しない
 *   - フラグが 0 / 1 の integer（取消区分・ユーザー操作フラグ）。アプリ内は boolean
 *   - 一覧の配列名が `stocks`（モデル名は SymbolListResponse なのにここだけ stock を名乗る。
 *     ワイヤ上の名前なのでこの層の中で吸収し、外へは出さない）
 *   - 削除は論理削除（取消区分=1）。一覧は既定で取消済みを返さない
 *
 * 画面の検索欄（銘柄コード・ティッカーコード）は `symbol` パラメータにだけ乗る。
 * 実 API は `symbol` / `ticker` / `name_ja` / `name_en` をそれぞれ別のパラメータに
 * 分けていて、まとめて 1 語で探すパラメータが無いため、**この欄では銘柄名では絞れない**。
 *
 * いまは一覧の取得と登録を持つ。更新・削除、CSV 入出力、更新履歴は別途。
 *
 * **登録の本文（SymbolRequest）には `市場名` / `前日出来高` / `Pre区分` を載せない。**
 * 画面のフォームがこの 3 項目を持たないため。理由は toSymbolRequest() のコメントを参照。
 */

/**
 * 1 件のアプリ内モデル（このファイルの JSDoc で使う）
 *
 * @typedef {{
 *   symbolCode: string,
 *   ticker: string,
 *   name: string,
 *   nameEn: string,
 *   marketName: string,
 *   regulation: string,
 *   regulationName: string,
 *   orderRoute: string,
 *   orderRouteName: string,
 *   vwapTarget: string,
 *   vwapTargetName: string,
 *   note: string,
 *   previousClose: number|null,
 *   previousVolume: number|null,
 *   averageVolume: number|null,
 *   userModified: boolean,
 *   updatedAt: string,
 * }} Symbol
 *   symbolCode が主キー（実 API も銘柄コードをキーにしている）。
 *   数値 3 種は null のまま通す。0 と「未取得」を区別したいので空文字や 0 に寄せない
 *   （整形は utils/format.js の formatUsd / formatQuantity が null を '—' にする）。
 *   userModified は ユーザー操作フラグ=1（手動操作された行）。一覧で色を付ける印になる。
 *   updatedAt は楽観的ロックの合札。更新のときに取得時の値をそのまま送り返す
 */

/**
 * 銘柄の一覧を取得する。
 *
 * ページャーを持つ一覧なので、配列ではなく `{ items, total }` を返す。
 *
 * 取消済み（論理削除）の行は含めない。実 API の include_deleted は既定 false なので送らない。
 *
 * 画面の検索欄 1 つは `symbol` にだけ乗せる。実 API は `ticker` を別パラメータに分けているが、
 * 欄を 2 つに割るかはバックエンドの `symbol` が Ticker にも当たるか次第なので、
 * 確認が付くまでは従来どおり 1 つの欄・1 つのパラメータで通す。
 *
 * @param {{
 *   limit?: number,
 *   offset?: number,
 *   symbolCode?: string,
 *   regulation?: string,
 *   orderRoute?: string,
 *   vwapTarget?: string,
 * }} [params]
 *   limit は 1..200（実 API の既定は 50）。symbolCode は銘柄コードまたは Ticker。
 *   regulation / orderRoute / vwapTarget は utils/symbolTypes.js のコード値。
 *   空文字は「条件なし」としてリクエストに載せない
 * @returns {Promise<{ items: Symbol[], total: number }>}
 */
export async function fetchSymbols({
  limit = 50,
  offset = 0,
  symbolCode = '',
  regulation = '',
  orderRoute = '',
  vwapTarget = '',
} = {}) {
  const { data } = await apiClient.get('/masters/symbols', {
    // クエリ名を知ってよいのはこの層だけ。値が undefined のパラメータは axios が送らない
    params: {
      limit,
      offset,
      symbol: symbolCode || undefined,
      restriction: regulation || undefined,
      route: orderRoute || undefined,
      vwap_target: vwapTarget || undefined,
    },
  })

  return {
    items: (data.stocks ?? []).map(toSymbol),
    total: data.total ?? 0,
  }
}

/**
 * 銘柄の入力内容をサーバに検証させる（登録・更新はしない）。
 *
 * 実 API が見るのは「必須項目・文字数制限 / コードマスタ（注文ルート・VWAP対象区分）/
 * 新規登録時の銘柄コード重複・変更時の銘柄存在」。画面は必須の未入力だけを先に弾き、
 * 残りはここに委ねる。
 *
 * 不合格は例外にしない（`{ valid: false, errors }` を返す）。通信・サーバ障害だけが throw され、
 * 呼び出し側（useCrudList）が両者を別の入れ物に入れる。
 *
 * **`warnings` は受け取らない。** 応答（SymbolValidationResponse）は warnings を持つが、
 * 銘柄マスタでは常に空とみなす。ここで返すと useCrudList が「1 回目は登録せずに戻る」経路へ
 * 入るので、画面がその理由を出さない限り「追加を押しても何も起きない」状態になる
 * （CA と同じ扱い。海外休場日だけが再有効化の確認に warnings を使う）。
 *
 * @param {Symbol & { isUpdate?: boolean }} params
 *   isUpdate は編集からの呼び出しのときだけ true（自分自身を重複と見なさせないため）
 * @returns {Promise<{ valid: boolean, errors: string[] }>}
 *   valid が false のときだけ errors に理由が入る
 */
export async function validateSymbol({ isUpdate = false, ...symbol }) {
  const { data } = await apiClient.post(
    '/masters/symbols/validate',
    toSymbolRequest(symbol),
    // 既定が新規検証なので、変更検証のときだけクエリを付ける
    isUpdate ? { params: { is_update: true } } : undefined,
  )

  return {
    valid: Boolean(data?.valid),
    // errors は default_factory 付きだが、実 API 以外（プロキシのエラー等）に備える
    errors: Array.isArray(data?.errors) ? data.errors : [],
  }
}

/**
 * 銘柄を 1 件登録する。
 *
 * 主キーは銘柄コードそのものなので、既にあるコードはサーバが弾く（事前検証で先に分かる）。
 * ユーザー操作フラグ=1 はサーバが立てる。
 *
 * @param {Symbol} symbol
 * @returns {Promise<Symbol>} 登録された 1 件
 */
export async function createSymbol(symbol) {
  const { data } = await apiClient.post('/masters/symbols', toSymbolRequest(symbol))

  // 1 件の入れ物も一覧の配列と同じくワイヤ上は stock（SymbolResponse の項目名）
  return toSymbol(data.stock)
}

/**
 * アプリ内モデル → SymbolRequest（登録・更新・事前検証で共用する入力の形）。
 *
 * **`市場名` / `前日出来高` / `Pre区分` は載せない。** 画面のフォームがこの 3 項目を持たないため
 * （相場の 2 値は自動取込、市場名と Pre区分 は画面モックに欄が無い）。SymbolRequest は
 * レコード全体を差し替える形なので、更新でこれらの現在値が消えうるが、**送られてこなかった
 * 項目を保つのはバックエンドの責務**とする（確認事項として起票済み）。
 *
 * 未設定の送りかたは項目ごとに違う。文字列の任意項目と数値 2 項目は null を明示するが、
 * `注文ルート` と `VWAP対象区分` だけは '0' に寄せる（前者は型宣言が null を許さず、
 * どちらも既定が '0'）。画面のセレクトも未選択を作らないので、通常ここは通らない。
 */
function toSymbolRequest({
  symbolCode,
  ticker,
  name,
  nameEn = '',
  regulation = '',
  orderRoute = '',
  vwapTarget = '',
  note = '',
  previousClose = null,
  averageVolume = null,
  updatedAt = '',
}) {
  return {
    銘柄コード: symbolCode,
    Ticker: ticker,
    銘柄名: name,
    // nullable な項目は空欄を「未設定」として null で明示する（空文字を送らない）
    銘柄名_英字: nameEn || null,
    規制情報: regulation || null,
    注文ルート: orderRoute || '0',
    VWAP対象区分: vwapTarget || '0',
    備考: note || null,
    前日終値: toApiNumber(previousClose),
    平均出来高: toApiNumber(averageVolume),
    /*
     * 楽観的ロックの合札。無いときはキーごと送らない（実 API 側は未指定を「照合しない」と
     * 解釈する）。書式は変換しない（照合用の不透明なトークンなので、秒未満の桁を落とすような
     * 整形はかえって不一致を作る。src/api/ca.js の toCaRequest に同じ経緯がある）。
     */
    ...(updatedAt ? { 更新日時: updatedAt } : {}),
  }
}

/**
 * 入力欄の文字列を数値に寄せる。空欄と数値にならないものは null（「未設定」を明示する）。
 *
 * 画面の入力欄は inputmode を指定していても値を文字列で持つので、この層で数値に直す。
 */
function toApiNumber(value) {
  if (value === null || value === undefined || value === '') return null

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** SymbolItem → アプリ内モデル */
function toSymbol(raw) {
  return {
    // 主キーは銘柄コードそのもの（CA のような数値 ID は無い）
    symbolCode: raw?.銘柄コード ?? '',
    // nullable な項目は空文字に寄せて、画面が null を出さないようにする
    ticker: raw?.Ticker ?? '',
    name: raw?.銘柄名 ?? '',
    nameEn: raw?.銘柄名_英字 ?? '',
    marketName: raw?.市場名 ?? '',
    regulation: raw?.規制情報 ?? '',
    // 表示名はサーバが付けて返す。欠けているときは画面側がコードから補う
    regulationName: raw?.規制情報名 ?? '',
    orderRoute: raw?.注文ルート ?? '',
    orderRouteName: raw?.注文ルート名 ?? '',
    vwapTarget: raw?.VWAP対象区分 ?? '',
    vwapTargetName: raw?.VWAP対象区分名 ?? '',
    note: raw?.備考 ?? '',
    /*
     * 相場の数値だけは null のまま通す。「0 株」と「まだ取れていない」は別の意味で、
     * 空文字や 0 に寄せると一覧でその区別が消える（整形側が null を '—' にする）。
     */
    previousClose: toNumberOrNull(raw?.前日終値),
    previousVolume: toNumberOrNull(raw?.前日出来高),
    averageVolume: toNumberOrNull(raw?.平均出来高),
    // 0 / 1 の integer は、この層で boolean に直して外へ出す
    userModified: raw?.ユーザー操作フラグ === 1,
    /*
     * 楽観的ロックの合札。実 API は ISO の日時を返し、登録直後の行では null になる。
     * 照合はサーバが行うので Date には通さず素の文字列で持つ。undefined のまま持つと
     * 更新時の JSON.stringify でキーごと消え、サーバから見て「送っていない」と「空」が
     * 区別できなくなるため文字列に寄せる（src/api/ca.js と同じ扱い）。
     */
    updatedAt: raw?.更新日時 ?? '',
  }
}

/**
 * 数値に寄せる。数値にならないもの（null / undefined / 空文字 / 文字列）は null。
 *
 * 実 API は number / integer を返す約束だが、未取得を null で表す項目なので
 * 「数値でなければ未取得」として扱う。
 */
function toNumberOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}
