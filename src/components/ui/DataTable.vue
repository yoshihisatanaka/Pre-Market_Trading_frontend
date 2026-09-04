<script setup>
/**
 * 汎用テーブル。ドメイン知識を持たせないこと（注文固有の表示は呼び出し側の slot で行う）。
 * 列ごとの見た目を変えたいときは `cell-<列key>` の slot を使う。
 */
defineProps({
  columns: {
    type: Array,
    required: true,
  },
  rows: {
    type: Array,
    required: true,
  },
  rowKey: {
    type: String,
    default: 'id',
  },
  // カード（BaseCard flush）の中に敷くとき、枠線・角丸・影が二重になるのを避ける
  flat: {
    type: Boolean,
    default: false,
  },
})
</script>

<template>
  <div :class="['data-table', { 'is-flat': flat }]">
    <table>
      <thead>
        <tr>
          <th v-for="column in columns" :key="column.key" :class="{ 'is-numeric': column.numeric }">
            {{ column.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row[rowKey]" data-testid="data-table-row">
          <td v-for="column in columns" :key="column.key" :class="{ numeric: column.numeric }">
            <slot :name="`cell-${column.key}`" :row="row" :value="row[column.key]">
              {{ row[column.key] }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.data-table {
  overflow-x: auto;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
}

.data-table.is-flat {
  border: none;
  border-radius: 0;
  box-shadow: none;
}

th,
td {
  padding: var(--space-3) var(--space-4);
  text-align: left;
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}

th {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-muted);
  background-color: var(--color-surface-muted);
}

th.is-numeric {
  text-align: right;
}

tbody tr:last-child td {
  border-bottom: none;
}
</style>
