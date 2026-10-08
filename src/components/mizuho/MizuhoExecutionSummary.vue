<script setup>
/**
 * 約定一覧の上に並べる件数カード 4 枚（総約定件数 / 買い約定 / 売り約定 / 一部出来）。
 *
 * 値は同じ検索条件での集計（ページに依らない）。取得中・失敗中は呼び出し側が null を渡し、
 * すべて '—' になる（前回の値を新しい条件の結果に見せない）。
 *
 * 「一部出来」は一部出来の**注文**の件数（ExecutionSummary の 一部出来件数）。ほかの 3 枚は約定の行数で、
 * 単位が違う（src/api/mizuhoExecutions.js の MizuhoExecutionSummary）。
 *
 * 色は画面モックの件数カードではなく、一覧の売買列と同じ 買=赤 / 売=青（tokens.css）にそろえる。
 * モックはカードだけ 買=青 / 売=赤 で、同じ画面の中で色の意味が逆になっていたため。
 *
 * 出す data-testid: mizuho-summary-total / -buy / -sell / -partial（値の要素）
 */
import { computed } from 'vue'
import { formatQuantity } from '@/utils/format'

const props = defineProps({
  /** src/api/mizuhoExecutions.js の MizuhoExecutionSummary。取れていなければ null */
  summary: {
    type: Object,
    default: null,
  },
})

const cards = computed(() => [
  { key: 'total', label: '総約定件数', value: props.summary?.executionCount, tone: null },
  { key: 'buy', label: '買い約定', value: props.summary?.buyCount, tone: 'buy' },
  { key: 'sell', label: '売り約定', value: props.summary?.sellCount, tone: 'sell' },
  { key: 'partial', label: '一部出来', value: props.summary?.partialCount, tone: 'partial' },
])
</script>

<template>
  <div class="mizuho-summary">
    <div v-for="card in cards" :key="card.key" class="mizuho-summary__card">
      <p class="mizuho-summary__label">{{ card.label }}</p>
      <p
        :class="['mizuho-summary__value', card.tone && `is-${card.tone}`]"
        :data-testid="`mizuho-summary-${card.key}`"
      >
        {{ formatQuantity(card.value) }}
      </p>
    </div>
  </div>
</template>

<style scoped>
/* モックの .grid-4。狭い画面では 2 列 → 1 列に落とす */
.mizuho-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-3);
}

@media (max-width: 900px) {
  .mizuho-summary {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .mizuho-summary {
    grid-template-columns: 1fr;
  }
}

/* モックの .stat-card */
.mizuho-summary__card {
  padding: var(--space-4) var(--space-5);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.mizuho-summary__label {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  letter-spacing: 0.05em;
}

.mizuho-summary__value {
  margin-top: var(--space-1);
  color: var(--color-text-heading);
  font-size: var(--font-size-xl);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.mizuho-summary__value.is-buy {
  color: var(--color-buy);
}

.mizuho-summary__value.is-sell {
  color: var(--color-sell);
}

.mizuho-summary__value.is-partial {
  color: var(--color-warning);
}
</style>
