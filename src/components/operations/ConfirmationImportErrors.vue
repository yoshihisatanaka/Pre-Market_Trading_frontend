<script setup>
/**
 * コンファメーション CSV の取込で返った行エラーの表（行 / 注文ID / 内容）。
 * 1 行に理由が複数あるときは全部出す（どれも直さないと取り込めないため）。
 *
 * 出す data-testid は無い。表そのものの testid は呼び出し側がフォールスルーで渡す。
 * 行は DataTable の data-table-row で数えられる。
 */
import DataTable from '@/components/ui/DataTable.vue'

defineProps({
  /** src/api/stalledOrders.js の ConfirmationImportResult.errors */
  errors: {
    type: Array,
    required: true,
  },
})

const COLUMNS = [
  { key: 'lineNumber', label: '行', numeric: true },
  { key: 'orderId', label: '注文ID' },
  { key: 'messages', label: '内容' },
]
</script>

<template>
  <DataTable :columns="COLUMNS" :rows="errors" row-key="lineNumber">
    <template #cell-lineNumber="{ value }">{{ value ?? '—' }}</template>
    <template #cell-orderId="{ value }">{{ value || '—' }}</template>
    <template #cell-messages="{ value }">
      <ul class="import-errors__messages">
        <li v-for="message in value" :key="message">{{ message }}</li>
      </ul>
    </template>
  </DataTable>
</template>

<style scoped>
.import-errors__messages {
  margin: 0;
  padding: 0;
  list-style: none;
  white-space: normal;
}
</style>
