import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useMarketStatusStore } from '@/stores/marketStatus'
import { toMarketDisplay } from '@/utils/marketStatus'

/*
 * ヘッダの市場状況を「動かし続ける」ための時計。
 *
 * **通信は起動時の 1 回だけ**（main.js の useMarketStatusStore().load()）。以後はフロント側で
 * 時刻を数え、sessions の各窓の境界（JPN開始 / JPN終了）に達したら表示を切り替える。
 * サーバがくれる境界は tz 付きの絶対時刻なので、次の境界までの setTimeout を 1 本置けば足りる。
 * 毎分ティックで判定し直す必要も、定期的に取り直す必要も無い。
 *
 * 例外として、受注不可日マスタ / 海外休場日マスタを保存したときはストア側が取り直す
 * （stores/marketStatus.js の reloadMarketStatusAfter）。取り直した status は下の watch が拾い、
 * 境界を予約し直す。
 *
 * トレードオフ:
 *   - 翌日のセッションは画面を再読み込みするまで反映されない（最後の境界を過ぎたら Closed のまま）
 *   - 他の利用者の端末で行われたマスタの編集も、再読み込みするまで反映されない
 *   - スリープ復帰などで遅れて発火しても、発火時点の Date.now() で判定し直すので表示は正しい側に戻る
 *
 * **タイマーをストアに置かないこと。** ストアは unmount されないのでタイマーが永久に残る。
 * ヘッダは 1 箇所にしかマウントされないので、ここが実質シングルトンになる。
 */

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

  let timer = null

  /*
   * 次の境界で 1 回だけ発火するように予約し直す。発火したら now を進めて、また次を予約する。
   * 早く発火しても（時計の補正など）同じ境界の残り時間で予約し直すだけなので自己修正される。
   * 境界が残っていなければ（休場・未取得・最後のセッションの後）予約しない。
   */
  function schedule() {
    clearTimeout(timer)
    timer = null

    const next = nextBoundary(store.status?.sessions ?? [], Date.now())
    if (next === null) return

    timer = setTimeout(() => {
      now.value = Date.now()
      schedule()
    }, next - Date.now())
  }

  // 起動時の取得がマウントより後に終わった場合と、マスタ保存後の取り直しで予約し直す
  watch(
    () => store.status,
    () => {
      now.value = Date.now()
      schedule()
    },
  )

  onMounted(schedule)

  onUnmounted(() => {
    clearTimeout(timer)
    timer = null
  })

  return computed(() => toMarketDisplay(store.status, now.value, { error: store.error }))
}

/** 現在時刻より後で最も早い境界（ミリ秒）。無ければ null */
function nextBoundary(sessions, nowMs) {
  const upcoming = sessions
    .flatMap((session) => [Date.parse(session.startJst), Date.parse(session.endJst)])
    .filter((ms) => Number.isFinite(ms) && ms > nowMs)

  return upcoming.length ? Math.min(...upcoming) : null
}
