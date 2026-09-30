<script setup>
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
import DreamErrorPopover from '@/components/orders/DreamErrorPopover.vue'
import DreamStatusChangeDialog from '@/components/orders/DreamStatusChangeDialog.vue'
import { useListQuery } from '@/composables/useListQuery'
import { useDreamStatusStore } from '@/stores/dreamStatus'
import { formatDateTime, formatQuantity } from '@/utils/format'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useDreamStatusStore()
const {
  items,
  total,
  limit,
  offset,
  loading,
  error,
  isEmpty,
  statusOptions,
  statusCodesLoading,
  statusCodesError,
  changing,
  changeError,
} = storeToRefs(store)

// 検索のプルダウンの選択肢。コード一覧は画面を開くたびに変わるものではないので 1 回だけ取る
if (store.statusCodes.length === 0) store.loadStatusCodes()

/*
 * 列は画面モック（dream_registration_status.html）の並びどおり。ただし「登録予定」は落とした。
 * 実 API の DreamOrderItem に対応する項目が無く、モックの値（「次回定点RPA登録」）も
 * 全行ほぼ同じ文言で、列として出しても行を見分ける手掛かりにならないため。
 */
const columns = [
  { key: 'status', label: 'Dream登録状況' },
  { key: 'statusChange', label: 'STS変更' },
  { key: 'completedAt', label: '登録日時' },
  { key: 'receiptNumber', label: 'Dream受付番号' },
  { key: 'id', label: '注文ID' },
  { key: 'branchCode', label: '部店' },
  { key: 'accountNumber', label: '口座番号', numeric: true },
  { key: 'customerName', label: '顧客名' },
  { key: 'symbol', label: '銘柄' },
  { key: 'side', label: '売買' },
  { key: 'quantity', label: '数量', numeric: true },
]

/*
 * ページ位置と検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名はこの filters 定義にだけ現れ、バックエンドへ送る名前
 * （account_no / dream_status / start_date など）は src/api/dreamStatus.js の中に閉じている。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'branchCode', query: 'branch_code' },
    { key: 'accountNumber', query: 'account_number' },
    { key: 'symbol', query: 'symbol' },
    { key: 'status', query: 'dream_status' },
    { key: 'dateFrom', query: 'registered_from' },
    { key: 'dateTo', query: 'registered_to' },
    { key: 'receiptNumber', query: 'dream_ref' },
  ],
  load: (params) => store.load(params),
})

/*
 * 状況の色。文言はサーバの Dream状況名をそのまま出し、画面は色だけを決める
 * （色の割り当てはモックの 登録待ち=青 / 登録済み=緑 / 登録エラー=赤 / 取消済=灰 に寄せた）。
 *   pending  … まだ終わっていない（未登録・登録中・取消中）
 *   done     … Dream に登録された
 *   error    … 登録失敗・取消失敗。エラー内容をポップアップで出し、STS を変更できる
 *   inactive … もう連携しない（登録対象外・取消済）
 */
const STATUS_TONES = {
  0: 'pending',
  1: 'pending',
  2: 'done',
  8: 'inactive',
  9: 'error',
  C1: 'pending',
  C2: 'inactive',
  C9: 'error',
}

/** エラー内容のポップアップの見出し。取消フェーズの失敗は「取消」と言い分ける */
const ERROR_TITLES = { 9: 'Dream登録エラー詳細', C9: 'Dream取消エラー詳細' }

function statusTone(row) {
  return STATUS_TONES[row.status] ?? 'pending'
}

function statusLabel(row) {
  return row.statusName || row.status || '—'
}

const sideLabels = { buy: '買', sell: '売' }

function sideLabel(row) {
  return row.sideName || sideLabels[row.side] || '—'
}

/*
 * STS変更。行のプルダウンで遷移先を選ぶと確認ダイアログを開き、「変更する」で送信する。
 *
 * プルダウンは「いまの状況」を空値の先頭項目として見せ、遷移先だけを選択肢に並べる。
 * 選んだ値は statusChange に持ち、ダイアログを閉じたら空へ戻す。こうすると
 * キャンセルしたときにプルダウンの表示も「いまの状況」へ戻る（選んだまま残らない）。
 *
 * 成功したらダイアログを閉じ、サーバの処理結果を noticeMessage に出す（一覧はストアが読み直す）。
 * 弾かれたとき（409 を含む）はダイアログを開いたまま、その中に理由を出す。
 */
const statusChange = ref(null)
const noticeMessage = ref('')

function transitionOptions(row) {
  return row.statusTransitions.map((transition) => ({
    value: transition.code,
    label: transition.name,
  }))
}

