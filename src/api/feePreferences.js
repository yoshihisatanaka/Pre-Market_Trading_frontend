import { apiClient } from './client'
import { DEFAULT_FEE_PATTERN_FILTER } from '@/utils/feePreferenceOptions'

/*
 * 手数料優遇マスタ（実 API `/masters/fee-preferences`。成熟度 A: 一覧・事前検証・登録・変更・削除が
 * 仕様にあり、バックエンドは Phase 63 で実装済み。docs/api/requests.md #11）。
 *
 * 1 口座 1 レコードで、手数料の優遇（パターン方式またはベイシス方式）と口座別の為替スプレッドを持つ。
 * 登録の無い口座はデフォルトの手数料パターンと仮計算マスタの為替スプレッドで計算される。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次の 7 点。
 *   - 主キーが integer の `ID`。アプリ内は文字列の `id`（src/api/ca.js と同じ扱い）。
 *     **パスキーも ID**（`/masters/fee-preferences/{fee_preference_id}`）なので、
 *     口座番号は編集で変更できる（`FeePreferenceUpdateRequest` に 口座番号 がある）
 *   - レスポンスのプロパティ名が日本語（口座番号 / 手数料パターン / 掛目 / ベイシス / スプレッド …）
 *   - **検索クエリ名だけは英語**（`branch_code` / `account_no` / `fee_pattern`）
 *   - 口座番号は integer。アプリ内は文字列（行の表示と URL で使う）
 *   - 手数料パターンの空文字は「デフォルトパターン」という値。検索で空文字を送るとデフォルトの口座に
 *     絞り込まれるので、画面は DEFAULT_FEE_PATTERN_FILTER という目印で持ち、ここで空文字に直す
 *   - 一覧の配列名が `fee_preferences`、1 件の応答のキーが `fee_preference`
 *   - 削除は論理削除（取消区分=1）。一覧は既定で取消済みを返さない
 *
 * 事前検証と登録・変更の応答は `warnings` を持つ（参照先の手数料パターンがマスタ未登録、
 * 方式で使われない項目の入力など。いずれも登録は通る）。扱いは validateFeePreference() と
 * toSaveResult() のコメントを参照。
 *
 * 一覧の取得・事前検証・登録・変更・削除を持つ。詳細照会・更新履歴・CSV 入出力は画面が使わないので置かない。
 */

/**
 * 1 件のアプリ内モデル（このファイルの JSDoc で使う）
 *
 * @typedef {{
 *   id: string,
 *   accountNumber: string,
 *   branchCode: string,
 *   customerName: string,
 *   feePattern: string,
 *   feeMultiplier: number|null,
 *   minFee: number|null,
 *   maxFee: number|null,
 *   basisPoints: number|null,
 *   minBasisFee: number|null,
 *   maxBasisFee: number|null,
 *   fxSpread: number|null,
 *   applyMethod: string,
 *   updatedAt: string,
 * }} FeePreference
 *   id は実 API の ID を文字列にしたもの。feePattern は 'A'〜'Z'、空文字がデフォルトパターン。
 *   数値 7 項目は null のまま通す（null は「未設定」で、0 とは意味が違う。fxSpread の 0 は為替手数料の免除、
 *   null は仮計算マスタの値を使う）。feeMultiplier は %（未設定は 100% として扱われる）、
 *   basisPoints は bp、金額 4 項目は税抜の円、fxSpread は円/USD。
 *   applyMethod はサーバが付ける 'BASIS'（ベイシスを設定した口座）/ 'PATTERN'（それ以外）。
 *   branchCode / customerName はサーバが口座マスタを結合して付ける表示項目（入力には使わない）。
 *   updatedAt は編集の楽観的ロックで送り返す合札
 */

/**
 * 入力 1 件のアプリ内モデル（登録・変更・事前検証に渡す形）
 *
 * @typedef {{
 *   accountNumber: string|number,
 *   feePattern?: string,
 *   feeMultiplier?: number|string|null,
 *   minFee?: number|string|null,
 *   maxFee?: number|string|null,
 *   basisPoints?: number|string|null,
 *   minBasisFee?: number|string|null,
 *   maxBasisFee?: number|string|null,
 *   fxSpread?: number|string|null,
 * }} FeePreferenceInput
 *   数値項目は画面の入力欄が文字列を持つので、数値でも文字列でも受ける（この層で数値に直す）。
 *   空文字は「未設定」で、null として送る
 */

