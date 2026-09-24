import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useMarketStatusStore } from '@/stores/marketStatus'
import { toMarketDisplay } from '@/utils/marketStatus'

/*
 * ヘッダの市場状況を「動かし続ける」ための時計。
 *
 * 更新の仕方を 2 つに分けてある。
 *   毎分のティック … now を進めるだけ。サーバがくれる JPN開始 / JPN終了 は tz 付きの
 *                    絶対時刻なので、現在セッションの判定はローカルの比較だけで済む
 *   5 分ごとの再取得 … 画面を開いたまま日付を跨いだときと、運用中に海外休場日マスタが
 *                    編集されたときに追いつくため
 *
 * 60 秒ごとに API を叩く案は採らない。ヘッダは全画面に常時マウントされるので
 * 利用者 1 人あたり常時 1 req/min になり、表示の情報量に対して割高になる。
 * 起動時 1 回だけの案も、日付を跨いだときに前日の時間帯を出し続けるので不可。
 *
 * **タイマーをストアに置かないこと。** ストアは unmount されないので setInterval が
 * 永久に残る。ヘッダは 1 箇所にしかマウントされないので、ここが実質シングルトンになる。
 */

/** 現在セッションを判定し直す間隔 */
const TICK_INTERVAL_MS = 60_000

/** サーバに取り直しに行く間隔 */
const RELOAD_INTERVAL_MS = 300_000

/**
 * ヘッダが描くだけでよい市場状況を返す。
 *
 * 通信はストアの担当で、この composable もコンポーネントも HTTP を知らない。
 * 取得済みのまま失敗したときに古い値を出し続けるかどうかは toMarketDisplay が決める。
 *
 * @returns {import('vue').ComputedRef<import('@/utils/marketStatus').MarketDisplay>}
 */
export function useMarketStatus() {
  const store = useMarketStatusStore()
  const now = ref(Date.now())

  let tickTimer = null
  let reloadTimer = null

  onMounted(() => {
    tickTimer = setInterval(() => {
      now.value = Date.now()
    }, TICK_INTERVAL_MS)

    reloadTimer = setInterval(() => {
      store.load()
    }, RELOAD_INTERVAL_MS)
  })

  onUnmounted(() => {
    clearInterval(tickTimer)
    clearInterval(reloadTimer)
  })

  return computed(() => toMarketDisplay(store.status, now.value, { error: store.error }))
}
