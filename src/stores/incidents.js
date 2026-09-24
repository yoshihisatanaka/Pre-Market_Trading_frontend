import { computed } from 'vue'
import { defineStore } from 'pinia'
import { fetchSuspensionHistories, fetchSuspensionStatus } from '@/api/incidents'
import { useAsync } from '@/composables/useAsync'

/**
 * 障害管理（停止対象ごとの発注停止状態 + 停止・再開の操作履歴）。
 *
 * 状態と履歴は 1 画面に同時に出すので、取得も 1 回にまとめる。
 * 取得口を 2 つに割ると、画面の 4 状態が状態側と履歴側でねじれる。
 * 片方が落ちたら error は 1 本だけ立つ（どちらが落ちたかは利用者の関心ではない）。
 *
 * Promise.all を api/ ではなくここに置くのは、api 層が「1 エンドポイント = 1 関数」だから。
 * ストアは axios もバックエンドの生の形も知らないので、レイヤ規約には抵触しない。
 */
export const useIncidentsStore = defineStore('incidents', () => {
  const { data, error, loading, execute } = useAsync(fetchAll)

  const status = computed(() => data.value?.status ?? null)
  const targets = computed(() => status.value?.targets ?? [])
  const histories = computed(() => data.value?.histories ?? [])

  /*
   * 「空」は停止状態が読めないこと。
   * 履歴 0 件は空ではない（停止対象の表は出るので、データあり側の内訳になる）。
   */
  const isEmpty = computed(() => !loading.value && !error.value && !status.value)
  const hasHistories = computed(() => histories.value.length > 0)

  function load() {
    return execute()
  }

  return { status, targets, histories, loading, error, isEmpty, hasHistories, load }
})

async function fetchAll() {
  const [status, histories] = await Promise.all([
    fetchSuspensionStatus(),
    fetchSuspensionHistories(),
  ])
  return { status, histories }
}
