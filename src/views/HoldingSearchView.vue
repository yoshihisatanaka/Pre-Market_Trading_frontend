<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
import { useListQuery } from '@/composables/useListQuery'
import { useCodesStore } from '@/stores/codes'
import { useCurrentOperatorStore } from '@/stores/currentOperator'
import { useHoldingSearchStore } from '@/stores/holdingSearch'
import { formatJpyUnit, formatQuantity, formatUsdUnit } from '@/utils/format'
import { holdingOrderQuery } from '@/utils/orderEntryQuery'
import { SIDE } from '@/utils/orderEntryOptions'
import { formatSignedJpyUnit, formatSignedPercent, profitLossTone } from '@/utils/profitLoss'

/*
 * 預り検索（画面モック holdings_search.html）。部店・口座番号・顧客名・銘柄・預り区分で
 * 顧客をまたいで預り（`GET /holdings`）を探す。一覧は読むだけ。
 *
 * 顧客検索と同じく、開いた時点で条件なしの一覧を出す（モックの画面アクセス時の表示。2026-10-02 確認）。
 *
 * 行の操作は顧客詳細の外株預り（views/CustomerSummaryView.vue）と同じ:
 *   - 顧客名 … 顧客詳細（/customers/:customerId/summary）へ移る。HoldingItem に顧客の ID が無いので、
 *              押したときに顧客マスタを引いてから移る（stores/holdingSearch.js の openCustomer）
 *   - 買い / 売り … 顧客詳細の注文入力タブ（/customers/:customerId/order-entry。モックの customer_context）へ
 *              顧客・銘柄・売買・預り区分を URL クエリで引き継ぐ（utils/orderEntryQuery.js）。顧客名と同じく
 *              押したときに顧客マスタの行 ID を引いてから移る。発注権限の無い利用者には出さない
 * 画面モックの「仮計算」ボタンは、仮計算の画面が未実装なので置かない（顧客詳細と同じ）。
 */

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useHoldingSearchStore()
const {
  items,
  total,
  limit,
  offset,
  loading,
  error,
  isEmpty,
  customerLookupError,
  customerLookupPending,
} = storeToRefs(store)

/*
 * 部店の選択肢はコードマスタから。読み込みは main.js が起動時に 1 回だけ行うので、ここでは呼ばない
 * （顧客検索と同じ）。
 */
const codes = useCodesStore()
const { loading: codesLoading } = storeToRefs(codes)
const branchOptions = computed(() => codes.optionsFor('部店'))
// 預り区分は GET /codes の 特定預り区分（明細の 預り売買区分 / 預り売買区分名 と同じコード・名前）
const specificDepositOptions = computed(() => codes.optionsFor('特定預り区分'))

/*
 * 発注権限での出し分け（views/CustomerSummaryView.vue と同じ）。このルートは権限を要求しないので、
 * 読み終えるまではどちらとも決まらない。そのあいだは発注の導線を出さない。
 */
const operator = useCurrentOperatorStore()
operator.ensureLoaded()
const canOrder = computed(() => operator.can('order'))
const operatorPending = computed(() => !operator.operator && !operator.error)

/** 参考為替は円 / ドルの小数第 2 位まで（モックの "%.2f"） */
const fxRateFormat = new Intl.NumberFormat('ja-JP', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/* 列は画面モックの並びどおり（見出しの 2 段は「／」で 1 行にまとめる。顧客詳細の外株預りと同じ） */
const columns = [
  { key: 'branchCode', label: '部店' },
  { key: 'accountNumber', label: '口座番号', numeric: true },
  { key: 'customerName', label: '顧客名' },
  { key: 'ticker', label: 'ティッカー' },
  { key: 'symbolCode', label: '銘柄コード' },
  { key: 'symbolName', label: '銘柄名' },
  { key: 'specificDeposit', label: '預り区分' },
  { key: 'quantity', label: '数量', numeric: true },
  { key: 'referencePrice', label: '参考単価（USD）', numeric: true },
  { key: 'referenceFxRate', label: '参考為替（USD/JPY）', numeric: true },
  { key: 'valuation', label: '取得金額／評価額（円）', numeric: true },
  { key: 'profitLoss', label: '評価損益／評価損益率', numeric: true },
  { key: 'corporateAction', label: 'CA' },
  { key: 'actions', label: '操作' },
]

/*
 * 検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名は画面モックと同じ（branch_code / account_number / customer_name / symbol / stock_name）。
 * 預り区分だけはモックの account_type（値は「特定」などの名前）にせず、specific_deposit に特定預り区分の
 * コードを載せる（顧客マスタの 口座区分 と紛れないように）。
 * バックエンドへ送る名前（account_no / symbol_name / specific_deposit）は src/api/holdings.js の中に閉じている。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'branchCode', query: 'branch_code' },
    { key: 'accountNumber', query: 'account_number' },
    { key: 'customerName', query: 'customer_name' },
    { key: 'symbol', query: 'symbol' },
    { key: 'symbolName', query: 'stock_name' },
    {
      key: 'specificDeposit',
      query: 'specific_deposit',
      /*
       * 手で書き換えられた未知のコードは条件なしに落とす（0 件の検索にしない）。
       * App.vue はコードマスタを読み終えてから画面を描くので、ここで選択肢を同期で引いてよい（stores/codes.js）
       */
      parse: (value) =>
        specificDepositOptions.value.some((option) => option.value === value) ? value : '',
    },
  ],
  load: (params) => {
    // 前の検索で顧客を引けなかった理由は、検索し直したら消す
    store.clearCustomerLookupError()
    store.load(params)
  },
})

