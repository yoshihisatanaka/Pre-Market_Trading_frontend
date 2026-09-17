import { computed } from 'vue'
import { defineStore } from 'pinia'
import { fetchIncidentHistories, fetchIncidentStatus } from '@/api/incidents'
import { useAsync } from '@/composables/useAsync'

/**
 * 障害管理（現在の運用状態 + 障害対応履歴）。
 *
 * 運用状態と履歴は 1 画面に同時に出すので、取得も 1 回にまとめる。
 * 取得口を 2 つに割ると、画面の 4 状態が運用状態側と履歴側でねじれる。
 * 片方が落ちたら error は 1 本だけ立つ（どちらが落ちたかは利用者の関心ではない）。
 *
 * Promise.all を api/ ではなくここに置くのは、api 層が「1 エンドポイント = 1 関数」だから。
 * ストアは axios もバックエンドの生の形も知らないので、レイヤ規約には抵触しない。
 *
 * 制御の実行（状態遷移）はまだ持たない。実装する段で stores/hardLimits.js の
 * saving / saveError と同じ形で 2 本目の useAsync を足す
 * （操作に失敗しても現在状態の表示は残したいため、取得とは loading / error を分ける）。
 */
export const useIncidentsStore = defineStore('incidents', () => {
  const { data, error, loading, execute } = useAsync(async () => {
    const [status, histories] = await Promise.all([
      fetchIncidentStatus(),
      fetchIncidentHistories(),
    ])
    return { status, histories }
  })

  const status = computed(() => data.value?.status ?? null)
  const histories = computed(() => data.value?.histories ?? [])

  /*
   * 「空」は運用状態が読めないこと。
   * 履歴 0 件は空ではない（運用状態と制御ボタンは出るので、データあり側の内訳になる）。
   */
  const isEmpty = computed(() => !loading.value && !error.value && !status.value)
  const hasHistories = computed(() => histories.value.length > 0)

  function load() {
    return execute()
  }

  return { status, histories, loading, error, isEmpty, hasHistories, load }
})
