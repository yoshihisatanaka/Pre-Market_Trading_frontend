<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import DataTable from '@/components/ui/DataTable.vue'
import IncidentControlDialog from '@/components/incidents/IncidentControlDialog.vue'
import { useIncidentsStore } from '@/stores/incidents'
import { formatDateTime } from '@/utils/format'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useIncidentsStore()
const { status, histories, loading, error, isEmpty, hasHistories } = storeToRefs(store)

/* 列はモックの見出しどおり（変更日時 / 変更前 / 変更後 / 障害対応の内容 / 更新者） */
const historyColumns = [
  { key: 'changedAt', label: '変更日時' },
  { key: 'stateBeforeName', label: '変更前' },
  { key: 'stateAfterName', label: '変更後' },
  { key: 'description', label: '障害対応の内容' },
  { key: 'updatedBy', label: '更新者' },
]

/*
 * 説明バナーの本文。テンプレートに直接書くと、日本語の途中で改行した位置が
 * そのまま半角スペースとして描画される（prettier の折り返しでも同じことが起きる）。
 * 1 つの文字列にしておけば、どこで折り返されても表示は変わらない。
 */
const INTRO_TEXT =
  'IB送信制御は注文入力を記録したままIBへの送信を止めるため、注文入力制御は新規の注文入力そのものを受け付けないための操作です。詳細な状態遷移は次段で実装します。'

/*
 * 運用状態の見た目。文言はサーバの 運用状態名 をそのまま出し、ここが決めるのは色だけ。
 * 判定にコード（運用状態）を使うのは、呼称が変わっても色が崩れないようにするため。
 * 通常運用（'0'）以外はすべて強調する。'1'（一部制御中）と '2'（停止中）で色を分けるかは
 * コード一覧がバックエンドで確定してから決める（src/api/incidents.js の確認事項 5）。
 */
const isStopped = computed(() => Boolean(status.value) && status.value.operationState !== '0')

/*
 * 確認ダイアログ。「開いているか」と「どちらの制御か」を 1 つの ref で持つ
 * （null なら閉じている）。制御の実行は未実装なので、閉じる以外に状態は動かない。
 */
const dialogIntent = ref(null)

function openDialog(intent) {
  dialogIntent.value = intent
}

function closeDialog() {
  dialogIntent.value = null
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
    <p class="incident__lead">障害発生時のIB送信制御と注文入力制御を分けて管理します。</p>

    <!--
      ローディング / エラー / 空 / データあり の 4 状態。
      運用状態と履歴はストアが 1 回の取得にまとめているので、チェーンは 1 本で足りる。
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
      現在の運用状態を取得できませんでした。
    </p>

    <template v-else>
      <BaseCard title="障害時の運用制御">
        <template #header-actions>
          <div class="incident__head-meta">
            <span class="incident__head-note">障害時のみ使用します。</span>
            <span :class="['incident__state', { 'is-stopped': isStopped }]">
              <span class="incident__state-label">現在の運用状態</span>
              <strong class="incident__state-value" data-testid="incidents-state">
                {{ status.operationStateName }}
              </strong>
            </span>
          </div>
        </template>

        <p class="incident__intro">
          <strong>制御対象を分けて判断します。</strong><br />
          {{ INTRO_TEXT }}
        </p>

        <div class="incident__controls">
          <section class="incident__control">
            <h2 class="incident__control-title">IB送信制御</h2>
            <p class="incident__control-note">
              注文情報の入力・記録は継続し、IBへの送信だけを制御します。
            </p>
            <BaseButton
              variant="secondary"
              block
              data-testid="incidents-control-ib-send"
              @click="openDialog('ib-send')"
            >
              IB送信を制御
            </BaseButton>
          </section>

          <section class="incident__control">
            <h2 class="incident__control-title">注文入力制御</h2>
            <p class="incident__control-note">
              新規の注文入力を受け付けない状態へ切り替えるための制御です。
            </p>
            <BaseButton
              variant="secondary"
              block
              data-testid="incidents-control-order-entry"
              @click="openDialog('order-entry')"
            >
              注文入力を制御
            </BaseButton>
          </section>
        </div>
      </BaseCard>

      <!-- 表を全幅で載せるときだけ flush。0 件の一行は本文余白の中に置きたいので付けない -->
      <BaseCard title="障害対応履歴" :flush="hasHistories">
        <template #header-actions>
          <span class="incident__head-note">新しい順</span>
        </template>

        <DataTable
          v-if="hasHistories"
          flat
          data-testid="incidents-history"
          :columns="historyColumns"
          :rows="histories"
        >
          <template #cell-changedAt="{ value }">{{ formatDateTime(value) }}</template>
        </DataTable>

        <p v-else data-testid="incidents-history-empty" class="incident__history-empty">
          現段階では制御ボタンの表示のみです。障害対応履歴は詳細な状態遷移の実装後に記録します。
        </p>
      </BaseCard>
    </template>

    <!--
      ダイアログはチェーンの外。BaseModal 自身が v-if="open" を持つので、
      ここは open だけで制御する。
    -->
    <IncidentControlDialog
      :open="dialogIntent !== null"
      :intent="dialogIntent"
      @close="closeDialog"
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

/* カードヘッダ右。注意書きと現在の運用状態を並べる */
.incident__head-meta {
  display: flex;
  align-items: center;
  gap: var(--space-4);
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

/* 通常運用以外は危険色で強調する（モックの .operation-state-summary strong.stop 相当） */
.incident__state.is-stopped {
  background-color: var(--color-danger-bg);
  border-color: var(--color-danger-border);
}

.incident__state.is-stopped .incident__state-value {
  color: var(--color-danger-text);
}

/* モックの .incident-intro 相当。淡い面の説明バナー */
.incident__intro {
  padding: var(--space-3) var(--space-4);
  color: var(--color-text-muted);
  background-color: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  line-height: 1.65;
}

.incident__intro strong {
  color: var(--color-text-heading);
  font-weight: 600;
}

.incident__controls {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
  margin-top: var(--space-4);
}

@media (max-width: 900px) {
  .incident__controls {
    grid-template-columns: 1fr;
  }
}

.incident__control {
  display: flex;
  flex-direction: column;
  padding: var(--space-4);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.incident__control-title {
  color: var(--color-text-heading);
  font-size: var(--font-size-md);
  font-weight: 600;
}

/* ボタンを下端でそろえたいので、説明文で残りの高さを埋める */
.incident__control-note {
  flex: 1;
  margin: var(--space-1) 0 var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  line-height: 1.6;
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
