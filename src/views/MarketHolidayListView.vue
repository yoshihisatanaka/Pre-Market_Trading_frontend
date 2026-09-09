<script setup>
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BasePagination from '@/components/ui/BasePagination.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import { useListQuery } from '@/composables/useListQuery'
import { MARKET_HOLIDAYS_PAGE_SIZE, useMarketHolidaysStore } from '@/stores/marketHolidays'
import {
  MARKET_HOLIDAY_TYPE_DEFAULT,
  MARKET_HOLIDAY_TYPE_OPTIONS,
  formatMarketHolidayType,
  isMarketHolidayType,
} from '@/utils/marketHolidayTypes'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useMarketHolidaysStore()
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
  deleting,
  deleteError,
} = storeToRefs(store)

const columns = [
  { key: 'date', label: '日付' },
  { key: 'reason', label: '休場理由' },
  { key: 'holidayType', label: '休場区分' },
  // 行ごとの操作（削除）。画面モックに合わせて見出しは空にする
  { key: 'actions', label: '' },
]

/*
 * ページ位置と検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名（date_from / date_to / holiday_type）は画面モックの form と同じ契約で、
 * この filters 定義にだけ現れる。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'dateFrom', query: 'date_from' },
    { key: 'dateTo', query: 'date_to' },
    // 未知のコード（?holiday_type=9 など）は条件なしとして捨てる
    {
      key: 'holidayType',
      query: 'holiday_type',
      parse: (value) => (isMarketHolidayType(value) ? value : ''),
    },
  ],
  load: (params) => store.load(params),
})

/*
 * 新規追加。ヘッダの「新規追加」からモーダルを開く形にする
 * （URL は変えない。一覧の単方向フローに触らない）。
 *
 * エラーは 2 種類あり、出し先を分ける。
 *   入力の不備   … FormField の error（項目の直下）
 *   サーバの拒否 … store.createError をモーダル内の BaseAlert（重複日付など）
 */
const isAddOpen = ref(false)
const addDate = ref('')
const addReason = ref('')
// セレクトは常に有効なコードが入る（プレースホルダを置かない）ので addErrors には持たせない
const addHolidayType = ref(MARKET_HOLIDAY_TYPE_DEFAULT)
const addErrors = ref({ date: '', reason: '' })

// 追加と削除の成功メッセージは同じ枠に出す（同時に成功することは無い）
const noticeMessage = ref('')

function openAdd() {
  addDate.value = ''
  addReason.value = ''
  addHolidayType.value = MARKET_HOLIDAY_TYPE_DEFAULT
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
    reason: addReason.value.trim() ? '' : '休場理由を入力してください。',
  }
  if (addErrors.value.date || addErrors.value.reason) return

  const created = await store.create({
    date: addDate.value,
    reason: addReason.value.trim(),
    holidayType: addHolidayType.value,
  })
  // 失敗時はモーダルを開いたままにして、入力を直せるようにする（理由は createError に出る）
  if (!created) return

  isAddOpen.value = false
  noticeMessage.value = `${created.date} を追加しました。`
}

/*
 * 削除。確認モーダルは「開いているか」と「何を消すか」を deleteTarget 1 つで持つ。
 * エラーの出し先は新規追加と同じ考えかたで、サーバの拒否は deleteError をモーダル内に出す。
 */
const deleteTarget = ref(null)

function openDelete(holiday) {
  store.clearDeleteError()
  noticeMessage.value = ''
  deleteTarget.value = holiday
}

function closeDelete() {
  // 削除中に閉じると結果の行き先が無くなるので、終わるまで閉じさせない
  if (deleting.value) return
  deleteTarget.value = null
}

