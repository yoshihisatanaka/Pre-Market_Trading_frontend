<script setup>
/**
 * 画面上部やカード内に出す帯状の通知。フォーム 1 項目のエラーは FormField の error を使う。
 * error のときだけ role="alert" にし、支援技術へ即時に読ませる。
 */
defineProps({
  variant: {
    type: String,
    default: 'info',
    validator: (value) => ['info', 'success', 'warning', 'error'].includes(value),
  },
})
</script>

<template>
  <div
    :class="['alert', `alert--${variant}`]"
    :role="variant === 'error' ? 'alert' : 'status'"
    :data-variant="variant"
  >
    <slot />
  </div>
</template>

<style scoped>
.alert {
  padding: var(--space-2) var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-md);
}

.alert--info {
  background-color: var(--color-info-bg);
  border-color: var(--color-info-border);
  color: var(--color-info-text);
}

.alert--success {
  background-color: var(--color-success-bg);
  border-color: var(--color-success-border);
  color: var(--color-success);
}

.alert--warning {
  background-color: var(--color-warning-bg);
  border-color: var(--color-warning-border);
  color: var(--color-warning);
}

.alert--error {
  background-color: var(--color-danger-bg);
  border-color: var(--color-danger-border);
  color: var(--color-danger-text);
}
</style>
