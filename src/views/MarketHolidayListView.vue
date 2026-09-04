<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BasePagination from '@/components/ui/BasePagination.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import { MARKET_HOLIDAYS_PAGE_SIZE, useMarketHolidaysStore } from '@/stores/marketHolidays'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useMarketHolidaysStore()
const { items, total, limit, offset, loading, error, isEmpty } = storeToRefs(store)

const route = useRoute()
const router = useRouter()

const columns = [
  { key: 'date', label: '日付' },
  { key: 'reason', label: '休場理由' },
]

/*
 * ページ位置と検索条件は URL クエリを正とする単方向フローで扱う。
 *
 *   操作（検索 / ページ移動） → router.push({ query })  ← ここでは読み込まない
 *                                    ↓
 *                          route.query が変わる
 *                                    ↓
 *              watch(queryKey, immediate) → store.load(...)
 *
 * こうすると二重フェッチが起きず、ブラウザバック / フォワードやブックマークにも
 * 追加のコードなしで対応できる。onMounted での初回読み込みは書かない（immediate が担う）。
 *
 * クエリ名の date_from / date_to は URL 上の契約（画面モックの form と同じ）であって
 * バックエンドのモデル表現ではない。snake_case はこの 2 つの関数の中だけに閉じる。
 */
function paramsFromQuery(query) {
  const rawOffset = Number.parseInt(typeof query.offset === 'string' ? query.offset : '', 10)
  const safeOffset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0

  return {
    // 表示件数の倍数に丸める（?offset=7 のような値でページ番号がずれないように）
    offset: safeOffset - (safeOffset % MARKET_HOLIDAYS_PAGE_SIZE),
    dateFrom: typeof query.date_from === 'string' ? query.date_from : '',
    dateTo: typeof query.date_to === 'string' ? query.date_to : '',
  }
}

function queryFromParams({ offset: nextOffset, dateFrom, dateTo }) {
  // 既定値はクエリに出さず URL を短く保つ
  const query = {}
  if (nextOffset > 0) query.offset = String(nextOffset)
  if (dateFrom) query.date_from = dateFrom
  if (dateTo) query.date_to = dateTo
  return query
}

// 検索フォームの入力値。URL に反映されるのは「検索」を押したときだけ
const dateFromInput = ref('')
const dateToInput = ref('')

// route.query は毎回オブジェクトの参照が変わるため、文字列に畳んでから監視する
const queryKey = computed(() => {
  const params = paramsFromQuery(route.query)
  return `${params.offset}|${params.dateFrom}|${params.dateTo}`
})

watch(
  queryKey,
  () => {
    const params = paramsFromQuery(route.query)
    // ブラウザバックでも入力欄が URL に追従するようにする
    dateFromInput.value = params.dateFrom
    dateToInput.value = params.dateTo
    store.load(params)
  },
  { immediate: true },
)

function submitSearch() {
  // 条件を変えたら 1 ページ目に戻す
  router.push({
    query: queryFromParams({
      offset: 0,
      dateFrom: dateFromInput.value,
      dateTo: dateToInput.value,
    }),
  })
}

function clearSearch() {
  router.push({ query: {} })
}

function goToOffset(nextOffset) {
  router.push({
    query: queryFromParams({
      offset: nextOffset,
      dateFrom: store.dateFrom,
      dateTo: store.dateTo,
    }),
  })
}
</script>

<template>
  <section class="market-holiday-list">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む -->
    <Teleport defer to="#topbar-actions">
      <BaseButton
        variant="secondary"
        data-testid="market-holidays-reload"
        :disabled="loading"
        @click="store.reload()"
      >
        再読み込み
      </BaseButton>
    </Teleport>

    <!-- 検索カードは 4 状態の外に置く。0 件やエラーのときこそ条件を直したいので消さない -->
    <BaseCard>
      <form data-testid="market-holidays-search" @submit.prevent="submitSearch">
        <FormGrid :columns="4">
          <FormField v-slot="{ field }" label="日付（From）">
            <BaseInput
              v-bind="field"
              v-model="dateFromInput"
              type="date"
              data-testid="market-holidays-date-from"
            />
          </FormField>
          <FormField v-slot="{ field }" label="日付（To）">
            <BaseInput
              v-bind="field"
              v-model="dateToInput"
              type="date"
              data-testid="market-holidays-date-to"
            />
          </FormField>
        </FormGrid>

        <div class="market-holiday-list__actions">
          <BaseButton type="submit" data-testid="market-holidays-search-submit" :disabled="loading">
            検索
          </BaseButton>
          <BaseButton
            variant="secondary"
            data-testid="market-holidays-search-clear"
            :disabled="loading"
            @click="clearSearch"
          >
            クリア
          </BaseButton>
        </div>
      </form>
    </BaseCard>

    <BaseCard title="海外休場日一覧" flush>
      <template #header-actions>
        <span class="market-holiday-list__count" data-testid="market-holidays-count">
          {{ total }} 件
        </span>
      </template>

      <!-- ローディング / エラー / 空 / データあり の 4 状態 -->
      <p v-if="loading" data-testid="market-holidays-loading" class="market-holiday-list__status">
        読み込み中…
      </p>

      <div
        v-else-if="error"
        data-testid="market-holidays-error"
        class="market-holiday-list__status is-error"
      >
        <p>{{ error.message }}</p>
        <BaseButton variant="secondary" @click="store.reload()">再試行</BaseButton>
      </div>

      <p
        v-else-if="isEmpty"
        data-testid="market-holidays-empty"
        class="market-holiday-list__status"
      >
        該当する海外休場日はありません。
      </p>

      <template v-else>
        <DataTable flat data-testid="market-holidays-table" :columns="columns" :rows="items">
          <template #cell-date="{ value }">
            <span class="market-holiday-list__date">{{ value || '—' }}</span>
          </template>
        </DataTable>

        <BasePagination
          data-testid="market-holidays-pagination"
          :total="total"
          :limit="limit"
          :offset="offset"
          :disabled="loading"
          @update:offset="goToOffset"
        />
      </template>
    </BaseCard>
  </section>
</template>

<style scoped>
.market-holiday-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.market-holiday-list__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.market-holiday-list__count {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.market-holiday-list__status {
  padding: var(--space-5);
  color: var(--color-text-muted);
}

.market-holiday-list__status.is-error {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--color-danger);
}

/* 日付は等幅にはせず、桁を揃えて少し強調する（画面モックの ui-code-strong 相当） */
.market-holiday-list__date {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
