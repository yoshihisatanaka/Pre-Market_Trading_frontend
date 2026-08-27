import { ref, shallowRef } from 'vue'

/**
 * 非同期処理の loading / error / data という定型を共通化する。
 * 新しい画面もこれを使い、各所で try-catch を書かないこと。
 *
 * @param {(...args: any[]) => Promise<any>} fn 実行する非同期関数（通常は api/ の関数）
 * @param {{ initialData?: any }} [options]
 */
export function useAsync(fn, { initialData = null } = {}) {
  const data = shallowRef(initialData)
  const error = ref(null)
  const loading = ref(false)

  async function execute(...args) {
    loading.value = true
    error.value = null
    try {
      data.value = await fn(...args)
      return data.value
    } catch (e) {
      error.value = e
      return null
    } finally {
      loading.value = false
    }
  }

  return { data, error, loading, execute }
}
