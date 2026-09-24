<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import DataTable from '@/components/ui/DataTable.vue'
import { useIncidentsStore } from '@/stores/incidents'
import { formatDateTime } from '@/utils/format'
import { summarizeSuspension } from '@/utils/suspensionState'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useIncidentsStore()
const { status, targets, histories, loading, error, isEmpty, hasHistories } = storeToRefs(store)

/*
 * 停止対象の表。行は サーバの targets の並び（ALL が先頭）のまま出す。
 * 公開モックの「IB送信制御 / 注文入力制御」の 2 区画は採らない（仕様の停止対象と軸が違い、
 * みずほ / VWAP / 自己取引 / OTC の停止が画面に出なくなるため）。
 */
const TARGET_COLUMNS = [
  { key: 'targetName', label: '停止対象' },
  { key: 'suspended', label: '状態' },
  { key: 'reason', label: '停止理由' },
  { key: 'suspendedAt', label: '停止日時・停止者' },
  { key: 'resumedAt', label: '再開日時・再開者' },
]

const HISTORY_COLUMNS = [
  { key: 'operatedAt', label: '操作日時' },
  { key: 'targetName', label: '停止対象' },
  { key: 'operationName', label: '操作区分' },
  { key: 'reason', label: '停止理由' },
  { key: 'operator', label: '操作者' },
]

/*
 * 操作区分の色分け。文言はサーバの 操作区分名 をそのまま出し、ここは色だけを決める
 * （操作区分は description だけで enum 宣言が無いので、src/utils/apiEnums.js には載せられない）。
 */
const OPERATION_BADGE_VARIANTS = { SUSPEND: 'error', RESUME: 'success' }

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
        @click="store.load()"
      >
        再読み込み
      </BaseButton>
    </Teleport>

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
      <BaseButton variant="secondary" @click="store.load()">再試行</BaseButton>
    </div>

    <p v-else-if="isEmpty" data-testid="incidents-empty" class="incident__status">
      現在の発注停止状態を取得できませんでした。
    </p>

    <template v-else>
      <BaseCard title="発注停止の状態" flush>
        <template #header-actions>
          <span :class="['incident__state', `is-${summary.tone}`]">
            <span class="incident__state-label">現在の運用状態</span>
            <strong class="incident__state-value" data-testid="incidents-state">
              {{ summary.label }}
            </strong>
          </span>
        </template>

        <p class="incident__intro">{{ INTRO_TEXT }}</p>

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
        </DataTable>
      </BaseCard>

      <!-- 表を全幅で載せるときだけ flush。0 件の一行は本文余白の中に置きたいので付けない -->
      <BaseCard title="停止・再開の操作履歴" :flush="hasHistories">
        <template #header-actions>
          <span class="incident__head-note">新しい順</span>
        </template>

        <DataTable
          v-if="hasHistories"
          flat
          data-testid="incidents-history"
          :columns="HISTORY_COLUMNS"
          :rows="histories"
        >
          <template #cell-operatedAt="{ value }">{{ formatDateTime(value) }}</template>
          <template #cell-operationName="{ row }">
            <BaseBadge :variant="OPERATION_BADGE_VARIANTS[row.operation] ?? 'gray'">
              {{ row.operationName }}
            </BaseBadge>
          </template>
          <template #cell-reason="{ value }">{{ value ?? '—' }}</template>
        </DataTable>

        <p v-else data-testid="incidents-history-empty" class="incident__history-empty">
          発注停止・再開の操作履歴はありません。
        </p>
      </BaseCard>
    </template>
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
