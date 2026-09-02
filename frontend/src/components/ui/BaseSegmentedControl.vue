<script setup>
/**
 * 排他選択をボタン列で行う部品（注文入力画面の売買区分・価格区分・預り売買区分など）。
 * <select> より押しやすく、選択中の値が常に見えるのが利点。
 *
 * options は `{ value, label, tone? }` の配列。tone に 'buy' / 'sell' を指定すると、
 * 選択中の色が売買方向の色になる（未指定なら primary）。
 * 選択状態は aria-pressed と data-selected の両方で外から観察できる。
 */
defineProps({
  options: {
    type: Array,
    required: true,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
})

const model = defineModel({ type: [String, Number], default: '' })

</script>

<template>
  <div class="segmented" role="group">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :class="['segmented__item', { 'is-selected': option.value === model }]"
      :aria-pressed="option.value === model"
      :disabled="disabled"
      :data-value="option.value"
      :data-tone="option.tone"
      :data-selected="option.value === model"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  align-items: center;
}

.segmented__item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 70px;
  height: 30px;
  padding: 0 var(--space-4);
  border: 1.5px solid var(--color-border);
  background-color: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}

/* 両端だけを丸め、間の境界は 1 本に見せる（モックのセグメント表現） */
.segmented__item:first-child {
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.segmented__item:last-child {
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.segmented__item:only-child {
  border-radius: var(--radius-sm);
}

.segmented__item:not(:first-child) {
  border-left: none;
}

.segmented__item:hover:not(.is-selected):not(:disabled) {
  background-color: var(--color-surface-muted);
  color: var(--color-text);
}

.segmented__item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.segmented__item.is-selected {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-primary-contrast);
}

.segmented__item.is-selected[data-tone='buy'] {
  background-color: var(--color-buy-strong);
  border-color: var(--color-buy);
}

.segmented__item.is-selected[data-tone='sell'] {
  background-color: var(--color-sell-strong);
  border-color: var(--color-sell);
}
</style>
