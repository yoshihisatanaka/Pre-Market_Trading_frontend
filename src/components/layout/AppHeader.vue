<script setup>
/**
 * 全画面共通のヘッダ。
 * 画面タイトルは各 view ではなく、ここが router の meta.title から描画する。
 * 画面固有の操作ボタンは view 側から <Teleport defer to="#topbar-actions"> で差し込む。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useMarketStatus } from '@/composables/useMarketStatus'

const route = useRoute()
const title = computed(() => route.meta.title ?? '')
const market = useMarketStatus()
</script>

<template>
  <header class="topbar">
    <h1 class="topbar__title">{{ title }}</h1>

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
