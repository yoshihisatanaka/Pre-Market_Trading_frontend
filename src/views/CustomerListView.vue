<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
import { useListQuery } from '@/composables/useListQuery'
import { useCodesStore } from '@/stores/codes'
import { useCustomersStore } from '@/stores/customers'
import { formatJpyUnit, formatUsdUnit } from '@/utils/format'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useCustomersStore()
const { items, total, limit, offset, loading, error, isEmpty } = storeToRefs(store)

/*
 * プルダウンの選択肢はコードマスタから。読み込みは main.js が起動時に 1 回だけ行うので、
 * ここでは load を呼ばない。storeToRefs ではなく computed で受けるのは、
 * 読み込みが終わった時点で選択肢が自動的に埋まるようにするため。
 */
const codes = useCodesStore()
// 一覧の loading と名前がぶつかるので別名で受ける
const { loading: codesLoading } = storeToRefs(codes)
const branchOptions = computed(() => codes.optionsFor('部店'))
const handlerOptions = computed(() => codes.optionsFor('扱者'))
const restrictionOptions = computed(() => codes.optionsFor('取引停止区分_全取引'))
const accountTypeOptions = computed(() => codes.optionsFor('口座区分'))
const corporateTypeOptions = computed(() => codes.optionsFor('法人区分'))

/*
 * 列は画面モック（https://uspreorder-vmbhej3k.manus.space/masters/customers）の並びどおり。
 *   - 操作列（編集・削除）は別途。この画面はいま読むだけ
 *   - 米国株評価額 / 評価損益 は値の出所が未定なので、見出しだけ置いて値は出さない（下記）
 */
const columns = [
  { key: 'branch', label: '部店' },
  { key: 'handler', label: '扱者' },
  { key: 'accountNumber', label: '口座番号', numeric: true },
  { key: 'customerName', label: '顧客名' },
  { key: 'age', label: '年齢' },
  { key: 'restriction', label: '取引規制' },
  { key: 'investmentPolicy', label: '投資方針' },
  { key: 'compliance', label: 'コンプラ' },
  { key: 'accountType', label: '口座区分' },
  { key: 'corporateType', label: '個人／法人' },
  { key: 'cashJpy', label: '円貨預り金', numeric: true },
  { key: 'cashUsd', label: 'USD預り金', numeric: true },
  { key: 'growthQuota', label: '成長投資枠', numeric: true },
  { key: 'equityValue', label: '米国株評価額', numeric: true },
  { key: 'unrealizedPl', label: '評価損益', numeric: true },
]

