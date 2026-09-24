<script setup>
/**
 * 残高補正の集計パネル（補正前数量 / 加算数量 / 補正後数量 の 3 枠）。
 *
 * 画面モックでは加算モーダルと新規追加モーダルの両方の足元にあり、加算数量の入力に応じて
 * その場で変わる。値の計算は呼び出し側（view の computed）が持ち、この部品は並べるだけ。
 *
 * 出す data-testid（testidPrefix が 'balance-adjustments-increase' なら
 * balance-adjustments-increase-before など）:
 *   {prefix}-before / {prefix}-added / {prefix}-after
 */
import { computed } from 'vue'
import { formatQuantity } from '@/utils/format'

const props = defineProps({
  testidPrefix: {
    type: String,
    required: true,
  },
  /** 補正前の数量（新規追加では 0） */
  before: {
    type: Number,
    required: true,
  },
  /** 加算数量。未入力・数値でない入力のあいだは null（枠には '—' を出す） */
  added: {
    type: Number,
    default: null,
  },
  /** 補正後の数量。未入力のあいだは before と同じ値が来る */
  after: {
    type: Number,
    required: true,
  },
})

// 加算数量だけは符号を見せる（何株増えるのかが読み取れるように）
const addedLabel = computed(() => {
  if (props.added === null) return '—'
  return `${props.added >= 0 ? '+' : ''}${formatQuantity(props.added)}株`
})
</script>

<template>
  <div class="balance-quantity-panel">
    <div class="balance-quantity-panel__cell">
      <span class="balance-quantity-panel__label">補正前数量</span>
      <span class="balance-quantity-panel__value" :data-testid="`${testidPrefix}-before`">
        {{ formatQuantity(before) }}株
      </span>
    </div>

    <div class="balance-quantity-panel__cell">
      <span class="balance-quantity-panel__label">加算数量</span>
      <span class="balance-quantity-panel__value" :data-testid="`${testidPrefix}-added`">
        {{ addedLabel }}
      </span>
    </div>

    <div class="balance-quantity-panel__cell">
      <span class="balance-quantity-panel__label">補正後数量</span>
      <span class="balance-quantity-panel__value" :data-testid="`${testidPrefix}-after`">
        {{ formatQuantity(after) }}株
      </span>
    </div>
  </div>
</template>

<style scoped>
/* 3 枠を等幅で並べ、区切り線だけで仕切る（画面モックの淡いパネル） */
.balance-quantity-panel {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-muted);
}

.balance-quantity-panel__cell {
  padding: var(--space-3) var(--space-4);
  border-left: 1px solid var(--color-border);
}

.balance-quantity-panel__cell:first-child {
  border-left: none;
}

.balance-quantity-panel__label {
  display: block;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

/* 数量は右寄せで桁を揃える（枠をまたいで位が読み比べられるように） */
.balance-quantity-panel__value {
  display: block;
  margin-top: var(--space-2);
  color: var(--color-text-heading);
  font-size: var(--font-size-lg);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
</style>
