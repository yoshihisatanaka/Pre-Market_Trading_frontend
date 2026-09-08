<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BasePagination from '@/components/ui/BasePagination.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import { useBlockedDatesStore } from '@/stores/blockedDates'
import { toOffset } from '@/utils/queryParams'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useBlockedDatesStore()
const {
  items,
  total,
  limit,
  offset,
  loading,
  error,
  isEmpty,
  creating,
  createError,
  validationErrors,
} = storeToRefs(store)

const route = useRoute()
const router = useRouter()

// 列は画面モック（docs/mock/masters-blocked-dates/index.html）に合わせる。
// 行ごとの操作（編集 / 削除）は別コミットで足すので、いまは操作列を持たない
// （新規追加はヘッダのボタンから開くので、この列とは関係しない）
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

/*
 * 新規追加。画面モック（docs/mock/masters-blocked-dates/index.html）に合わせ、
 * ヘッダの「新規追加」からモーダルを開く形にする。URL は変えない（一覧の単方向フローに触らない）。
 *
 * 登録は store 側で「サーバの事前検証 → 登録」の 2 段になっている。ここでの検証は
 * 必須の未入力を弾いて無駄な往復を防ぐためのもので、日付の実在性や重複はサーバが見る。
 *
 * エラーは 3 種類あり、出し先を分ける。
 *   入力の不備      … FormField の error（項目の直下）
 *   事前検証の不合格 … store.validationErrors をモーダル内の BaseAlert（重複日付など）
 *   通信・サーバ障害 … store.createError を同じ位置の BaseAlert
 */
const isAddOpen = ref(false)
const addDate = ref('')
const addReason = ref('')
const addErrors = ref({ date: '', reason: '' })

// 追加の成功メッセージ
const noticeMessage = ref('')

function openAdd() {
  addDate.value = ''
  addReason.value = ''
  addErrors.value = { date: '', reason: '' }
  // 前回の失敗と成功をどちらも持ち込まない
  store.clearCreateError()
  noticeMessage.value = ''
  isAddOpen.value = true
}

function closeAdd() {
  // 登録中に閉じると結果の行き先が無くなるので、終わるまで閉じさせない
  if (creating.value) return
  isAddOpen.value = false
}

async function submitAdd() {
  addErrors.value = {
    date: addDate.value ? '' : '日付を入力してください。',
    reason: addReason.value.trim() ? '' : '理由を入力してください。',
  }
  if (addErrors.value.date || addErrors.value.reason) return

  const created = await store.create({
    date: addDate.value,
    reason: addReason.value.trim(),
  })
  // 失敗時はモーダルを開いたままにして、入力を直せるようにする（理由は createError に出る）
  if (!created) return

  isAddOpen.value = false
  noticeMessage.value = `${created.date} を追加しました。`
}
</script>

<template>
  <section class="blocked-date-list">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む -->
    <Teleport defer to="#topbar-actions">
      <BaseButton
        variant="secondary"
        data-testid="blocked-dates-reload"
        :disabled="loading"
        @click="store.reload()"
      >
        再読み込み
      </BaseButton>
      <BaseButton data-testid="blocked-dates-add" @click="openAdd">新規追加</BaseButton>
    </Teleport>

    <BaseAlert v-if="noticeMessage" variant="success" data-testid="blocked-dates-notice">
      {{ noticeMessage }}
    </BaseAlert>

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

    <BaseModal :open="isAddOpen" title="受注不可日 新規追加" @close="closeAdd">
      <!-- 送信ボタンはモーダルのフッタ（この form の外）にあるので、
           ここでの submit は入力欄での Enter キーのためだけにある -->
      <form
        data-testid="blocked-dates-add-form"
        class="blocked-date-list__form"
        @submit.prevent="submitAdd"
      >
        <!-- サーバの事前検証が返した理由。複数返ることがあるので箇条書きで出す -->
        <BaseAlert
          v-if="validationErrors.length > 0"
          variant="error"
          data-testid="blocked-dates-add-validation-error"
        >
          <ul class="blocked-date-list__validation-errors">
            <li v-for="message in validationErrors" :key="message">{{ message }}</li>
          </ul>
        </BaseAlert>

        <BaseAlert v-if="createError" variant="error" data-testid="blocked-dates-add-error">
          {{ createError.message }}
        </BaseAlert>

        <FormField v-slot="{ field }" label="日付" required :error="addErrors.date">
          <BaseInput
            v-bind="field"
            v-model="addDate"
            type="date"
            data-testid="blocked-dates-add-date"
          />
        </FormField>

        <!-- maxlength は実仕様（BlackoutDateRequest の 備考）の 45 文字に合わせる -->
        <FormField v-slot="{ field }" label="理由" required :error="addErrors.reason">
          <BaseInput
            v-bind="field"
            v-model="addReason"
            placeholder="例: GW前"
            maxlength="45"
            data-testid="blocked-dates-add-reason"
          />
        </FormField>
      </form>

      <template #footer>
        <BaseButton
          variant="secondary"
          data-testid="blocked-dates-add-cancel"
          :disabled="creating"
          @click="closeAdd"
        >
          キャンセル
        </BaseButton>
        <BaseButton data-testid="blocked-dates-add-submit" :disabled="creating" @click="submitAdd">
          {{ creating ? '追加中…' : '追加' }}
        </BaseButton>
      </template>
    </BaseModal>
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

/* モーダル内の入力欄。項目間の余白は検索カード（FormGrid）と同じ間隔に揃える */
.blocked-date-list__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* 事前検証の理由。1 件のときも箇条書きの体裁が浮かないよう、記号と字下げは付けない */
.blocked-date-list__validation-errors {
  margin: 0;
  padding: 0;
  list-style: none;
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
