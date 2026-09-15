<script setup>
/**
 * マスタ一覧の検索カード。
 *
 * 検索条件の入力欄（FormField 群）は既定スロットに差す。条件の種類も件数も画面ごとに
 * 違うので、この部品は FormGrid の器と「検索 / クリア」のボタン列だけを持つ。
 *
 * このカードは一覧の 4 状態の外に置く（0 件やエラーのときこそ条件を直したいので消さない）。
 *
 * 出す data-testid（testidPrefix が 'market-holidays' なら market-holidays-search など）:
 *   {prefix}-search（form） / {prefix}-search-submit / {prefix}-search-clear
 *   / {prefix}-options-loading（optionsLoading のときだけ）
 *
 * @see MasterListCard 検索結果を出す一覧カード
 */
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import FormGrid from '@/components/ui/FormGrid.vue'

defineProps({
  testidPrefix: {
    type: String,
    required: true,
  },
  /** 入力欄を並べる列数。既定の 4 は画面モックの検索フォームに合わせた値 */
  columns: {
    type: Number,
    default: 4,
  },
  /** 読み込み中は検索もクリアも押せないようにする（loading を渡す） */
  disabled: {
    type: Boolean,
    default: false,
  },
  /*
   * 選択肢（コードマスタ）の取得中。入力欄ごと無効にして回転マークを出す。
   *
   * disabled と分けてあるのは意味が違うため。disabled は一覧の取得中で、そのあいだも
   * 条件は入力できてよい。こちらは「選択肢がまだ無い」状態なので、選び直しても
   * 空のプルダウンしか出せない。
   */
  optionsLoading: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['submit', 'clear'])
</script>

<template>
  <BaseCard>
    <form :data-testid="`${testidPrefix}-search`" @submit.prevent="emit('submit')">
      <!-- fieldset の disabled は中の入力すべてに効くので、slot の中身に手を入れずに済む -->
      <fieldset class="master-search-card__fields" :disabled="optionsLoading">
        <FormGrid :columns="columns">
          <slot />
        </FormGrid>
      </fieldset>

      <div class="master-search-card__actions">
        <BaseButton
          type="submit"
          :data-testid="`${testidPrefix}-search-submit`"
          :disabled="disabled || optionsLoading"
        >
          検索
        </BaseButton>
        <BaseButton
          variant="secondary"
          :data-testid="`${testidPrefix}-search-clear`"
          :disabled="disabled || optionsLoading"
          @click="emit('clear')"
        >
          クリア
        </BaseButton>

        <BaseSpinner
          v-if="optionsLoading"
          size="sm"
          label="選択肢を読み込み中"
          :data-testid="`${testidPrefix}-options-loading`"
        />
      </div>
    </form>
  </BaseCard>
</template>

<style scoped>
/* fieldset は入力をまとめて無効にするためだけに置く。既定の枠線・余白は消す */
.master-search-card__fields {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.master-search-card__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
</style>
