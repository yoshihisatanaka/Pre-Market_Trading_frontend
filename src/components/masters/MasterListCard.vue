<script setup>
/**
 * マスタ一覧のカード。件数の表示と「ローディング / エラー / 空 / データあり」の
 * 4 状態の出し分け、そしてページャーまでを持つ。
 *
 * 表そのものは既定スロットに差す（呼び出し側が DataTable を置く）。列の定義・セルの整形・
 * 行ごとの操作ボタンは画面の内容そのものなので、この部品には通さない。
 * 既定スロットが描かれるのは「データあり」のときだけなので、
 * 呼び出し側は行が 0 件かどうかを気にしなくてよい。
 *
 * 出す data-testid（testidPrefix が 'market-holidays' なら market-holidays-count など）:
 *   {prefix}-count / {prefix}-loading / {prefix}-error / {prefix}-empty / {prefix}-pagination
 *
 * @see MasterSearchCard 検索条件のカード（4 状態の外に置く）
 */
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BasePagination from '@/components/ui/BasePagination.vue'

defineProps({
  testidPrefix: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  /** 空状態の文言。「該当する〈対象〉はありません。」の形にする */
  emptyMessage: {
    type: String,
    required: true,
  },
  total: {
    type: Number,
    required: true,
  },
  limit: {
    type: Number,
    required: true,
  },
  offset: {
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

const emit = defineEmits(['reload', 'update:offset'])
</script>

<template>
  <BaseCard :title="title" flush>
    <template #header-actions>
      <!-- 「56 件」を 1 つのテキストとして読ませたいので、数字と単位を改行で分けない -->
      <span class="master-list-card__count" :data-testid="`${testidPrefix}-count`">
        {{ total }} 件
      </span>
    </template>

    <!-- ローディング / エラー / 空 / データあり の 4 状態 -->
    <p v-if="loading" :data-testid="`${testidPrefix}-loading`" class="master-list-card__status">
      読み込み中…
    </p>

    <div
      v-else-if="error"
      :data-testid="`${testidPrefix}-error`"
      class="master-list-card__status is-error"
    >
      <p>{{ error.message }}</p>
      <BaseButton variant="secondary" @click="emit('reload')">再試行</BaseButton>
    </div>

    <p v-else-if="isEmpty" :data-testid="`${testidPrefix}-empty`" class="master-list-card__status">
      {{ emptyMessage }}
    </p>

    <template v-else>
      <slot />

      <BasePagination
        :data-testid="`${testidPrefix}-pagination`"
        :total="total"
        :limit="limit"
        :offset="offset"
        :disabled="loading"
        @update:offset="emit('update:offset', $event)"
      />
    </template>
  </BaseCard>
</template>

<style scoped>
.master-list-card__count {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.master-list-card__status {
  padding: var(--space-5);
  color: var(--color-text-muted);
}

.master-list-card__status.is-error {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--color-danger);
}
</style>
