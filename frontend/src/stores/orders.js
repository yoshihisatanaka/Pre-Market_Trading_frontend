import { computed } from 'vue'
import { defineStore } from 'pinia'
import { fetchOrders } from '@/api/orders'
import { useAsync } from '@/composables/useAsync'

/**
 * 注文一覧のストア。
 * Pinia は setup ストア形式（Composition API）で書くこと。
 */
export const useOrdersStore = defineStore('orders', () => {
  const { data, error, loading, execute } = useAsync(fetchOrders, { initialData: [] })

  const items = computed(() => data.value ?? [])
  const isEmpty = computed(() => !loading.value && !error.value && items.value.length === 0)

  return {
    items,
    error,
    loading,
    isEmpty,
    load: execute,
  }
})
