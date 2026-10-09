import { defineStore } from 'pinia'
import { fetchBanner } from '@/api/banner'
import { useAsync } from '@/composables/useAsync'

/**
 * 全画面ヘッダ用バナー（発注停止とお知らせの統合判定）。
 *
 * 検索条件もページングも無い単一リソースなので、useAsync を直に使う（useMarketStatusStore と同じ形）。
 * 利用者はヘッダ直下の帯（AppOperationBanner）とお知らせ管理の「現在の運用状態」。
 * 両方が同じストアを読むので画面固有の状態は持たない。初回の取得は main.js、
 * 定期の取り直しは composables/useOperationBanner（タイマーはここに置かない）。
 *
 * 取得に失敗しても業務を止めない（帯は出さず、お知らせ管理は「—」を出すだけ）。
 * 取り直しに失敗しても banner は直前の値のまま残る（useAsync は失敗時に data を消さない）。
 */
export const useBannerStore = defineStore('banner', () => {
  const { data, error, loading, execute } = useAsync(fetchBanner)

  function load() {
    return execute()
  }

  // data のままだと呼び出し側が何のデータか分からないので banner で公開する
  return { banner: data, error, loading, load }
})
