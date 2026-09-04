<script setup>
/**
 * 汎用ボタン。ラベルは slot で受ける。
 * click は宣言せず、フォールスルー属性として <button> にそのまま届ける。
 */
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
    :class="[
      'base-button',
      `base-button--${variant}`,
      `base-button--${size}`,
      { 'is-block': block },
    ]"
  >
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
