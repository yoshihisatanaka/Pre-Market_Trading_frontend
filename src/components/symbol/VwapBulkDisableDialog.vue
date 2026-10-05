<script setup>
/**
 * 「VWAP対象を一括で対象外へ」の確認ダイアログ。
 *
 * 画面モックは `confirm()`（「VWAP対象の銘柄をすべて対象外へ変更します。通常注文の取引可否は
 * 変更しません。よろしいですか？」）だけだが、実 API には事前確認（dry-run）があり、
 * 何件・どの銘柄が変わるかを実行前に見せられる。ブラウザの confirm は E2E でも支援技術でも
 * 扱いづらいので、他のマスタと同じ BaseModal で出す。
 *
 * 開閉は呼び出し側が open で持ち、この部品は状態を持たない。事前確認の結果（preview）も
 * 呼び出し側（ストア）が持つ。出し分けは 4 つ:
 *   previewing        … 回転マークだけ（件数を取りに行っている）
 *   previewError      … 事前確認の失敗。実行ボタンは押せない
 *   preview.targetCount === 0 … 変える銘柄が無い。実行ボタンは押せない
 *   それ以外          … 件数と銘柄の一覧を出し、実行できる
 *
 * 出す data-testid（testidPrefix が 'symbols' なら symbols-vwap-bulk-count など）:
 *   {prefix}-vwap-bulk-dialog / {prefix}-vwap-bulk-preview-error / {prefix}-vwap-bulk-error
 *   / {prefix}-vwap-bulk-count / {prefix}-vwap-bulk-list / {prefix}-vwap-bulk-empty
 *   / {prefix}-vwap-bulk-cancel / {prefix}-vwap-bulk-submit
 *
 * 単体テストは持たない。挙動は `src/views/SymbolListView.spec.js`（STV）が
 * 画面を通して担保する（SymbolFormFields と同じ扱い）。
 */
import { computed } from 'vue'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'

const props = defineProps({
  open: {
    type: Boolean,
    required: true,
  },
  testidPrefix: {
    type: String,
    required: true,
  },
  /** 事前確認の結果（src/api/symbols.js の VwapTargetBulkResult）。取得前・失敗時は null */
  preview: {
    type: Object,
    default: null,
  },
  /** 事前確認の実行中 */
  previewing: {
    type: Boolean,
    default: false,
  },
  /** 事前確認の失敗（ApiError） */
  previewError: {
    type: Object,
    default: null,
  },
  /** 本実行の実行中。true のあいだはキャンセルもできない（結果の行き先が無くなるため） */
  pending: {
    type: Boolean,
    default: false,
  },
  /** 本実行の失敗（ApiError）。ダイアログ内に出す */
  error: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['close', 'confirm'])

const targetCount = computed(() => props.preview?.targetCount ?? 0)

/** 実行できるのは、事前確認が済んでいて変える銘柄が 1 件以上あるときだけ */
const canSubmit = computed(
  () => !props.previewing && !props.previewError && props.preview !== null && targetCount.value > 0,
)
</script>

<template>
  <BaseModal :open="open" title="VWAP対象を一括で対象外へ" size="sm" @close="emit('close')">
    <!--
      data-testid は BaseModal ではなく本文のラッパに付ける。BaseModal のルートは Teleport
      （フラグメント）なので属性が継承されない（MasterFormDialog が内側の form に付けているのと同じ理由）
    -->
    <div :data-testid="`${testidPrefix}-vwap-bulk-dialog`">
      <BaseAlert v-if="error" variant="error" :data-testid="`${testidPrefix}-vwap-bulk-error`">
        {{ error.message }}
      </BaseAlert>

      <!-- 文言は画面モックの confirm() のとおり。取引可否には触れないことを明記する -->
      <p>VWAP対象の銘柄をすべて対象外へ変更します。通常注文の取引可否は変更しません。</p>

    <p v-if="previewing" class="vwap-bulk-dialog__status">
      <BaseSpinner size="sm" label="対象の件数を確認中" />
    </p>

    <BaseAlert
      v-else-if="previewError"
      variant="error"
      :data-testid="`${testidPrefix}-vwap-bulk-preview-error`"
    >
      {{ previewError.message }}
    </BaseAlert>

    <template v-else-if="preview">
      <p
        v-if="targetCount === 0"
        class="vwap-bulk-dialog__status"
        :data-testid="`${testidPrefix}-vwap-bulk-empty`"
      >
        対象外へ変更する銘柄はありません（VWAP対象の銘柄が無い）。
      </p>
      <template v-else>
        <p class="vwap-bulk-dialog__count" :data-testid="`${testidPrefix}-vwap-bulk-count`">
          対象 <strong>{{ targetCount }}</strong> 件（有効な銘柄 {{ preview.candidateCount }} 件中）
        </p>
        <!-- 件数だけでは何が変わるか分からないので、変わる銘柄を並べる（本文がスクロールする） -->
        <ul class="vwap-bulk-dialog__list" :data-testid="`${testidPrefix}-vwap-bulk-list`">
          <li v-for="symbol in preview.symbols" :key="symbol.id">
            <span class="vwap-bulk-dialog__code">{{ symbol.symbolCode || '—' }}</span>
            <span class="vwap-bulk-dialog__ticker">{{ symbol.ticker || '—' }}</span>
            <span>{{ symbol.name || '—' }}</span>
          </li>
        </ul>
      </template>
    </template>
    </div>

    <template #footer>
      <BaseButton
        variant="secondary"
        :data-testid="`${testidPrefix}-vwap-bulk-cancel`"
        :disabled="pending"
        @click="emit('close')"
      >
        キャンセル
      </BaseButton>
      <BaseButton
        :data-testid="`${testidPrefix}-vwap-bulk-submit`"
        :disabled="pending || !canSubmit"
        :loading="pending"
        @click="emit('confirm')"
      >
        {{ pending ? '変更中…' : '対象外にする' }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.vwap-bulk-dialog__status {
  margin-top: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.vwap-bulk-dialog__count {
  margin-top: var(--space-3);
}

.vwap-bulk-dialog__list {
  margin: var(--space-2) 0 0;
  padding: 0;
  list-style: none;
  font-size: var(--font-size-sm);
}

.vwap-bulk-dialog__list li {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-1) 0;
  border-top: 1px solid var(--color-border);
}

.vwap-bulk-dialog__code {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.vwap-bulk-dialog__ticker {
  font-weight: 600;
}
</style>
