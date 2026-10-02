<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
import { useListQuery } from '@/composables/useListQuery'
import { useCodesStore } from '@/stores/codes'
import { useCustomerSearchStore } from '@/stores/customerSearch'
import { isCautionRank } from '@/utils/customerCautions'
import { formatJpyUnit, formatUsdUnit } from '@/utils/format'

/*
 * 顧客検索（画面モック customer_search.html）。部店・扱者・口座番号・顧客名で顧客を探し、
 * 顧客名から顧客詳細（/customers/:customerId/summary）へ移る。一覧は読むだけ。
 *
 * 読む API は顧客マスタと同じ `GET /masters/customers`（2026-09-28 決定）。ストアは別に持つ
 * （stores/customerSearch.js の冒頭）。モックと同じく、開いた時点で条件なしの一覧を出す。
 */

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useCustomerSearchStore()
const { items, total, limit, offset, loading, error, isEmpty } = storeToRefs(store)

/*
 * 部店の選択肢はコードマスタから。読み込みは main.js が起動時に 1 回だけ行うので、ここでは呼ばない
 * （顧客マスタ画面と同じ）。computed で受けるのは、読み込みが終わった時点で選択肢が埋まるようにするため。
 */
const codes = useCodesStore()
const { loading: codesLoading } = storeToRefs(codes)
const branchOptions = computed(() => codes.optionsFor('部店'))

/*
 * 列は画面モックの並びどおり。ただし次の 2 列は出さない（顧客マスタと同じ。2026-09-28 決定）。
 *   米国株保有評価額（円）/ 米国株評価損益 … `/masters/customers` に無い。顧客ごとに `/holdings` を
 *   引けば出せるが、1 ページで 50 回叩くことになる。顧客詳細の顧客カードで見る
 */
const columns = [
  { key: 'branchCode', label: '部店' },
  { key: 'handler', label: '扱者' },
  { key: 'accountNumber', label: '口座番号', numeric: true },
  { key: 'customerName', label: '顧客名' },
  { key: 'age', label: '年齢' },
  { key: 'complianceRank', label: 'コンプラランク' },
  { key: 'investmentPolicy', label: '投資方針' },
  { key: 'cashJpy', label: '預り金（円貨）', numeric: true },
  { key: 'cashUsd', label: '預り金（USD）', numeric: true },
  { key: 'growthQuota', label: '成長投資枠', numeric: true },
  { key: 'restriction', label: '取引規制' },
]

/*
 * 検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名は画面モックと同じ（branch_code / sales_rep_code / account_number / name）。
 * バックエンドへ送る名前（handler_code / account_no / customer_name）は src/api/customers.js の中に閉じている。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'branchCode', query: 'branch_code' },
    { key: 'handlerCode', query: 'sales_rep_code' },
    { key: 'accountNumber', query: 'account_number' },
    { key: 'customerName', query: 'name' },
  ],
  load: (params) => store.load(params),
})

/** 年齢。実 API では文字列で、法人は空（その場合は '—'） */
function ageLabel(row) {
  return row.age ? `${row.age}歳` : '—'
}

/** 顧客詳細の外株預りへのリンク先。行のキーと同じく主キー（id）で指す */
function detailRoute(row) {
  return { name: 'customer-summary', params: { customerId: row.id } }
}
</script>

