<script setup>
defineProps({
  variant: {
    type: String,
    default: 'primary',
    validator: (value) => ['primary', 'secondary', 'danger'].includes(value),
  },
  type: {
    type: String,
    default: 'button',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
})
</script>

<template>
  <button :type="type" :disabled="disabled" :class="['base-button', `base-button--${variant}`]">
    <slot />
  </button>
</template>

<style scoped>
.base-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.base-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
</style>
