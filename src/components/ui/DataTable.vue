<script setup>
/**
 * 汎用テーブル。ドメイン知識を持たせないこと（注文固有の表示は呼び出し側の slot で行う）。
 * 列ごとの見た目を変えたいときは `cell-<列key>` の slot を使う。
 */
const props = defineProps({
  columns: {
    type: Array,
    required: true,
  },
  rows: {
    type: Array,
    required: true,
  },
  rowKey: {
    type: String,
    default: 'id',
  },
  // カード（BaseCard flush）の中に敷くとき、枠線・角丸・影が二重になるのを避ける
  flat: {
    type: Boolean,
    default: false,
  },
  /*
   * 行ごとに足すクラス。`(row) => string | string[] | object` の関数で渡す
   * （Vue の :class に渡せる形ならそのまま使える）。
   *
   * 「どの行を目立たせるか」は画面ごとのドメイン知識なので、判定も見た目も呼び出し側に置く。
   * ここが受け取るのはクラス名だけで、この部品は条件を一切知らない。
   */
  rowClass: {
    type: Function,
    default: null,
  },
  /*
   * 行全体をクリックできるようにする。押された行を `row-click` で渡すだけで、
   * どこへ移るかは呼び出し側が決める。キーボードでも辿れるよう行にフォーカスが乗り、Enter でも発火する。
   * 行の中にボタンやリンクを置く表では使わない（押下が行にも伝わって二重に動く）。
   */
  clickable: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['row-click'])

function onRowClick(row) {
  if (props.clickable) emit('row-click', row)
}

// セルの中身からのキー入力は拾わない（行そのものにフォーカスがあるときだけ）
function onRowEnter(event, row) {
  if (event.target === event.currentTarget) onRowClick(row)
}
</script>

<template>
  <div :class="['data-table', { 'is-flat': flat }]">
    <table>
      <thead>
        <tr>
          <th v-for="column in columns" :key="column.key" :class="{ 'is-numeric': column.numeric }">
            {{ column.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row[rowKey]"
          :class="[rowClass ? rowClass(row) : null, { 'is-clickable': clickable }]"
          :tabindex="clickable ? 0 : undefined"
          data-testid="data-table-row"
          @click="onRowClick(row)"
          @keydown.enter="onRowEnter($event, row)"
        >
          <td v-for="column in columns" :key="column.key" :class="{ numeric: column.numeric }">
            <slot :name="`cell-${column.key}`" :row="row" :value="row[column.key]">
              {{ row[column.key] }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.data-table {
  overflow-x: auto;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
}

.data-table.is-flat {
  border: none;
  border-radius: 0;
  box-shadow: none;
}

th,
td {
  padding: var(--space-3) var(--space-4);
  text-align: left;
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}

th {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-muted);
  background-color: var(--color-surface-muted);
}

th.is-numeric {
  text-align: right;
}

tbody tr:last-child td {
  border-bottom: none;
}

/*
 * 行ホバー。モック（docs/mock/ の `tr:hover td`）に合わせ、背景だけを一段沈ませる。
 * transition は付けない。カーソルは clickable の行だけ指にする（モックの `cursor:pointer`）。
 * tr ではなく td に塗るのもモックと同じ。ただしこれは行ごとの色
 * （呼び出し側が :deep で当てる tr.is-user-modified など）をホバー中だけ隠すので、
 * 行に色を付けている画面は、そのホバー色も対で指定すること。
 */
tbody tr:hover td {
  background-color: var(--color-surface-muted);
}

tbody tr.is-clickable {
  cursor: pointer;
}

/* キーボードで行に乗ったときだけ見せる（マウスのクリックでは出さない） */
tbody tr.is-clickable:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}
</style>
