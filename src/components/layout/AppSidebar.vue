<script setup>
/**
 * 全画面共通のサイドメニュー。
 * 項目は navigation.js が正。ここに直接リンクを書き足さないこと。
 *
 * 開閉状態は自分では持たず、所有者（AppLayout）から open で受け取る。
 * 押し出し式なので、閉じると板ごと画面外へ出て本文が全幅になる。
 */
import { RouterLink } from 'vue-router'
import { navSections } from './navigation'
import { navIcons } from './navIcons'

defineProps({
  /** 展開しているか。既定は展開（畳むのは呼び出し側の明示的な指定） */
  open: {
    type: Boolean,
    default: true,
  },
})
</script>

<template>
  <!--
    inert は Vue の「特別な boolean 属性」ではないため :inert="!open" と書くと
    inert="false" が属性として残り、開いているのに操作できなくなる環境がある。
    畳んだときだけ true を渡し、開いているときは undefined で属性ごと消す。
  -->
  <aside
    id="app-sidebar"
    data-testid="app-sidebar"
    class="sidebar"
    :class="{ 'is-collapsed': !open }"
    :inert="open ? undefined : true"
  >
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
  /* 1 箇所で持ち、prefers-reduced-motion で 0 に潰す（BaseSpinner と同じ作法） */
  --sidebar-transition-duration: 0.2s;

  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: var(--layout-sidebar-width);
  overflow-y: auto;
  background-color: var(--color-sidebar-bg);
  transition:
    margin-left var(--sidebar-transition-duration) ease,
    visibility 0s linear 0s;
}

/*
 * 幅を 0 に縮めるとラベルが折り返して「潰れる」動きになるので、幅は保ったまま
 * 板ごと左へ出す（はみ出しは .app-layout の overflow: hidden がクリップする）。
 * visibility は畳み終わってから掛ける。矩形が残ったままだと「見えている」と判定され、
 * 閉じたことを検証できない。
 */
.sidebar.is-collapsed {
  margin-left: calc(var(--layout-sidebar-width) * -1);
  visibility: hidden;
  transition:
    margin-left var(--sidebar-transition-duration) ease,
    visibility 0s linear var(--sidebar-transition-duration);
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

/* 0s にすると visibility の遅延も 0s になり、その場で切り替わる */
@media (prefers-reduced-motion: reduce) {
  .sidebar {
    --sidebar-transition-duration: 0s;
  }
}
</style>