/* ---------- 行の操作 ---------- */

const router = useRouter()

/** 顧客名を押したら、顧客マスタの行 ID を引いてから顧客詳細へ移る。引けなければ理由を帯に出す */
async function openCustomer(row) {
  const customerId = await store.openCustomer(row)
  if (customerId) router.push({ name: 'customer-summary', params: { customerId } })
}

/**
 * 買い / 売りを押したら、顧客名と同じく顧客マスタの行 ID を引いてから顧客詳細の注文入力タブへ移る。
 * 顧客は行そのもの（部店コード・口座番号）から引き継ぐ。引けなければ理由を帯に出す。
 * 引いている間の連打は無視する（ボタンを無効にすると売却不可の見た目と紛れるので塞がない）
 */
async function openOrderEntry(row, side) {
  if (customerLookupPending.value) return
  const customerId = await store.openCustomer(row)
  if (customerId) {
    router.push({
      name: 'customer-order-entry',
      params: { customerId },
      query: holdingOrderQuery(row, row, side),
    })
  }
}

function profitLossClass(row) {
  const tone = profitLossTone(row.profitLossJpy)
  return tone ? `is-${tone}` : null
}
</script>

<template>
  <section class="holding-search">
    <MasterSearchCard
      testid-prefix="holding-search"
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
          data-testid="holding-search-branch-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="口座番号">
        <BaseInput
          v-bind="field"
          v-model="inputs.accountNumber"
          placeholder="例: 1230001"
          inputmode="numeric"
          data-testid="holding-search-account-number"
        />
      </FormField>
      <FormField v-slot="{ field }" label="顧客名（カナ含む）">
        <BaseInput
          v-bind="field"
          v-model="inputs.customerName"
          placeholder="例: 山田"
          data-testid="holding-search-customer-name"
        />
      </FormField>
      <FormField v-slot="{ field }" label="銘柄コード／ティッカー">
        <BaseInput
          v-bind="field"
          v-model="inputs.symbol"
          placeholder="例: S001 / AAPL"
          data-testid="holding-search-symbol"
        />
      </FormField>
      <FormField v-slot="{ field }" label="銘柄名">
        <BaseInput
          v-bind="field"
          v-model="inputs.symbolName"
          placeholder="例: アップル"
          data-testid="holding-search-symbol-name"
        />
      </FormField>
      <FormField v-slot="{ field }" label="預り区分">
        <BaseSelect
          v-bind="field"
          v-model="inputs.specificDeposit"
          :options="specificDepositOptions"
          placeholder="-- 全区分 --"
          data-testid="holding-search-specific-deposit"
        />
      </FormField>
    </MasterSearchCard>

    <BaseAlert
      v-if="customerLookupError"
      variant="error"
      data-testid="holding-search-customer-error"
    >
      顧客詳細を開けませんでした。{{ customerLookupError.message }}
    </BaseAlert>

    <MasterListCard
      testid-prefix="holding-search"
      title="預り検索結果"
      empty-message="該当する預りはありません"
      :total="total"
      :limit="limit"
      :offset="offset"
      :loading="loading"
      :is-empty="isEmpty"
      :error="error"
      @reload="store.reload()"
      @update:offset="goToOffset"
    >
      <!-- 行のキーは DataTable の既定（id。口座番号・銘柄コード・預り区分をつないだもの）に任せる -->
      <DataTable flat data-testid="holding-search-table" :columns="columns" :rows="items">
        <template #cell-branchCode="{ row }">{{ row.branchCode || '—' }}</template>
        <template #cell-accountNumber="{ row }">{{ row.accountNumber || '—' }}</template>

        <!-- 顧客名から顧客詳細へ移る。移る先の ID を引くまで押せない（二重に引かない） -->
        <template #cell-customerName="{ row }">
          <div class="holding-search__stack">
            <button
              type="button"
              class="holding-search__link"
              :disabled="customerLookupPending"
              data-testid="holding-search-customer-link"
              @click="openCustomer(row)"
            >
              {{ row.customerName || '—' }}
            </button>
            <span v-if="row.customerNameKana" class="holding-search__secondary">
              {{ row.customerNameKana }}
            </span>
          </div>
        </template>

        <template #cell-ticker="{ row }">
          <span class="holding-search__ticker">{{ row.ticker || '—' }}</span>
        </template>
        <template #cell-symbolCode="{ row }">{{ row.symbolCode || '—' }}</template>
        <template #cell-symbolName="{ row }">{{ row.symbolName || '—' }}</template>

        <template #cell-specificDeposit="{ row }">{{ row.specificDepositName || '—' }}</template>

        <template #cell-quantity="{ row }">{{ formatQuantity(row.quantity) }}株</template>

        <template #cell-referencePrice="{ row }">{{ formatUsdUnit(row.referencePrice) }}</template>

        <template #cell-referenceFxRate="{ row }">
          {{ row.referenceFxRate === null ? '—' : fxRateFormat.format(row.referenceFxRate) }}
        </template>

        <!-- 取得金額（淡色）の下に評価額 -->
        <template #cell-valuation="{ row }">
          <div class="holding-search__stack is-end">
            <span class="holding-search__secondary">{{ formatJpyUnit(row.costJpy) }}</span>
            <span class="holding-search__strong">{{ formatJpyUnit(row.valueJpy) }}</span>
          </div>
        </template>

        <template #cell-profitLoss="{ row }">
          <div :class="['holding-search__stack', 'is-end', 'is-profit-loss', profitLossClass(row)]">
            <span class="holding-search__strong">{{ formatSignedJpyUnit(row.profitLossJpy) }}</span>
            <span>{{ formatSignedPercent(row.profitLossRate) }}</span>
          </div>
        </template>

        <template #cell-corporateAction="{ row }">
          <span v-if="row.corporateAction" class="holding-search__ca">{{
            row.corporateAction
          }}</span>
          <span v-else class="holding-search__secondary">—</span>
        </template>

        <!-- 発注権限を読み終えるまでは何も出さない（「閲覧のみ」がちらつかない） -->
        <template #cell-actions="{ row }">
          <template v-if="!operatorPending">
            <span
              v-if="!canOrder"
              class="holding-search__secondary"
              data-testid="holding-search-view-only"
            >
              閲覧のみ
            </span>
            <div v-else class="holding-search__actions">
              <button
                type="button"
                class="holding-search__trade is-buy"
                data-testid="holding-search-buy"
                @click="openOrderEntry(row, SIDE.BUY)"
              >
                買い
              </button>
              <!-- 売却不可（売却不可区分=1）の明細は押せない売りボタンを出す（モックと同じ） -->
              <button
                v-if="row.sellProhibited"
                type="button"
                class="holding-search__trade is-sell"
                disabled
                title="現在売却できません。"
                data-testid="holding-search-sell"
              >
                売り
              </button>
              <button
                v-else
                type="button"
                class="holding-search__trade is-sell"
                data-testid="holding-search-sell"
                @click="openOrderEntry(row, SIDE.SELL)"
              >
                売り
              </button>
            </div>
          </template>
        </template>
      </DataTable>
    </MasterListCard>
  </section>