<template>
  <section class="customer-search">
    <!-- 画面の説明（モックのヘッダの副題）。4 状態や検索結果に関わらず常時出す -->
    <p class="customer-search__description" data-testid="customer-search-description">
      部店・口座番号・顧客名で検索
    </p>

    <MasterSearchCard
      testid-prefix="customer-search"
      :disabled="loading"
      :options-loading="codesLoading"
      @submit="submitSearch"
      @clear="clearSearch"
    >
      <FormField v-slot="{ field }" label="部店コード">
        <BaseSelect
          v-bind="field"
          v-model="inputs.branchCode"
          :options="branchOptions"
          placeholder="-- 全部店 --"
          data-testid="customer-search-branch-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="扱者コード">
        <BaseInput
          v-bind="field"
          v-model="inputs.handlerCode"
          placeholder="例: 001"
          data-testid="customer-search-handler-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="口座番号">
        <BaseInput
          v-bind="field"
          v-model="inputs.accountNumber"
          placeholder="例: 1230001"
          inputmode="numeric"
          data-testid="customer-search-account-number"
        />
      </FormField>
      <FormField v-slot="{ field }" label="顧客名（カナ含む）">
        <BaseInput
          v-bind="field"
          v-model="inputs.customerName"
          placeholder="例: 山田"
          data-testid="customer-search-customer-name"
        />
      </FormField>
    </MasterSearchCard>

    <MasterListCard
      testid-prefix="customer-search"
      title="検索結果"
      empty-message="該当する顧客が見つかりませんでした"
      :total="total"
      :limit="limit"
      :offset="offset"
      :loading="loading"
      :is-empty="isEmpty"
      :error="error"
      @reload="store.reload()"
      @update:offset="goToOffset"
    >
      <!-- 行のキーは DataTable の既定（id）に任せる。主キーは口座番号ではない -->
      <DataTable flat data-testid="customer-search-table" :columns="columns" :rows="items">
        <template #cell-branchCode="{ row }">{{ row.branchCode || '—' }}</template>

        <!-- 扱者はコードを上に、名前を下に添える 2 段表示（モックの sales-rep-code / sales-rep-name） -->
        <template #cell-handler="{ row }">
          <div class="customer-search__stack">
            <span class="customer-search__secondary">{{ row.handlerCode || '—' }}</span>
            <span v-if="row.handlerName">{{ row.handlerName }}</span>
          </div>
        </template>

        <template #cell-accountNumber="{ row }">{{ row.accountNumber || '—' }}</template>

        <!-- 顧客名から顧客詳細へ移る（モックは行全体がリンク。キーボードでも辿れるようリンクにする） -->
        <template #cell-customerName="{ row }">
          <div class="customer-search__stack">
            <RouterLink
              :to="detailRoute(row)"
              class="customer-search__link"
              :data-testid="`customer-search-detail-${row.id}`"
            >
              {{ row.customerName || '—' }}
            </RouterLink>
            <span v-if="row.customerNameKana" class="customer-search__secondary">
              {{ row.customerNameKana }}
            </span>
          </div>
        </template>

        <template #cell-age="{ row }">{{ ageLabel(row) }}</template>

        <!-- 要注意のランク（A・B・Y・Z）だけ赤いバッジにする（モックの badge-sell） -->
        <template #cell-complianceRank="{ row }">
          <BaseBadge
            v-if="row.complianceRank"
            :variant="isCautionRank(row.complianceRank) ? 'buy' : 'gray'"
          >
            {{ row.complianceRank }}
          </BaseBadge>
          <template v-else>—</template>
        </template>

        <template #cell-investmentPolicy="{ row }">{{ row.investmentPolicyName || '—' }}</template>

        <!-- 金額は記号ではなく単位を後置する（3,500,000 円 / 50,000.00 ドル） -->
        <template #cell-cashJpy="{ row }">{{ formatJpyUnit(row.cashJpy) }}</template>
        <template #cell-cashUsd="{ row }">{{ formatUsdUnit(row.cashUsd) }}</template>
        <template #cell-growthQuota="{ row }">{{ formatJpyUnit(row.growthQuota) }}</template>

        <!-- 全取引停止だけ目立たせる。通常の行は「-」（モックと同じ） -->
        <template #cell-restriction="{ row }">
          <BaseBadge v-if="row.tradingSuspended" variant="buy">全取引停止</BaseBadge>
          <span v-else class="customer-search__secondary">-</span>
        </template>
      </DataTable>
    </MasterListCard>
  </section>
</template>

<style scoped>
.customer-search {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* 説明文はヘッダの見出しに続く小さな添え書き（モックの副題に相当） */
.customer-search__description {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

/* 2 段表示のセル（扱者 / 顧客名） */
.customer-search__stack {
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}

.customer-search__secondary {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.customer-search__link {
  color: var(--color-link);
  font-weight: 500;
}
</style>
