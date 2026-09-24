<script setup>
/**
 * 複数行入力（お知らせ本文・備考など）。BaseInput の textarea 版。
 * placeholder・maxlength・disabled といった個別指定は宣言せず、そのまま <textarea> へ素通しする。
 * ラベルや必須マーク、エラー文言は持たない（FormField の仕事）。
 *
 * 様式は枠線ボックスだけ。BaseInput の underline（注文入力画面の下線様式）に相当する
 * 複数行入力はモックに無いので variant を持たせない。
 */
defineProps({
  rows: {
    type: Number,
    default: 4,
  },
  invalid: {
    type: Boolean,
    default: false,
  },
})

const model = defineModel({ type: String, default: '' })
</script>

<template>
  <textarea
    v-model="model"
    :rows="rows"
    :class="['base-textarea', { 'is-invalid': invalid }]"
    :aria-invalid="invalid || undefined"
  />
</template>

<style scoped>
.base-textarea {
  display: block;
  width: 100%;
  /* モックの .announcement-input に合わせる。rows より下には縮まない */
  min-height: 88px;
  padding: var(--space-2) var(--space-3);
  color: var(--color-text);
  background-color: var(--color-surface);
  border: 1px solid var(--color-input-border);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: var(--font-size-md);
  line-height: 1.6;
  outline: none;
  /* 横に伸ばすとレイアウトが崩れるので縦だけ許す */
  resize: vertical;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.base-textarea::placeholder {
  color: var(--color-input-placeholder);
}

.base-textarea:focus {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-focus-ring);
}

.base-textarea:disabled {
  background-color: var(--color-surface-muted);
  color: var(--color-text-muted);
  cursor: not-allowed;
}

.base-textarea.is-invalid {
  border-color: var(--color-danger);
}
</style>