async function submitDelete() {
  const target = deleteTarget.value
  if (!target) return

  const deleted = await store.remove(target.id)
  // 失敗時はモーダルを開いたままにして、理由（deleteError）を読ませる
  if (!deleted) return

  deleteTarget.value = null
  noticeMessage.value = `${target.date} を削除しました。`

  // 最終ページの最後の 1 件を消すと今の offset に行が無くなるので、1 ページ戻す
  if (items.value.length === 0 && offset.value > 0) {
    goToOffset(offset.value - MARKET_HOLIDAYS_PAGE_SIZE)
  }
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
      <BaseButton data-testid="market-holidays-add" @click="openAdd">新規追加</BaseButton>
    </Teleport>

    <BaseAlert v-if="noticeMessage" variant="success" data-testid="market-holidays-notice">
      {{ noticeMessage }}
    </BaseAlert>

    <!-- 検索カードは 4 状態の外に置く。0 件やエラーのときこそ条件を直したいので消さない -->
    <BaseCard>
      <form data-testid="market-holidays-search" @submit.prevent="submitSearch">
        <FormGrid :columns="4">
          <FormField v-slot="{ field }" label="日付（From）">
            <BaseInput
              v-bind="field"
              v-model="inputs.dateFrom"
              type="date"
              data-testid="market-holidays-date-from"
            />
          </FormField>
          <FormField v-slot="{ field }" label="日付（To）">
            <BaseInput
              v-bind="field"
              v-model="inputs.dateTo"
              type="date"
              data-testid="market-holidays-date-to"
            />
          </FormField>
          <FormField v-slot="{ field }" label="休場区分">
            <BaseSelect
              v-bind="field"
              v-model="inputs.holidayType"
              :options="MARKET_HOLIDAY_TYPE_OPTIONS"
              placeholder="-- すべて --"
              data-testid="market-holidays-holiday-type"
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

          <template #cell-holidayType="{ value }">
            <span class="market-holiday-list__type">{{ formatMarketHolidayType(value) }}</span>
          </template>

          <template #cell-actions="{ row }">
            <BaseButton
              variant="danger"
              :data-testid="`market-holidays-delete-${row.id}`"
              :disabled="deleting"
              @click="openDelete(row)"
            >
              削除
            </BaseButton>
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

    <BaseModal :open="isAddOpen" title="海外休場日 新規追加" @close="closeAdd">
      <!-- 送信ボタンはモーダルのフッタ（この form の外）にあるので、
           ここでの submit は入力欄での Enter キーのためだけにある -->
      <form
        data-testid="market-holidays-add-form"
        class="market-holiday-list__form"
        @submit.prevent="submitAdd"
      >
        <BaseAlert v-if="createError" variant="error" data-testid="market-holidays-add-error">
          {{ createError.message }}
        </BaseAlert>

        <FormField v-slot="{ field }" label="日付" required :error="addErrors.date">
          <BaseInput
            v-bind="field"
            v-model="addDate"
            type="date"
            data-testid="market-holidays-add-date"
          />
        </FormField>

        <FormField v-slot="{ field }" label="休場理由" required :error="addErrors.reason">
          <BaseInput
            v-bind="field"
            v-model="addReason"
            placeholder="例: 独立記念日"
            maxlength="100"
            data-testid="market-holidays-add-reason"
          />
        </FormField>

        <FormField v-slot="{ field }" label="休場区分" required>
          <BaseSelect
            v-bind="field"
            v-model="addHolidayType"
            :options="MARKET_HOLIDAY_TYPE_OPTIONS"
            data-testid="market-holidays-add-holiday-type"
          />
        </FormField>
      </form>

      <template #footer>
        <BaseButton
          variant="secondary"
          data-testid="market-holidays-add-cancel"
          :disabled="creating"
          @click="closeAdd"
        >
          キャンセル
        </BaseButton>
        <BaseButton
          data-testid="market-holidays-add-submit"
          :disabled="creating"
          @click="submitAdd"
        >
          {{ creating ? '追加中…' : '追加' }}
        </BaseButton>
      </template>
    </BaseModal>

    <!-- 削除確認。本文が短いので size="sm"（画面モックの max-width:400px 相当） -->
    <BaseModal :open="Boolean(deleteTarget)" title="削除確認" size="sm" @close="closeDelete">
      <BaseAlert v-if="deleteError" variant="error" data-testid="market-holidays-delete-error">
        {{ deleteError.message }}
      </BaseAlert>

      <p>
        <span class="market-holiday-list__date">{{ deleteTarget?.date }}</span> を削除しますか？
      </p>
      <p class="market-holiday-list__warning">この操作は元に戻せません。</p>

      <template #footer>
        <BaseButton
          variant="secondary"
          data-testid="market-holidays-delete-cancel"
          :disabled="deleting"
          @click="closeDelete"
        >
          キャンセル
        </BaseButton>
        <BaseButton
          variant="danger"
          data-testid="market-holidays-delete-submit"
          :disabled="deleting"
          @click="submitDelete"
        >
          {{ deleting ? '削除中…' : '削除する' }}
        </BaseButton>
      </template>
    </BaseModal>
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

/* モーダル内の入力欄。項目間の余白は検索カード（FormGrid）と同じ間隔に揃える */
.market-holiday-list__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* 削除確認モーダルの注意書き。本文（既定色）より一段小さく、危険色で出す */
.market-holiday-list__warning {
  margin-top: var(--space-2);
  color: var(--color-danger);
  font-size: var(--font-size-xs);
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

/* 休場区分は補助的な情報なので、画面モックの中間列（対象市場）と同じく一段小さく落ち着かせる */
.market-holiday-list__type {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

/* 日付は等幅にはせず、桁を揃えて少し強調する（画面モックの ui-code-strong 相当） */
.market-holiday-list__date {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
