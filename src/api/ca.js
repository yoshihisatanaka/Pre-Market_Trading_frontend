import { apiClient } from './client'

/*
 * CAマスタ（コーポレートアクション。実 API `/masters/ca`）。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次の 5 点。
 *   - プロパティ名が日本語（ID / 銘柄コード / CA種別 / 権利付最終日 …）
 *   - 日付は integer の YYYYMMDD（20260901）。アプリ内は 'YYYY-MM-DD'
 *   - フラグが 0 / 1 の integer（取消区分・ユーザー操作フラグ）。アプリ内は boolean
 *   - 一覧の配列名が `ca_list`、1 件の応答のキーが `ca`
 *   - 削除は論理削除（取消区分=1）。一覧は既定で取消済みを返さない
 *
 * 一覧の取得と登録・更新（事前検証つき）・削除を持つ。CSV 入出力と更新履歴は別途。
 * 更新系は `X-User-Code` ヘッダが必須。付与は client.js の interceptor が全 API 共通で行う。
 */

/**
 * 1 件のアプリ内モデル（このファイルの JSDoc で使う）
 *
 * @typedef {{
 *   id: string,
 *   stockCode: string,
 *   ticker: string,
 *   caType: string,
 *   caTypeName: string,
 *   exRightsDate: string,
 *   effectiveDate: string,
 *   paymentDate: string,
 *   denominator: number|null,
 *   numerator: number|null,
 *   ratio: string,
 *   note: string,
 *   userModified: boolean,
 *   updatedAt: string,
 * }} CorporateAction
 *   id は実 API の ID を文字列にしたもの。日付 3 種は 'YYYY-MM-DD'（未設定は空文字）。
 *   denominator / numerator は編集フォームの初期値に使う生の数値（未設定は null。
 *   `比率` は表示用にサーバが組んだ文字列で、こちらは入力へ戻せない）。
 *   userModified は ユーザー操作フラグ=1（手動操作された行）。一覧で色を付ける印になる。
 *   updatedAt は編集の楽観的ロックで送り返す合札
 */

/**
 * 入力 1 件のアプリ内モデル（登録・更新・事前検証に渡す形）
 *
 * @typedef {{
 *   stockCode: string,
 *   caType: string,
 *   exRightsDate?: string,
 *   effectiveDate?: string,
 *   paymentDate?: string,
 *   denominator?: number|string|null,
 *   numerator?: number|string|null,
 *   note?: string,
 * }} CorporateActionInput
 *   日付 3 種は 'YYYY-MM-DD'、空文字は「未設定」。denominator / numerator は
 *   画面の `type="number"` が文字列を持つので数値でも文字列でも受ける（この層で数値に直す）
 */

/**
 * CA の一覧を取得する。
 *
 * ページャーを持つ一覧なので、配列ではなく `{ items, total }` を返す。
 *
 * 取消済み（論理削除）の行は含めない。実 API の include_deleted は既定 false なので送らない。
 *
 * @param {{ limit?: number, offset?: number, stockCode?: string, caType?: string }} [params]
 *   stockCode は銘柄コードまたは Ticker。caType は CA種別コード（'110' など）。
 *   空文字は「条件なし」としてリクエストに載せない
 * @returns {Promise<{ items: CorporateAction[], total: number }>}
 */
export async function fetchCorporateActions({
  limit = 50,
  offset = 0,
  stockCode = '',
  caType = '',
} = {}) {
  const { data } = await apiClient.get('/masters/ca', {
    // クエリ名を知ってよいのはこの層だけ。値が undefined のパラメータは axios が送らない
    params: {
      limit,
      offset,
      /*
       * 銘柄の絞り込みは `symbol`（2026-09-16 の仕様取り込みで `stock_code` から改名された。
       * `/masters/symbols` や `/masters/ca/export-csv` も同じ改名）。
       * アプリ内の名前（stockCode）と URL クエリ（stock_code）は変えていない。
       * FastAPI は知らないクエリを黙って無視するので、旧名のままだと絞り込みが
       * エラーにならずに効かなくなる。
       */
      symbol: stockCode || undefined,
      ca_type: caType || undefined,
    },
  })

  return {
    items: (data.ca_list ?? []).map(toCorporateAction),
    total: data.total ?? 0,
  }
}

