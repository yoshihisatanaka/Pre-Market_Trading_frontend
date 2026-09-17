<script setup>
/**
 * ロール 1 件の権限チェック 5 行（編集モーダルの中身）。
 *
 * `MasterFormDialog` の既定スロットに差す中身だけを持つ。枠・ボタン・エラーの出し先は
 * ダイアログ側の責務。項目そのものは utils/permissionTypes.js の PERMISSION_ITEMS が正で、
 * ここは並べかたと見た目だけを決める（一覧の列と食い違わないようにするための部品化）。
 *
 * 見た目は画面モックの `.permission-check` に合わせる。見出しと説明が左、チェックボックスが右、
 * 行の間に細い区切り線。BaseCheckbox は「チェック → ラベル」の並びなので、
 * ここで row-reverse にして左右を入れ替える。
 *
 * BaseCheckbox は `inheritAttrs: false` でルート（<label>）ではなく <input> に属性を回すので、
 * **class を渡しても行そのものには効かない**。並びと区切り線は :deep(.base-checkbox) で当てる。
 * 文言は <label> の中に置いてあるので、説明文をクリックしても切り替わる（モックと同じ）。
 *
 * 出す data-testid（testidPrefix が 'permissions-edit' なら permissions-edit-can-order など）。
 * 上記のとおり **付くのは <input> 自身**なので、テストからは checked をそのまま読める:
 *   {prefix}-{ハイフン区切りにした権限名}
 *
 * 単体テストは持たない。挙動は画面側の spec が編集ダイアログを通して担保する
 * （src/components/symbol/SymbolFormFields.vue と同じ扱い）。
 */
import BaseCheckbox from '@/components/ui/BaseCheckbox.vue'
import { PERMISSION_ITEMS } from '@/utils/permissionTypes'

defineProps({
  /** data-testid の接頭辞。'permissions-edit' のように操作まで含めて渡す */
  testidPrefix: {
    type: String,
    required: true,
  },
})

/*
 * 権限の値。オブジェクトごと v-model する（項目が 5 つあり、
 * 1 項目 1 model にすると呼び出し側が 5 本の ref を並べることになるため）。
 * キーは PERMISSION_ITEMS と同じ。
 */
const form = defineModel({ type: Object, required: true })

/** canOrder → can-order。data-testid をケバブケースに揃える */
function testid(prefix, name) {
  return `${prefix}-${name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`
}
</script>

<template>
  <div class="permission-check-list">
    <BaseCheckbox
      v-for="item in PERMISSION_ITEMS"
      :key="item.key"
      v-model="form[item.key]"
      :data-testid="testid(testidPrefix, item.key)"
    >
      <span class="permission-check-list__text">
        <strong class="permission-check-list__label">{{ item.label }}</strong>
        <span class="permission-check-list__description">{{ item.description }}</span>
      </span>
    </BaseCheckbox>
  </div>
</template>

<style scoped>
.permission-check-list {
  display: flex;
  flex-direction: column;
}

/*
 * BaseCheckbox のルートは <label>。既定は inline-flex なので、幅いっぱいの flex に直したうえで
 * row-reverse にしてチェックボックスを右端へ送り、余りをテキスト側に渡す
 * （モックの .permission-check と同じ並び）。class は <input> に回ってしまうので :deep で指す。
 */
.permission-check-list :deep(.base-checkbox) {
  display: flex;
  flex-direction: row-reverse;
  justify-content: space-between;
  padding: var(--space-3) 0;
  border-top: 1px solid var(--color-border);
}

.permission-check-list :deep(.base-checkbox:first-child) {
  border-top: none;
}

.permission-check-list__text {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.permission-check-list__label {
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: 600;
}

.permission-check-list__description {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}
</style>
