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
 */
const userCode = import.meta.env.VITE_USER_CODE || ''

apiClient.interceptors.request.use((config) => {
  if (userCode) config.headers['X-User-Code'] = userCode
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(normalizeError(error)),
)

function normalizeError(error) {
  if (error.response) {
    const { status, data } = error.response
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
 * エラー本文から画面に出す 1 行を取り出す。
 *
 * 実 API（FastAPI）の本文は 2 形ある。
 *   ErrorResponse         … `{ detail: '休場日 20260101 は既に登録されています' }`（400 / 401 / 404 / 409 / 500）
 *   HTTPValidationError   … `{ detail: [{ loc, msg, type }, …] }`（422。msg は日本語化済み）
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
    return detail
      .map((item) => item?.msg)
      .filter((msg) => typeof msg === 'string' && msg)
      .join(' / ')
  }
  return ''
}

function defaultMessageFor(status) {
  if (status === 400) return '入力内容に誤りがあります。'
  if (status === 401) return 'ログインが必要です。'
  if (status === 403) return 'この操作を行う権限がありません。'
  if (status === 404) return '対象が見つかりませんでした。'
  if (status >= 500) return 'サーバーでエラーが発生しました。'
  return 'エラーが発生しました。'
}