/**
 * 手数料優遇の一覧を取得する。
 *
 * ページャーを持つ一覧なので、配列ではなく `{ items, total }` を返す。
 *
 * 取消済み（論理削除）の行は含めない。実 API の include_deleted は既定 false なので送らない。
 *
 * @param {{
 *   limit?: number,
 *   offset?: number,
 *   branchCode?: string,
 *   accountNumber?: string,
 *   feePattern?: string,
 * }} [params]
 *   limit は 1..200（実 API の既定は 50）。accountNumber は数字だけのときに送る
 *   （実 API は integer なので、それ以外を送ると 422 で検索できない）。
 *   feePattern は 'A'〜'Z' か DEFAULT_FEE_PATTERN_FILTER（デフォルトパターンの口座）。
 *   空文字は「条件なし」としてリクエストに載せない
 * @returns {Promise<{ items: FeePreference[], total: number }>}
 */
export async function fetchFeePreferences({
  limit = 50,
  offset = 0,
  branchCode = '',
  accountNumber = '',
  feePattern = '',
} = {}) {
  const { data } = await apiClient.get('/masters/fee-preferences', {
    // クエリ名を知ってよいのはこの層だけ。値が undefined のパラメータは axios が送らない
    params: {
      limit,
      offset,
      branch_code: branchCode || undefined,
      account_no: toAccountNo(accountNumber),
      fee_pattern: toFeePatternQuery(feePattern),
    },
  })

  return {
    items: (data.fee_preferences ?? []).map(toFeePreference),
    total: data.total ?? 0,
  }
}

/**
 * 手数料優遇の入力内容をサーバに検証させる（登録・変更はしない）。
 *
 * 実 API が見るのは「口座の存在 / 1 口座 1 レコードの重複 / 掛目・ベイシス・金額の範囲」。
 * 画面は必須の未入力と数値の形だけを先に弾き、残りはここに委ねる。
 *
 * 不合格は例外にしない（`{ valid: false, errors }` を返す）。通信・サーバ障害だけが throw され、
 * 呼び出し側（useCrudList）が両者を別の入れ物に入れる。
 *
 * **`warnings` は受け取って返す**（CA・銘柄と違う）。手数料優遇の事前検証は、参照先の手数料パターンが
 * マスタ未登録のとき（仮計算ではデフォルトパターンになる）と、方式で使われない項目が入っているとき
 * （ベイシスを設定したのに掛目も入っている、など）に警告を返す。どちらも登録は通るが、
 * 利用者の意図と違う計算になりうるので、新規追加では 1 回目は登録せずに見せる（useCrudList の約束。
 * 押し直すと acknowledgedWarnings が付いて登録に進む）。変更（useCrudList.update）は warnings を
 * 見ずに進むので、変更の警告は PUT の応答で受け取る（toSaveResult）。
 *
 * **新規検証か変更検証かは `id` の有無だけで決まる**（src/api/ca.js と同じ）。
 * 変更検証の対象はクエリの `fee_preference_id`（主キー）で指す。
 *
 * @param {FeePreferenceInput & { id?: string, updatedAt?: string, acknowledgedWarnings?: boolean }} params
 *   id は編集からの呼び出しのときだけ渡す（自分自身を重複と見なさせないため）。
 *   updatedAt / acknowledgedWarnings は受け取るが送らない（登録・変更の payload をそのまま渡せるようにするため）
 * @returns {Promise<{ valid: boolean, errors: string[], warnings: string[] }>}
 *   valid が false のときだけ errors に理由が入る
 */
export async function validateFeePreference({
  id = '',
  updatedAt: _updatedAt = '',
  acknowledgedWarnings: _acknowledged = false,
  ...input
}) {
  const { data } = await apiClient.post(
    '/masters/fee-preferences/validate',
    // 更新日時 は本文から落とす（事前検証は楽観的ロックの照合をしない）
    toFeePreferenceRequest(input),
    // 既定が新規検証なので、変更検証のときだけクエリを付ける（fee_preference_id は integer 宣言）
    id ? { params: { fee_preference_id: Number(id), is_update: true } } : undefined,
  )

  return {
    valid: Boolean(data?.valid),
    // errors / warnings は default_factory 付きでも required でもないので、無い場合に備える
    errors: toMessages(data?.errors),
    warnings: toMessages(data?.warnings),
  }
}

