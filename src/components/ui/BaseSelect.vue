<script setup>
/**
 * 選択入力。options は `{ value, label, disabled?, group? }` の配列で渡す。
 * placeholder を渡すと、空値の選択肢が先頭に入る（モックの「-- 全部店 --」相当）。
 * variant / invalid の意味は BaseInput と同じ。
 *
 * disabled を付けた選択肢は見えるが選べない。group を付けた選択肢は、group が同じで隣り合うものを
 * 1 つの <optgroup>（見出しが group の文言）にまとめる（新規注文の注文区分の「Ph.1（受付対象）」など）。
 */
import { computed } from 'vue'

const props = defineProps({
  options: {
    type: Array,
    required: true,
  },
  placeholder: {
    type: String,
    default: '',
  },
  variant: {
    type: String,
    default: 'boxed',
    validator: (value) => ['boxed', 'underline'].includes(value),
  },
  invalid: {
    type: Boolean,
    default: false,
  },
})

const model = defineModel({ type: [String, Number], default: '' })

/** 隣り合う同じ group の選択肢を 1 つの塊にまとめる（group の無い選択肢は label の無い塊） */
const sections = computed(() =>
  props.options.reduce((result, option) => {
    const group = option.group ?? ''
    const last = result.at(-1)
    if (last && last.label === group) last.options.push(option)
    else result.push({ label: group, options: [option] })
    return result
  }, []),
)
</script>

<template>
  <select
    v-model="model"
    :class="['base-select', `base-select--${variant}`, { 'is-invalid': invalid }]"
    :aria-invalid="invalid || undefined"
    :data-variant="variant"
  >
    <option v-if="placeholder" value="">{{ placeholder }}</option>
    <template v-for="section in sections" :key="`${section.label}:${section.options[0].value}`">
      <optgroup v-if="section.label" :label="section.label">
        <option
          v-for="option in section.options"
          :key="option.value"
          :value="option.value"
          :disabled="option.disabled"
        >
          {{ option.label }}
        </option>
      </optgroup>
      <template v-else>
        <option
          v-for="option in section.options"
          :key="option.value"
          :value="option.value"
          :disabled="option.disabled"
        >
          {{ option.label }}
        </option>
      </template>
    </template>
  </select>
</template>

<style scoped>
.base-select {
  color: var(--color-text);
  background-color: var(--color-surface);
  outline: none;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.base-select:disabled {
  background-color: var(--color-surface-muted);
  color: var(--color-text-muted);
  cursor: not-allowed;
}

.base-select--boxed {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-input-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-md);
}

.base-select--boxed:focus {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-focus-ring);
}

.base-select--boxed.is-invalid {
  border-color: var(--color-danger);
}

.base-select--underline {
  height: 34px;
  padding: var(--space-1) var(--space-2);
  border: none;
  border-bottom: 2px solid var(--color-input-underline);
  border-radius: 0;
  background-color: transparent;
  font-size: var(--font-size-md);
}

.base-select--underline:focus {
  border-bottom-color: var(--color-primary);
}

.base-select--underline.is-invalid {
  border-bottom-color: var(--color-danger);
}
</style>
