<script setup>
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import FileDropZone from '@/components/ui/FileDropZone.vue'
import FormField from '@/components/ui/FormField.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
import StalledOrderListCard from '@/components/operations/StalledOrderListCard.vue'
import StalledOrderTable from '@/components/operations/StalledOrderTable.vue'
import { useListQuery } from '@/composables/useListQuery'
import { useStalledOrdersStore } from '@/stores/stalledOrders'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useStalledOrdersStore()
const { orderErrors, workingOrders, loading, error, isOrderErrorsEmpty, isWorkingOrdersEmpty } =
  storeToRefs(store)

/*
 * 検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名（branch_code / account_number / symbol）はこの filters 定義にだけ現れ、
 * バックエンドへ送る名前は src/api/stalledOrders.js の中に閉じている。
 * この一覧はページングしないので goToOffset は受け取らない。
 */
const { inputs, submitSearch, clearSearch } = useListQuery({
  filters: [
    { key: 'branchCode', query: 'branch_code' },
    { key: 'accountNumber', query: 'account_number' },
    { key: 'symbol', query: 'symbol' },
  ],
  load: (params) => store.load(params),
})

/** 取込むコンファメーション CSV。選ぶまでは null */
const confirmationFile = ref(null)

/*
 * CSV の出力・取込は処理が未実装（UI だけ先に置く）。
 * バックエンドに該当 API がまだ無いため、押しても何も起きない。
 *
 * TODO(処理実装): 別システム発注 CSV の出力は検索条件を引き継いで
 *   order_id,account_number,symbol,action,quantity,order_type,limit_price,time_in_force,market_category
 *   の書式で、コンファメーション CSV の取込は
 *   order_id,confirmation_ref,confirmation_status,filled_quantity,average_price,confirmed_at,message
 *   の書式で行う（書式は公開モックのサンプル実物から採取）。
 */
function downloadOrderSample() {
  // TODO(処理実装): 別システム発注 CSV のサンプルをダウンロードする
}

function exportOrderErrors() {
  // TODO(処理実装): 注文エラーを別システム発注 CSV として出力する
}

function downloadConfirmationSample() {
  // TODO(処理実装): コンファメーション CSV のサンプルをダウンロードする
}

function importConfirmation() {
  // TODO(処理実装): confirmationFile を送り、注文照会へ反映する
}
</script>

<template>
  <section class="stalled-orders">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む -->
    <Teleport defer to="#topbar-actions">
      <BaseButton
        variant="secondary"
        data-testid="stalled-orders-reload"
        :disabled="loading"
        @click="store.reload()"
      >
        再読み込み
      </BaseButton>
    </Teleport>

    <!-- 画面の説明。4 状態や検索結果に関わらず常時出す -->
    <p class="stalled-orders__description" data-testid="stalled-orders-description">
      ブローカー・自システム障害時に、別システムでの手動発注とコンファメーション取込を管理する画面です。
    </p>

    <BaseAlert variant="info" data-testid="stalled-orders-flow">
      <strong>手動運用フロー</strong><br />
      1. <strong>注文エラー</strong>を別システムの発注対象としてCSV出力&#12288;2. 別システムで発注&#12288;3.
      コンファメーションCSVを手動取込&#12288;4. 未約定は<strong>注文中</strong
      >として確認し、約定済みは滞留一覧から除外
    </BaseAlert>

    <MasterSearchCard
      testid-prefix="stalled-orders"
      :disabled="loading"
      @submit="submitSearch"
      @clear="clearSearch"
    >
      <FormField v-slot="{ field }" label="部店コード">
        <BaseInput
          v-bind="field"
          v-model="inputs.branchCode"
          placeholder="例: 123"
          data-testid="stalled-orders-branch-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="口座番号">
        <BaseInput
          v-bind="field"
          v-model="inputs.accountNumber"
          placeholder="例: 123456"
          data-testid="stalled-orders-account-number"
        />
      </FormField>
      <FormField v-slot="{ field }" label="銘柄コード">
        <BaseInput
          v-bind="field"
          v-model="inputs.symbol"
          placeholder="例: AMZN"
          data-testid="stalled-orders-symbol"
        />
      </FormField>
    </MasterSearchCard>

    <BaseCard title="別システム発注・コンファメーション取込">
      <template #header-actions>
        <!-- 権限の表示。認証が入るまでは固定で「操作可能」（モックも as_user に依らず同じ） -->
        <BaseBadge variant="success" data-testid="stalled-orders-permission">操作可能</BaseBadge>
      </template>

      <div class="stalled-orders__actions">
        <BaseButton
          variant="secondary"
          data-testid="stalled-orders-order-sample"
          @click="downloadOrderSample"
        >
          別システム発注CSVサンプル
        </BaseButton>
        <BaseButton data-testid="stalled-orders-export" @click="exportOrderErrors">
          注文エラーをCSV出力
        </BaseButton>
        <BaseButton
          variant="secondary"
          data-testid="stalled-orders-confirmation-sample"
          @click="downloadConfirmationSample"
        >
          コンファメーションCSVサンプル
        </BaseButton>
      </div>

      <div class="stalled-orders__upload">
        <FormField label="別システムのコンファメーションCSVを手動取込">
          <FileDropZone
            v-model="confirmationFile"
            accept=".csv,text/csv"
            hint="CSV ファイルを 1 つ選んでください"
            data-testid="stalled-orders-confirmation-file"
          />
        </FormField>

        <BaseButton
          data-testid="stalled-orders-confirmation-import"
          :disabled="!confirmationFile"
          @click="importConfirmation"
        >
          取込して注文照会へ反映
        </BaseButton>
      </div>
    </BaseCard>

    <StalledOrderListCard
      testid-prefix="stalled-order-errors"
      title="注文エラー（別システムで発注要）"
      empty-message="別システムで発注する注文エラーはありません"
      :total="orderErrors.length"
      :loading="loading"
      :is-empty="isOrderErrorsEmpty"
      :error="error"
      @reload="store.reload()"
    >
      <StalledOrderTable
        variant="errors"
        data-testid="stalled-order-errors-table"
        :rows="orderErrors"
      />
    </StalledOrderListCard>

    <StalledOrderListCard
      testid-prefix="stalled-working-orders"
      title="注文中（コンファメーション取込後・未約定）"
      empty-message="コンファメーション取込後に未約定となっている注文はありません"
      :total="workingOrders.length"
      :loading="loading"
      :is-empty="isWorkingOrdersEmpty"
      :error="error"
      @reload="store.reload()"
    >
      <StalledOrderTable
        variant="working"
        data-testid="stalled-working-orders-table"
        :rows="workingOrders"
      />
    </StalledOrderListCard>
  </section>
</template>

<style scoped>
.stalled-orders {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* 説明文はヘッダの見出しに続く小さな添え書き（モックの h2 直下の p に相当） */
.stalled-orders__description {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

/* CSV のボタン列。幅の狭い画面では折り返す */
.stalled-orders__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* 取込口はモックと同じく「入力欄 + 右端のボタン」。狭い画面では縦に積む */
.stalled-orders__upload {
  display: flex;
  align-items: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.stalled-orders__upload > :first-child {
  flex: 1;
  min-width: 0;
}

@media (max-width: 720px) {
  .stalled-orders__upload {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