</template>

<style scoped>
.holding-search {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* 2 段表示のセル（顧客名 / 取得金額・評価額 / 評価損益・率） */
.holding-search__stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  line-height: 1.25;
}

.holding-search__stack.is-end {
  align-items: flex-end;
}

.holding-search__secondary {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.holding-search__strong,
.holding-search__ticker {
  font-weight: 600;
}

/* 顧客名。顧客を引くために button にしているが、見た目はリンクにそろえる（顧客検索の顧客名と同じ） */
.holding-search__link {
  padding: 0;
  border: none;
  background: none;
  color: var(--color-link);
  font: inherit;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}

.holding-search__link:hover {
  text-decoration: underline;
}

.holding-search__link:disabled {
  cursor: progress;
}

.holding-search__stack.is-profit-loss.is-profit {
  color: var(--color-profit);
}

.holding-search__stack.is-profit-loss.is-loss {
  color: var(--color-loss);
}

.holding-search__ca {
  color: var(--color-warning);
}

.holding-search__actions {
  display: flex;
  justify-content: center;
  gap: var(--space-1);
}

/* 行の「買い」「売り」。売買の色の小さなボタン（顧客詳細の外株預りと同じ） */
.holding-search__trade {
  display: inline-block;
  padding: var(--space-1) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-primary-contrast);
  font-size: var(--font-size-xs);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
}

.holding-search__trade.is-buy {
  background-color: var(--color-buy);
}

.holding-search__trade.is-buy:hover {
  background-color: var(--color-buy-hover);
}

.holding-search__trade.is-sell {
  background-color: var(--color-sell);
}

.holding-search__trade.is-sell:hover {
  background-color: var(--color-sell-hover);
}

.holding-search__trade:disabled {
  background-color: var(--color-input-border);
  cursor: not-allowed;
}
</style>
