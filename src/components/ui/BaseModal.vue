<script setup>
/**
 * 前面に重ねる小さなダイアログ（マスタの新規追加・削除確認など）。
 * 開閉は呼び出し側が open で持ち、閉じる操作（オーバーレイのクリック / Esc / 閉じるボタン）は
 * close イベントで伝える。この部品自身は状態を持たない。
 *
 * size='sm' は削除確認のような本文の短いダイアログ用。
 */
import { onBeforeUnmount, watch } from 'vue'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: '',
  },
  size: {
    type: String,
    default: 'md',
    validator: (value) => ['md', 'sm'].includes(value),
  },
})

const emit = defineEmits(['close'])

function onKeydown(event) {
  if (event.key === 'Escape') emit('close')
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) document.addEventListener('keydown', onKeydown)
    else document.removeEventListener('keydown', onKeydown)
  },
  { immediate: true },
)

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal" role="presentation" @click.self="emit('close')">
      <div
        :class="['modal__box', `modal__box--${size}`]"
        role="dialog"
        aria-modal="true"
        :aria-label="title || undefined"
      >
        <p v-if="title" class="modal__title">{{ title }}</p>

        <slot />

        <footer v-if="$slots.footer" class="modal__footer">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  background-color: var(--color-overlay);
}

.modal__box {
  width: 100%;
  padding: var(--space-6);
  background-color: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-modal);
}

.modal__box--md {
  max-width: 520px;
}

.modal__box--sm {
  max-width: 400px;
}

.modal__title {
  margin-bottom: var(--space-5);
  color: var(--color-text-heading);
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
</style>
