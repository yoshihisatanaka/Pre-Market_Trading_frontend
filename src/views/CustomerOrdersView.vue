<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import FormField from '@/components/ui/FormField.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
import OrderInquiryTable from '@/components/orders/OrderInquiryTable.vue'
import { useListQuery } from '@/composables/useListQuery'
import { useCodesStore } from '@/stores/codes'
import { useCurrentOperatorStore } from '@/stores/currentOperator'
import { useCustomerDetailStore } from '@/stores/customerDetail'
import { useCustomerOrdersStore } from '@/stores/customerOrders'
import { buildOrderEntryQuery } from '@/utils/orderEntryQuery'

/*
 * 顧客詳細の注文照会タブ（画面モック customer_order_inquiry.html）。その顧客の注文だけを出す。
 * 表は注文照会（views/OrderInquiryListView.vue）と同じ OrderInquiryTable で、顧客を特定する 3 列
 * （部店・口座番号・顧客名）は顧客カードに出ているので外す。
 *
 * 顧客は枠（views/CustomerDetailView.vue）が読み終えてからこの画面を描くので、部店と口座番号は
 * setup の時点で揃っている。絞り込みは銘柄コードと出来状況の 2 つで、URL クエリに載る。
 * 部店と口座番号は URL に載せず、ストアへの読み込みのたびに顧客から足す。
 *
 * 訂正・取消は注文照会と同じく別画面へ移る。向こうの「戻る」は履歴を戻るので、この画面へ帰る
 * （views/OrderAmendView.vue の goBack）。帰ると useListQuery がマウント時に読み直す。
 */

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const detail = useCustomerDetailStore()
const { customer } = storeToRefs(detail)

const store = useCustomerOrdersStore()
const { items, total, limit, offset, loading, error, isEmpty } = storeToRefs(store)
const router = useRouter()

/* 発注権限での出し分け（注文照会と同じ。views/OrderInquiryListView.vue の冒頭） */
const operator = useCurrentOperatorStore()
operator.ensureLoaded()
const canOrder = computed(() => operator.can('order'))
const operatorPending = computed(() => !operator.operator && !operator.error)

/*
 * 出来状況の選択肢はコードマスタ `注文照会出来状況`（注文照会と同じ）。
 * App.vue がコードマスタを読み終えてから画面を描くので、setup の時点で選択肢は揃っている。
 */
const codes = useCodesStore()
const executionStatusOptions = codes.optionsFor('注文照会出来状況')

/** 選択肢に無い値（手で書き換えられた URL クエリ）を空に落とす */
function oneOf(options) {
  return (value) => (options.some((option) => option.value === value) ? value : '')
}

/** 読み込みに足す、その顧客の部店と口座番号（URL には載せない） */
const customerKey = computed(() => ({
  branchCode: customer.value?.branchCode ?? '',
  accountNumber: customer.value?.accountNumber ?? '',
}))

/*
 * 検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名は画面モックと同じ（symbol / status）。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'symbol', query: 'symbol' },
    { key: 'executionStatus', query: 'status', parse: oneOf(executionStatusOptions) },
  ],
  load: (params) => store.load({ ...params, ...customerKey.value }),
})

/** 絞り込んでいるか。空の表示の文言を分ける（モックと同じ） */
const filtered = computed(() => Boolean(store.symbol || store.executionStatus))

const emptyMessage = computed(() =>
  filtered.value ? '条件に一致する注文が見つかりませんでした' : 'この顧客の注文はありません',
)

function goToNewOrder() {
  router.push({ name: 'order-new', query: buildOrderEntryQuery(customerKey.value) })
}

/* 訂正・取消は、その元注文の最新の版（group.latest）に対して行う（注文照会と同じ） */
function amendOrder(group) {
  router.push({ name: 'order-amend', params: { orderId: group.latest.id } })
}

function cancelOrder(group) {
  router.push({ name: 'order-cancel', params: { orderId: group.latest.id } })
}
</script>

<template>
  <section class="customer-orders">
    <!-- 画面固有の操作だけをヘッダへ差し込む（モックの header_actions の「新規注文」） -->
    <Teleport defer to="#topbar-actions">
      <BaseButton
        v-if="!operatorPending && canOrder"
        size="sm"
        data-testid="customer-orders-new-order"
        @click="goToNewOrder"
      >
        新規注文
      </BaseButton>
    </Teleport>

    <MasterSearchCard
      testid-prefix="customer-orders"
      :disabled="loading"
      @submit="submitSearch"
      @clear="clearSearch"
    >
      <FormField v-slot="{ field }" label="銘柄コード">
        <BaseInput
          v-bind="field"
          v-model="inputs.symbol"
          placeholder="例: AAPL"
          data-testid="customer-orders-symbol"
        />
      </FormField>
      <FormField v-slot="{ field }" label="出来状況">
        <BaseSelect
          v-bind="field"
          v-model="inputs.executionStatus"
          :options="executionStatusOptions"
          placeholder="-- 全て --"
          data-testid="customer-orders-status"
        />
      </FormField>
    </MasterSearchCard>

    <MasterListCard
      testid-prefix="customer-orders"
      title="注文一覧"
      :empty-message="emptyMessage"
      :total="total"
      :limit="limit"
      :offset="offset"
      :loading="loading"
      :is-empty="isEmpty"
      :error="error"
      @reload="store.reload()"
      @update:offset="goToOffset"
    >
      <OrderInquiryTable
        data-testid="customer-orders-table"
        :groups="items"
        :can-order="canOrder"
        :show-customer="false"
        @amend="amendOrder"
        @cancel="cancelOrder"
      />
    </MasterListCard>
  </section>
</template>

<style scoped>
.customer-orders {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
</style>
