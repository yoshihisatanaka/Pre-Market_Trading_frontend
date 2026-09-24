<script setup>
/**
 * 操作ログ 1 件の詳細ダイアログ。**読み取り専用。**
 *
 * 監査の記録なので入力欄も保存ボタンも持たない（masters/MasterFormDialog は使わない。
 * あちらは「キャンセル / 保存」のフォームの器）。フッタは「閉じる」だけ。
 *
 * 出すもの:
 *   - 概要（操作日時 / 対象種別 / 対象キー / 操作区分 / 操作者 / 履歴ID）
 *   - 変更項目（バッジ）と差分の表（項目 / 変更前 / 変更後）
 *   - 変更前データ / 変更後データの全項目（折りたたみ。無い側は出さない）
 *
 * **この部品は状態を持たない。** どの行を開いているかは呼び出し側（view）が持ち、
 * ここは close を emit するだけ。
 *
 * 出す data-testid: activity-log-detail / -changed-fields / -diff / -before / -after / -close
 */
import { computed } from 'vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import DataTable from '@/components/ui/DataTable.vue'
import {
  formatActivityAt,
  formatActivityValue,
  operationBadgeVariant,
  operationLabel,
} from '@/utils/activityLogTypes'

const props = defineProps({
  open: {
    type: Boolean,
    required: true,
  },
  /** 表示する操作ログ（src/api/activityLogs.js の ActivityLog）。閉じている間は null でよい */
  log: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['close'])

const diffColumns = [
  { key: 'field', label: '項目' },
  { key: 'before', label: '変更前' },
  { key: 'after', label: '変更後' },
]

const recordColumns = [
  { key: 'field', label: '項目' },
  { key: 'value', label: '値' },
]

/** レコード（object）→ DataTable の行。無いとき（登録前・削除後）は null */
function toRecordRows(record) {
  if (!record) return null
  return Object.entries(record).map(([field, value]) => ({ field, value }))
}

const beforeRows = computed(() => toRecordRows(props.log?.before))
const afterRows = computed(() => toRecordRows(props.log?.after))
</script>

<template>
  <BaseModal :open="open" title="操作ログの詳細" @close="emit('close')">
    <div v-if="log" class="activity-log-detail" data-testid="activity-log-detail">
      <dl class="activity-log-detail__summary">
        <dt>操作日時</dt>
        <dd>{{ formatActivityAt(log.at) }}</dd>
        <dt>対象種別</dt>
        <dd>{{ log.targetTypeName }}</dd>
        <dt>対象キー</dt>
        <dd>{{ log.targetKey || '—' }}</dd>
        <dt>操作区分</dt>
        <dd>
          <BaseBadge :variant="operationBadgeVariant(log.operation)">
            {{ operationLabel(log.operation) }}
          </BaseBadge>
        </dd>
        <dt>操作者</dt>
        <dd>{{ log.operator || '—' }}</dd>
        <dt>履歴ID</dt>
        <dd>{{ log.historyId }}</dd>
      </dl>

      <section class="activity-log-detail__section">
        <p class="activity-log-detail__heading">変更項目</p>
        <div
          v-if="log.changedFields.length > 0"
          class="activity-log-detail__fields"
          data-testid="activity-log-detail-changed-fields"
        >
          <BaseBadge v-for="field in log.changedFields" :key="field">{{ field }}</BaseBadge>
        </div>
        <p v-else class="activity-log-detail__none">変更された項目はありません。</p>
      </section>

      <section v-if="log.diff.length > 0" class="activity-log-detail__section">
        <p class="activity-log-detail__heading">差分</p>
        <DataTable
          flat
          row-key="field"
          data-testid="activity-log-detail-diff"
          :columns="diffColumns"
          :rows="log.diff"
        >
          <template #cell-before="{ row }">{{ formatActivityValue(row.before) }}</template>
          <template #cell-after="{ row }">{{ formatActivityValue(row.after) }}</template>
        </DataTable>
      </section>

      <details v-if="beforeRows" class="activity-log-detail__record">
        <summary>変更前データ（全項目）</summary>
        <DataTable
          flat
          row-key="field"
          data-testid="activity-log-detail-before"
          :columns="recordColumns"
          :rows="beforeRows"
        >
          <template #cell-value="{ row }">{{ formatActivityValue(row.value) }}</template>
        </DataTable>
      </details>

      <details v-if="afterRows" class="activity-log-detail__record">
        <summary>変更後データ（全項目）</summary>
        <DataTable
          flat
          row-key="field"
          data-testid="activity-log-detail-after"
          :columns="recordColumns"
          :rows="afterRows"
        >
          <template #cell-value="{ row }">{{ formatActivityValue(row.value) }}</template>
        </DataTable>
      </details>
    </div>

    <template #footer>
      <BaseButton variant="secondary" data-testid="activity-log-detail-close" @click="emit('close')">
        閉じる
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.activity-log-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  /* 全項目を開くと縦に長くなるので、画面からはみ出さないようにダイアログの中でスクロールさせる */
  max-height: 60vh;
  overflow-y: auto;
}

.activity-log-detail__summary {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-2) var(--space-4);
  font-size: var(--font-size-sm);
}

.activity-log-detail__summary dt {
  color: var(--color-text-muted);
}

.activity-log-detail__section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.activity-log-detail__heading {
  color: var(--color-text-heading);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.activity-log-detail__fields {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.activity-log-detail__none {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.activity-log-detail__record summary {
  cursor: pointer;
  font-size: var(--font-size-sm);
}

.activity-log-detail__record[open] summary {
  margin-bottom: var(--space-2);
}
</style>
