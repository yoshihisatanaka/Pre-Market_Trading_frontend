<script setup>
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
import { useOrderInquiryStore } from '@/stores/orderInquiry'

/*
 * 注文照会（画面モック `order_inquiry.html`）。**いまは UI だけの段階**で、
 * 一覧は MSW のモックまで通して 4 状態を出し分けるが、訂正・取消・出来状況での絞り込みは
 * 処理をつないでいない（`TODO(処理実装)`）。
 */

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useOrderInquiryStore()
const { items, total, limit, offset, loading, error, isEmpty } = storeToRefs(store)
const router = useRouter()

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
    { key: 'executionStatus', query: 'status' },
  ],
  load: (params) => store.load(params),
})

/*
 * 出来状況の選択肢。並びと文言は画面モックのとおり。
 * TODO(処理実装): 値を API の status（処理状況コード）へ対応づける。いまは URL に残るだけで、
 *   api 層が送らないので絞り込みは効かない（取消済は 032 / 034 の 2 コードにまたがる）
 */
const executionStatusOptions = [
  { value: '未出来', label: '未出来' },
  { value: '注文中', label: '注文中' },
  { value: '一部出来', label: '一部出来' },
  { value: '全部出来', label: '全部出来' },
  { value: '取消済', label: '取消済（出来有・無）' },
  { value: '注文エラー', label: '注文エラー' },
]

/*
 * 新規注文の画面はまだ無い（/orders/new は NotFoundView に落ちる）。
 * モックの導線どおりに遷移だけ置いておく。
 * TODO(処理実装): 発注権限の無いロールには出さず「発注権限なし」と表示する（モックの can_order）
 */
function goToNewOrder() {
  router.push('/orders/new')
}

/*
 * 訂正・取消は処理が未実装（UI だけ先に置く）。押しても何も起きない。
 * モックはどちらも別画面（/orders/{id}/amend・/orders/{id}/cancel）へ遷移する。
 *
 * TODO(処理実装): 訂正は POST /orders/{order_id}/amend（数量・指値単価・指成区分・発注範囲の 4 項目）、
 *   取消は POST /orders/{order_id}/cancel。どちらも group.latest.id に対して行い、
 *   済んだら store.reload() で一覧を引き直す
 */
function amendOrder() {
  // TODO(処理実装): 訂正の画面（またはダイアログ）を開く
}

function cancelOrder() {
  // TODO(処理実装): 取消の確認を出して取消 API を呼ぶ
}
</script>

<template>
  <section class="order-inquiry">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む -->
    <Teleport defer to="#topbar-actions">
      <BaseButton size="sm" data-testid="order-inquiry-new-order" @click="goToNewOrder">
        新規注文
      </BaseButton>
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
</style>
