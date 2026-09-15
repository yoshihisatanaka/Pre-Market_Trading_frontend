<script setup>
/**
 * 通信待ちを示す回転マーク。
 *
 * 色を指定する prop は持たない。輪郭を currentColor で描くので、置いた場所の文字色を
 * そのまま継承する（一覧の淡いグレー、primary ボタンの白、など）。
 *
 * label を空文字にすると role も読み上げテキストも出さず aria-hidden になる。
 * ボタンの中のように「追加中…」という別の文字が既に状態を伝えている場所で使う
 * （二重に読み上げさせないためと、ボタンの textContent を汚さないため）。
 *
 * ルート要素が span なのは、置き先の 4 状態がどれも <p> だから。ブロック要素を入れると
 * HTML パーサが <p> を強制的に閉じ、data-testid を持つ要素の外へスピナーが出てしまう
 * （jsdom と実ブラウザで挙動が違うので、単体テストではすり抜ける）。
 *
 * 将来 Playwright の toHaveScreenshot を入れるときは animations: 'disabled' が要る。
 * 無限アニメーションは、比較の前に「終了待ち」になってタイムアウトする。
 */
defineProps({
  /** sm はボタンの中、md は一覧やカードの中、lg は画面全体を覆うとき */
  size: {
    type: String,
    default: 'md',
    validator: (value) => ['sm', 'md', 'lg'].includes(value),
  },
  /** 支援技術に読ませる文言。空文字にすると読み上げ対象から外れる（上記） */
  label: {
    type: String,
    default: '読み込み中',
  },
})
</script>

<template>
  <span
    :class="['base-spinner', `base-spinner--${size}`]"
    :role="label ? 'status' : undefined"
    :aria-hidden="label ? undefined : 'true'"
  >
    <span v-if="label" class="visually-hidden">{{ label }}</span>
  </span>
</template>

<style scoped>
.base-spinner {
  --base-spinner-duration: 0.8s;

  display: inline-block;
  /* 検索カードの操作列やボタンの中（flex 行）で潰されないようにする */
  flex-shrink: 0;
  vertical-align: middle;
  border-style: solid;
  /*
   * 既定は 3 辺を currentColor で描き、1 辺だけ透かして輪郭が回っているように見せる。
   *
   * 濃い面に大きく置くときは、呼び出し側がこの 2 つの変数を差し替えて
   * 「薄い軌道＋濃い弧」にできる（AppLoadingOverlay がそうしている）。
   * 変数を渡さなければ従来どおりの見た目になる。
   */
  border-color: var(--base-spinner-track, currentColor);
  border-top-color: var(--base-spinner-arc, transparent);
  border-radius: 50%;
  animation: base-spinner-rotate var(--base-spinner-duration) linear infinite;
}

/*
 * 幅は色や余白と違ってトークンにしない（--space-* は余白の尺度で、部品の寸法ではない）。
 * border 2px と噛み合うよう偶数にする。奇数だと縁が 1px にじむ。
 */
.base-spinner--md {
  width: 16px;
  height: 16px;
  border-width: 2px;
}

.base-spinner--sm {
  width: 12px;
  height: 12px;
  border-width: 2px;
}

/*
 * 画面全体を覆うとき用（AppLoadingOverlay）。広い面の中央に 1 つだけ置くので、
 * md のままだと小さすぎて視線が止まらない。線も太さを上げないと輪郭が細く見える。
 * index.html のスプラッシュが同じ寸法を直値で持っているので、変えるときは両方直すこと。
 */
.base-spinner--lg {
  width: 48px;
  height: 48px;
  border-width: 4px;
}

@keyframes base-spinner-rotate {
  to {
    transform: rotate(1turn);
  }
}

/*
 * 動きを減らす設定でも止めない。回転そのものが「固まっていない」ことを伝えているので、
 * 静止させると停止した UI と見分けが付かなくなる。十分に遅くして負荷だけ下げる。
 */
@media (prefers-reduced-motion: reduce) {
  .base-spinner {
    --base-spinner-duration: 2.4s;
  }
}
</style>
