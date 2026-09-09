<script setup>
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import ConfirmDeleteDialog from '@/components/masters/ConfirmDeleteDialog.vue'
import MasterFormDialog from '@/components/masters/MasterFormDialog.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
import { useListQuery } from '@/composables/useListQuery'
import { BLOCKED_DATES_PAGE_SIZE, useBlockedDatesStore } from '@/stores/blockedDates'

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
  deleting,
  deleteError,
} = storeToRefs(store)

// 列は画面モック（docs/mock/masters-blocked-dates/index.html）に合わせる。
// 操作列に置くのは削除だけ。行ごとの編集は別コミットで足す
// （新規追加はヘッダのボタンから開くので、この列には出さない）
const columns = [
  { key: 'date', label: '日付' },
  { key: 'market', label: '対象市場' },
  { key: 'reason', label: '理由' },
  // 行ごとの操作（削除）。画面モックに合わせて見出しは空にする
  { key: 'actions', label: '' },
]

/*
 * ページ位置と検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名（date_from / date_to）は画面モックの form と同じ契約で、
 * この filters 定義にだけ現れる。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'dateFrom', query: 'date_from' },
    { key: 'dateTo', query: 'date_to' },
  ],
  load: (params) => store.load(params),
})

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

// 追加と削除の成功メッセージは同じ枠に出す（同時に成功することは無い）
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

/*
 * 削除。確認モーダルは「開いているか」と「何を消すか」を deleteTarget 1 つで持つ。
 * エラーの出し先は新規追加と同じ考えかたで、サーバの拒否は deleteError をモーダル内に出す。
 */
const deleteTarget = ref(null)

function openDelete(blocked) {
  store.clearDeleteError()
  noticeMessage.value = ''
  deleteTarget.value = blocked
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
    goToOffset(offset.value - BLOCKED_DATES_PAGE_SIZE)
  }
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

    <MasterSearchCard
      testid-prefix="blocked-dates"
      :disabled="loading"
      @submit="submitSearch"
      @clear="clearSearch"
    >
      <FormField v-slot="{ field }" label="日付（From）">
        <BaseInput
          v-bind="field"
          v-model="inputs.dateFrom"
          type="date"
          data-testid="blocked-dates-date-from"
        />
      </FormField>
      <FormField v-slot="{ field }" label="日付（To）">
        <BaseInput
          v-bind="field"
          v-model="inputs.dateTo"
          type="date"
          data-testid="blocked-dates-date-to"
        />
      </FormField>
    </MasterSearchCard>

    <MasterListCard
      testid-prefix="blocked-dates"
      title="受注不可日一覧"
      empty-message="該当する受注不可日はありません。"
      :total="total"
      :limit="limit"
      :offset="offset"
      :loading="loading"
      :is-empty="isEmpty"
      :error="error"
      @reload="store.reload()"
      @update:offset="goToOffset"
    >
      <DataTable flat data-testid="blocked-dates-table" :columns="columns" :rows="items">
        <template #cell-date="{ value }">
          <span class="blocked-date-list__date">{{ value || '—' }}</span>
        </template>

        <template #cell-market="{ value }">
          <span class="blocked-date-list__market">{{ value || '—' }}</span>
        </template>

        <template #cell-actions="{ row }">
          <BaseButton
            variant="danger"
            :data-testid="`blocked-dates-delete-${row.id}`"
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
      title="受注不可日 新規追加"
      testid-prefix="blocked-dates"
      :pending="creating"
      :error="createError"
      :validation-errors="validationErrors"
      @close="closeAdd"
      @submit="submitAdd"
    >
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
    </MasterFormDialog>

    <ConfirmDeleteDialog
      :open="Boolean(deleteTarget)"
      testid-prefix="blocked-dates"
      :label="deleteTarget?.date ?? ''"
      :pending="deleting"
      :error="deleteError"
      @close="closeDelete"
      @confirm="submitDelete"
    />
  </section>
</template>

<style scoped>
.blocked-date-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
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
