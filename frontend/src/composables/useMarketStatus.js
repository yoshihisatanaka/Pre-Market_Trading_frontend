import { onMounted, onUnmounted, ref } from 'vue'
import { getMarketStatus } from '@/utils/marketStatus'

// モックと同じ間隔で再判定する
const REFRESH_INTERVAL_MS = 60_000

/**
 * 市場の取引セッションを保持し、1 分ごとに更新する。
 * @returns {import('vue').Ref<{ key: string, label: string }>}
 */
export function useMarketStatus() {
  const status = ref(getMarketStatus())
  let timer = null

  onMounted(() => {
    timer = setInterval(() => {
      status.value = getMarketStatus()
    }, REFRESH_INTERVAL_MS)
  })

  onUnmounted(() => {
    clearInterval(timer)
  })

  return status
}
