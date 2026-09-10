<script setup>
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import ConfirmDeleteDialog from '@/components/masters/ConfirmDeleteDialog.vue'
import MasterFormDialog from '@/components/masters/MasterFormDialog.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
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
  validationErrors,
  validationWarnings,
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
 * 出し先は 4 つに分かれる。
 *   入力の不備      … FormField の error（項目の直下）
 *   事前検証の不合格 … store.validationErrors をモーダル内の BaseAlert（重複日付など）
 *   事前検証の警告   … store.validationWarnings を同じくモーダル内に（取消済み日付の再有効化）
 *   通信・サーバ障害 … store.createError を同じくモーダル内に
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

/*
 * 事前検証の警告が出ているあいだは、送信は「承知して続行」の意味になる。
 * 文言も変えて、同じボタンを押しても結果が変わることを見せる。
 */
const hasAddWarnings = computed(() => validationWarnings.value.length > 0)
const addSubmitLabel = computed(() => (hasAddWarnings.value ? '続行' : '追加'))

// 日付を変えたら前回の検証結果は当てにならない。承知済みの警告も持ち越さない
watch(addDate, () => store.clearCreateError())

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
    // 警告を出したうえでもう一度押されたので、承知したものとして登録に進む
    acknowledgedWarnings: hasAddWarnings.value,
  })
  // 失敗時と確認待ちのときはモーダルを開いたままにして、理由を読ませる
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

    <MasterSearchCard
      testid-prefix="market-holidays"
      :disabled="loading"
      @submit="submitSearch"
      @clear="clearSearch"
    >
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
    </MasterSearchCard>

    <MasterListCard
      testid-prefix="market-holidays"
      title="海外休場日一覧"
      empty-message="該当する海外休場日はありません。"
      :total="total"
      :limit="limit"
      :offset="offset"
      :loading="loading"
      :is-empty="isEmpty"
      :error="error"
      @reload="store.reload()"
      @update:offset="goToOffset"
    >
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
    </MasterListCard>

    <MasterFormDialog
      :open="isAddOpen"
      title="海外休場日 新規追加"
      testid-prefix="market-holidays"
      :submit-label="addSubmitLabel"
      :pending="creating"
      :error="createError"
      :validation-errors="validationErrors"
      :validation-warnings="validationWarnings"
      @close="closeAdd"
      @submit="submitAdd"
    >
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
          maxlength="45"
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
    </MasterFormDialog>

    <ConfirmDeleteDialog
      :open="Boolean(deleteTarget)"
      testid-prefix="market-holidays"
      :label="deleteTarget?.date ?? ''"
      :pending="deleting"
      :error="deleteError"
      @close="closeDelete"
      @confirm="submitDelete"
    />
  </section>
</template>

<style scoped>
.market-holiday-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
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
