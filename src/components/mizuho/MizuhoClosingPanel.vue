<script setup>
/**
 * みずほ注文締めのカード（画面の先頭に置く大きな状態表示と操作ボタン）。
 *
 * 締め状態の「ローディング / エラー / 空 / データあり」の 4 状態はこのカードの中で出し分ける。
 * 約定一覧とは取得が別なので、締め状態が読めなくても一覧は見られるままにする（逆も同じ）。
 *
 * 操作は emit するだけで、確認ダイアログも処理も呼び出し側が持つ。
 *   close           … 「みずほ注文締め」（受付中のとき）
 *   reopen          … 「締め解除」（締め済のとき）
 *   create-order-file … 「注文ファイル作成」。締め済のときだけ押せる
 *                     （実 API も未締めの基準日には出力できない。400）
 *   reload          … エラーからの再試行
 *
 * 出す data-testid:
 *   mizuho-closing / -loading / -error / -empty / -state / -order-file / -close / -reopen
 *   / -history-row / -history-empty
 */
import { computed } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import { formatDateTime } from '@/utils/format'

const props = defineProps({
  /** src/api/closing.js の ClosingStatus。読めていなければ null */
  status: {
    type: Object,
    default: null,
  },
  loading: {
    type: Boolean,
    required: true,
  },
  isEmpty: {
    type: Boolean,
    required: true,
  },
  /** 取得に失敗した理由（ApiError）。message をそのまま出せる */
  error: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['close', 'reopen', 'create-order-file', 'reload'])

const closed = computed(() => Boolean(props.status?.closed))

/*
 * 状態の語と説明は画面モックに合わせる。サーバの 締め状態名 は使わない（src/api/closing.js）。
 * 締め済の説明はモックに無いので、注文ファイル作成の条件（締め済のときだけ出力できる）を書く。
 */
const stateLabel = computed(() => (closed.value ? '締め済' : '受付中'))
const stateDescription = computed(() =>
  closed.value
    ? '本日のみずほ注文の受付を締めています。注文ファイルを作成できます'
    : '現在、みずほ注文の受付状態です',
)

/*
 * 状態変更履歴。実 API は最後の 1 回の変更（更新日時 / 実行者）しか返さないので 1 行だけ出す。
 * 何をしたかは今の状態から決まる（締め済なら最後の変更は締め、受付中なら締め解除）。
 */
const historyAction = computed(() => (closed.value ? '締め実行' : '締め解除'))

/*
 * カードの色は「データあり」のときだけ状態で変える（読めていない間は中立の色）。
 * 再試行に失敗したときも、前回読めた status が残っているので loading だけでなく error も見る
 */
const cardClass = computed(() => ({
  'is-closed': !props.loading && !props.error && closed.value,
}))
</script>

<template>
  <section
    :class="['mizuho-closing', cardClass]"
    aria-label="みずほ注文締め管理"
    data-testid="mizuho-closing"
  >
    <!-- ローディング / エラー / 空 / データあり の 4 状態 -->
    <p
      v-if="loading"
      data-testid="mizuho-closing-loading"
      class="mizuho-closing__status is-loading"
    >
      <BaseSpinner />
    </p>

    <div
      v-else-if="error"
      data-testid="mizuho-closing-error"
      class="mizuho-closing__status is-error"
    >
      <p>{{ error.message }}</p>
      <BaseButton variant="secondary" @click="emit('reload')">再試行</BaseButton>
    </div>

    <p v-else-if="isEmpty" data-testid="mizuho-closing-empty" class="mizuho-closing__status">
      みずほ注文の締め状態を取得できませんでした。
    </p>

    <template v-else>
      <div class="mizuho-closing__main">
        <div>
          <p class="mizuho-closing__label">みずほ注文締め</p>
          <p class="mizuho-closing__state" data-testid="mizuho-closing-state">{{ stateLabel }}</p>
          <p class="mizuho-closing__description">{{ stateDescription }}</p>
        </div>

        <div class="mizuho-closing__actions">
          <!-- 押せるのは締め済のときだけ（モックどおり） -->
          <BaseButton
            class="mizuho-closing__action is-mizuho"
            data-testid="mizuho-closing-order-file"
            :disabled="!closed"
            @click="emit('create-order-file')"
          >
            注文ファイル作成
          </BaseButton>

          <BaseButton
            v-if="closed"
            variant="danger"
            class="mizuho-closing__action"
            data-testid="mizuho-closing-reopen"
            @click="emit('reopen')"
          >
            締め解除
          </BaseButton>
          <BaseButton
            v-else
            class="mizuho-closing__action is-mizuho"
            data-testid="mizuho-closing-close"
            @click="emit('close')"
          >
            みずほ注文締め
          </BaseButton>
        </div>
      </div>

      <div class="mizuho-closing__history">
        <p class="mizuho-closing__history-title">状態変更履歴</p>
        <p
          v-if="status.updatedAt"
          class="mizuho-closing__history-row"
          data-testid="mizuho-closing-history-row"
        >
          <strong>{{ formatDateTime(status.updatedAt) }}</strong>
          <span>{{ historyAction }}</span>
          <span>{{ status.operator || '—' }}</span>
        </p>
        <p v-else class="mizuho-closing__history-row" data-testid="mizuho-closing-history-empty">
          状態変更履歴はありません
        </p>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* モックの .mizuho-close-card。受付中は中立、締め済は危険色の淡色面で囲む */
.mizuho-closing {
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.mizuho-closing.is-closed {
  border-color: var(--color-danger-border);
}

.mizuho-closing__main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
  min-height: 88px;
  padding: var(--space-4) var(--space-5);
  background-color: var(--color-surface-muted);
}

.mizuho-closing.is-closed .mizuho-closing__main {
  background-color: var(--color-danger-bg);
}

.mizuho-closing__label {
  color: var(--color-label);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.mizuho-closing__state {
  margin-top: var(--space-1);
  color: var(--color-text-heading);
  font-size: var(--font-size-xl);
  font-weight: 700;
  line-height: 1.2;
}

.mizuho-closing.is-closed .mizuho-closing__state {
  color: var(--color-danger-text);
}

.mizuho-closing__description {
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.mizuho-closing__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
}

/*
 * モックの大きな操作ボタン（幅 184px・高さ 44px・太字）。
 * 「みずほ注文締め」と「注文ファイル作成」はモックの色で塗る（BaseButton の primary を上書き）。
 * 押せないときも BaseButton の半透明ではなく、モックの淡色面と灰色の文字で出す。
 * 締め解除の色は BaseButton の variant に任せる
 */
.mizuho-closing__action {
  min-width: 184px;
  min-height: 44px;
  font-weight: 700;
}

.mizuho-closing__action.is-mizuho {
  background-color: var(--color-mizuho-action);
  color: var(--color-mizuho-action-text);
}

.mizuho-closing__action.is-mizuho:hover:not(:disabled) {
  background-color: var(--color-mizuho-action-hover);
}

.mizuho-closing__action.is-mizuho:disabled {
  background-color: var(--color-mizuho-action-disabled);
  color: var(--color-mizuho-action-disabled-text);
  opacity: 1;
}

.mizuho-closing__history {
  padding: var(--space-2) var(--space-5);
  border-top: 1px solid var(--color-border);
}

.mizuho-closing__history-title {
  margin-bottom: var(--space-1);
  color: var(--color-label);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.mizuho-closing__history-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: 1.7;
}

.mizuho-closing__history-row strong {
  color: var(--color-text);
  font-weight: 600;
}

/* 締め状態を読めていない間の表示。カードの枠の中に置く */
.mizuho-closing__status {
  padding: var(--space-5);
  color: var(--color-text-muted);
}

.mizuho-closing__status.is-loading {
  display: flex;
  justify-content: center;
}

.mizuho-closing__status.is-error {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--color-danger);
}

/* 狭い画面ではボタンを状態表示の下に縦に積む（モックの @media (max-width: 700px)） */
@media (max-width: 700px) {
  .mizuho-closing__main,
  .mizuho-closing__actions {
    flex-direction: column;
    align-items: stretch;
  }

  .mizuho-closing__action {
    width: 100%;
  }
}
</style>
