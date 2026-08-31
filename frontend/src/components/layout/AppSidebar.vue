<script setup>
/**
 * 全画面共通のサイドメニュー。
 * 項目は navigation.js が正。ここに直接リンクを書き足さないこと。
 */
import { RouterLink } from 'vue-router'
import { navSections } from './navigation'
import { navIcons } from './navIcons'
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar__logo">
      <div class="sidebar__logo-title">米株発注システム</div>
    </div>

    <nav class="sidebar__nav" aria-label="メインメニュー">
      <template v-for="section in navSections" :key="section.label">
        <h2 class="sidebar__section">{{ section.label }}</h2>
        <RouterLink
          v-for="item in section.items"
          :key="item.to"
          :to="item.to"
          class="sidebar__link"
          active-class="is-active"
        >
          <!-- アイコンはラベルの装飾。読み上げ対象から外してリンク名をラベルだけにする -->
          <svg
            v-if="item.icon"
            class="sidebar__icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path :d="navIcons[item.icon]" />
          </svg>
          {{ item.label }}
        </RouterLink>
      </template>
    </nav>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: var(--layout-sidebar-width);
  overflow-y: auto;
  background-color: var(--color-sidebar-bg);
}

.sidebar__logo {
  padding: var(--space-5) var(--space-4);
  border-bottom: 1px solid var(--color-sidebar-border);
}

.sidebar__logo-title {
  color: var(--color-sidebar-text-active);
  font-size: var(--font-size-lg);
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: 0.01em;
}

.sidebar__nav {
  flex: 1;
  padding: var(--space-4) var(--space-3);
}

.sidebar__section {
  margin: var(--space-4) 0 var(--space-2);
  padding: 0 var(--space-2);
  color: var(--color-sidebar-section);
  font-size: var(--font-size-xs);
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.sidebar__section:first-child {
  margin-top: 0;
}

.sidebar__link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  color: var(--color-sidebar-text);
  font-size: var(--font-size-md);
  text-decoration: none;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.sidebar__link:hover,
.sidebar__link.is-active {
  background-color: var(--color-sidebar-hover);
  color: var(--color-sidebar-text-active);
}

.sidebar__icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}
</style>
