<script setup>
/**
 * 前面に重ねる小さなダイアログ（マスタの新規追加・削除確認など）。
 * 開閉は呼び出し側が open で持ち、閉じる操作（オーバーレイのクリック / Esc / 閉じるボタン）は
 * close イベントで伝える。この部品自身は状態を持たない。
 *
 * size='sm' は削除確認のような本文の短いダイアログ用。
 * size='lg' は入力項目の多い登録・編集（顧客マスタなど）用。本文が画面の高さを超えたら
 * 箱の中でスクロールする（見出しとフッタのボタンは常に見えるまま）。
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
    validator: (value) => ['lg', 'md', 'sm'].includes(value),
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

        <!-- 本文だけがスクロールする（見出しとフッタのボタンを画面外へ押し出さない） -->
        <div class="modal__body">
          <slot />
        </div>

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
  display: flex;
  flex-direction: column;
  width: 100%;
  /* 外側の .modal の余白（上下）を引いた高さに収める。超えた分は本文がスクロールする */
  max-height: calc(100vh - 2 * var(--space-4));
  padding: var(--space-6);
  background-color: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-modal);
}

.modal__body {
  min-height: 0;
  overflow-y: auto;
}

.modal__box--lg {
  max-width: 960px;
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
