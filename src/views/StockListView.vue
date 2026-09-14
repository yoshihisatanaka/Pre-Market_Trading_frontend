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
import { useStocksStore } from '@/stores/stocks'
import { formatJpyUnit, formatUsdUnit } from '@/utils/format'
import {
  ORDER_ROUTE_OPTIONS,
  REGULATION_OPTIONS,
  VWAP_TARGET_OPTIONS,
  formatOrderRoute,
  formatRegulation,
  formatVwapTarget,
  isOrderRoute,
  isRegulation,
  isVwapTarget,
} from '@/utils/stockTypes'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する
const store = useStocksStore()
const { items, total, limit, offset, loading, error, isEmpty } = storeToRefs(store)

/*
 * 列は画面モック（https://uspreorder-vmbhej3k.manus.space/masters/symbols）に合わせつつ、
 * 実 API（docs/api/openapi.json の StockItem）が持つ項目だけを出す。
 *   - モックには無い「前日出来高」を足し、相場の 3 列を
 *     前日終値 / 前日出来高 / 5日平均出来高 の順でまとめている
 *   - ユーザー操作フラグは列にせず、行の色で表す（下の rowClass）
 *   - 市場名・Pre区分はモックに列が無いので出さない（API には項目がある）
 *   - 操作列（編集・削除）は別途。この画面はいま読むだけ
 */
const columns = [
  { key: 'stockCode', label: '銘柄コード' },
  { key: 'ticker', label: 'ティッカーコード' },
  { key: 'nameEn', label: '銘柄名（英語）' },
  { key: 'name', label: '銘柄名（日本語）' },
  { key: 'previousClose', label: '前日終値', numeric: true },
  { key: 'previousVolume', label: '前日出来高', numeric: true },
  { key: 'averageVolume', label: '5日平均出来高', numeric: true },
  { key: 'regulation', label: '取引可否' },
  { key: 'orderRoute', label: '預託先区分' },
  { key: 'vwapTarget', label: 'VWAP対象区分' },
  { key: 'note', label: '備考' },
]

/*
 * ページ位置と検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名（stock_code / regulation / …）はこの filters 定義にだけ現れる。
 *
 * 検索欄は画面モックどおり 4 つだが、実 API は銘柄コード・Ticker・銘柄名を別々の
 * パラメータに分けていて 1 語でまとめて探せない。この欄は `銘柄コード` に乗るので、
 * 効くのは銘柄コードと Ticker だけ（ラベルもそう書いてある）。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'stockCode', query: 'stock_code' },
    // 未知のコード（?regulation=9 など）は条件なしとして捨てる
    { key: 'regulation', query: 'regulation', parse: (value) => (isRegulation(value) ? value : '') },
    {
      key: 'orderRoute',
      query: 'order_route',
      parse: (value) => (isOrderRoute(value) ? value : ''),
    },
    {
      key: 'vwapTarget',
      query: 'vwap_target',
      parse: (value) => (isVwapTarget(value) ? value : ''),
    },
  ],
  load: (params) => store.load(params),
})

/*
 * 区分の表示名。実 API が付けて返す名称を優先し、
 * 欠けているときだけコードから補う（どちらも無ければ '—'）。
 */
function regulationLabel(row) {
  return row.regulationName || formatRegulation(row.regulation)
}

function orderRouteLabel(row) {
  return row.orderRouteName || formatOrderRoute(row.orderRoute)
}

