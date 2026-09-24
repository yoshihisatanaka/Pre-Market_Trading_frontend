<script setup>
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseCheckbox from '@/components/ui/BaseCheckbox.vue'
import BasePagination from '@/components/ui/BasePagination.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import { ANNOUNCEMENT_HISTORY_PAGE_SIZE, useAnnouncementsStore } from '@/stores/announcements'
import { useBannerStore } from '@/stores/banner'
import { formatMonthDayTime } from '@/utils/format'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useAnnouncementsStore()
const {
  announcement,
  loading,
  error,
  isEmpty,
  saving,
  saveError,
  history,
  historyTotal,
  historyOffset,
  historyLoading,
  historyError,
  historyIsEmpty,
} = storeToRefs(store)

/*
 * 現在の運用状態は GET /operations/banner の 発注停止中 から出す（お知らせ API には無い）。
 * 取得に失敗しても「—」になるだけで、お知らせの編集は止めない。
 */
const bannerStore = useBannerStore()
const { banner } = storeToRefs(bannerStore)

const isSuspended = computed(() => Boolean(banner.value?.ordersSuspended))

const operationStatusLabel = computed(() => {
  if (!banner.value) return '—'
  return isSuspended.value ? '発注停止中' : '通常運用'
})

/** AnnouncementUpdateRequest.本文 の maxLength */
const MESSAGE_MAX_LENGTH = 500

const NOTICE_PLACEHOLDER = `例：本日は市場休場日前のため、注文条件をご確認ください。
例：9月15日 06:00〜07:00に計画メンテナンスを予定しています。`

const HISTORY_COLUMNS = [
  { key: 'operatedAt', label: '操作日時' },
  { key: 'operationLabel', label: '操作区分' },
  { key: 'message', label: '本文' },
  { key: 'operator', label: '操作者' },
]

/*
 * 操作区分の色分け。文言はサーバが添える操作区分名をそのまま出し、ここは色だけを決める
 * （操作区分は description だけで enum 宣言が無いので、src/utils/apiEnums.js には載せられない）。
 */
const OPERATION_BADGE_VARIANTS = { SHOW: 'success', HIDE: 'gray', UPDATE: 'info' }

/*
 * 入力欄は現在値が変わるたび（初回読み込み・再読み込み・保存成功）に洗い替える。
 * 入力途中の値を握りっぱなしにしないので、保存後に画面と入力欄がずれない。
 */
const enabledInput = ref(false)
const messageInput = ref('')

watch(
  announcement,
  (value) => {
    if (!value) return
    enabledInput.value = value.enabled
    messageInput.value = value.message
  },
  { immediate: true },
)

// サーバ側で 500 文字を超える値が入っていても負の数は出さない（maxlength は既存の値を切らない）
const remainingHint = computed(() => {
  const remaining = Math.max(0, MESSAGE_MAX_LENGTH - messageInput.value.length)
  return `残り ${remaining} 文字（最大 ${MESSAGE_MAX_LENGTH} 文字）`
})

/*
 * エラーは 2 系統あり、出し先を分ける（BlackoutDateListView と同じ）。
 *   入力の不備       … FormField の error（本文の直下）
 *   サーバの拒否・障害 … store.saveError をフォーム先頭の BaseAlert（400 / 409 / 通信障害）
 * 409 の競合も同じ枠に出す。code を見て分岐すると、view が API のコード値を知る約束事が増える。
 */
const messageError = ref('')
const noticeMessage = ref('')

async function submitSave() {
  // 更新ボタンは :disabled で塞いであるが、入力欄での Enter でも submit は飛ぶ。
  // 二重送信（PUT が並列に出る）はここで止める
  if (saving.value) return

  noticeMessage.value = ''
  store.clearSaveError()

  // 押す前に止められるものは画面で止める（サーバも同じ理由で 400 を返す）。
  // 500 文字超は maxlength で入力できないので、ここでは見ない
  messageError.value =
    enabledInput.value && !messageInput.value.trim()
      ? 'お知らせを表示するには本文を入力してください。'
      : ''
  if (messageError.value) return

  const result = await store.save({
    enabled: enabledInput.value,
    message: messageInput.value,
  })
  // 失敗時は入力をそのまま残して直させる（理由は saveError に出る）
  if (!result) return

  // 成功文言はサーバが返す（表示・非表示・本文変更・変更なしで変わる）。自前で組み立てない
  noticeMessage.value = result.message
}

