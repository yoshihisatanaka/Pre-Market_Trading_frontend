import axios from 'axios'

/**
 * アプリ内で唯一の axios インスタンス。
 * コンポーネントやストアから axios を直接 import しないこと。
 */
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

/** API エラーをアプリ内で一様に扱うための型 */
export class ApiError extends Error {
  constructor(message, { status = null, code = null, cause = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.cause = cause
  }
}

/*
 * 更新系（POST / PUT / DELETE）は操作者社員コード `X-User-Code` を必須にしている
 * （docs/api/openapi.json の各マスタの登録・変更・削除）。
 *
 * 本来の出所は Onegate SSO のセッションだが、openapi.json の securitySchemes は
 * 宣言だけで security がどのオペレーションにも付いておらず、実 API も未認証で 200 を返す。
 * そこで暫定的に .env の VITE_USER_CODE を全リクエストに載せる。
 * SSO が入ったらここをセッション由来の値に差し替える（呼び出し側は変えなくてよい）。
 *
 * 本文にも操作者を載せる API（みずほ注文締めの 実行者。サーバがヘッダから解決しない）は、
 * api 層がこの値を読む。出所を 1 か所に保つため、ここから export する。
 */
export const USER_CODE = import.meta.env.VITE_USER_CODE || ''

apiClient.interceptors.request.use((config) => {
  if (USER_CODE) config.headers['X-User-Code'] = USER_CODE
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(normalizeError(error)),
)

function normalizeError(error) {
  if (error.response) {
    const { status } = error.response
    const data = decodeBinaryBody(error.response.data)
    return new ApiError(messageFrom(data) || defaultMessageFor(status), {
      status,
      code: data?.code ?? null,
      cause: error,
    })
  }
  if (error.code === 'ECONNABORTED') {
    return new ApiError('通信がタイムアウトしました。時間をおいて再度お試しください。', {
      code: error.code,
      cause: error,
    })
  }
  return new ApiError('サーバーに接続できませんでした。', { code: error.code, cause: error })
}

/**
 * ファイルを落とす要求（`responseType: 'arraybuffer'`）は、エラーの本文もバイト列で届く。
 * JSON として読めればその形に戻し、下の messageFrom が理由を取り出せるようにする
 * （読まないと 400 の理由が「入力内容に誤りがあります。」の既定文言に化ける）。
 *
 * Blob（`responseType: 'blob'`）にしないのは、読むのが非同期になり、jsdom 26 の Blob には
 * text() も無いため。ArrayBuffer なら TextDecoder で同期に読める。
 *
 * @param {unknown} data レスポンス本文
 * @returns {unknown} バイト列でなければそのまま。JSON として読めなければ null
 */
function decodeBinaryBody(data) {
  // 実行環境（ブラウザ / jsdom）で ArrayBuffer の realm が違っても判定できるよう instanceof は使わない
  if (Object.prototype.toString.call(data) !== '[object ArrayBuffer]') return data

  try {
    return JSON.parse(new TextDecoder().decode(data))
  } catch {
    return null
  }
}

/**
 * エラー本文から画面に出す 1 行を取り出す。
 *
 * 実 API（FastAPI）の本文は 2 形ある。
 *   ErrorResponse         … `{ detail: '休場日 20260101 は既に登録されています' }`（400 / 401 / 404 / 409 / 500）
 *   HTTPValidationError   … `{ detail: [{ loc, msg, type }, …] }`（422。msg はおおむね日本語化済み）
 * どちらも同じ `detail` キーなので、文字列か配列かで見分ける。
 *
 * `message` も見るのは、まだ実 API に切り替えていないマスタのモックが
 * `{ message, code }` を返しているため（該当の API が実装されたら要らなくなる）。
 *
 * @param {unknown} data レスポンス本文
 * @returns {string} 取り出せなければ空文字（呼び出し側が status 既定の文言に落とす）
 */
function messageFrom(data) {
  if (typeof data?.message === 'string' && data.message) return data.message

  const detail = data?.detail

  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    // 422 は項目ごとに 1 件返る。どれも直すべき理由なので、全部つなげて出す
    return detail.map(toValidationMessage).filter(Boolean).join(' / ')
  }
  return ''
}

/**
 * ValidationError 1 件を、画面に出す 1 行にする。
 *
 * 実 API の `msg` は日本語化されているが**項目名を含まない**
 * （実測: 市場関与率が下限未満 → 「指定できる下限を下回っています」だけ）。
 * 複数の入力欄がある画面ではどれの話か分からないので、`loc` の末尾を前に付ける。
 * `loc` は `['body', '市場関与率']` / `['query', 'limit']` の形で、
 * 先頭の「値の出所」は利用者に見せる情報ではないので落とす。
 *
 * @param {unknown} item ValidationError 1 件
 * @returns {string} 取り出せなければ空文字（呼び出し側が filter で捨てる）
 */
function toValidationMessage(item) {
  if (typeof item?.msg !== 'string' || !item.msg) return ''

  const field = Array.isArray(item.loc) ? item.loc.at(-1) : null
  const named = typeof field === 'string' && field !== 'body' && field !== 'query'

  return named ? `${field}: ${item.msg}` : item.msg
}

function defaultMessageFor(status) {
  if (status === 400) return '入力内容に誤りがあります。'
  if (status === 401) return 'ログインが必要です。'
  if (status === 403) return 'この操作を行う権限がありません。'
  if (status === 404) return '対象が見つかりませんでした。'
  if (status >= 500) return 'サーバーでエラーが発生しました。'
  return 'エラーが発生しました。'
}