/*
 * ページ位置と検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名（branch_code / account_type など）はこの filters 定義にだけ現れる。
 * バックエンドが受け取る日本語のクエリ名は src/api/customers.js の中に閉じている。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'branchCode', query: 'branch_code' },
    { key: 'handlerCode', query: 'handler_code' },
    { key: 'accountNumber', query: 'account_number' },
    { key: 'customerName', query: 'customer_name' },
    { key: 'restriction', query: 'restriction' },
    { key: 'accountType', query: 'account_type' },
    { key: 'corporateType', query: 'corporate_type' },
  ],
  load: (params) => store.load(params),
})

/** 年齢。実 API では文字列で、法人は空（その場合は '—'） */
function ageLabel(row) {
  return row.age ? `${row.age}歳` : '—'
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
  <section class="customer-list">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む -->
    <Teleport defer to="#topbar-actions">
      <BaseButton
        variant="secondary"
        data-testid="customers-reload"
        :disabled="loading"
        @click="store.reload()"
      >
        再読み込み
      </BaseButton>
    </Teleport>

    <!-- 画面の説明。4 状態や検索結果に関わらず常時出す -->
    <BaseAlert variant="info" data-testid="customers-description">
      口座情報をもとに顧客を検索します。<strong>色の付いた行</strong>は画面や API
      から手動で操作された行で、自動取込のままの行と区別しています。
    </BaseAlert>

    <MasterSearchCard
      testid-prefix="customers"
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
          data-testid="customers-branch-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="扱者コード">
        <BaseSelect
          v-bind="field"
          v-model="inputs.handlerCode"
          :options="handlerOptions"
          placeholder="-- 全扱者 --"
          data-testid="customers-handler-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="口座番号">
        <BaseInput
          v-bind="field"
          v-model="inputs.accountNumber"
          placeholder="例: 1230001"
          data-testid="customers-account-number"
        />
      </FormField>
      <FormField v-slot="{ field }" label="顧客名" hint="顧客名・カナのどちらにも当たります">
        <BaseInput
          v-bind="field"
          v-model="inputs.customerName"
          placeholder="例: 山田"
          data-testid="customers-customer-name"
        />
      </FormField>
      <FormField v-slot="{ field }" label="取引規制">
        <BaseSelect
          v-bind="field"
          v-model="inputs.restriction"
          :options="restrictionOptions"
          placeholder="-- すべて --"
          data-testid="customers-restriction"
        />
      </FormField>
      <FormField v-slot="{ field }" label="口座区分">
        <BaseSelect
          v-bind="field"
          v-model="inputs.accountType"
          :options="accountTypeOptions"
          placeholder="-- 全区分 --"
          data-testid="customers-account-type"
        />
      </FormField>
      <FormField v-slot="{ field }" label="個人／法人">
        <BaseSelect
          v-bind="field"
          v-model="inputs.corporateType"
          :options="corporateTypeOptions"
          placeholder="-- すべて --"
          data-testid="customers-corporate-type"
        />
      </FormField>
    </MasterSearchCard>

    <MasterListCard
      testid-prefix="customers"
      title="顧客一覧"
      empty-message="該当する顧客はありません。"
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
        data-testid="customers-table"
        row-key="accountNumber"
        :columns="columns"
        :rows="items"
        :row-class="rowClass"
      >
        <!--
          部店・扱者はコードが主で名前をその下に添える 2 段表示（CAマスタの銘柄列と同じ作り）。
          顧客名だけは氏名が主で、カナを下に添える。
        -->
        <template #cell-branch="{ row }">
          <div class="customer-list__stack">
            <span class="customer-list__primary">{{ row.branchCode || '—' }}</span>
            <span v-if="row.branchName" class="customer-list__secondary">{{ row.branchName }}</span>
          </div>
        </template>

        <template #cell-handler="{ row }">
          <div class="customer-list__stack">
            <span class="customer-list__primary">{{ row.handlerCode || '—' }}</span>
            <span v-if="row.handlerName" class="customer-list__secondary">
              {{ row.handlerName }}
            </span>
          </div>
        </template>

        <template #cell-accountNumber="{ row }">
          {{ row.accountNumber || '—' }}
        </template>

        <template #cell-customerName="{ row }">
          <div class="customer-list__stack">
            <span class="customer-list__primary">{{ row.customerName || '—' }}</span>
            <span v-if="row.customerNameKana" class="customer-list__secondary">
              {{ row.customerNameKana }}
            </span>
          </div>
        </template>

        <template #cell-age="{ row }">{{ ageLabel(row) }}</template>

        <!-- 取引停止中だけ目立たせる。通常の行は区分名をそのまま出す -->
        <template #cell-restriction="{ row }">
          <BaseBadge v-if="row.tradingSuspended" variant="warning">
            {{ row.restrictionName || '取引停止' }}
          </BaseBadge>
          <template v-else>{{ row.restrictionName || '—' }}</template>
        </template>

        <template #cell-investmentPolicy="{ row }">{{ row.investmentPolicyName || '—' }}</template>
        <template #cell-compliance="{ row }">{{ row.complianceRankName || '—' }}</template>

        <!-- 事故処理口座は口座区分に併記する（区分そのものとは別の軸なので置き換えない） -->
        <template #cell-accountType="{ row }">
          <span class="customer-list__account-type">
            <span>{{ row.accountTypeName || '—' }}</span>
            <BaseBadge v-if="row.accidentAccount" variant="warning">事故</BaseBadge>
          </span>
        </template>

        <template #cell-corporateType="{ row }">{{ row.corporateTypeName || '—' }}</template>

        <!-- 金額は記号ではなく単位を後置する（3,500,000 円 / 50,000.00 ドル） -->
        <template #cell-cashJpy="{ row }">
          {{ formatJpyUnit(row.cashJpy) }}
        </template>
        <template #cell-cashUsd="{ row }">
          {{ formatUsdUnit(row.cashUsd) }}
        </template>
        <template #cell-growthQuota="{ row }">
          {{ formatJpyUnit(row.growthQuota) }}
        </template>

        <!--
          米国株評価額 / 評価損益。いま AccountItem に対応する項目が無く値の出所が決まっていない。
          表示要望が来る見込みが高いので列（見出し）だけ確保し、セルは常に '—' にしてある。
          アプリ内モデルにも equityValue / unrealizedPl は持たせていない（無いものを null として
          運ばない）。項目が決まったら api 層の toCustomer() に足して、この slot を差し替える。
        -->
        <template #cell-equityValue> — </template>
        <template #cell-unrealizedPl> — </template>
      </DataTable>
    </MasterListCard>
  </section>
</template>

<style scoped>
.customer-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* 2 段表示のセル（部店 / 扱者 / 顧客名） */
.customer-list__stack {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.customer-list__primary {
  font-weight: 600;
}

.customer-list__secondary {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.customer-list__account-type {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

/*
 * 手動操作された行（ユーザー操作フラグ=1）。
 * 行は DataTable が描くので、scoped のままでは届かない（:deep が要る）。
 * 色は警告色の淡色面を借りる。「異常」ではなく「自動取込のままではない」ことの印。
 */
.customer-list :deep(tr.is-user-modified) {
  background-color: var(--color-warning-bg);
}

/* ホバー中も印を残す。DataTable の中立なホバー色に塗り潰させず、同系色で一段濃くする */
.customer-list :deep(tr.is-user-modified:hover td) {
  background-color: var(--color-warning-border);
}
</style>
