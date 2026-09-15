<script setup>
/**
 * 汎用ボタン。ラベルは slot で受ける。
 * click は宣言せず、フォールスルー属性として <button> にそのまま届ける。
 *
 * loading は「送信中」の見た目（回転マークと aria-busy）だけを担う。押せなくするのは
 * 呼び出し側の disabled の仕事で、ここでは連動させない（同じことを 2 箇所で管理しない）。
 */
import BaseSpinner from '@/components/ui/BaseSpinner.vue'

defineProps({
  variant: {
    type: String,
    default: 'primary',
    validator: (value) => ['primary', 'secondary', 'danger', 'success'].includes(value),
  },
  size: {
    type: String,
    default: 'md',
    validator: (value) => ['md', 'sm'].includes(value),
  },
  type: {
    type: String,
    default: 'button',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  /** 送信中。回転マークを出すだけで、押せなくはしない（上記） */
  loading: {
    type: Boolean,
    default: false,
  },
  block: {
    type: Boolean,
    default: false,
  },
})
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    :aria-busy="loading || undefined"
    :class="[
      'base-button',
      `base-button--${variant}`,
      `base-button--${size}`,
      { 'is-block': block },
    ]"
  >
    <!--
      label="" は必須。ボタンのラベル（「追加中…」など）が既に状態を伝えているので
      読み上げは二重にせず、textContent も汚さない（文言を完全一致で見ているテストがある）
    -->
    <BaseSpinner v-if="loading" size="sm" label="" />
    <slot />
  </button>
</template>

<style scoped>
.base-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.base-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.base-button.is-block {
  width: 100%;
}

.base-button--md {
  padding: var(--space-2) var(--space-4);
  font-size: var(--font-size-md);
}

.base-button--sm {
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-size-sm);
}

.base-button--primary {
  background-color: var(--color-primary);
  color: var(--color-primary-contrast);
}

.base-button--primary:hover:not(:disabled) {
  background-color: var(--color-primary-hover);
}

.base-button--secondary {
  background-color: var(--color-surface);
  border-color: var(--color-border);
  color: var(--color-text);
}

.base-button--secondary:hover:not(:disabled) {
  background-color: var(--color-bg);
}

.base-button--danger {
  background-color: var(--color-danger);
  color: var(--color-primary-contrast);
}

.base-button--danger:hover:not(:disabled) {
  background-color: var(--color-danger-hover);
}

.base-button--success {
  background-color: var(--color-success);
  color: var(--color-primary-contrast);
}

.base-button--success:hover:not(:disabled) {
  background-color: var(--color-success-hover);
}
</style>