function selectedTransition(row) {
  return statusChange.value?.order.id === row.id ? statusChange.value.targetStatus : ''
}

function openStatusChange(row, targetStatus) {
  if (!targetStatus) return
  // 前回の失敗と成功をどちらも持ち込まない
  store.clearChangeError()
  noticeMessage.value = ''
  statusChange.value = { order: row, targetStatus }
}

function closeStatusChange() {
  // 送信中は閉じない（ダイアログ側も閉じる操作を止めている）
  if (changing.value) return
  statusChange.value = null
  store.clearChangeError()
}

async function confirmStatusChange({ status, receiptNumber, reason }) {
  const { order } = statusChange.value

  await store.changeStatus(
    { order, status, receiptNumber, reason },
    {
      onSuccess: (result) => {
        statusChange.value = null
        noticeMessage.value =
          result.message || `注文ID #${order.id} のDream状況を変更しました。`
      },
    },
  )
}
</script>

<template>
  <section class="dream-status">
    <!-- 画面の説明。4 状態や検索結果に関わらず常時出す（モックの副題） -->
    <p class="dream-status__description" data-testid="dream-status-description">
      定点RPA登録の処理状況を確認します。登録失敗・取消失敗の注文は STS を変更できます。
    </p>

    <BaseAlert v-if="noticeMessage" variant="success" data-testid="dream-status-notice">
      {{ noticeMessage }}
    </BaseAlert>

    <MasterSearchCard
      testid-prefix="dream-status"
      :disabled="loading"
      :options-loading="statusCodesLoading"
      @submit="submitSearch"
      @clear="clearSearch"
    >
      <FormField v-slot="{ field }" label="部店コード">
        <BaseInput
          v-bind="field"
          v-model="inputs.branchCode"
          placeholder="例: 123"
          data-testid="dream-status-branch-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="口座番号">
        <BaseInput
          v-bind="field"
          v-model="inputs.accountNumber"
          inputmode="numeric"
          placeholder="例: 123456"
          data-testid="dream-status-account-number"
        />
      </FormField>
      <FormField v-slot="{ field }" label="銘柄コード">
        <BaseInput
          v-bind="field"
          v-model="inputs.symbol"
          placeholder="例: AAPL"
          data-testid="dream-status-symbol"
        />
      </FormField>
      <!-- 選択肢が取れなくても検索はできる（「全て」で引ける）。理由だけ欄の下に出す（操作ログの対象種別と同じ） -->
      <FormField
        v-slot="{ field }"
        label="Dream登録状況"
        :error="
          statusCodesError
            ? `Dream登録状況の選択肢を取得できませんでした（${statusCodesError.message}）`
            : ''
        "
        data-testid="dream-status-status-field"
      >
        <BaseSelect
          v-bind="field"
          v-model="inputs.status"
          :options="statusOptions"
          placeholder="-- 全て --"
          data-testid="dream-status-status"
        />
      </FormField>
      <FormField v-slot="{ field }" label="登録日（From）">
        <BaseInput
          v-bind="field"
          v-model="inputs.dateFrom"
          type="date"
          data-testid="dream-status-date-from"
        />
      </FormField>
      <FormField v-slot="{ field }" label="登録日（To）">
        <BaseInput
          v-bind="field"
          v-model="inputs.dateTo"
          type="date"
          data-testid="dream-status-date-to"
        />
      </FormField>
      <FormField v-slot="{ field }" label="Dream受付番号">
        <BaseInput
          v-bind="field"
          v-model="inputs.receiptNumber"
          placeholder="例: DR-20260928-0002"
          data-testid="dream-status-receipt-number"
        />
      </FormField>
    </MasterSearchCard>

    <MasterListCard
      testid-prefix="dream-status"
      title="Dream登録一覧"
      empty-message="該当する注文はありません。"
      :total="total"
      :limit="limit"
      :offset="offset"
      :loading="loading"
      :is-empty="isEmpty"
      :error="error"
      @reload="store.reload()"
      @update:offset="goToOffset"
    >
      <DataTable flat data-testid="dream-status-table" :columns="columns" :rows="items">
        <!-- 失敗の行だけ、文字に触れるとエラー内容が出る（モックは常設の列をやめてこの形にした） -->
        <template #cell-status="{ row }">
          <DreamErrorPopover
            v-if="statusTone(row) === 'error'"
            :title="ERROR_TITLES[row.status] ?? 'Dreamエラー詳細'"
            :message="row.errorMessage"
          >
            <span class="dream-status__status is-error">{{ statusLabel(row) }}</span>
          </DreamErrorPopover>
          <span v-else :class="['dream-status__status', `is-${statusTone(row)}`]">
            {{ statusLabel(row) }}
          </span>
        </template>

        <!-- 変えられるのは登録失敗・取消失敗の行だけ（サーバの STS変更可）。それ以外は「変更不可」 -->
        <template #cell-statusChange="{ row }">
          <BaseSelect
            v-if="row.canChangeStatus"
            class="dream-status__change"
            :model-value="selectedTransition(row)"
            :options="transitionOptions(row)"
            :placeholder="statusLabel(row)"
            :aria-label="`注文ID #${row.id} のSTS変更`"
            data-testid="dream-status-change"
            @update:model-value="openStatusChange(row, $event)"
          />
          <span
            v-else
            class="dream-status__locked"
            title="STS を変更できるのは登録失敗・取消失敗の注文だけです"
            data-testid="dream-status-locked"
          >
            変更不可
          </span>
        </template>

        <template #cell-completedAt="{ value }">
          <span class="dream-status__muted">{{ formatDateTime(value) }}</span>
        </template>

        <!-- 空のときの '—' は等幅にしない（細く潰れて、ほかの列の '—' と揃わない） -->
        <template #cell-receiptNumber="{ value }">
          <span v-if="value" class="dream-status__code is-small">{{ value }}</span>
          <template v-else>—</template>
        </template>

        <!-- 注文 ID はモックに合わせて # を前置する -->
        <template #cell-id="{ value }">
          <span class="dream-status__code">#{{ value }}</span>
        </template>

        <template #cell-branchCode="{ row }">
          <span :title="row.branchName || undefined">{{ row.branchCode || '—' }}</span>
        </template>

        <template #cell-accountNumber="{ value }">{{ value || '—' }}</template>
        <template #cell-customerName="{ value }">{{ value || '—' }}</template>

        <!-- 銘柄は Ticker を主に出す（モックの表示）。無ければ銘柄コード -->
        <template #cell-symbol="{ row }">
          <span class="dream-status__symbol" :title="row.symbolName || undefined">
            {{ row.ticker || row.symbolCode || '—' }}
          </span>
        </template>

        <template #cell-side="{ row }">
          <span :class="['dream-status__side', `is-${row.side || 'unknown'}`]">
            {{ sideLabel(row) }}
          </span>
        </template>

        <template #cell-quantity="{ value }">{{ formatQuantity(value) }}</template>
      </DataTable>
    </MasterListCard>

    <DreamStatusChangeDialog
      :open="statusChange !== null"
      :order="statusChange?.order ?? null"
      :target-status="statusChange?.targetStatus ?? ''"
      :pending="changing"
      :error="changeError"
      @close="closeStatusChange"
      @confirm="confirmStatusChange"
    />
  </section>
