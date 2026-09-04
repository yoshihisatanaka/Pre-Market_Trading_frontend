<script setup>
/**
 * 一覧のセルなどに置く小さな状態チップ（売買区分・区分名・ステータス）。
 * 文言は slot で受ける。色の意味づけは呼び出し側が variant で決める。
 */
defineProps({
  variant: {
    type: String,
    default: 'gray',
    validator: (value) => ['gray', 'buy', 'sell', 'success', 'warning', 'info'].includes(value),
  },
})
</script>

<template>
  <span :class="['badge', `badge--${variant}`]" :data-variant="variant">
    <slot />
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: 600;
  line-height: 1.6;
  white-space: nowrap;
}

.badge--gray {
  background-color: var(--color-surface-muted);
  color: var(--color-text-muted);
}

.badge--buy {
  background-color: var(--color-danger-bg);
  color: var(--color-buy);
}

.badge--sell {
  background-color: var(--color-info-bg);
  color: var(--color-sell);
}

.badge--success {
  background-color: var(--color-success-bg);
  color: var(--color-success);
}

.badge--warning {
  background-color: var(--color-warning-bg);
  color: var(--color-warning);
}

.badge--info {
  background-color: var(--color-info-bg);
  color: var(--color-info-text);
}
</style>
