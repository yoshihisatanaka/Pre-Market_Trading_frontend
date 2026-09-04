<script setup>
/**
 * フォーム 1 項目の器。ラベル / 必須マーク / ヒント / エラーを描き、入力そのものは slot で受ける。
 * label と入力の紐付け（id・aria-describedby・aria-invalid・required）はここが組み立て、
 * scoped slot の `field` として渡す。呼び出し側は `v-bind="field"` するだけでよい。
 *
 * layout はモックの 2 系統に対応する。
 *   stacked … ラベルを上に置く枠線ボックス様式（検索カード / モーダル）
 *   inline  … ラベルを左 150px に置く下線様式（注文入力画面）
 */
import { computed, useId } from 'vue'

const props = defineProps({
  label: {
    type: String,
    default: '',
  },
  required: {
    type: Boolean,
    default: false,
  },
  hint: {
    type: String,
    default: '',
  },
  error: {
    type: String,
    default: '',
  },
  layout: {
    type: String,
    default: 'stacked',
    validator: (value) => ['stacked', 'inline'].includes(value),
  },
})

const uid = useId()
const inputId = `${uid}-input`
const hintId = `${uid}-hint`
const errorId = `${uid}-error`

// 必須マークはモックの表記に合わせる（stacked は「*」、inline は「●」）
const requiredMark = computed(() => (props.layout === 'inline' ? '●' : '*'))

const describedBy = computed(() => {
  const ids = []
  if (props.hint) ids.push(hintId)
  if (props.error) ids.push(errorId)
  return ids.length > 0 ? ids.join(' ') : undefined
})

const field = computed(() => ({
  id: inputId,
  required: props.required,
  invalid: Boolean(props.error),
  'aria-describedby': describedBy.value,
}))
</script>

<template>
  <div :class="['form-field', `form-field--${layout}`]">
    <label v-if="label" class="form-field__label" :for="inputId">
      {{ label }}
      <span v-if="required" class="form-field__required" aria-hidden="true">{{ requiredMark }}</span>
      <span v-if="required" class="visually-hidden">（必須）</span>
    </label>

    <div class="form-field__control">
      <slot :field="field" />

      <p v-if="hint" :id="hintId" class="form-field__hint">{{ hint }}</p>
      <p v-if="error" :id="errorId" class="form-field__error" role="alert">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.form-field__label {
  color: var(--color-label);
  font-size: var(--font-size-xs);
  font-weight: 500;
}

.form-field__required {
  margin-left: var(--space-1);
  color: var(--color-danger);
}

.form-field__hint {
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.form-field__error {
  margin-top: var(--space-1);
  color: var(--color-danger-text);
  font-size: var(--font-size-xs);
}

/* ラベルを上に置く様式 */
.form-field--stacked .form-field__label {
  display: block;
  margin-bottom: var(--space-1);
}

/* ラベルを左に置く様式。ラベル幅はモックの 150px 固定 */
.form-field--inline {
  display: flex;
  align-items: center;
  min-height: 36px;
}

.form-field--inline .form-field__label {
  flex: 0 0 150px;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.form-field--inline .form-field__control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

/* ヒント / エラーは入力の横ではなく次の行に落とす */
.form-field--inline .form-field__hint,
.form-field--inline .form-field__error {
  flex-basis: 100%;
  margin-top: 0;
}
</style>
