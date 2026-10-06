<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
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
import { useOrderInquiryStore } from '@/stores/orderInquiry'

/*
 * 注文照会（画面モック `order_inquiry.html`）。一覧は読むだけで、訂正・取消は行の操作ボタンから
 * 別画面（/orders/:orderId/amend・/orders/:orderId/cancel）へ移って行う（モックと同じ導線）。
 * 戻ってくると useListQuery がマウント時に読み直すので、一覧は訂正・取消の結果を映す。
 */

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useOrderInquiryStore()
const { items, total, limit, offset, loading, error, isEmpty } = storeToRefs(store)
const router = useRouter()

/*
 * 発注権限（GET /auth/me の order。発注・取消・訂正）での出し分け。画面モックの can_order。
 *   あり … ヘッダに「新規注文」、行に「訂正」「取消」
 *   なし … ヘッダに「発注権限なし」、行に「閲覧のみ」
 * この画面のルートは権限を要求しないので、ガードは /auth/me の読み込みを待たない。
 * 読み終えるまではどちらとも決まらないので、ヘッダには何も出さない（「発注権限なし」がちらつかない）。
 */
const operator = useCurrentOperatorStore()
operator.ensureLoaded()
const canOrder = computed(() => operator.can('order'))
const operatorPending = computed(() => !operator.operator && !operator.error)

/*
 * 出来状況の選択肢はコードマスタ `注文照会出来状況`（依頼中の契約提案）から。値は処理状況コードで、
 * URL クエリ（status）にも API の status にもそのまま載る。
 * App.vue がコードマスタを読み終えてから画面を描くので、setup の時点で選択肢は揃っている。
 */
const codes = useCodesStore()
const executionStatusOptions = codes.optionsFor('注文照会出来状況')

/** 選択肢に無い値（手で書き換えられた URL クエリ）を空に落とす */
function oneOf(options) {
  return (value) => (options.some((option) => option.value === value) ? value : '')
}

/*
 * 検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名は画面モックと同じ（branch_code / account_number / symbol / status）。
 * バックエンドへ送る名前（account_no など）は src/api/orderInquiry.js の中に閉じている。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'branchCode', query: 'branch_code' },
    { key: 'accountNumber', query: 'account_number' },
    { key: 'symbol', query: 'symbol' },
    { key: 'executionStatus', query: 'status', parse: oneOf(executionStatusOptions) },
  ],
  load: (params) => store.load(params),
})

/*
 * 顧客検索（/customers/search）へ移る。注文は顧客を選んでから顧客詳細の注文入力タブで入れる
 * （モックの /orders/new は顧客の指定が無いと顧客検索へ回す。python_app/routers/orders.py の order_new_get）。
 * ボタンは発注権限のある利用者にだけ出す（上の canOrder。無ければ「発注権限なし」）。
 */
function goToNewOrder() {
  router.push({ name: 'customer-search' })
}

/*
 * 訂正・取消は、その元注文の最新の版（group.latest）に対して行う。
 * 対象注文は移った先の画面が読み直すので、ここからは ID だけを渡す。
 */
function amendOrder(group) {
  router.push({ name: 'order-amend', params: { orderId: group.latest.id } })
}

function cancelOrder(group) {
  router.push({ name: 'order-cancel', params: { orderId: group.latest.id } })
}
</script>

<template>
  <section class="order-inquiry">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む -->
    <Teleport defer to="#topbar-actions">
      <template v-if="!operatorPending">
        <BaseButton
          v-if="canOrder"
          size="sm"
          data-testid="order-inquiry-new-order"
          @click="goToNewOrder"
        >
          新規注文
        </BaseButton>
        <span v-else class="order-inquiry__no-permission" data-testid="order-inquiry-no-permission">
          発注権限なし
        </span>
      </template>
    </Teleport>

    <!-- 画面の説明（モックのヘッダの副題）。4 状態や検索結果に関わらず常時出す -->
    <p class="order-inquiry__description" data-testid="order-inquiry-description">
      注文の検索・取消・再発注
    </p>

    <MasterSearchCard
      testid-prefix="order-inquiry"
      :disabled="loading"
      @submit="submitSearch"
      @clear="clearSearch"
    >
      <FormField v-slot="{ field }" label="部店コード">
        <BaseInput
          v-bind="field"
          v-model="inputs.branchCode"
          placeholder="例: 123"
          data-testid="order-inquiry-branch-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="口座番号">
        <BaseInput
          v-bind="field"
          v-model="inputs.accountNumber"
          placeholder="例: 123456"
          inputmode="numeric"
          data-testid="order-inquiry-account-number"
        />
      </FormField>
      <FormField v-slot="{ field }" label="銘柄コード">
        <BaseInput
          v-bind="field"
          v-model="inputs.symbol"
          placeholder="例: AAPL"
          data-testid="order-inquiry-symbol"
        />
      </FormField>
      <FormField v-slot="{ field }" label="出来状況">
        <BaseSelect
          v-bind="field"
          v-model="inputs.executionStatus"
          :options="executionStatusOptions"
          placeholder="-- 全て --"
          data-testid="order-inquiry-status"
        />
      </FormField>
    </MasterSearchCard>

    <MasterListCard
      testid-prefix="order-inquiry"
      title="注文一覧"
      empty-message="注文が見つかりませんでした"
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
        data-testid="order-inquiry-table"
        :groups="items"
        :can-order="canOrder"
        @amend="amendOrder"
        @cancel="cancelOrder"
      />
    </MasterListCard>
  </section>
</template>

<style scoped>
.order-inquiry {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* 説明文はヘッダの見出しに続く小さな添え書き（モックの副題に相当） */
.order-inquiry__description {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

/* ヘッダの「発注権限なし」。ボタンの位置に置くが、押せるものに見せない（モックの text-xs text-gray） */
.order-inquiry__no-permission {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}
</style>
