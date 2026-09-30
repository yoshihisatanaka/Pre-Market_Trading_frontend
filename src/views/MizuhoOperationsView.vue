<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import DownloadIcon from '@/components/ui/DownloadIcon.vue'
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
import { downloadBlob } from '@/utils/download'
import { FILL_STATUS_OPTIONS } from '@/utils/fillStatusTypes'

/*
 * みずほ注文締（公開モック /executions/mizuho-operations）。
 *   - 締めカード … 締め状態（受付中 / 締め済）を出し、締め・締め解除・注文ファイル作成を
 *                  確認ダイアログ越しに行う。結果は画面上部の通知に出す
 *   - 約定一覧   … 預託先＝みずほの約定を検索する。カードのヘッダの「CSV出力」で、
 *                  いま一覧に出ている検索条件の約定を GET /executions/export-csv から落とす
 * 締め状態と約定一覧は取得が別で、4 状態もカードごとに出し分ける。
 * 公開モックは画面ヘッダにも同じ「CSV出力」を持つが、一覧カードの 1 つに寄せた（同じ操作が 2 つ並ぶため）。
 */

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const executionsStore = useMizuhoExecutionsStore()
const { items, total, limit, offset, loading, error, isEmpty, summary, exporting, exportError } =
  storeToRefs(executionsStore)

