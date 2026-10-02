<script setup>
/**
 * アプリ全体の骨格。サイドメニュー + ヘッダ + スクロールするコンテンツ領域。
 * 画面（views）は slot の中身だけを描画し、この構造を知らなくてよい。
 *
 * サイドメニューの開閉状態を唯一所有するのはここ。AppSidebar / AppHeader は
 * props を受け取るだけの部品でいる（BaseModal と同じ方針）。
 *
 * 画面遷移の確定待ち（遅延 import のチャンク取得。router/index.js の trackRouteLoading）は
 * ヘッダ上端の細いバーで示す。画面はまだ mount されていないので、各画面の 4 状態の
 * ローディングはこの間は出せない。押した項目の読み込み中表示は pending-path で AppSidebar に配る。
 */
import AppSidebar from './AppSidebar.vue'
import AppHeader from './AppHeader.vue'
import { useRouteLoading } from '@/composables/useRouteLoading'
import { useSidebarToggle } from '@/composables/useSidebarToggle'

const { isOpen, toggle } = useSidebarToggle()
const { isLoading, pendingPath } = useRouteLoading()
</script>

<template>
  <div class="app-layout">
    <AppSidebar :open="isOpen" :pending-path="pendingPath" />

    <div class="app-layout__main">
      <!-- 読み上げはここに任せる（サイドメニュー側の回転マークは aria-hidden） -->
      <div v-if="isLoading" data-testid="route-loading" role="status" class="app-layout__progress">
        <span class="visually-hidden">画面を読み込んでいます</span>
      </div>

      <AppHeader :sidebar-open="isOpen" @toggle-sidebar="toggle" />
      <main class="app-layout__content" :aria-busy="isLoading ? 'true' : undefined">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
/* overflow: hidden は畳んだサイドバー（負の margin-left ではみ出す）のクリップも兼ねる */
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.app-layout__main {
  /* プログレスバーの基準。上端に重ねるだけで、ヘッダや本文の位置は変えない */
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--color-bg);
}

/*
 * 遷移の確定待ちを示す不確定バー（ヘッダ上端の 3px）。
 * 150ms 待ってから現れるので、キャッシュ済みの速い遷移では目に入らない。
 * 1 箇所で持ち、prefers-reduced-motion で遅くする（BaseSpinner と同じ作法）。
 */
.app-layout__progress {
  --route-loading-duration: 1.2s;

  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  /* ヘッダより手前。モーダル（1000）とは比べない */
  z-index: 1;
  height: 3px;
  overflow: hidden;
  background-color: var(--color-info-border);
  animation: route-loading-appear 0.2s ease 0.15s both;
}

.app-layout__progress::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 40%;
  background-color: var(--color-link);
  animation: route-loading-slide var(--route-loading-duration) ease-in-out infinite;
}

@keyframes route-loading-appear {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@keyframes route-loading-slide {
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(250%);
  }
}

/* 止めると固まった画面と見分けが付かないので、遅くするだけにする */
@media (prefers-reduced-motion: reduce) {
  .app-layout__progress {
    --route-loading-duration: 3.6s;
  }
}

/* 縦スクロールはここだけで起きる（ヘッダとサイドバーは固定） */
.app-layout__content {
  flex: 1;
  padding: var(--space-5);
  overflow-y: auto;
}
</style>