/**
 * CA の入力内容を事前検証する（DB には登録・更新しない）。
 *
 * 実 API は「事前検証を通過した内容を登録する」前提で、銘柄コードが銘柄マスタに実在するか・
 * 日付が妥当か・比率が数値かはサーバだけが判断できる。登録・更新の前にこれを呼び、
 * 不合格ならそこへ進まない。
 *
 * 不合格は例外にしない（`{ valid: false, errors }` を返す）。通信・サーバ障害だけが throw される。
 *
 * **`warnings` は受け取らない。** 応答（CAValidationResponse）は warnings を持つが、
 * CA では常に空とみなす。CA の主キーは surrogate な ID で、登録は必ず新しい行を INSERT するため
 * 「取消済みの行を再有効化する」ような確認事項が起きない（海外休場日はそれがあるので警告を使う）。
 * ここで warnings を返すと useCrudList が「1 回目は登録せずに戻る」経路へ入るので、
 * 画面がその理由を出さない限り「追加を押しても何も起きない」状態になる。
 * 将来サーバが warnings を返し始めたら、この層で受け取って画面に確認の導線を足す。
 *
 * **`is_update` の決め方は受注不可日と違う。** 実 API は検証対象の CA を本文ではなく
 * クエリの `ca_id` で受けるので、「何を書き換えたか」に関わらず対象は変わらない。
 * 編集からの呼び出しかどうか（= id を持つか）だけで決まる。
 * 受注不可日は主キーが日付そのものなので「日付を変えたか」を見る必要があった（blackoutDates.js 参照）。
 *
 * @param {CorporateActionInput & { id?: string, updatedAt?: string }} params
 *   id は編集のときだけ渡す（実 API の ID を文字列にしたもの）。
 *   updatedAt は受け取るが送らない（編集の payload をそのまま渡せるようにするためだけ）
 * @returns {Promise<{ valid: boolean, errors: string[] }>}
 *   valid が false のときだけ errors に理由が入る
 */
export async function validateCorporateAction({ id = '', updatedAt: _updatedAt = '', ...ca }) {
  const { data } = await apiClient.post(
    '/masters/ca/validate',
    // 更新日時 は本文から落とす（事前検証は楽観的ロックの照合をしない）
    toCaRequest(ca),
    // 既定が新規検証なので、変更検証のときだけクエリを付ける（ca_id は integer 宣言）
    id ? { params: { ca_id: Number(id), is_update: true } } : undefined,
  )

  return {
    valid: Boolean(data?.valid),
    // errors は default_factory 付きだが、実 API 以外（プロキシのエラー等）に備える
    errors: Array.isArray(data?.errors) ? data.errors : [],
  }
}

/**
 * CA を 1 件登録する。
 *
 * 実 API は必ず新しい行を INSERT する（CA には自然キーが無く、同じ銘柄・同じ CA種別・
 * 同じ日付の行が複数あっても正当）。ユーザー操作フラグ=1 はサーバが立てる。
 *
 * Ticker は送らない。実 API が銘柄コードから銘柄マスタを引いて補完する。
 *
 * @param {CorporateActionInput} ca
 * @returns {Promise<CorporateAction>} 登録された 1 件
 */
export async function createCorporateAction(ca) {
  const { data } = await apiClient.post('/masters/ca', toCaRequest(ca))

  return toCorporateAction(data.ca)
}

/**
 * CA を 1 件更新する（全項目を変更できる）。
 *
 * `CARequest` はレコード全体を差し替える形なので、変えない項目も含めて送る。
 * 呼び出し側は編集フォームの現在値をそのまま渡せばよい。
 *
 * updatedAt は一覧取得時の更新日時をそのまま送り返す楽観的ロックの合札で、
 * サーバ側の現在値と違えば 409 で弾かれる（他の利用者が先に更新していた場合）。
 * 書式は変換しない（理由は toCaRequest のコメント）。
 *
 * @param {CorporateActionInput & { id: string, updatedAt?: string }} params
 *   id は更新対象の CA ID（実 API では integer なのでパスへ入れる前に数値に寄せる）
 * @returns {Promise<CorporateAction>} 更新後の 1 件
 */
export async function updateCorporateAction({ id, ...ca }) {
  const { data } = await apiClient.put(`/masters/ca/${encodeURIComponent(id)}`, toCaRequest(ca))

  return toCorporateAction(data.ca)
}

/**
 * CA を 1 件削除する（実 API は論理削除。取消区分=1・ユーザー操作フラグ=1 になる）。
 *
 * 応答は削除後の 1 件（CAResponse）だが、画面は削除前の行を使ってメッセージを出すので
 * 使い道が無い。呼び出し側が useAsync で成否を判定できるよう、削除した id を返す。
 *
 * 楽観的ロックは無い（実 API の DELETE は本文を取らず、更新日時 を照合しない）。
 *
 * @param {string} id 削除対象の CA ID
 * @returns {Promise<string>} 削除した id
 */
export async function deleteCorporateAction(id) {
  await apiClient.delete(`/masters/ca/${encodeURIComponent(id)}`)
  return id
}

