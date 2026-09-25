<script setup>
/**
 * スライド式のトグル（role="switch"）。障害管理の発注停止など、ON / OFF を 1 つで切り替えるもの。
 *
 * **押しても値を変えない。** click で `toggle` を emit するだけで、ON / OFF は呼び出し側が
 * modelValue で決める。確認ダイアログで確定したときだけ状態が変わる用途のため
 * （v-model にすると、キャンセルしたのに見た目だけ切り替わる）。
 * そのため defineModel は使わない（update:modelValue を emit しない）。v-model で結ばないこと。
 *
 * 見た目のラベルは持たない。読み上げ名は label（aria-label）で必ず渡す。
 * data-testid などの属性はルートの <button> にそのまま届く。
 */
defineProps({
  /** ON か。true のときつまみが右に寄り、危険色で塗る */
  modelValue: {
    type: Boolean,
    required: true,
  },
  /** 読み上げ名（aria-label）。表の行の中に置くので「〈対象〉の〈何を〉」まで書く */
  label: {
    type: String,
    required: true,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['toggle'])
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue ? 'true' : 'false'"
    :aria-label="label"
    :disabled="disabled"
    :class="['base-switch', { 'is-on': modelValue }]"
    @click="emit('toggle')"
  >
    <span class="base-switch__thumb" aria-hidden="true" />
  </button>
</template>

<style scoped>
/* モックの .toggle-switch 相当（48×28・つまみ 24） */
.base-switch {
  position: relative;
  flex-shrink: 0;
  width: 48px;
  height: 28px;
  padding: 0;
  background-color: var(--color-input-border);
  border: none;
  border-radius: 14px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.base-switch.is-on {
  background-color: var(--color-danger);
}

.base-switch:focus-visible {
  outline: 2px solid var(--color-link);
  outline-offset: 2px;
}

.base-switch:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.base-switch__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 24px;
  height: 24px;
  background-color: var(--color-surface);
  border-radius: 50%;
  box-shadow: var(--shadow-card);
  transition: transform 0.15s ease;
}

.base-switch.is-on .base-switch__thumb {
  transform: translateX(20px);
}
</style>
