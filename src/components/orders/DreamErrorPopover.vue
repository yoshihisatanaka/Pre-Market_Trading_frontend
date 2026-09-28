<script setup>
/**
 * Dream 連携エラーの詳細を、状況の文字にホバー / フォーカスしたときだけ出すポップアップ。
 * 画面モック（dream_registration_status.html）の .dream-error-trigger / .dream-error-popover にあたる。
 * 触れる対象（「登録失敗」などの文字）は既定スロットに差す。
 *
 * モックは CSS だけで真上に絶対配置しているが、一覧は DataTable の横スクロール枠
 * （overflow-x: auto。縦方向も切り取られる）の中にあるので、そのままでは 1 行目の
 * ポップアップが枠の上端で切れる。そこで本文は body へ Teleport し、fixed でトリガの真上
 * （上に入らなければ真下）へ置く。開いている間にどこかがスクロールしたら位置がずれるので閉じる。
 *
 * 本文は閉じていても DOM に残す（v-show）。トリガの aria-describedby の参照先を消さないため。
 *
 * 出す data-testid:
 *   dream-status-error-trigger / dream-status-error-popover
 */
import { nextTick, onBeforeUnmount, ref, useId } from 'vue'

defineProps({
  /** ポップアップの見出し（「Dream登録エラー詳細」など） */
  title: {
    type: String,
    required: true,
  },
  /** エラーの本文。空のときは確認を促す定型文を出す */
  message: {
    type: String,
    default: '',
  },
})

/** トリガとポップアップの間隔・画面端との余白（px） */
const GAP = 8

const popoverId = useId()
const open = ref(false)
const trigger = ref(null)
const popover = ref(null)
const position = ref({ top: 0, left: 0, placement: 'top' })

async function show() {
  if (open.value) return
  open.value = true
  // 表示されてからでないと高さが測れない
  await nextTick()
  place()
  // capture で受けるのは、一覧の横スクロール枠のようなページ以外のスクロールも拾うため
  window.addEventListener('scroll', hide, true)
  window.addEventListener('resize', hide)
}

function place() {
  if (!trigger.value || !popover.value) return

  const rect = trigger.value.getBoundingClientRect()
  const { offsetHeight: height, offsetWidth: width } = popover.value
  const fitsAbove = rect.top - GAP - height >= 0

  position.value = {
    top: fitsAbove ? rect.top - GAP - height : rect.bottom + GAP,
    // 右端では画面の内側へ押し戻す（左端は押し戻さない。トリガより左へずらすと矢印が外れる）
    left: Math.max(GAP, Math.min(rect.left, window.innerWidth - width - GAP)),
    placement: fitsAbove ? 'top' : 'bottom',
  }
}

function hide() {
  open.value = false
  window.removeEventListener('scroll', hide, true)
  window.removeEventListener('resize', hide)
}

onBeforeUnmount(hide)
</script>

<template>
  <span
    ref="trigger"
    class="dream-error-popover__trigger"
    tabindex="0"
    :aria-describedby="popoverId"
    data-testid="dream-status-error-trigger"
    @mouseenter="show"
    @mouseleave="hide"
    @focus="show"
    @blur="hide"
    @keydown.esc="hide"
  >
    <slot />

    <Teleport to="body">
      <span
        v-show="open"
        :id="popoverId"
        ref="popover"
        role="tooltip"
        :class="['dream-error-popover', `is-${position.placement}`]"
        :style="{ top: `${position.top}px`, left: `${position.left}px` }"
        data-testid="dream-status-error-popover"
      >
        <span class="dream-error-popover__title">{{ title }}</span>
        {{ message || 'エラー内容を確認してください。' }}
      </span>
    </Teleport>
  </span>
</template>

<style scoped>
/* 触れられることが判るよう、ヘルプのカーソルと点線の下線を付ける */
.dream-error-popover__trigger {
  cursor: help;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
  outline: none;
}

.dream-error-popover__trigger:focus-visible {
  border-radius: 2px;
  box-shadow: var(--shadow-focus-ring);
}

/* 本文。モックの 300px 幅・12px・行間 1.55 に合わせる */
.dream-error-popover {
  position: fixed;
  z-index: 1100;
  display: block;
  width: 300px;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-danger-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface);
  box-shadow: var(--shadow-modal);
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-weight: 400;
  line-height: 1.55;
  white-space: normal;
  pointer-events: none;
}

/* トリガを指す矢印。上に出すときは下辺、下に出すときは上辺に付ける */
.dream-error-popover::before {
  content: '';
  position: absolute;
  left: var(--space-4);
  width: 10px;
  height: 10px;
  background-color: var(--color-surface);
  border: solid var(--color-danger-border);
  transform: rotate(45deg);
}

.dream-error-popover.is-top::before {
  bottom: -6px;
  border-width: 0 1px 1px 0;
}

.dream-error-popover.is-bottom::before {
  top: -6px;
  border-width: 1px 0 0 1px;
}

.dream-error-popover__title {
  display: block;
  margin-bottom: var(--space-1);
  color: var(--color-danger-text);
  font-size: var(--font-size-xs);
  font-weight: 600;
}
</style>
