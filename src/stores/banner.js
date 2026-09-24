import { defineStore } from 'pinia'
import { fetchBanner } from '@/api/banner'
import { useAsync } from '@/composables/useAsync'

/**
 * 全画面ヘッダ用バナー（発注停止とお知らせの統合判定）。
 *
 * 検索条件もページングも無い単一リソースなので、useAsync を直に使う（useMarketStatusStore と同じ形）。
 * いまの利用者はお知らせ管理の「現在の運用状態」だけ。全画面ヘッダのバナー表示は障害管理の担当で、
 * そちらも同じストアを使えるよう画面固有の状態は持たない。
 *
 * 取得に失敗しても業務を止めない（呼び出し側は banner が null のとき「—」を出すだけ）。
 */
export const useBannerStore = defineStore('banner', () => {
  const { data, error, loading, execute } = useAsync(fetchBanner)

  function load() {
    return execute()
  }

  // data のままだと呼び出し側が何のデータか分からないので banner で公開する
  return { banner: data, error, loading, load }
})
