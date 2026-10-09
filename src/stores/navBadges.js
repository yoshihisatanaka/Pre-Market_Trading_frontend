import { computed } from 'vue'
import { defineStore } from 'pinia'
import { fetchDreamErrorCount } from '@/api/dreamStatus'
import { fetchOrderErrorCount } from '@/api/orderInquiry'
import { useAsync } from '@/composables/useAsync'

/**
 * サイドメニューの項目に添える件数（画面モックの赤い件数表示）。
 *   orderErrors … 注文照会の出来状況が「注文エラー」の注文
 *   dreamErrors … Dream登録状況が「エラー」（登録失敗・取消失敗）の注文
 * キーは navigation.js の項目の badge.key と同じ。
 *
 * 取り直すのは AppSidebar（画面を移るたび。画面モックはページを開くたびにサーバが数え直す）と、
 * 件数を変える操作をその場で行う画面のストア（Dream登録状況の STS変更）。
 *
 * 2 本は独立に取る。片方が失敗してももう片方は出す。失敗した件数は前の値のまま残る
 * （useAsync が data を書き換えない）。取得前と失敗が続いたときは null で、サイドメニューは何も出さない。
 */
export const useNavBadgesStore = defineStore('navBadges', () => {
  const orderErrors = useAsync(fetchOrderErrorCount)
  const dreamErrors = useAsync(fetchDreamErrorCount)

  /** badge.key → 件数（未取得は null） */
  const counts = computed(() => ({
    orderErrors: orderErrors.data.value,
    dreamErrors: dreamErrors.data.value,
  }))

  function load() {
    return Promise.all([orderErrors.execute(), dreamErrors.execute()])
  }

  return { counts, load }
})
