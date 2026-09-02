<script setup>
/**
 * ファイル 1 件を、クリックまたはドラッグ&ドロップで選ばせる領域（CSV 一括注文の取込み口）。
 * v-model には File（未選択なら null）が入る。アップロード自体は行わない（呼び出し側の責務）。
 */
import { ref } from 'vue'

defineProps({
  accept: {
    type: String,
    default: '',
  },
  label: {
    type: String,
    default: 'クリックまたはドラッグ＆ドロップでファイルを選択',
  },
  hint: {
    type: String,
    default: '',
  },
})

const model = defineModel({ type: File, default: null })

const inputRef = ref(null)
const isDragOver = ref(false)

function openPicker() {
  inputRef.value?.click()
}

function onChange(event) {
  model.value = event.target.files?.[0] ?? null
}

function onDrop(event) {
  isDragOver.value = false
  model.value = event.dataTransfer?.files?.[0] ?? null
}
</script>

<template>
  <div
    :class="['drop-zone', { 'is-dragover': isDragOver }]"
    role="button"
    tabindex="0"
    :data-dragover="isDragOver"
    @click="openPicker"
    @keydown.enter.prevent="openPicker"
    @keydown.space.prevent="openPicker"
    @dragover.prevent="isDragOver = true"
    @dragleave="isDragOver = false"
    @drop.prevent="onDrop"
  >
    <p class="drop-zone__label">{{ model ? model.name : label }}</p>
    <p v-if="hint" class="drop-zone__hint">{{ hint }}</p>

    <input
      ref="inputRef"
      type="file"
      class="visually-hidden"
      :accept="accept"
      @change="onChange"
    />
  </div>
</template>

<style scoped>
.drop-zone {
  padding: var(--space-6) var(--space-5);
  border: 2px dashed var(--color-input-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-muted);
  text-align: center;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease;
}

.drop-zone:hover,
.drop-zone:focus-visible,
.drop-zone.is-dragover {
  border-color: var(--color-link);
  background-color: var(--color-info-bg);
}

.drop-zone__label {
  color: var(--color-text-heading);
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.drop-zone__hint {
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-md);
}
</style>
