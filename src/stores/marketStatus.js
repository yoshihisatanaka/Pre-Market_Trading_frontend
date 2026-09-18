import { defineStore } from 'pinia'
import { fetchMarketStatus } from '@/api/marketStatus'
import { useAsync } from '@/composables/useAsync'

/**
 * 市場状況（全画面共通のヘッダが出す取引セッションと時間帯）。
 *
 * 検索条件もページングも無い単一リソースなので、一覧系の useCrudList ではなく
 * useAsync を直に使う（usePermissionsStore と同じ形）。
 *
 * **ヘッダから直に API を呼ばずストアを挟んでいる理由は 3 つある。**
 *   - main.js で useCodesStore の隣に先読みでき、起動オーバーレイが覆っている間に取得が終わる
 *     （ヘッダがマウントされた瞬間に「—」が見えるちらつきが出ない）
 *   - 休場 / 短縮取引は将来 発注画面も欲しがる（全画面共通・起動時 1 回という点で codes と同じ）
 *   - HTTP がコンポーネントの外に出るので、**ヘッダのマウント自体が通信を起こさない**
 *
 * **タイマーはここに置かない。** ストアは unmount されないので setInterval が永久に残る。
 * 定期実行は composables/useMarketStatus が onMounted / onUnmounted で持つ。
 *
 * 取得に失敗しても status は前の値のまま残す（useAsync が data を書き換えないため）。
 * 画面を開いたまま一時的に通信が切れたときに、直前まで出ていた時間帯を消さないための挙動。
 */
export const useMarketStatusStore = defineStore('marketStatus', () => {
  const { data, error, loading, execute } = useAsync(fetchMarketStatus)

  function load() {
    return execute()
  }

  // data のままだと呼び出し側が何のデータか分からないので status で公開する
  return { status: data, error, loading, load }
})