function reload() {
  noticeMessage.value = ''
  messageError.value = ''
  store.clearSaveError()
  store.load()
  store.loadHistory()
  bannerStore.load()
}

// 初回読み込み。onMounted に置くと最初の描画で一瞬「未登録」が出るため setup で始める
store.load()
store.loadHistory(0)
bannerStore.load()
</script>

<template>
  <section class="announcement">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む -->
    <Teleport defer to="#topbar-actions">
      <BaseButton
        variant="secondary"
        data-testid="announcements-reload"
        :disabled="loading"
        @click="reload"
      >
        再読み込み
      </BaseButton>
    </Teleport>

    <BaseAlert v-if="noticeMessage" variant="success" data-testid="announcements-notice">
      {{ noticeMessage }}
    </BaseAlert>

    <header class="announcement__head">
      <p class="announcement__lead">
        通常のお知らせや計画メンテナンスの案内を、発注を止めずに全画面へ表示します。
      </p>

      <div class="announcement__state" data-testid="announcements-status">
        <span class="announcement__state-term">現在の運用状態</span>
        <strong :class="['announcement__state-value', { 'is-suspended': isSuspended }]">
          {{ operationStatusLabel }}
        </strong>
      </div>
    </header>

    <!-- /operations/banner は発注停止中なら障害の案内を優先し、お知らせを出さない。その挙動をここで説明する -->
    <BaseAlert v-if="isSuspended" variant="warning" data-testid="announcements-suspended">
      現在は発注停止中です。利用者画面には障害管理の停止案内を優先して表示します。
    </BaseAlert>

    <!-- ローディング / エラー / 空 / データあり の 4 状態 -->
    <p v-if="loading" data-testid="announcements-loading" class="announcement__status is-loading">
      <BaseSpinner />
    </p>

    <div v-else-if="error" data-testid="announcements-error" class="announcement__status is-error">
      <p>{{ error.message }}</p>
      <BaseButton variant="secondary" @click="reload">再試行</BaseButton>
    </div>

    <p v-else-if="isEmpty" data-testid="announcements-empty" class="announcement__status">
      お知らせが登録されていません。
    </p>

    <BaseCard v-else title="利用者向けお知らせ" class="announcement__card">
      <template #header-actions>
        <span class="announcement__header-actions">
          <span class="announcement__card-note">通常のお知らせ・計画メンテナンスの案内</span>
          <BaseBadge variant="success">変更可能</BaseBadge>
        </span>
      </template>

      <!--
        novalidate: 本文の required はラベルの必須マークと aria のためのもの。ブラウザ標準の吹き出し
        （英語の「Please fill out this field.」）に先を越されないよう、検証は submitSave に任せる
      -->
      <form
        class="announcement__form"
        data-testid="announcements-form"
        novalidate
        @submit.prevent="submitSave"
      >
        <BaseAlert v-if="saveError" variant="error" data-testid="announcements-save-error">
          {{ saveError.message }}
        </BaseAlert>

        <div class="announcement__mode">
          <BaseCheckbox
            v-model="enabledInput"
            label="お知らせを表示する"
            data-testid="announcements-enabled"
          />
          <p class="announcement__hint">
            表示中も、新規発注・訂正・取消は通常どおり操作できます。
          </p>
        </div>

        <FormField
          v-slot="{ field }"
          label="お知らせ内容（全画面共通）"
          :required="enabledInput"
          :hint="remainingHint"
          :error="messageError"
        >
          <BaseTextarea
            v-bind="field"
            v-model="messageInput"
            :maxlength="MESSAGE_MAX_LENGTH"
            :placeholder="NOTICE_PLACEHOLDER"
            data-testid="announcements-message"
          />
        </FormField>

        <p class="announcement__hint">
          お知らせの登録・表示・解除は操作履歴に記録します。発注停止中は停止案内が優先されます。
        </p>

        <div class="announcement__actions">
          <BaseButton
            type="submit"
            class="announcement__submit"
            data-testid="announcements-save"
            :disabled="saving"
            :loading="saving"
          >
            {{ saving ? '更新中…' : 'お知らせを更新' }}
          </BaseButton>
        </div>
      </form>
    </BaseCard>

    <BaseCard title="お知らせ履歴" flush>
      <template #header-actions>
        <span class="announcement__card-note">新しい順</span>
      </template>

      <!-- 履歴も 4 状態を出し分ける。お知らせ本体とは別に失敗しうるため -->
      <p
        v-if="historyLoading"
        data-testid="announcements-history-loading"
        class="announcement__history-status is-loading"
      >
        <BaseSpinner />
      </p>

      <div
        v-else-if="historyError"
        data-testid="announcements-history-error"
        class="announcement__history-status is-error"
      >
        <p>{{ historyError.message }}</p>
        <BaseButton variant="secondary" @click="store.loadHistory()">再試行</BaseButton>
      </div>

      <p
        v-else-if="historyIsEmpty"
        data-testid="announcements-history-empty"
        class="announcement__history-status"
      >
        お知らせ履歴はありません。
      </p>

      <DataTable
        v-else
        flat
        :columns="HISTORY_COLUMNS"
        :rows="history"
        data-testid="announcements-history-table"
      >
        <!-- 操作日時は年を出さない（履歴が並ぶので日付が読み取りにくくなる） -->
        <template #cell-operatedAt="{ value }">
          <span class="announcement__code">{{ formatMonthDayTime(value) }}</span>
        </template>

        <template #cell-operationLabel="{ row, value }">
          <BaseBadge :variant="OPERATION_BADGE_VARIANTS[row.operation] ?? 'gray'">
            {{ value }}
          </BaseBadge>
        </template>

        <!-- 本文を消して解除すると空で残る。空欄のままだと欠測と見分けが付かないので印を出す -->
        <template #cell-message="{ value }">
          <span v-if="value">{{ value }}</span>
          <span v-else class="announcement__blank">—</span>
        </template>

        <template #cell-operator="{ value }">
          <span class="announcement__code">{{ value || '—' }}</span>
        </template>
      </DataTable>

      <!-- ページ送り中も消さない（表の位置が跳ねないように）。読み込み中は押せなくする -->
      <BasePagination
        v-if="!historyError && historyTotal > 0"
        :total="historyTotal"
        :limit="ANNOUNCEMENT_HISTORY_PAGE_SIZE"
        :offset="historyOffset"
        :disabled="historyLoading"
        data-testid="announcements-history-pagination"
        @update:offset="store.loadHistory($event)"
      />
    </BaseCard>
  </section>
