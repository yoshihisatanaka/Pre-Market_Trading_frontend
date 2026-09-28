<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import IncidentControlDialog from '@/components/incidents/IncidentControlDialog.vue'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BasePagination from '@/components/ui/BasePagination.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import DataTable from '@/components/ui/DataTable.vue'
import { INCIDENT_HISTORY_PAGE_SIZE, useIncidentsStore } from '@/stores/incidents'
import { formatDateTime } from '@/utils/format'
import { summarizeSuspension } from '@/utils/suspensionState'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useIncidentsStore()
const {
  status,
  targets,
  histories,
  historyTotal,
  historyOffset,
  historyLoading,
  historyError,
  loading,
  error,
  isEmpty,
  hasHistories,
  saving,
  saveError,
} = storeToRefs(store)

/*
 * 停止対象の表。行は サーバの targets の並び（ALL が先頭）のまま出す。
 * 公開モックの「IB送信制御 / 注文入力制御」の 2 区画は採らない（仕様の停止対象と軸が違い、
 * みずほ / VWAP / 自己取引 / OTC の停止が画面に出なくなるため）。
 * モック 08986d1 のスライド式トグルは、この表の「発注停止」列に取り込む（ON = 停止中）。
 * 語はモックの「制御 / 解除」ではなく、API とサーバ文言に揃えて「停止 / 再開」にする。
 */
const TARGET_COLUMNS = [
  { key: 'targetName', label: '停止対象' },
  { key: 'suspended', label: '状態' },
  { key: 'reason', label: '停止理由' },
  { key: 'suspendedAt', label: '停止日時・停止者' },
  { key: 'resumedAt', label: '再開日時・再開者' },
  { key: 'action', label: '発注停止' },
]

/*
 * 履歴はモックの 変更日時 / 制御内容 / 更新者 に、停止理由の列を足した 4 列。
 * 停止理由はモックに無い意図的なずれ（API は停止に理由を必須とし、何のために止めたかは監査上残す必要がある）。
 */
const HISTORY_COLUMNS = [
  { key: 'operatedAt', label: '変更日時' },
  { key: 'content', label: '制御内容' },
  { key: 'reason', label: '停止理由' },
  { key: 'operator', label: '更新者' },
]

/*
 * 説明文。テンプレートに直接書くと、日本語の途中で改行した位置が
 * そのまま半角スペースとして描画される（prettier の折り返しでも同じことが起きる）。
 * 1 つの文字列にしておけば、どこで折り返されても表示は変わらない。
 */
const INTRO_TEXT =
  '停止中は注文の新規受付と取消、IB発注・Dream連携のバッチが止まります。受付済みの発注待ち注文は保留され、再開後に通常のバッチ周期で順次発注されます。'

const summary = computed(() => summarizeSuspension(status.value))

// 全体の行だけを強調する（全体停止はルート単位の停止に優先するため）
function targetRowClass(row) {
  return { 'is-all': row.target === 'ALL', 'is-suspended': row.suspended }
}

// 制御内容。モックの「IB送信制御：制御開始」と同じ形で、停止対象名と操作区分名をサーバの文言のまま繋ぐ
function historyContent(row) {
  return `${row.targetName}：${row.operationName}`
}

/*
 * 確認ダイアログ。「開いているか」と「何を・どの対象に」を 1 つの ref で持つ（null なら閉じている）。
 * トグルを押しただけでは状態を変えない。ダイアログで確定し、サーバから取り直した値で切り替わる。
 * 対象は開いた時点の行の写し。操作後の取り直しで表の行が差し替わっても、ダイアログの文言はぶれない。
 */
const dialog = ref(null)
const noticeMessage = ref('')

/*
 * 全体停止中はルート行の操作を塞ぐ（誤操作防止）。全体停止はルート単位の停止に優先するので、
 * その間にルートを止めても再開しても発注の実態は変わらない。塞ぐかどうかの仕様は
 * バックエンドに問い合わせ中（docs/api/requests.md）で、サーバが受け付けるかは見ていない。
 */
function isActionLocked(row) {
  return Boolean(status.value?.allSuspended) && row.target !== 'ALL'
}

function openDialog(row) {
  noticeMessage.value = ''
  store.clearSaveError()
  dialog.value = { mode: row.suspended ? 'resume' : 'suspend', target: row }
}

