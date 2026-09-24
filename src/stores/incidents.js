import { computed } from 'vue'
import { defineStore } from 'pinia'
import {
  fetchSuspensionHistories,
  fetchSuspensionStatus,
  resumeOrders,
  suspendOrders,
} from '@/api/incidents'
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
 *
 * 取得と操作（停止・再開）で loading / error を分ける（stores/sliceCriteria.js と同じ）。
 * 操作に失敗しても現在の状態の表示は残したい。障害対応の最中に画面が消えると困るため。
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

  /*
   * 操作 → 状態と履歴の取り直し を 1 本の useAsync の中で続ける（useCrudList の 2 段と同じ）。
   * 操作の応答は操作した 1 対象しか返さず、総合フラグも履歴も含まないので、取り直さないと
   * 画面の他の部分が古いままになる。取り直しは取得側の loading を立てない（表を消さない）。
   * どちらの段で落ちても saveError に出る。
   */
  const {
    error: saveError,
    loading: saving,
    execute: executeControl,
  } = useAsync(async (control, params) => {
    const result = await control(params)
    data.value = await fetchAll()
    return result
  })

  /** 楽観的ロックの合札。表に無い対象なら送らない（null）。サーバが対象不正で弾く */
  function updatedAtOf(target) {
    return targets.value.find((row) => row.target === target)?.updatedAt ?? null
  }

  /**
   * 発注を停止する。成功すれば操作の応答（message を画面が出す）、失敗すれば null。
   * @param {{ target: string, reason: string }} params
   */
  function suspend({ target, reason }) {
    return executeControl(suspendOrders, { target, reason, updatedAt: updatedAtOf(target) })
  }

  /**
   * 発注を再開する。戻り値は suspend と同じ。
   * @param {{ target: string }} params
   */
  function resume({ target }) {
    return executeControl(resumeOrders, { target, updatedAt: updatedAtOf(target) })
  }

  function clearSaveError() {
    saveError.value = null
  }

  function load() {
    return execute()
  }

  return {
    status,
    targets,
    histories,
    loading,
    error,
    isEmpty,
    hasHistories,
    saving,
    saveError,
    load,
    suspend,
    resume,
    clearSaveError,
  }
})

async function fetchAll() {
  const [status, histories] = await Promise.all([
    fetchSuspensionStatus(),
    fetchSuspensionHistories(),
  ])
  return { status, histories }
}
