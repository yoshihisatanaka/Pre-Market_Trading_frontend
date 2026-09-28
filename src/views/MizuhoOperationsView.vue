<script setup>
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import FormField from '@/components/ui/FormField.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
import MizuhoClosingDialog from '@/components/mizuho/MizuhoClosingDialog.vue'
import MizuhoClosingPanel from '@/components/mizuho/MizuhoClosingPanel.vue'
import MizuhoExecutionSummary from '@/components/mizuho/MizuhoExecutionSummary.vue'
import MizuhoExecutionTable from '@/components/mizuho/MizuhoExecutionTable.vue'
import { useListQuery } from '@/composables/useListQuery'
import { useMizuhoClosingStore } from '@/stores/mizuhoClosing'
import { useMizuhoExecutionsStore } from '@/stores/mizuhoExecutions'
import { FILL_STATUS_OPTIONS } from '@/utils/fillStatusTypes'

/*
 * みずほ注文締。公開モック（/executions/mizuho-operations）の UI/UX だけを先に置いた段階。
 *   - 締め状態（受付中 / 締め済）と約定一覧は MSW のモックまで通して 4 状態を出し分ける
 *   - 締め・締め解除・注文ファイル作成は確認ダイアログを開くところまで（主ボタンは押せない）
 *   - ヘッダの CSV 出力は押しても何も起きない（下の TODO）
 */

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const executionsStore = useMizuhoExecutionsStore()
const { items, total, limit, offset, loading, error, isEmpty, summary } =
  storeToRefs(executionsStore)

const closingStore = useMizuhoClosingStore()
const {
  status: closingStatus,
  loading: closingLoading,
  error: closingError,
  isEmpty: isClosingEmpty,
} = storeToRefs(closingStore)

/** 売買区分。値は実 API の SideEnum（1:売 / 3:買）で、URL にもこのまま載る */
const SIDE_OPTIONS = [
  { value: '3', label: '買い' },
  { value: '1', label: '売り' },
]

/*
 * ページ位置と検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名（branch_code / side / status / date_from など）はこの filters 定義にだけ現れる。
 * バックエンドへ送る名前（start_date / end_date など）と route=0（みずほ）の固定は
 * src/api/mizuhoExecutions.js の中に閉じている。
 * status は出来状況の区分（filled / partial / canceled_filled）で、処理状況コードではない。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'branchCode', query: 'branch_code' },
    { key: 'symbol', query: 'symbol' },
    { key: 'side', query: 'side' },
    { key: 'fillStatus', query: 'status' },
    { key: 'dateFrom', query: 'date_from' },
    { key: 'dateTo', query: 'date_to' },
  ],
  load: (params) => executionsStore.load(params),
})

/** 確認ダイアログ。'close' / 'reopen' / 'order-file'。null なら閉じている */
const dialogMode = ref(null)

/*
 * TODO(処理実装): 約定一覧の CSV 出力（実 API `GET /executions/export-csv` に、
 *   route=0 といまの検索条件を載せる）。
 *
 * 公開モックは同じ CSV ボタンをヘッダと「約定一覧」カードの見出しの 2 か所に置いているが、
 * ここではヘッダの 1 つだけにした。MasterListCard の見出し右は件数の表示に使われていて
 * ボタンを差す口が無く、同じ出力のために共通部品へ口を開けるほどの差ではないため。
 */
function exportCsv() {
  // TODO(処理実装): いまの検索条件でみずほの約定を CSV として出力する
}

// 初回読み込み。onMounted に置くと最初の描画で一瞬「取得できませんでした」が出る
closingStore.load()
</script>

<template>
  <section class="mizuho-operations">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む -->
    <Teleport defer to="#topbar-actions">
      <BaseButton variant="secondary" data-testid="mizuho-operations-export" @click="exportCsv">
        CSV出力
      </BaseButton>
    </Teleport>

    <MizuhoClosingPanel
      :status="closingStatus"
      :loading="closingLoading"
      :is-empty="isClosingEmpty"
      :error="closingError"
      @close="dialogMode = 'close'"
      @reopen="dialogMode = 'reopen'"
      @create-order-file="dialogMode = 'order-file'"
      @reload="closingStore.load()"
    />

    <MasterSearchCard
      testid-prefix="mizuho-executions"
      :disabled="loading"
      @submit="submitSearch"
      @clear="clearSearch"
    >
      <FormField v-slot="{ field }" label="部店コード">
        <BaseInput
          v-bind="field"
          v-model="inputs.branchCode"
          placeholder="例: 123"
          data-testid="mizuho-executions-branch-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="銘柄コード">
        <BaseInput
          v-bind="field"
          v-model="inputs.symbol"
          placeholder="例: AAPL"
          data-testid="mizuho-executions-symbol"
        />
      </FormField>
      <FormField v-slot="{ field }" label="売買区分">
        <BaseSelect
          v-bind="field"
          v-model="inputs.side"
          :options="SIDE_OPTIONS"
          placeholder="-- 全て --"
          data-testid="mizuho-executions-side"
        />
      </FormField>
      <FormField v-slot="{ field }" label="出来状況">
        <BaseSelect
          v-bind="field"
          v-model="inputs.fillStatus"
          :options="FILL_STATUS_OPTIONS"
          placeholder="-- 全て --"
          data-testid="mizuho-executions-fill-status"
        />
      </FormField>
      <FormField v-slot="{ field }" label="約定日（From）">
        <BaseInput
          v-bind="field"
          v-model="inputs.dateFrom"
          type="date"
          data-testid="mizuho-executions-date-from"
        />
      </FormField>
      <FormField v-slot="{ field }" label="約定日（To）">
        <BaseInput
          v-bind="field"
          v-model="inputs.dateTo"
          type="date"
          data-testid="mizuho-executions-date-to"
        />
      </FormField>
    </MasterSearchCard>

    <!-- 集計は一覧と同じ取得に載ってくる。取得中・失敗中は前回の値を見せない -->
    <MizuhoExecutionSummary :summary="loading || error ? null : summary" />

    <MasterListCard
      testid-prefix="mizuho-executions"
      title="約定一覧"
      empty-message="該当する約定はありません。"
      :total="total"
      :limit="limit"
      :offset="offset"
      :loading="loading"
      :is-empty="isEmpty"
      :error="error"
      @reload="executionsStore.reload()"
      @update:offset="goToOffset"
    >
      <MizuhoExecutionTable data-testid="mizuho-executions-table" :rows="items" />
    </MasterListCard>

    <!--
      ダイアログは 4 状態のチェーンの外。BaseModal 自身が v-if="open" を持つので、
      ここは open だけで制御する。
    -->
    <MizuhoClosingDialog
      :open="dialogMode !== null"
      :mode="dialogMode"
      @close="dialogMode = null"
    />
  </section>
</template>

<style scoped>
.mizuho-operations {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
</style>