function vwapTargetLabel(row) {
  return row.vwapTargetName || formatVwapTarget(row.vwapTarget)
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
  <section class="stock-list">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む -->
    <Teleport defer to="#topbar-actions">
      <BaseButton
        variant="secondary"
        data-testid="stocks-reload"
        :disabled="loading"
        @click="store.reload()"
      >
        再読み込み
      </BaseButton>
    </Teleport>

    <!-- 画面の説明。4 状態や検索結果に関わらず常時出す -->
    <BaseAlert variant="info" data-testid="stocks-description">
      取扱銘柄と、取引可否・預託先・VWAP対象の区分を管理します。<strong>色の付いた行</strong>は画面や
      API から手動で操作された行で、自動取込のままの行と区別しています。
    </BaseAlert>

    <MasterSearchCard
      testid-prefix="stocks"
      :disabled="loading"
      @submit="submitSearch"
      @clear="clearSearch"
    >
      <FormField v-slot="{ field }" label="銘柄コード・ティッカーコード">
        <BaseInput
          v-bind="field"
          v-model="inputs.stockCode"
          placeholder="例: S001 / AAPL"
          data-testid="stocks-stock-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="取引可否">
        <BaseSelect
          v-bind="field"
          v-model="inputs.regulation"
          :options="REGULATION_OPTIONS"
          placeholder="-- すべて --"
          data-testid="stocks-regulation"
        />
      </FormField>
      <FormField v-slot="{ field }" label="預託先区分">
        <BaseSelect
          v-bind="field"
          v-model="inputs.orderRoute"
          :options="ORDER_ROUTE_OPTIONS"
          placeholder="-- すべて --"
          data-testid="stocks-order-route"
        />
      </FormField>
      <FormField v-slot="{ field }" label="VWAP対象区分">
        <BaseSelect
          v-bind="field"
          v-model="inputs.vwapTarget"
          :options="VWAP_TARGET_OPTIONS"
          placeholder="-- すべて --"
          data-testid="stocks-vwap-target"
        />
      </FormField>
    </MasterSearchCard>

    <MasterListCard
      testid-prefix="stocks"
      title="銘柄一覧"
      empty-message="該当する銘柄はありません。"
      :total="total"
      :limit="limit"
      :offset="offset"
      :loading="loading"
      :is-empty="isEmpty"
      :error="error"
      @reload="store.reload()"
      @update:offset="goToOffset"
    >
      <DataTable
        flat
        row-key="stockCode"
        data-testid="stocks-table"
        :columns="columns"
        :rows="items"
        :row-class="rowClass"
      >
        <template #cell-stockCode="{ value }">
          <span class="stock-list__code">{{ value || '—' }}</span>
        </template>
        <template #cell-ticker="{ value }">
          <span class="stock-list__ticker">{{ value || '—' }}</span>
        </template>
        <template #cell-nameEn="{ value }">{{ value || '—' }}</template>
        <template #cell-name="{ value }">
          <span class="stock-list__name">{{ value || '—' }}</span>
        </template>

        <!-- 相場の 3 列。未取得（null）は formatUsdUnit / formatJpyUnit が '—' にする -->
        <template #cell-previousClose="{ value }">{{ formatUsdUnit(value) }}</template>
        <template #cell-previousVolume="{ value }">{{ formatJpyUnit(value) }}</template>
        <template #cell-averageVolume="{ value }">{{ formatJpyUnit(value) }}</template>

        <!-- 取引可否は可否が一目で分かるように色を変える（画面モックと同じ扱い） -->
        <template #cell-regulation="{ row }">
          <span :class="['stock-list__flag', row.regulation === '0' ? 'is-open' : 'is-closed']">
            {{ regulationLabel(row) }}
          </span>
        </template>

        <template #cell-orderRoute="{ row }">
          <span class="stock-list__route">{{ orderRouteLabel(row) }}</span>
        </template>

        <!-- 対象外は主張させない（対象の行だけを目で拾えるようにする） -->
        <template #cell-vwapTarget="{ row }">
          <span :class="['stock-list__flag', row.vwapTarget === '1' ? 'is-open' : 'is-muted']">
            {{ vwapTargetLabel(row) }}
          </span>
        </template>

        <template #cell-note="{ value }">
          <span class="stock-list__note">{{ value || '—' }}</span>
        </template>
      </DataTable>
    </MasterListCard>
  </section>
</template>

<style scoped>
.stock-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* 銘柄コードと Ticker はコード値。桁を揃えて読ませる */
.stock-list__code {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.stock-list__ticker {
  font-weight: 600;
}

.stock-list__name {
  font-size: var(--font-size-sm);
}

.stock-list__route {
  white-space: nowrap;
}

.stock-list__note {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.stock-list__flag {
  font-weight: 600;
  white-space: nowrap;
}

.stock-list__flag.is-open {
  color: var(--color-success);
}

.stock-list__flag.is-closed {
  color: var(--color-danger-text);
}

.stock-list__flag.is-muted {
  color: var(--color-text-muted);
  font-weight: 400;
}

/*
 * 手動操作された行（ユーザー操作フラグ=1）。
 * 行は DataTable が描くので、scoped のままでは届かない（:deep が要る）。
 * 色は警告色の淡色面を借りる。「異常」ではなく「自動取込のままではない」ことの印。
 */
.stock-list :deep(tr.is-user-modified) {
  background-color: var(--color-warning-bg);
}
</style>