/**
 * アプリ内モデル → CARequest（登録・更新・事前検証で共用する入力の形）。
 *
 * 日付と比率は「未設定」を **null で明示する**（クエリパラメータのように値ごと省くのではない）。
 * CARequest はレコード全体を差し替える形なので、キーを落とすと更新で
 * 「変えない」と「空にする」が区別できなくなる。
 */
function toCaRequest({
  stockCode,
  caType,
  exRightsDate = '',
  effectiveDate = '',
  paymentDate = '',
  denominator = null,
  numerator = null,
  note = '',
  updatedAt = '',
}) {
  return {
    銘柄コード: stockCode,
    CA種別: caType,
    権利付最終日: toApiDate(exRightsDate),
    効力発生日: toApiDate(effectiveDate),
    支払日: toApiDate(paymentDate),
    分母: toApiNumber(denominator),
    分子: toApiNumber(numerator),
    // 備考は nullable。空欄は「備考なし」なので空文字ではなく null を送る
    備考: note || null,
    /*
     * 楽観的ロックの合札。無いときはキーごと送らない（実 API 側は未指定を「照合しない」と
     * 解釈する。登録直後の行は実 API 側の更新日時が未設定で、照合する相手が無い）。
     *
     * 書式は変換しない。CAItem は ISO の date-time（'2026-08-20T09:30:00'）を返し、
     * CARequest の説明は 'YYYY-MM-DD HH:MM:SS' と書かれているが、受注不可日
     * （BlackoutDateItem / BlackoutDateRequest）もまったく同じ非対称で、そちらは ISO を
     * 素通しして実 API の編集が通っている（docs/e2e/masters/blackout-dates-real-api.md の BDR-06）。
     * 合札は照合用の不透明なトークンなので、秒未満の桁を落とすような整形はかえって
     * 不一致を作りうる。
     */
    ...(updatedAt ? { 更新日時: updatedAt } : {}),
  }
}

/** CAItem → アプリ内モデル */
function toCorporateAction(raw) {
  return {
    // 実 API の主キーは integer の ID。画面と URL では文字列として扱う
    id: String(raw?.ID ?? ''),
    stockCode: raw?.銘柄コード ?? '',
    // nullable な項目は空文字に寄せて、画面が null を出さないようにする
    ticker: raw?.Ticker ?? '',
    caType: raw?.CA種別 ?? '',
    // 表示名はサーバが付けて返す。欠けているときは画面側が CA種別コードから補う
    caTypeName: raw?.CA種別名 ?? '',
    exRightsDate: toIsoDate(raw?.権利付最終日),
    effectiveDate: toIsoDate(raw?.効力発生日),
    paymentDate: toIsoDate(raw?.支払日),
    /*
     * 分母・分子は編集フォームへ戻すために生の数値で持つ（未設定は null のまま。
     * 0 と「未設定」を混ぜないよう空文字には寄せない）。
     * 比率は「1:2」のような表示用の文字列でサーバが算出するので、入力には戻せない。
     */
    denominator: raw?.分母 ?? null,
    numerator: raw?.分子 ?? null,
    ratio: raw?.比率 ?? '',
    note: raw?.備考 ?? '',
    // 0 / 1 の integer は、この層で boolean に直して外へ出す
    userModified: raw?.ユーザー操作フラグ === 1,
    /*
     * 楽観的ロックの合札。実 API は ISO の日時を返し、登録直後の行では null になる。
     * 照合はサーバが行うので Date には通さず素の文字列で持つ。undefined のまま持つと
     * 更新時の JSON.stringify でキーごと消え、サーバから見て「送っていない」と「空」が
     * 区別できなくなるため文字列に寄せる。
     */
    updatedAt: raw?.更新日時 ?? '',
  }
}

/**
 * 'YYYY-MM-DD' → 20260101。
 *
 * 空文字や形の違うものは null（「未設定」を明示する）。
 * Date には通さない。UTC 深夜として解釈され、UTC より西のタイムゾーンで前日にずれる。
 */
function toApiDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? Number(date.replaceAll('-', '')) : null
}

/**
 * 比率の分母・分子を実 API の number へ寄せる。
 *
 * 画面の `type="number"` は値を文字列で持つので、ここで数値に直す。
 * 空欄・null・数値にならないものは null（「未設定」）。
 */
function toApiNumber(value) {
  if (value === '' || value === null || value === undefined) return null

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 20260901 → '2026-09-01'。
 *
 * Date には通さない。UTC 深夜として解釈され、UTC より西のタイムゾーンで前日にずれる。
 */
function toIsoDate(value) {
  const digits = String(value ?? '')
  if (!/^\d{8}$/.test(digits)) return ''

  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}