function closeDialog() {
  // 実行中に閉じると、結果（成功の文言・失敗の理由）の行き先が無くなる
  if (saving.value) return
  dialog.value = null
  store.clearSaveError()
}

async function confirmControl({ reason }) {
  const { mode, target } = dialog.value
  const result =
    mode === 'resume'
      ? await store.resume({ target: target.target })
      : await store.suspend({ target: target.target, reason })
  // 失敗時はダイアログを開いたまま、理由を saveError で出す（入力した理由は残る）
  if (!result) return

  dialog.value = null
  // 成功の文言はサーバが返す。自前で組み立てない
  noticeMessage.value = result.message
}

// 再読み込みは見ている履歴のページを保つ（初回とエラーからの再試行も同じ入口）
function reload() {
  noticeMessage.value = ''
  store.load(historyOffset.value)
}

// 初回読み込み。onMounted に置くと最初の描画で一瞬「取得できませんでした」が出る
store.load()
</script>

<template>
  <section class="incident">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む -->
    <Teleport defer to="#topbar-actions">
      <BaseButton
        variant="secondary"
        data-testid="incidents-reload"
        :disabled="loading"
        @click="reload"
      >
        再読み込み
      </BaseButton>
    </Teleport>

    <BaseAlert v-if="noticeMessage" variant="success" data-testid="incidents-notice">
      {{ noticeMessage }}
    </BaseAlert>

    <!-- 画面の説明。取得結果に依存しないので 4 状態のチェーンの外に置く -->
    <p class="incident__lead">障害発生時に、全体または注文ルート別に発注を停止・再開します。</p>

    <!--
      ローディング / エラー / 空 / データあり の 4 状態。
      停止状態と履歴はストアが 1 回の取得にまとめているので、チェーンは 1 本で足りる。
      履歴 0 件はこの「空」ではない（データあり側の内訳。下の hasHistories で出し分ける）。
    -->
    <p v-if="loading" data-testid="incidents-loading" class="incident__status is-loading">
      <BaseSpinner />
    </p>

    <div v-else-if="error" data-testid="incidents-error" class="incident__status is-error">
      <p>{{ error.message }}</p>
      <BaseButton variant="secondary" @click="reload">再試行</BaseButton>
    </div>

    <p v-else-if="isEmpty" data-testid="incidents-empty" class="incident__status">
      現在の発注停止状態を取得できませんでした。
    </p>

    <template v-else>
      <BaseCard title="障害時の運用制御" flush>
        <template #header-actions>
          <span :class="['incident__state', `is-${summary.tone}`]">
            <span class="incident__state-label">現在の運用状態</span>
            <strong class="incident__state-value" data-testid="incidents-state">
              {{ summary.label }}
            </strong>
          </span>
        </template>

        <p class="incident__intro">{{ INTRO_TEXT }}</p>

        <BaseAlert
          v-if="status.allSuspended"
          variant="warning"
          class="incident__locked"
          data-testid="incidents-locked"
        >
          全体停止中はルート別に停止・再開できません。全体を再開してから操作してください。
        </BaseAlert>

        <DataTable
          flat
          data-testid="incidents-targets"
          :columns="TARGET_COLUMNS"
          :rows="targets"
          :row-class="targetRowClass"
        >
          <template #cell-suspended="{ value }">
            <BaseBadge :variant="value ? 'error' : 'success'">
              {{ value ? '停止中' : '通常' }}
            </BaseBadge>
          </template>
          <template #cell-reason="{ value }">{{ value ?? '—' }}</template>
          <template #cell-suspendedAt="{ row }">
            <template v-if="row.suspendedAt">
              {{ formatDateTime(row.suspendedAt) }}
              <span class="incident__operator">{{ row.suspendedBy }}</span>
            </template>
            <template v-else>—</template>
          </template>
          <template #cell-resumedAt="{ row }">
            <template v-if="row.resumedAt">
              {{ formatDateTime(row.resumedAt) }}
              <span class="incident__operator">{{ row.resumedBy }}</span>
            </template>
            <template v-else>—</template>
          </template>
          <template #cell-action="{ row }">
            <BaseSwitch
              :model-value="row.suspended"
              :label="`${row.targetName}の発注停止`"
              :data-testid="`incidents-target-${row.target}-action`"
              :disabled="isActionLocked(row)"
              @toggle="openDialog(row)"
            />
          </template>
        </DataTable>
      </BaseCard>

      <!-- 表を全幅で載せるときだけ flush。0 件やエラーの一行は本文余白の中に置きたいので付けない -->
      <BaseCard title="障害対応履歴" :flush="hasHistories && !historyError">
        <template #header-actions>
          <span class="incident__head-note">新しい順</span>
        </template>

        <!--
          ページ送りの失敗はこのカードの中だけで出す（停止対象の表と操作は使えるまま残す）。
          ページ送りの応答待ちは表を消さない（位置が跳ねないように）。ページャーを押せなくするだけ
        -->
        <div
          v-if="historyError"
          data-testid="incidents-history-error"
          class="incident__history-empty is-error"
        >
          <p>{{ historyError.message }}</p>
          <BaseButton variant="secondary" @click="store.loadHistory()">再試行</BaseButton>
        </div>

        <DataTable
          v-else-if="hasHistories"
          flat
          data-testid="incidents-history"
          :columns="HISTORY_COLUMNS"
          :rows="histories"
        >
          <template #cell-operatedAt="{ value }">{{ formatDateTime(value) }}</template>
          <template #cell-content="{ row }">{{ historyContent(row) }}</template>
          <template #cell-reason="{ value }">{{ value ?? '—' }}</template>
        </DataTable>

        <p v-else data-testid="incidents-history-empty" class="incident__history-empty">
          障害対応履歴はありません。
        </p>

        <BasePagination
          v-if="!historyError && historyTotal > 0"
          :total="historyTotal"
          :limit="INCIDENT_HISTORY_PAGE_SIZE"
          :offset="historyOffset"
          :disabled="historyLoading || saving"
          data-testid="incidents-history-pagination"
          @update:offset="store.loadHistory($event)"
        />
      </BaseCard>
    </template>

    <!--
      ダイアログはチェーンの外。BaseModal 自身が v-if="open" を持つので、
      ここは open だけで制御する。
    -->
    <IncidentControlDialog
      :open="dialog !== null"
      :mode="dialog?.mode ?? null"
      :target="dialog?.target ?? null"
      :pending="saving"
      :error="saveError"
      @close="closeDialog"
      @confirm="confirmControl"
    />
  </section>
