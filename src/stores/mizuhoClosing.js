import { computed } from 'vue'
import { defineStore } from 'pinia'
import { fetchMizuhoClosingStatus } from '@/api/closing'
import { useAsync } from '@/composables/useAsync'

/**
 * みずほ注文締の締め状態（受付中 / 締め済）のストア。
 *
 * 約定一覧（stores/mizuhoExecutions.js）とは取得を分ける。締め状態が読めなくても約定一覧は
 * 見られるままにしたい（逆も同じ）ので、画面の 4 状態もカードごとに別々に出す。
 * 1 件の形は src/api/closing.js の JSDoc を参照。
 *
 * TODO(処理実装): 締め実行・締め解除（close / reopen と saving / saveError）。
 *   操作の応答は ClosingStatusResponse なので、取り直さずにその値で status を差し替えられる。
 */
export const useMizuhoClosingStore = defineStore('mizuhoClosing', () => {
  const { data: status, error, loading, execute } = useAsync(fetchMizuhoClosingStatus)

  /** 「空」は締め状態が読めないこと（本文なしの応答） */
  const isEmpty = computed(() => !loading.value && !error.value && !status.value)

  /** 締め状態を読む（初回と再試行の入口） */
  function load() {
    return execute()
  }

  return { status, loading, error, isEmpty, load }
})
