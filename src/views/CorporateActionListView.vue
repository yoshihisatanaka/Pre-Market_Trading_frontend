<script setup>
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
import { useListQuery } from '@/composables/useListQuery'
import { useCaStore } from '@/stores/ca'
import { CA_TYPE_OPTIONS, formatCaType, isCaType } from '@/utils/caTypes'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useCaStore()
const { items, total, limit, offset, loading, error, isEmpty } = storeToRefs(store)

/*
 * 列は画面モック（https://uspreorder-vmbhej3k.manus.space/masters/ca）に合わせつつ、
 * 実 API（docs/api/openapi.json の CAItem）が持つ項目だけを出す。
 *   - ステータスは実 API に無い（モックにはあるが、対応する列も値も無いので出さない）
 *   - モックの「権利確定日」も実 API に無い。日付は 権利付最終日 / 効力発生日 / 支払日 の 3 つ
 *   - 操作列（編集・削除）は別途。この画面はいま読むだけ
 */
const columns = [
  { key: 'stockCode', label: '銘柄' },
  { key: 'caType', label: 'CA種別' },
  { key: 'exRightsDate', label: '権利付最終日' },
  { key: 'effectiveDate', label: '効力発生日' },
  { key: 'paymentDate', label: '支払日' },
  { key: 'ratio', label: '比率' },
  { key: 'note', label: '備考' },
]

/*
 * ページ位置と検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名（stock_code / ca_type）はこの filters 定義にだけ現れる。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'stockCode', query: 'stock_code' },
    // 未知のコード（?ca_type=999 など）は条件なしとして捨てる
    {
      key: 'caType',
      query: 'ca_type',
      parse: (value) => (isCaType(value) ? value : ''),
    },
  ],
  load: (params) => store.load(params),
})

/**
 * CA種別の表示名。実 API が付けて返す `CA種別名` を優先し、
 * 欠けているときだけコードから補う（どちらも無ければ '—'）。
 */
function caTypeLabel(row) {
  return row.caTypeName || formatCaType(row.caType)
}

/**
 * 手動操作された行（ユーザー操作フラグ=1）に付けるクラス。
 * 自動取込のままの行と見分けられるよう、行ごと淡く塗る。
 */
function rowClass(row) {
  return row.userModified ? 'is-user-modified' : null
}
</script>

<template>
  <section class="ca-list">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む -->
    <Teleport defer to="#topbar-actions">
      <BaseButton
        variant="secondary"
        data-testid="ca-reload"
        :disabled="loading"
        @click="store.reload()"
      >
        再読み込み
      </BaseButton>
    </Teleport>

    <!-- 画面の説明。4 状態や検索結果に関わらず常時出す -->
    <BaseAlert variant="info" data-testid="ca-description">
      銘柄ごとのコーポレートアクション（配当・分割・併合など）を管理します。<strong>色の付いた行</strong>は画面や
      API から手動で操作された行で、自動取込のままの行と区別しています。
    </BaseAlert>

    <MasterSearchCard
      testid-prefix="ca"
      :disabled="loading"
      @submit="submitSearch"
      @clear="clearSearch"
    >
      <FormField v-slot="{ field }" label="銘柄コード">
        <BaseInput
          v-bind="field"
          v-model="inputs.stockCode"
          placeholder="例: A0001 / AAPL"
          data-testid="ca-stock-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="CA種別">
        <BaseSelect
          v-bind="field"
          v-model="inputs.caType"
          :options="CA_TYPE_OPTIONS"
          placeholder="-- すべて --"
          data-testid="ca-type"
        />
      </FormField>
    </MasterSearchCard>

    <MasterListCard
      testid-prefix="ca"
      title="CA一覧"
      empty-message="該当するCAはありません。"
      :total="total"
      :limit="limit"
      :offset="offset"
      :loading="loading"
      :is-empty="isEmpty"
      :error="error"
      @reload="store.reload()"
      @update:offset="goToOffset"
    >
      <DataTable flat data-testid="ca-table" :columns="columns" :rows="items" :row-class="rowClass">
        <!-- 銘柄は当社銘柄コードが主、Ticker はその下に添える（画面モックの 2 段表示） -->
        <template #cell-stockCode="{ row }">
          <div class="ca-list__stock">
            <span class="ca-list__stock-code">{{ row.stockCode || '—' }}</span>
            <span v-if="row.ticker" class="ca-list__ticker">{{ row.ticker }}</span>
          </div>
        </template>

        <template #cell-caType="{ row }">{{ caTypeLabel(row) }}</template>

        <template #cell-exRightsDate="{ value }">
          <span class="ca-list__date">{{ value || '—' }}</span>
        </template>
        <template #cell-effectiveDate="{ value }">
          <span class="ca-list__date">{{ value || '—' }}</span>
        </template>
        <template #cell-paymentDate="{ value }">
          <span class="ca-list__date">{{ value || '—' }}</span>
        </template>

        <template #cell-ratio="{ value }">
          <span class="ca-list__ratio">{{ value || '—' }}</span>
        </template>

        <template #cell-note="{ value }">{{ value || '—' }}</template>
      </DataTable>
    </MasterListCard>
  </section>
</template>

<style scoped>
.ca-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.ca-list__stock {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.ca-list__stock-code {
  font-weight: 600;
}

.ca-list__ticker {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

/* 日付と比率は桁を揃えて読ませる（受注不可日マスタの日付列と同じ扱い） */
.ca-list__date,
.ca-list__ratio {
  font-variant-numeric: tabular-nums;
}

/*
 * 手動操作された行（ユーザー操作フラグ=1）。
 * 行は DataTable が描くので、scoped のままでは届かない（:deep が要る）。
 * 色は警告色の淡色面を借りる。「異常」ではなく「自動取込のままではない」ことの印。
 */
.ca-list :deep(tr.is-user-modified) {
  background-color: var(--color-warning-bg);
}
</style>
