<script setup>
/**
 * 滞留注文の一覧カード。件数の表示と「ローディング / エラー / 空 / データあり」の
 * 4 状態の出し分けを持つ。
 *
 * 表そのものは既定スロットに差す（呼び出し側が DataTable を置く）。既定スロットが
 * 描かれるのは「データあり」のときだけなので、呼び出し側は行が 0 件かどうかを気にしなくてよい。
 *
 * MasterListCard と違ってページャを持たない。滞留注文抽出の一覧はページングせず、
 * カード右肩の件数が全件だから（ページャを置くと「3 件」と「3 件中 1–3 件」が二重に出る）。
 * 画面に一覧が 2 本並ぶので、4 状態のマークアップを重複させないためにも部品にしてある。
 *
 * 出す data-testid（testidPrefix が 'stalled-order-errors' なら stalled-order-errors-count など）:
 *   {prefix}-count / {prefix}-loading / {prefix}-error / {prefix}-empty
 */
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'

defineProps({
  testidPrefix: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  /** 空状態の文言。この画面は「〜はありません」の形をモックから引き写す */
  emptyMessage: {
    type: String,
    required: true,
  },
  total: {
    type: Number,
    required: true,
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

const emit = defineEmits(['reload'])
</script>

<template>
  <BaseCard :title="title" flush>
    <template #header-actions>
      <!-- 「3 件」を 1 つのテキストとして読ませたいので、数字と単位を改行で分けない。
           取得中は出さない（確定前の件数を出すと、前回の値が新しい結果に見える） -->
      <span
        v-if="!loading"
        class="stalled-order-list-card__count"
        :data-testid="`${testidPrefix}-count`"
      >
        {{ total }} 件
      </span>
    </template>

    <!-- ローディング / エラー / 空 / データあり の 4 状態 -->
    <p
      v-if="loading"
      :data-testid="`${testidPrefix}-loading`"
      class="stalled-order-list-card__status is-loading"
    >
      <BaseSpinner />
    </p>

    <div
      v-else-if="error"
      :data-testid="`${testidPrefix}-error`"
      class="stalled-order-list-card__status is-error"
    >
      <p>{{ error.message }}</p>
      <BaseButton variant="secondary" @click="emit('reload')">再試行</BaseButton>
    </div>

    <p
      v-else-if="isEmpty"
      :data-testid="`${testidPrefix}-empty`"
      class="stalled-order-list-card__status"
    >
      {{ emptyMessage }}
    </p>

    <slot v-else />
  </BaseCard>
</template>

<style scoped>
.stalled-order-list-card__count {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

/* 空状態はモックに合わせて中央に置く（一覧の幅に対して左端の 1 行だと見落とす） */
.stalled-order-list-card__status {
  padding: var(--space-6) var(--space-5);
  color: var(--color-text-muted);
  text-align: center;
}

.stalled-order-list-card__status.is-loading {
  display: flex;
  justify-content: center;
}

.stalled-order-list-card__status.is-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  color: var(--color-danger);
}
</style>
