<script setup>
/**
 * アプリ全体の骨格。サイドメニュー + ヘッダ + スクロールするコンテンツ領域。
 * 画面（views）は slot の中身だけを描画し、この構造を知らなくてよい。
 *
 * サイドメニューの開閉状態を唯一所有するのはここ。AppSidebar / AppHeader は
 * props を受け取るだけの部品でいる（BaseModal と同じ方針）。
 */
import AppSidebar from './AppSidebar.vue'
import AppHeader from './AppHeader.vue'
import { useSidebarToggle } from '@/composables/useSidebarToggle'

const { isOpen, toggle } = useSidebarToggle()
</script>

<template>
  <div class="app-layout">
    <AppSidebar :open="isOpen" />

    <div class="app-layout__main">
      <AppHeader :sidebar-open="isOpen" @toggle-sidebar="toggle" />
      <main class="app-layout__content">
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
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--color-bg);
}

/* 縦スクロールはここだけで起きる（ヘッダとサイドバーは固定） */
.app-layout__content {
  flex: 1;
  padding: var(--space-5);
  overflow-y: auto;
}
</style>