/**
 * 手数料優遇を 1 件登録する（1 口座 1 レコード。既に登録のある口座はサーバが弾く）。
 *
 * 主キー（ID）はサーバが採番するので送らない。部店コード・顧客名は口座マスタから結合されるので送らない。
 *
 * @param {FeePreferenceInput & { acknowledgedWarnings?: boolean, updatedAt?: string }} input
 *   acknowledgedWarnings は useCrudList が使う目印で、送らない。updatedAt も送らない
 *   （FeePreferenceRequest に 更新日時 は無い。登録に楽観的ロックの合札は要らない）
 * @returns {Promise<FeePreference & { warnings: string[] }>} 登録された 1 件と、応答の警告
 */
export async function createFeePreference({
  acknowledgedWarnings: _acknowledged = false,
  updatedAt: _updatedAt = '',
  ...input
}) {
  const { data } = await apiClient.post('/masters/fee-preferences', toFeePreferenceRequest(input))

  return toSaveResult(data)
}

/**
 * 手数料優遇を 1 件変更する（口座番号も含めて全項目を変更できる）。
 *
 * 本文は `FeePreferenceUpdateRequest`（含めた項目だけを更新する部分更新）だが、変えない項目も含めて
 * 全項目を送る。数値項目の空欄は null を明示して送り、「未設定に戻す」をサーバに伝える
 * （キーを落とすと「変えない」と解釈される）。
 *
 * updatedAt は一覧取得時の更新日時をそのまま送り返す楽観的ロックの合札で、
 * サーバ側の現在値と違えば 409 で弾かれる（他の利用者が先に更新していた場合）。
 *
 * @param {FeePreferenceInput & { id: string, updatedAt?: string }} params id は更新対象の行 ID
 * @returns {Promise<FeePreference & { warnings: string[] }>} 更新後の 1 件と、応答の警告
 */
export async function updateFeePreference({ id, ...input }) {
  const { data } = await apiClient.put(
    `/masters/fee-preferences/${encodeURIComponent(id)}`,
    toFeePreferenceRequest(input),
  )

  return toSaveResult(data)
}

/**
 * 手数料優遇を 1 件削除する（実 API は論理削除。削除後の口座はデフォルトパターンで計算される）。
 *
 * 応答は削除後の 1 件（FeePreferenceResponse）だが、画面は削除前の行を使ってメッセージを出すので
 * 使い道が無い。呼び出し側が useAsync で成否を判定できるよう、削除した id を返す
 * （src/api/ca.js の deleteCorporateAction と同じ）。楽観的ロックは無い（DELETE は本文を取らない）。
 *
 * @param {string} id 削除対象の行 ID
 * @returns {Promise<string>} 削除した id
 */
export async function deleteFeePreference(id) {
  await apiClient.delete(`/masters/fee-preferences/${encodeURIComponent(id)}`)
  return id
}

/**
 * 登録・変更の応答（FeePreferenceResponse）→ 1 件と警告。
 *
 * 警告は「登録は成功している」もの（仕様の説明どおり）。変更は事前検証の警告で止まらないので、
 * 画面はここで受け取った警告を成功の通知に添えて見せる。
 */
function toSaveResult(data) {
  return {
    ...toFeePreference(data?.fee_preference),
    warnings: toMessages(data?.warnings),
  }
}

/**
 * アプリ内モデル → FeePreferenceRequest / FeePreferenceUpdateRequest / FeePreferenceValidateRequest
 * （登録・変更・事前検証で共用する入力の形）。
 *
 * 数値 7 項目は「未設定」を **null で明示する**。更新は部分更新で、キーを落とすと「変えない」、
 * null を送ると「未設定に戻す」と解釈されるため、フォームで消した値を確実に戻すにはキーを落とさない。
 *
 * 手数料パターンは空文字のまま送る（空文字がデフォルトパターンという値。FeePreferenceRequest は
 * null を許さない）。
 */