</template>

<style scoped>
.incident {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.incident__lead {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.incident__head-note {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

/* モックの .operation-state-summary 相当。ラベルの下に値を置く小さな枠 */
.incident__state {
  display: inline-flex;
  flex-direction: column;
  min-width: 140px;
  padding: var(--space-1) var(--space-2);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.incident__state-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.incident__state-value {
  color: var(--color-text-heading);
  font-size: var(--font-size-md);
  font-weight: 600;
}

/* 一部停止中は注意色、全体停止中は危険色で強調する（モックの .operation-state-summary strong.stop 相当） */
.incident__state.is-warning {
  background-color: var(--color-warning-bg);
}

.incident__state.is-warning .incident__state-value {
  color: var(--color-warning);
}

.incident__state.is-danger {
  background-color: var(--color-danger-bg);
  border-color: var(--color-danger-border);
}

.incident__state.is-danger .incident__state-value {
  color: var(--color-danger-text);
}

/* モックの .incident-intro 相当。表の上に敷く淡い面の説明 */
.incident__intro {
  padding: var(--space-3) var(--space-4);
  color: var(--color-text-muted);
  background-color: var(--color-surface-muted);
  border-bottom: 1px solid var(--color-border);
  font-size: var(--font-size-sm);
  line-height: 1.65;
}

/* 表の上の注意。カードは flush なので本文余白を自前で持つ */
.incident__locked {
  margin: var(--space-3) var(--space-4) 0;
}

/* 全体の行は表の先頭で太字にする。全体停止はルート単位の停止に優先するため */
.incident :deep(tr.is-all td:first-child) {
  font-weight: 600;
}

.incident__operator {
  margin-left: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.incident__history-empty {
  padding: var(--space-5) var(--space-3);
  color: var(--color-text-muted);
  text-align: center;
  font-size: var(--font-size-sm);
}

.incident__history-empty.is-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  color: var(--color-danger);
}

/* カードの外に出る 4 状態の表示。面と枠線を自前で持つ */
.incident__status {
  padding: var(--space-5);
  color: var(--color-text-muted);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

/* スピナーだけを置くので中央に寄せる */
.incident__status.is-loading {
  display: flex;
  justify-content: center;
}

.incident__status.is-error {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--color-danger);
}
</style>
