<script setup>
/**
 * 件数表示付きのページャー。ドメイン知識は持たせないこと。
 *
 * ページ番号ではなく offset を受け渡しする。URL クエリも API も offset で話しているので、
 * 「ページ番号 ↔ offset」の換算をこの部品に閉じ込められる。
 * `v-model:offset` でも `@update:offset` でも受けられる。
 */
import { computed } from 'vue'
import BaseButton from './BaseButton.vue'

const props = defineProps({
  total: {
    type: Number,
    required: true,
  },
  limit: {
    type: Number,
    default: 50,
  },
  offset: {
    type: Number,
    default: 0,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['update:offset'])

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.limit)))

// 範囲外の offset をブックマークされても壊れないよう、表示は必ず 1..pageCount に収める
const currentPage = computed(() =>
  Math.min(pageCount.value, Math.max(1, Math.floor(props.offset / props.limit) + 1)),
)

/** 「0 件」または「56 件中 1–50 件」 */
const rangeLabel = computed(() => {
  if (props.total === 0) return '0 件'
  // 範囲外の offset でもページ番号の表示と食い違わないよう、currentPage から導く
  const start = (currentPage.value - 1) * props.limit
  const first = start + 1
  const last = Math.min(start + props.limit, props.total)
  return `${props.total} 件中 ${first}–${last} 件`
})

/**
 * 先頭・末尾・現在ページの前後 1 つを必ず出し、飛んだところを「…」に畳む。
 * 現在ページが端に寄ったときは表示数が痩せないよう補う。
 */
const pageItems = computed(() => {
  const last = pageCount.value
  const current = currentPage.value

  const shown = new Set([1, last, current - 1, current, current + 1])
  if (current <= 3) [2, 3, 4].forEach((page) => shown.add(page))
  if (current >= last - 2) [last - 1, last - 2, last - 3].forEach((page) => shown.add(page))

  const pages = [...shown].filter((page) => page >= 1 && page <= last).sort((a, b) => a - b)

  const items = []
  let previous = 0
  for (const page of pages) {
    if (previous !== 0 && page - previous > 1) items.push({ key: `gap-${page}`, gap: true })
    items.push({ key: `page-${page}`, page })
    previous = page
  }
  return items
})

function goTo(page) {
  if (props.disabled || page === currentPage.value) return
  emit('update:offset', (page - 1) * props.limit)
}
</script>

<template>
  <nav class="pagination" aria-label="ページ送り">
    <span class="pagination__range" data-testid="pagination-range">{{ rangeLabel }}</span>

    <div v-if="pageCount > 1" class="pagination__pages">
      <BaseButton
        variant="secondary"
        size="sm"
        class="pagination__button"
        data-testid="pagination-prev"
        aria-label="前のページ"
        :disabled="disabled || currentPage === 1"
        @click="goTo(currentPage - 1)"
      >
        ‹
      </BaseButton>

      <template v-for="item in pageItems" :key="item.key">
        <span v-if="item.gap" class="pagination__gap" aria-hidden="true">…</span>
        <BaseButton
          v-else
          :variant="item.page === currentPage ? 'primary' : 'secondary'"
          size="sm"
          class="pagination__button"
          data-testid="pagination-page"
          :data-page="item.page"
          :aria-current="item.page === currentPage ? 'page' : undefined"
          :disabled="disabled"
          @click="goTo(item.page)"
        >
          {{ item.page }}
        </BaseButton>
      </template>

      <BaseButton
        variant="secondary"
        size="sm"
        class="pagination__button"
        data-testid="pagination-next"
        aria-label="次のページ"
        :disabled="disabled || currentPage === pageCount"
        @click="goTo(currentPage + 1)"
      >
        ›
      </BaseButton>
    </div>
  </nav>
</template>

<style scoped>
/* 一覧カード（BaseCard flush）の下端に直付けする想定で上境界を持つ */
.pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background-color: var(--color-surface);
  border-top: 1px solid var(--color-border);
}

.pagination__range {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
}

.pagination__pages {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-left: auto;
}

/* 色や余白は BaseButton に任せ、桁数で幅が揺れないよう最小幅だけ足す */
.pagination__button {
  min-width: 30px;
  font-variant-numeric: tabular-nums;
}

.pagination__gap {
  padding: 0 var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
</style>