function toFeePreferenceRequest({
  accountNumber,
  feePattern = '',
  feeMultiplier = null,
  minFee = null,
  maxFee = null,
  basisPoints = null,
  minBasisFee = null,
  maxBasisFee = null,
  fxSpread = null,
  updatedAt = '',
}) {
  return {
    口座番号: toAccountNo(accountNumber) ?? null,
    手数料パターン: feePattern ?? '',
    掛目: toApiNumber(feeMultiplier),
    下限手数料: toApiNumber(minFee),
    上限手数料: toApiNumber(maxFee),
    ベイシス: toApiNumber(basisPoints),
    下限ベイシス円: toApiNumber(minBasisFee),
    上限ベイシス円: toApiNumber(maxBasisFee),
    スプレッド: toApiNumber(fxSpread),
    /*
     * 楽観的ロックの合札。無いときはキーごと送らない（実 API 側は未指定を「照合しない」と
     * 解釈する）。書式は変換しない（照合用の不透明なトークンなので、整形はかえって不一致を作る。
     * src/api/ca.js の toCaRequest に同じ経緯がある）。
     */
    ...(updatedAt ? { 更新日時: updatedAt } : {}),
  }
}

/** FeePreferenceItem → アプリ内モデル */
function toFeePreference(raw) {
  return {
    // 実 API の主キーは integer の ID。画面と URL では文字列として扱う
    id: String(raw?.ID ?? ''),
    accountNumber: String(raw?.口座番号 ?? ''),
    // 口座マスタを結合した表示項目。nullable なので空文字に寄せて、画面が null を出さないようにする
    branchCode: raw?.部店コード ?? '',
    customerName: raw?.顧客名 ?? '',
    feePattern: raw?.手数料パターン ?? '',
    /*
     * 数値は null のまま通す。「0」と「未設定」は別の意味で（スプレッドの 0 は免除、null は仮計算マスタの値）、
     * 空文字や 0 に寄せるとその区別が消える。
     */
    feeMultiplier: toNumberOrNull(raw?.掛目),
    minFee: toNumberOrNull(raw?.下限手数料),
    maxFee: toNumberOrNull(raw?.上限手数料),
    basisPoints: toNumberOrNull(raw?.ベイシス),
    minBasisFee: toNumberOrNull(raw?.下限ベイシス円),
    maxBasisFee: toNumberOrNull(raw?.上限ベイシス円),
    fxSpread: toNumberOrNull(raw?.スプレッド),
    applyMethod: raw?.適用方式 ?? '',
    /*
     * 楽観的ロックの合札。照合はサーバが行うので Date には通さず素の文字列で持つ。
     * undefined のまま持つと更新時の JSON.stringify でキーごと消えるため文字列に寄せる
     * （src/api/ca.js と同じ扱い）。
     */
    updatedAt: raw?.更新日時 ?? '',
  }
}

/**
 * 口座番号 → リクエストに載せる integer。数字だけのときにだけ送る
 * （src/api/balanceAdjustments.js と同じ。文字列のまま送ると 422 で弾かれ、理由が画面に出ない）。
 */
function toAccountNo(value) {
  const digits = String(value ?? '').trim()
  return /^\d+$/.test(digits) ? Number(digits) : undefined
}

/** 手数料パターンの検索条件 → クエリの値。目印はデフォルト（空文字）に直し、空は送らない */
function toFeePatternQuery(feePattern) {
  if (feePattern === DEFAULT_FEE_PATTERN_FILTER) return ''
  return feePattern || undefined
}

/**
 * 入力欄の文字列を数値に寄せる。空欄は null（「未設定」を明示する）。
 *
 * 数値にならない入力は画面が先に弾く（ここで null に寄せると、誤入力が黙って「未設定」になる）。
 */
function toApiNumber(value) {
  if (value === null || value === undefined || value === '') return null

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** 数値に寄せる。数値でないもの（null / undefined / 文字列）は null */
function toNumberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 文字列の配列だけを通す（errors / warnings。実 API 以外の応答に備える） */
function toMessages(value) {
  return Array.isArray(value) ? value.filter((message) => typeof message === 'string') : []
}
