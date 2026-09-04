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

// 認証方式が決まったらここでトークンを付与する
apiClient.interceptors.request.use((config) => config)

apiClient.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(normalizeError(error)),
)

function normalizeError(error) {
  if (error.response) {
    const { status, data } = error.response
    return new ApiError(data?.message || defaultMessageFor(status), {
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

function defaultMessageFor(status) {
  if (status === 400) return '入力内容に誤りがあります。'
  if (status === 401) return 'ログインが必要です。'
  if (status === 403) return 'この操作を行う権限がありません。'
  if (status === 404) return '対象が見つかりませんでした。'
  if (status >= 500) return 'サーバーでエラーが発生しました。'
  return 'エラーが発生しました。'
}
