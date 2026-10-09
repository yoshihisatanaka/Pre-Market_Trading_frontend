import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useBannerStore } from '@/stores/banner'
import { toBannerDisplay } from '@/utils/operationBanner'

/*
 * 全画面の運用バナーを「新しく保ち続ける」ための時計と、利用者が閉じた状態。
 *
 * 初回の取得は起動時の 1 回（main.js の useBannerStore().load()）。以後はここが
 * BANNER_REFRESH_MS ごとに取り直す。市場状況（useMarketStatus）と違い、発注停止やお知らせは
 * 他の担当者の操作でいつでも変わり、境界の時刻が前もって分からないので定期的に取り直す。
 *
 *   - タブが裏にある間（document.hidden）は取らない。表に戻った時点ですぐ取り直す
 *   - 取り直しに失敗しても useAsync は data を消さないので、直前の内容が出続ける
 *   - お知らせ管理で保存したときは、画面側が store を直接取り直す（60 秒を待たせない）
 *
 * **タイマーをストアに置かないこと。** ストアは unmount されないのでタイマーが永久に残る。
 * バナーはレイアウトの 1 箇所にしかマウントされないので、ここが実質シングルトンになる。
 */

/** 取り直しの間隔（ミリ秒） */
export const BANNER_REFRESH_MS = 60_000

/** 閉じたお知らせの本文を覚えておく sessionStorage のキー */
export const DISMISSED_STORAGE_KEY = 'app.operationBanner.dismissed'

function readDismissed() {
  try {
    return window.sessionStorage.getItem(DISMISSED_STORAGE_KEY)
  } catch {
    // 保存が使えない環境（プライベートモードなど）。閉じた状態はこのタブの中だけで持つ
    return null
  }
}

function writeDismissed(message) {
  try {
    window.sessionStorage.setItem(DISMISSED_STORAGE_KEY, message)
  } catch {
    // 保存できなくても、閉じる操作そのものは成立する
  }
}

/**
 * ヘッダ直下の帯が描くだけでよい内容を返す。
 *
 * 閉じた状態は**本文で覚える**。同じ本文なら再読み込みしても出さず、本文が変われば再び出す。
 * タブを閉じれば忘れる（sessionStorage）。閉じられるのはお知らせだけで、発注停止は常に出す。
 *
 * @returns {{
 *   display: import('vue').ComputedRef<import('@/utils/operationBanner').BannerDisplay | null>,
 *   dismiss: () => void,
 * }}
 */
export function useOperationBanner() {
  const store = useBannerStore()
  const dismissedMessage = ref(readDismissed())

  const display = computed(() => {
    const value = toBannerDisplay(store.banner)
    if (!value) return null
    if (value.dismissible && value.message === dismissedMessage.value) return null
    return value
  })

  function dismiss() {
    const value = display.value
    if (!value?.dismissible) return
    dismissedMessage.value = value.message
    writeDismissed(value.message)
  }

  let timer = null

  function refresh() {
    if (document.hidden) return
    store.load()
  }

  function startTimer() {
    clearInterval(timer)
    timer = setInterval(refresh, BANNER_REFRESH_MS)
  }

  // 表に戻ったら取り直し、間隔も数え直す（直後にタイマーが発火して 2 回続けて取らないように）
  function onVisibilityChange() {
    if (document.hidden) return
    store.load()
    startTimer()
  }

  onMounted(() => {
    startTimer()
    document.addEventListener('visibilitychange', onVisibilityChange)
  })

  onUnmounted(() => {
    clearInterval(timer)
    timer = null
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return { display, dismiss }
}
