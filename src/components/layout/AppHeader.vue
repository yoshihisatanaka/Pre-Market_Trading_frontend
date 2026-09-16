<script setup>
/**
 * 全画面共通のヘッダ。
 * 画面タイトルは各 view ではなく、ここが router の meta.title から描画する。
 * 画面固有の操作ボタンは view 側から <Teleport defer to="#topbar-actions"> で差し込む。
 *
 * 左端のメニューボタンはサイドメニューの開閉操作。押し出し式で畳むとサイドメニューは
 * 画面外に出るので、トグルは常時見えているこちら側に置く。状態は持たず通知するだけ。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useMarketStatus } from '@/composables/useMarketStatus'

defineProps({
  /** サイドメニューが展開しているか。ボタンの aria-expanded に映すだけで、自分では変えない */
  sidebarOpen: {
    type: Boolean,
    default: true,
  },
})

defineEmits(['toggle-sidebar'])

const route = useRoute()
const title = computed(() => route.meta.title ?? '')
const market = useMarketStatus()
</script>

<template>
  <header class="topbar">
    <div class="topbar__left">
      <!--
        名前は状態で変えない（状態は aria-expanded の役割）。
        nav の「メインメニュー」と同名にしないこと。
      -->
      <button
        type="button"
        data-testid="sidebar-toggle"
        class="topbar__menu"
        aria-label="メニューの開閉"
        aria-controls="app-sidebar"
        :aria-expanded="sidebarOpen ? 'true' : 'false'"
        @click="$emit('toggle-sidebar')"
      >
        <!-- アイコンライブラリは入れていない。線はサイドメニューと同じ流儀（24 viewBox / stroke 2） -->
        <svg
          class="topbar__menu-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <h1 class="topbar__title">{{ title }}</h1>
    </div>

    <div class="topbar__right">
      <span
        data-testid="market-status"
        :data-status="market.key"
        :class="['market-status', `market-status--${market.key}`]"
      >
        {{ market.label }}
      </span>

      <!-- 画面固有のボタンの差し込み先。中身は各 view が Teleport で入れる -->
      <div id="topbar-actions" data-testid="topbar-actions" class="topbar__actions"></div>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-5);
  background-color: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.topbar__left {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

/*
 * 面を塗らないアイコンボタンは BaseButton の 4 variant に無い。1 箇所のために
 * 共通部品を広げず素の button で持つ（同じ形が 2 個目に出たら BaseButton へ寄せる）。
 */
.topbar__menu {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background-color: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.topbar__menu:hover {
  background-color: var(--color-bg);
  color: var(--color-text);
}

.topbar__menu:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus-ring);
}

/* --space-* は余白の尺度なので、アイコンの寸法は直値で持つ（既存方針） */
.topbar__menu-icon {
  width: 20px;
  height: 20px;
}

.topbar__title {
  color: var(--color-text-heading);
  font-size: var(--font-size-xl);
  font-weight: 500;
  letter-spacing: 0.01em;
}

.topbar__right,
.topbar__actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.market-status {
  font-size: var(--font-size-sm);
  font-weight: 500;
  white-space: nowrap;
}

.market-status--premarket {
  color: var(--color-market-premarket);
}

.market-status--regular {
  color: var(--color-market-regular);
}

.market-status--afterhours {
  color: var(--color-market-afterhours);
}

.market-status--closed {
  color: var(--color-market-closed);
}
</style>
