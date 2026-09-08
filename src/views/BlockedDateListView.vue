<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BasePagination from '@/components/ui/BasePagination.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import { useBlockedDatesStore } from '@/stores/blockedDates'
import { toOffset } from '@/utils/queryParams'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useBlockedDatesStore()
const { items, total, limit, offset, loading, error, isEmpty } = storeToRefs(store)

const route = useRoute()
const router = useRouter()

// 列は画面モック（docs/mock/masters-blocked-dates/index.html）に合わせる。
// 行ごとの操作（編集 / 削除）は別コミットで足すので、いまは操作列を持たない
const columns = [
  { key: 'date', label: '日付' },
  { key: 'market', label: '対象市場' },
  { key: 'reason', label: '理由' },
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
  return {
    offset: toOffset(query.offset),
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
  <section class="blocked-date-list">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む。
         画面モックの「新規追加」は追加機能と一緒に別コミットで足す -->
    <Teleport defer to="#topbar-actions">
      <BaseButton
        variant="secondary"
        data-testid="blocked-dates-reload"
        :disabled="loading"
        @click="store.reload()"
      >
        再読み込み
      </BaseButton>
    </Teleport>

    <!-- 画面の説明。4 状態や検索結果に関わらず常時出す（画面モックの info バナー相当） -->
    <BaseAlert variant="info" data-testid="blocked-dates-description">
      国内の営業日・受注停止日を管理します。ゴールデンウィーク、シルバーウィーク、年末年始など、国内拠点で受注を停止する日を登録してください。
    </BaseAlert>

    <!-- 検索カードは 4 状態の外に置く。0 件やエラーのときこそ条件を直したいので消さない -->
    <BaseCard>
      <form data-testid="blocked-dates-search" @submit.prevent="submitSearch">
        <FormGrid :columns="4">
          <FormField v-slot="{ field }" label="日付（From）">
            <BaseInput
              v-bind="field"
              v-model="dateFromInput"
              type="date"
              data-testid="blocked-dates-date-from"
            />
          </FormField>
          <FormField v-slot="{ field }" label="日付（To）">
            <BaseInput
              v-bind="field"
              v-model="dateToInput"
              type="date"
              data-testid="blocked-dates-date-to"
            />
          </FormField>
        </FormGrid>

        <div class="blocked-date-list__actions">
          <BaseButton type="submit" data-testid="blocked-dates-search-submit" :disabled="loading">
            検索
          </BaseButton>
          <BaseButton
            variant="secondary"
            data-testid="blocked-dates-search-clear"
            :disabled="loading"
            @click="clearSearch"
          >
            クリア
          </BaseButton>
        </div>
      </form>
    </BaseCard>

    <BaseCard title="受注不可日一覧" flush>
      <template #header-actions>
        <span class="blocked-date-list__count" data-testid="blocked-dates-count">
          {{ total }} 件
        </span>
      </template>

      <!-- ローディング / エラー / 空 / データあり の 4 状態 -->
      <p v-if="loading" data-testid="blocked-dates-loading" class="blocked-date-list__status">
        読み込み中…
      </p>

      <div
        v-else-if="error"
        data-testid="blocked-dates-error"
        class="blocked-date-list__status is-error"
      >
        <p>{{ error.message }}</p>
        <BaseButton variant="secondary" @click="store.reload()">再試行</BaseButton>
      </div>

      <p v-else-if="isEmpty" data-testid="blocked-dates-empty" class="blocked-date-list__status">
        該当する受注不可日はありません。
      </p>

      <template v-else>
        <DataTable flat data-testid="blocked-dates-table" :columns="columns" :rows="items">
          <template #cell-date="{ value }">
            <span class="blocked-date-list__date">{{ value || '—' }}</span>
          </template>

          <template #cell-market="{ value }">
            <span class="blocked-date-list__market">{{ value || '—' }}</span>
          </template>
        </DataTable>

        <BasePagination
          data-testid="blocked-dates-pagination"
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
.blocked-date-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.blocked-date-list__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.blocked-date-list__count {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.blocked-date-list__status {
  padding: var(--space-5);
  color: var(--color-text-muted);
}

.blocked-date-list__status.is-error {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--color-danger);
}

/* 日付は等幅にはせず、桁を揃えて少し強調する（画面モックの ui-code-strong 相当） */
.blocked-date-list__date {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* 対象市場は補足情報なので本文より一段小さく（画面モックの font-size:12px 相当） */
.blocked-date-list__market {
  font-size: var(--font-size-xs);
}
</style>
