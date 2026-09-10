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
  updating,
  updateError,
  updateValidationErrors,
  deleting,
  deleteError,
} = storeToRefs(store)

/*
 * 列は画面モック（docs/mock/masters-blocked-dates/index.html）に合わせる。
 * 操作列の「編集」は画面モックには無いが、行から直せないと理由の誤記を直すだけでも
 * 「新規追加 → 削除」の 2 操作が必要で、その間マスタが不整合になるため足している。
 * 新規追加はヘッダのボタンから開くので、この列には出さない。
 */
const columns = [
  { key: 'date', label: '日付' },
  { key: 'reason', label: '理由' },
  // 行ごとの操作（編集・削除）。画面モックに合わせて見出しは空にする
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

// 追加・編集・削除の成功メッセージは同じ枠に出す（同時に成功することは無い）
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
 * 編集。モーダルは「開いているか」と「どの行か」を editTarget 1 つで持つ（削除と同じ形）。
 * 入力欄はその行の現在値で初期化し、editTarget が握っている updatedAt が
 * 楽観的ロックの合札になる（他の利用者が先に更新していればサーバが 409 で弾く）。
 *
 * エラーの出し先は新規追加と同じ 3 系統。409 の競合も通信・サーバ障害と同じ枠に出すので、
 * ここに競合専用のコードは無い（code を見て分岐すると、view が API のコード値を知る約束事が増える）。
 * 競合時に一覧を自動で読み直すこともしない。一覧だけ読み直してもモーダルが握る合札は古いままで
 * 再度 409 になり、モーダル側まで差し替えると他人の変更を見せずに上書きさせることになる。
 */
const editTarget = ref(null)
const editDate = ref('')
const editReason = ref('')
const editErrors = ref({ date: '', reason: '' })

function openEdit(blocked) {
  editDate.value = blocked.date
  editReason.value = blocked.reason
  editErrors.value = { date: '', reason: '' }
  // 前回の失敗と成功をどちらも持ち込まない
  store.clearUpdateError()
  noticeMessage.value = ''
  editTarget.value = blocked
}

function closeEdit() {
  // 更新中に閉じると結果の行き先が無くなるので、終わるまで閉じさせない
  if (updating.value) return
  editTarget.value = null
}

async function submitEdit() {
  const target = editTarget.value
  if (!target) return

  editErrors.value = {
    date: editDate.value ? '' : '日付を入力してください。',
    reason: editReason.value.trim() ? '' : '理由を入力してください。',
  }
  if (editErrors.value.date || editErrors.value.reason) return

  const updated = await store.update({
    id: target.id,
    date: editDate.value,
    reason: editReason.value.trim(),
    updatedAt: target.updatedAt,
  })
  // 失敗時はモーダルを開いたままにして、入力を直せるようにする（理由は updateError に出る）
  if (!updated) return

  editTarget.value = null
  // 日付を変更できるので、サーバが受理した日付をそのまま出す
  noticeMessage.value = `${updated.date} を更新しました。`

  /*
   * 絞り込み中に対象外の日付へ変えると total が 1 減り、最終ページが空になり得る。
   * 行が別ページへ移ったことそのものは追わない（サーバが新しいインデックスを返さないため）。
   * 成功メッセージが新しい日付を含むので、ユーザはその日付で検索できる。
   */
  stepBackIfPageEmpty()
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

  stepBackIfPageEmpty()
}

/**
 * 読み直した結果が 0 件になったら 1 ページ戻す。
 * 最終ページの最後の 1 件が今の offset から居なくなる操作（削除、絞り込み中の日付変更）で使う。
 */
function stepBackIfPageEmpty() {
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

        <!-- 編集を左、削除を右端に置く。破壊的な操作を最後にする既存の並び
             （モーダルのフッタも キャンセル → 危険色）に合わせ、削除の位置は動かさない -->
        <template #cell-actions="{ row }">
          <div class="blocked-date-list__row-actions">
            <BaseButton
              variant="secondary"
              :data-testid="`blocked-dates-edit-${row.id}`"
              :disabled="updating"
              @click="openEdit(row)"
            >
              編集
            </BaseButton>
            <BaseButton
              variant="danger"
              :data-testid="`blocked-dates-delete-${row.id}`"
              :disabled="deleting"
              @click="openDelete(row)"
            >
              削除
            </BaseButton>
          </div>
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

    <MasterFormDialog
      :open="Boolean(editTarget)"
      title="受注不可日 編集"
      testid-prefix="blocked-dates"
      action="edit"
      submit-label="更新"
      :pending="updating"
      :error="updateError"
      :validation-errors="updateValidationErrors"
      @close="closeEdit"
      @submit="submitEdit"
    >
      <FormField v-slot="{ field }" label="日付" required :error="editErrors.date">
        <BaseInput
          v-bind="field"
          v-model="editDate"
          type="date"
          data-testid="blocked-dates-edit-date"
        />
      </FormField>

      <!-- maxlength は追加と同じく実仕様（BlackoutDateRequest の 備考）の 45 文字に合わせる -->
      <FormField v-slot="{ field }" label="理由" required :error="editErrors.reason">
        <BaseInput
          v-bind="field"
          v-model="editReason"
          placeholder="例: GW前"
          maxlength="45"
          data-testid="blocked-dates-edit-reason"
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

/* 行ごとの操作（編集・削除）。横に並べ、間隔は他の並列ボタンと同じトークンで取る */
.blocked-date-list__row-actions {
  display: flex;
  gap: var(--space-2);
}
</style>
