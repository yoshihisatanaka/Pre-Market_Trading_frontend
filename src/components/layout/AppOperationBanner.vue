<script setup>
/**
 * ヘッダ直下に全幅で出す運用バナー（GET /operations/banner）。
 *
 *   お知らせ（NOTICE）   … お知らせ管理で表示 ON にした本文。淡い青。× で閉じられる
 *   発注停止中（INCIDENT）… 障害管理の停止案内。赤。業務判断に直結するので閉じさせない
 *   何も無い・未取得・取得失敗 … 帯そのものを描かない
 *
 * どちらを出すかはサーバの判定（kind）に従い、ここでは組み立て直さない。
 * 置き場所は AppHeader と本文（main）の間。スクロールするのは本文だけなので、帯は常に見えている。
 *
 * 見た目はモック（base.html の .operation-banner）。BaseAlert は角丸の枠付きでカードの中に
 * 置く部品なので、全幅の帯には使わない。
 */
import { useOperationBanner } from '@/composables/useOperationBanner'

const { display, dismiss } = useOperationBanner()
</script>

<template>
  <div
    v-if="display"
    data-testid="operation-banner"
    :data-kind="display.kind"
    :class="['operation-banner', `operation-banner--${display.tone}`]"
    :role="display.tone === 'danger' ? 'alert' : 'status'"
  >
    <!-- アイコンライブラリは入れていない。線は AppHeader と同じ流儀（24 viewBox / stroke 2） -->
    <svg
      class="operation-banner__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path
        v-if="display.tone === 'danger'"
        d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"
      />
      <path v-else d="M13 16h-1v-4h-1m1-4h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
    </svg>

    <p class="operation-banner__body">
      <strong data-testid="operation-banner-label" class="operation-banner__label">
        {{ display.label }}
      </strong>
      <!-- pre-line で改行を生かすので、本文の前後に空白を入れないよう 1 行で書く -->
      <span data-testid="operation-banner-message" class="operation-banner__message">{{
        display.message
      }}</span>
      <span
        v-if="display.targets"
        data-testid="operation-banner-targets"
        class="operation-banner__targets"
      >
        {{ display.targets }}
      </span>
    </p>

    <!-- 面を塗らないアイコンボタン。AppHeader のメニューボタンと同じく素の button で持つ -->
    <button
      v-if="display.dismissible"
      type="button"
      data-testid="operation-banner-dismiss"
      class="operation-banner__dismiss"
      aria-label="お知らせを閉じる"
      @click="dismiss"
    >
      <svg
        class="operation-banner__dismiss-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
/*
 * モックの .operation-banner。寸法は最寄りのトークンに丸める
 * （padding 9px 24px → space-2 / space-5。左右は本文の余白と揃える、gap 10px → space-2、文字 12px → font-size-sm）。
 * 枠は下辺だけ引き、ヘッダと本文の間の区切りを兼ねる。
 */
.operation-banner {
  display: flex;
  flex-shrink: 0;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-5);
  border-bottom: 1px solid transparent;
  font-size: var(--font-size-sm);
  line-height: 1.5;
}

.operation-banner--info {
  background-color: var(--color-info-bg);
  border-bottom-color: var(--color-info-border);
  color: var(--color-info-text);
}

.operation-banner--danger {
  background-color: var(--color-danger-bg);
  border-bottom-color: var(--color-danger-border);
  color: var(--color-danger-text);
}

/* --space-* は余白の尺度なので、アイコンの寸法は直値で持つ（既存方針）。1 行目の文字の中心に合わせる */
.operation-banner__icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin-top: 1px;
}

.operation-banner__body {
  flex: 1;
  min-width: 0;
}

.operation-banner__label {
  margin-right: var(--space-2);
  font-weight: 600;
}

/* お知らせ管理の textarea で入れた改行を生かす。長い英数字は折り返す */
.operation-banner__message {
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.operation-banner__targets {
  margin-left: var(--space-2);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.operation-banner__dismiss {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border: none;
  border-radius: var(--radius-sm);
  background-color: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.75;
  transition: opacity 0.15s ease;
}

.operation-banner__dismiss:hover {
  opacity: 1;
}

.operation-banner__dismiss:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus-ring);
}

.operation-banner__dismiss-icon {
  width: 16px;
  height: 16px;
}
</style>