</template>

<style scoped>
.announcement {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  /* モックの .announcement-page と同じ。横に間延びさせない */
  max-width: 1080px;
}

.announcement__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-5);
}

.announcement__lead {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

/* 現在の運用状態。この画面からは変更できない読み取り専用の表示 */
.announcement__state {
  min-width: 150px;
  padding: var(--space-2) var(--space-3);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.announcement__state-term {
  display: block;
  margin-bottom: 2px;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.announcement__state-value {
  color: var(--color-text-heading);
  font-size: var(--font-size-md);
  font-weight: 600;
}

.announcement__state-value.is-suspended {
  color: var(--color-danger);
}

/* モックの .announcement-card。カード上端の線でお知らせ設定を履歴と区別する */
.announcement__card {
  border-top: 2px solid var(--color-border);
}

/*
 * カードヘッダの説明文とバッジ。モックは「タイトル 説明文 …… バッジ」の並びなので、
 * スロットをタイトルの右いっぱいまで広げ、中で両端に寄せる
 * （BaseCard 自身は タイトル｜スロット の 2 分割しか知らない）。
 */
.announcement__header-actions {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.announcement__card-note {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.announcement__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* 表示 ON/OFF は本文と性質が違うので、区切り線で分ける */
.announcement__mode {
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.announcement__hint {
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: 1.55;
}

.announcement__actions {
  display: flex;
  justify-content: flex-end;
}

/* モックのボタン幅に合わせる。文言が「更新中…」に変わっても幅が動かない */
.announcement__submit {
  min-width: 176px;
}

.announcement__blank {
  color: var(--color-text-muted);
}

/* 日時と社員コード。桁位置をそろえて縦に読めるようにする（モックの .ui-code） */
.announcement__code {
  display: block;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

/* カードの外に出る 4 状態の表示。面と枠線を自前で持つ */
.announcement__status {
  padding: var(--space-5);
  color: var(--color-text-muted);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

/* 履歴の 4 状態はカードの中なので、面と枠線は持たない */
.announcement__history-status {
  padding: var(--space-6) var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-align: center;
}

.announcement__status.is-loading,
.announcement__history-status.is-loading {
  display: flex;
  justify-content: center;
}

.announcement__status.is-error,
.announcement__history-status.is-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  color: var(--color-danger);
}
</style>