</template>

<style scoped>
.dream-status {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* 説明文はヘッダの見出しに続く小さな添え書き（モックの副題に相当） */
.dream-status__description {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

/* 状況。モックの 登録待ち=青 / 登録済み=緑 / 登録エラー=赤 / 取消済=灰 */
.dream-status__status {
  font-weight: 600;
}

.dream-status__status.is-pending {
  color: var(--color-info-text);
}

.dream-status__status.is-done {
  color: var(--color-success);
}

.dream-status__status.is-error {
  color: var(--color-danger-text);
}

.dream-status__status.is-inactive {
  color: var(--color-text-muted);
  font-weight: 400;
}

/*
 * 行の STS変更のプルダウン。一覧の中に置くので、検索欄より一回り小さくする。
 * 幅を決め打ちするのは、選択肢の文言（「登録済（Dream側で手入力済のため消し込む）」など）が長く、
 * 放っておくと最長の選択肢の幅まで列が広がるため。開いたときの一覧はブラウザが文言の幅で出す。
 * BaseSelect の既定（width: 100% など）より強く当てるため、要素名を足して詳細度を上げている。
 */
select.dream-status__change {
  width: 120px;
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.dream-status__locked {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.dream-status__muted {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

/* 受付番号・注文 ID はコード値なので等幅にする（モックの .ui-code） */
.dream-status__code {
  font-family: var(--font-family-numeric);
}

.dream-status__code.is-small {
  font-size: var(--font-size-xs);
}

.dream-status__symbol {
  font-weight: 600;
}

/* 売買はモックどおり 買=赤 / 売=青 の太字。知らないコードのときは色を付けない */
.dream-status__side.is-buy {
  color: var(--color-buy);
  font-weight: 600;
}

.dream-status__side.is-sell {
  color: var(--color-sell);
  font-weight: 600;
}
</style>
