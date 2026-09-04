<script setup>
/**
 * 単独のチェックボックス（注文入力の「強制区分」など）。
 * label を <label> で包むので、FormField を挟まずそのまま置いてよい。
 * 複数選択のグループが要るときは、この部品を並べて呼び出し側で束ねる。
 */
defineProps({
  label: {
    type: String,
    default: '',
  },
})

// ルートは <label> なので、disabled / id などの属性は <input> 側へ回す
defineOptions({ inheritAttrs: false })

const model = defineModel({ type: Boolean, default: false })

</script>

<template>
  <label class="base-checkbox">
    <input v-model="model" type="checkbox" class="base-checkbox__input" v-bind="$attrs" />
    <span v-if="label" class="base-checkbox__label">{{ label }}</span>
    <slot />
  </label>
</template>

<style scoped>
.base-checkbox {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
}

.base-checkbox:has(.base-checkbox__input:disabled) {
  color: var(--color-text-muted);
  cursor: not-allowed;
}

.base-checkbox__input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--color-primary);
}

.base-checkbox__label {
  font-size: var(--font-size-md);
}
</style>
