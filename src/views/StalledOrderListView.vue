<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import FileDropZone from '@/components/ui/FileDropZone.vue'
import FormField from '@/components/ui/FormField.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
import ConfirmationImportErrors from '@/components/operations/ConfirmationImportErrors.vue'
import StalledOrderListCard from '@/components/operations/StalledOrderListCard.vue'
import StalledOrderTable from '@/components/operations/StalledOrderTable.vue'
import { useListQuery } from '@/composables/useListQuery'
import { useCurrentOperatorStore } from '@/stores/currentOperator'
import { useStalledOrdersStore } from '@/stores/stalledOrders'
import { downloadCsv } from '@/utils/download'
import {
  CONFIRMATION_SAMPLE_CSV_FILENAME,
  TWS_ORDER_CSV_FILENAME,
  TWS_ORDER_SAMPLE_CSV_FILENAME,
  buildConfirmationSampleCsv,
  buildTwsOrderCsv,
  buildTwsOrderSampleCsv,
} from '@/utils/stalledOrderCsv'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useStalledOrdersStore()
const {
  orderErrors,
  workingOrders,
  loading,
  error,
  isOrderErrorsEmpty,
  isWorkingOrdersEmpty,
  importing,
  importError,
} = storeToRefs(store)

/*
 * 権限の表示。運用管理権限の無い利用者はルートのガードでこの画面に入れないので、
 * 実際には常に「操作可能」になる（/auth/me に繋いであるのは、ガードと表示を食い違わせないため）。
 * ensureLoaded はガードが済ませているので通常は何もしない（ガードを通らない単体テストのための保険）。
 */
const operator = useCurrentOperatorStore()
operator.ensureLoaded()
const canOperate = computed(() => operator.can('operation'))

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

/*
 * CSV の出力とサンプル 2 種はサーバを通さず、ここで組み立ててダウンロードさせる
 * （書式は公開モックの実物から採取。列と値の変換は utils/stalledOrderCsv.js）。
 *
 * 「注文エラーをCSV出力」の対象は、いま画面に出ている注文エラーの行そのもの。
 * 検索条件はすでに一覧の取得で効いているので、出力は画面の検索結果と同じ行になる（モックも同じ）。
 */
function downloadOrderSample() {
  downloadCsv(TWS_ORDER_SAMPLE_CSV_FILENAME, buildTwsOrderSampleCsv())
}

function exportOrderErrors() {
  downloadCsv(TWS_ORDER_CSV_FILENAME, buildTwsOrderCsv(orderErrors.value))
}

function downloadConfirmationSample() {
  downloadCsv(CONFIRMATION_SAMPLE_CSV_FILENAME, buildConfirmationSampleCsv())
}

/*
 * 出力を押せるのは、注文エラーが読めて 1 件以上あるときだけ。
 * 取得中・取込中に押すと取り直す前の行が出る。0 件の出力は別システムで発注するものが無い。
 */
const canExport = computed(
  () => !loading.value && !error.value && !importing.value && orderErrors.value.length > 0,
)

/** 取込むコンファメーション CSV。選ぶまでは null */
const confirmationFile = ref(null)

/**
 * 直近の取込の結果（src/api/stalledOrders.js の ConfirmationImportResult）。
 * 出していないときは null。ファイルごと拒否された・通信に失敗したときの理由は importError 側。
 */
const importResult = ref(null)

// ストアは画面を離れても残る。戻ってきたときに前回の取込の失敗を出し直さない
store.clearImportError()

async function importConfirmation() {
  importResult.value = null
  store.clearImportError()

  const result = await store.importConfirmation(confirmationFile.value)
  // 失敗はファイルを選んだまま importError で出す（直さずに押し直せる）
  if (!result) return

  importResult.value = result
  // 反映できたら選択を外す。行エラーのときは同じファイルを直して選び直すので残す
  if (result.success) confirmationFile.value = null
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
        <BaseBadge
          :variant="canOperate ? 'success' : 'gray'"
          data-testid="stalled-orders-permission"
        >
          {{ canOperate ? '操作可能' : '操作不可' }}
        </BaseBadge>
      </template>

      <div class="stalled-orders__actions">
        <BaseButton
          variant="secondary"
          data-testid="stalled-orders-order-sample"
          @click="downloadOrderSample"
        >
          別システム発注CSVサンプル
        </BaseButton>
        <BaseButton
          data-testid="stalled-orders-export"
          :disabled="!canExport"
          @click="exportOrderErrors"
        >
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
          :disabled="!confirmationFile || importing"
          @click="importConfirmation"
        >
          {{ importing ? '取込中…' : '取込して注文照会へ反映' }}
        </BaseButton>
      </div>

      <!--
        取込の結果は取込口の直下に出す。成功・行エラーの文言はサーバが返す（自前で組み立てない）。
        行エラーのときは 1 行も反映されていないので、どの行を直すかを表で見せる。
      -->
      <BaseAlert
        v-if="importError"
        variant="error"
        class="stalled-orders__import-result"
        data-testid="stalled-orders-import-error"
      >
        {{ importError.message }}
      </BaseAlert>
      <BaseAlert
        v-else-if="importResult?.success"
        variant="success"
        class="stalled-orders__import-result"
        data-testid="stalled-orders-import-notice"
      >
        {{ importResult.message }}
      </BaseAlert>
      <BaseAlert
        v-else-if="importResult"
        variant="warning"
        class="stalled-orders__import-result"
        data-testid="stalled-orders-import-errors"
      >
        <p>{{ importResult.message }}</p>
        <ConfirmationImportErrors
          v-if="importResult.errors.length > 0"
          class="stalled-orders__import-errors"
          :errors="importResult.errors"
        />
      </BaseAlert>
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

.stalled-orders__import-result {
  margin-top: var(--space-3);
}

/* 行エラーの表は警告の帯の中に敷く。文言との間だけ空ける */
.stalled-orders__import-errors {
  margin-top: var(--space-2);
}

@media (max-width: 720px) {
  .stalled-orders__upload {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
