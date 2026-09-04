<script setup>
/**
 * 1行入力（text / number / date / password など）。
 * 幅・inputmode・maxlength・step といった個別指定は宣言せず、そのまま <input> へ素通しする。
 * ラベルや必須マーク、エラー文言は持たない（FormField の仕事）。
 *
 *   boxed     … 枠線ボックス様式（検索カード / モーダル）
 *   underline … 下線だけの様式（注文入力画面）
 */
defineProps({
  type: {
    type: String,
    default: 'text',
  },
  variant: {
    type: String,
    default: 'boxed',
    validator: (value) => ['boxed', 'underline'].includes(value),
  },
  invalid: {
    type: Boolean,
    default: false,
  },
})

const model = defineModel({ type: [String, Number], default: '' })

</script>

<template>
  <input
    v-model="model"
    :type="type"
    :class="['base-input', `base-input--${variant}`, { 'is-invalid': invalid }]"
    :aria-invalid="invalid || undefined"
    :data-variant="variant"
  />
</template>

<style scoped>
.base-input {
  color: var(--color-text);
  background-color: var(--color-surface);
  outline: none;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.base-input::placeholder {
  color: var(--color-input-placeholder);
}

.base-input:disabled {
  background-color: var(--color-surface-muted);
  color: var(--color-text-muted);
  cursor: not-allowed;
}

.base-input--boxed {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-input-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-md);
}

.base-input--boxed:focus {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-focus-ring);
}

.base-input--boxed.is-invalid {
  border-color: var(--color-danger);
}

.base-input--underline {
  height: 34px;
  padding: var(--space-1) var(--space-2);
  border: none;
  border-bottom: 2px solid var(--color-input-underline);
  border-radius: 0;
  background-color: transparent;
  font-size: var(--font-size-md);
}

.base-input--underline:focus {
  border-bottom-color: var(--color-primary);
}

.base-input--underline.is-invalid {
  border-bottom-color: var(--color-danger);
}
</style>
