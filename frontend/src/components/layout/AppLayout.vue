<script setup>
/**
 * アプリ全体の骨格。サイドメニュー + ヘッダ + スクロールするコンテンツ領域。
 * 画面（views）は slot の中身だけを描画し、この構造を知らなくてよい。
 */
import AppSidebar from './AppSidebar.vue'
import AppHeader from './AppHeader.vue'
</script>

<template>
  <div class="app-layout">
    <AppSidebar />

    <div class="app-layout__main">
      <AppHeader />
      <main class="app-layout__content">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
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
