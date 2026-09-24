import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  fetchAnnouncement,
  fetchAnnouncementHistory,
  updateAnnouncement,
} from '@/api/announcements'
import { useAsync } from '@/composables/useAsync'

/** 履歴の 1 ページの件数（実 API の limit の既定と同じ） */
export const ANNOUNCEMENT_HISTORY_PAGE_SIZE = 50

/**
 * お知らせ管理（全画面共通のお知らせ・計画メンテナンス案内）。
 * お知らせは 1 行だけの単一リソースなので、useCrudList ではなく useAsync を直に使う。
 *
 * 取得・保存・履歴で loading / error を 3 本に分ける。
 *   - 保存に失敗しても現在値の表示は残したい
 *   - 履歴の取得に失敗しても、お知らせ自体の編集は続けられるようにしたい
 *
 * 履歴のページ位置は URL クエリに載せず、ここの historyOffset で持つ。
 * 画面内の従属的な表で、useListQuery（一覧画面の URL ↔ 検索条件の往復）の対象ではないため。
 */
export const useAnnouncementsStore = defineStore('announcements', () => {
  const { data, error, loading, execute } = useAsync(fetchAnnouncement)

  const announcement = computed(() => data.value)
  const isEmpty = computed(() => !loading.value && !error.value && !data.value)

  const { error: saveError, loading: saving, execute: executeSave } = useAsync(updateAnnouncement)

  /*
   * 履歴の取得は並びうる（2 ページ目の取得中に保存すると、保存後の loadHistory(0) が重なる）。
   * 追い越された応答で表を上書きしないよう、最後に出した要求の結果だけを採る。
   * 古い要求の結果と失敗は、いまの表をそのまま返して捨てる。
   */
  let latestHistoryRequest = 0

  async function fetchLatestHistory(params) {
    const request = ++latestHistoryRequest
    try {
      const result = await fetchAnnouncementHistory(params)
      return request === latestHistoryRequest ? result : historyData.value
    } catch (e) {
      if (request === latestHistoryRequest) throw e
      return historyData.value
    }
  }

  const {
    data: historyData,
    error: historyError,
    loading: historyLoading,
    execute: executeHistory,
  } = useAsync(fetchLatestHistory, { initialData: { items: [], total: 0 } })

  const historyOffset = ref(0)
  const history = computed(() => historyData.value?.items ?? [])
  const historyTotal = computed(() => historyData.value?.total ?? 0)
  const historyIsEmpty = computed(
    () => !historyLoading.value && !historyError.value && history.value.length === 0,
  )

  /**
   * 表示 ON/OFF と本文をひとつの操作で保存する（画面モックの「お知らせを更新」ボタン）。
   *
   * 直近に取得した更新日時を楽観的ロックの合札として送る。取得してから保存するまでに
   * 他の担当者が更新していればサーバが 409 で弾き、理由は saveError に入る。
   *
   * 成功したら応答の announcement を現在値に置き、履歴を先頭ページから取り直す
   * （新しい 1 行は先頭に積まれるので、2 ページ目を見ていても先頭へ戻す）。
   *
   * @param {{ enabled: boolean, message: string }} input
   * @returns {Promise<{ announcement: object, message: string } | null>} 失敗時は null
   */
  async function save({ enabled, message }) {
    const current = data.value
    // 現在値が無い＝まだ読めていない。合札が決まらないので送らない
    if (!current) return null

    const result = await executeSave({ enabled, message, updatedAt: current.updatedAt })
    if (!result) return null

    // PUT の応答が更新後の全項目なので、取得し直さずそのまま現在値にする
    data.value = result.announcement
    await loadHistory(0)
    return result
  }

  function clearSaveError() {
    saveError.value = null
  }

  function load() {
    return execute()
  }

  /**
   * 履歴を読む。offset を省けば今のページを読み直す。
   * ページ位置は取得の成否にかかわらず先に動かす（ページャーの表示と再試行の対象をそろえる）。
   */
  function loadHistory(offset = historyOffset.value) {
    historyOffset.value = offset
    return executeHistory({ limit: ANNOUNCEMENT_HISTORY_PAGE_SIZE, offset })
  }

  return {
    announcement,
    loading,
    error,
    isEmpty,
    load,
    saving,
    saveError,
    save,
    clearSaveError,
    history,
    historyTotal,
    historyOffset,
    historyLoading,
    historyError,
    historyIsEmpty,
    loadHistory,
  }
})