const closingStore = useMizuhoClosingStore()
const {
  status: closingStatus,
  loading: closingLoading,
  error: closingError,
  isEmpty: isClosingEmpty,
  saving,
  saveError,
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

/** 注文ファイルの売買区分（store の ORDER_FILE_SIDES の値）→ 通知に出す語 */
const SIDE_LABELS = { buy: '買い', sell: '売り' }

/** 確認ダイアログ。'close' / 'reopen' / 'order-file'。null なら閉じている */
const dialogMode = ref(null)

/**
 * 操作の結果の通知。null なら出さない。
 * 文は 1 行ずつ lines に持つ（テンプレートで日本語を途中改行すると半角スペースが入るため、
 * 文言は script 側で組み立てる）。
 * @type {import('vue').Ref<{ variant: 'success'|'warning'|'error', lines: string[] }|null>}
 */
const notice = ref(null)

function openDialog(mode) {
  notice.value = null
  closingStore.clearSaveError()
  dialogMode.value = mode
}

function closeDialog() {
  // 実行中に閉じると、結果（成功の知らせ・失敗の理由）の行き先が無くなる
  if (saving.value) return
  dialogMode.value = null
  closingStore.clearSaveError()
}

async function confirmDialog() {
  if (dialogMode.value === 'order-file') {
    await confirmOrderFiles()
    return
  }

  const reopening = dialogMode.value === 'reopen'
  const result = reopening ? await closingStore.reopen() : await closingStore.close()
  // 失敗時はダイアログを開いたまま、理由を saveError で出す（締め状態は変わっていない）
  if (!result) return

  dialogMode.value = null
  notice.value = {
    variant: 'success',
    lines: [reopening ? 'みずほ注文締めを解除しました。' : 'みずほ注文を締めました。'],
  }
}

/*
 * 注文ファイルは買い → 売りの 2 冊を続けて作り、作れた分をすぐ落とす。
 * 1 冊も作れなければ何も変わっていないので、ダイアログを開いたまま理由を出す。
 * 1 冊だけ作れたときは、その分はサーバで発注済へ進んでいるので、ダイアログを閉じて
 * 何が済んで何が残ったかを通知に出す（作り直しは同じ内容を返すので、もう一度押せば揃う）。
 */
async function confirmOrderFiles() {
  const { files, failedSide } = await closingStore.createOrderFiles()
  for (const file of files) downloadBlob(file.filename, file.blob)
  if (files.length === 0) return

  dialogMode.value = null
  notice.value = failedSide
    ? partialOrderFilesNotice(files, failedSide, saveError.value)
    : orderFilesNotice(files)
  // 途中で落ちた理由は通知に移した。次に開くダイアログへ持ち越さない
  closingStore.clearSaveError()
}

/** 2 冊とも作れたときの通知。Dream 未登録で載せられなかった注文があれば注意として出す */
function orderFilesNotice(files) {
  const exported = files
    .map((file) => `${SIDE_LABELS[file.side]} ${countText(file.exportedCount)} 件`)
    .join('・')
  const newlyExported = countText(sumCounts(files.map((file) => file.newlyExportedCount)))
  const lines = [
    `注文ファイルを作成しました（${exported}。うち今回発注済にした注文 ${newlyExported} 件）。`,
  ]

  const skipped = files.filter((file) => file.skippedCount > 0)
  if (skipped.length === 0) return { variant: 'success', lines }

  const skippedText = skipped
    .map((file) => `${SIDE_LABELS[file.side]} ${file.skippedCount} 件`)
    .join('・')
  lines.push(`Dream 未登録のため載せていない注文があります（${skippedText}）。`)
  return { variant: 'warning', lines }
}

/** 途中の 1 冊で失敗したときの通知 */
function partialOrderFilesNotice(files, failedSide, error) {
  const created = files.map((file) => SIDE_LABELS[file.side]).join('・')
  return {
    variant: 'error',
    lines: [
      `${created}の注文ファイルは作成しましたが、${SIDE_LABELS[failedSide]}の注文ファイルを作成できませんでした。`,
      `理由: ${error?.message ?? '—'}`,
      'もう一度「注文ファイル作成」を押すと、作成済みの分も同じ内容で作り直します。',
    ],
  }
}

/** 件数の表示。ヘッダが読めなかった（null）なら — */
function countText(count) {
  return count ?? '—'
}

/** 件数の合計。1 つでも読めなかったら合計も出さない（null） */
function sumCounts(counts) {
  return counts.includes(null) ? null : counts.reduce((sum, count) => sum + count, 0)
}

/*
 * CSV 出力。条件はいま一覧に出ているもの（ストアが最後に読んだ条件で、検索欄に入力しただけの値は使わない）。
 * 取得中・エラー・0 件のときは押せない（一覧と食い違う条件で出る・出すものが無い）。
 * 列と並びはバックエンドが決める（条件に合う全件。上限 10,000 件・約定日時の昇順）。
 */
const canExport = computed(
  () => !loading.value && !error.value && !isEmpty.value && !exporting.value,
)

async function exportCsv() {
  const file = await executionsStore.exportCsv()
  // 失敗の理由は exportError で出す
  if (file) downloadBlob(file.filename, file.blob)
}

// 初回読み込み。onMounted に置くと最初の描画で一瞬「取得できませんでした」が出る
closingStore.load()
// ストアは画面を離れても残る。戻ってきたときに前回の出力の失敗を出し直さない
executionsStore.clearExportError()
</script>

<template>
  <section class="mizuho-operations">
    <!-- 見出しはヘッダが meta.title から出す。この画面はヘッダへ差し込む操作を持たない -->
    <BaseAlert
      v-if="notice"
      :variant="notice.variant"
      data-testid="mizuho-operations-notice"
      class="mizuho-operations__notice"
    >
      <p v-for="line in notice.lines" :key="line">{{ line }}</p>
    </BaseAlert>

    <MizuhoClosingPanel
      :status="closingStatus"
      :loading="closingLoading"
      :is-empty="isClosingEmpty"
      :error="closingError"
      @close="openDialog('close')"
      @reopen="openDialog('reopen')"
      @create-order-file="openDialog('order-file')"
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

    <!-- CSV 出力の失敗。ボタンのある一覧カードの直前に出す（一覧はそのまま残す） -->
    <BaseAlert v-if="exportError" variant="error" data-testid="mizuho-executions-export-error">
      {{ exportError.message }}
    </BaseAlert>

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
      <template #actions>
        <BaseButton
          variant="secondary"
          size="sm"
          data-testid="mizuho-executions-export"
          :disabled="!canExport"
          @click="exportCsv"
        >
          <DownloadIcon />
          {{ exporting ? '出力中…' : 'CSV出力' }}
        </BaseButton>
      </template>

      <MizuhoExecutionTable data-testid="mizuho-executions-table" :rows="items" />
    </MasterListCard>

    <!--
      ダイアログは 4 状態のチェーンの外。BaseModal 自身が v-if="open" を持つので、
      ここは open だけで制御する。
    -->
    <MizuhoClosingDialog
      :open="dialogMode !== null"
      :mode="dialogMode"
      :pending="saving"
      :error="saveError"
      @close="closeDialog"
      @confirm="confirmDialog"
    />
  </section>
</template>

<style scoped>
.mizuho-operations {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* 通知の文は行ごとに段落にしている。段落の既定の余白で帯が間延びしないよう詰める */
.mizuho-operations__notice p {
  margin: 0;
}
</style>
