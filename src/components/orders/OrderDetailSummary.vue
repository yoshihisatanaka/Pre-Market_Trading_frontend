<script setup>
/**
 * 訂正・取消の画面で、対象注文を読み取り専用で見せる表（左にラベル、右に値の 2 列）。
 *
 * 何をどの順で出すかは画面ごとに違う（訂正は「原注文」、取消は「取消対象（未約定残）」を出す）ので、
 * 行の中身は呼び出し側が items で組み立てて渡す。この部品が持つのは体裁だけ。
 * 見た目は DreamStatusChangeDialog の要約と同じ。
 *
 * 出す data-testid は無い（行の値は呼び出し側が items の testid で指す）。
 * 表そのものの testid は呼び出し側がフォールスルーで渡す。
 */
defineProps({
  /**
   * 1 行ずつの `{ label, value, testid? }`。value は整形済みの文字列。
   * testid を付けた行は dd に data-testid が付く（E2E が値を読むため）
   */
  items: {
    type: Array,
    required: true,
  },
})
</script>

<template>
  <dl class="order-detail-summary">
    <template v-for="item in items" :key="item.label">
      <dt>{{ item.label }}</dt>
      <dd :data-testid="item.testid || undefined">{{ item.value }}</dd>
    </template>
  </dl>
</template>

<style scoped>
.order-detail-summary {
  display: grid;
  grid-template-columns: 10em 1fr;
  margin: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.order-detail-summary dt,
.order-detail-summary dd {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--color-border);
}

/* 1 行目だけは上の枠線と重ならないようにする */
.order-detail-summary dt:first-of-type,
.order-detail-summary dt:first-of-type + dd {
  border-top: none;
}

.order-detail-summary dt {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  background-color: var(--color-surface-muted);
}

.order-detail-summary dd {
  font-variant-numeric: tabular-nums;
}
</style>
