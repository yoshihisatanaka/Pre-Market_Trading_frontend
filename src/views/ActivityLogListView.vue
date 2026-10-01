<script setup>
import { onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import ActivityLogDetailDialog from '@/components/activityLog/ActivityLogDetailDialog.vue'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSegmentedControl from '@/components/ui/BaseSegmentedControl.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
import { useListQuery } from '@/composables/useListQuery'
import { useActivityLogTargetsStore } from '@/stores/activityLogTargets'
import { useActivityLogsStore } from '@/stores/activityLogs'
import { useCodesStore } from '@/stores/codes'
import {
  ACTIVITY_SORT_OPTIONS,
  formatActivityAt,
  isActivitySort,
  operationBadgeVariant,
  operationLabel,
} from '@/utils/activityLogTypes'

/*
 * 操作ログ（監査ログ）の一覧。各マスタの変更履歴を横断して検索する。
 * 列・検索条件は実 API（openapi.json の ActivityLogItem と GET /operations/activity-logs の
 * クエリ）にあるものだけで組んでいる。
 *
 * 画面モック（https://uspreorder-vmbhej3k.manus.space/operations/activity-logs）からの意図的なずれ:
 *   - モックにある 操作者名 / 実行者区分 / 対象機能 / 操作内容 / 結果 は実 API に無いので出さない
 *     （追加を依頼中。docs/api/requests.md #1。提案する形は src/mocks/fixtures/activityLogs.js）
 *   - 変更前／変更後の 1 行表示の代わりに、変更項目を一覧に出し、差分は「詳細」のダイアログで見せる
 *     （実 API の変更前後はレコード全体の JSON なので、1 セルには収まらない）
 *   - モックは全件を sticky ヘッダ付きのスクロール領域に出すが、ここは 50 件ごとのページャー
 *   - 検索カードに「クリア」が増える（MasterSearchCard が検索とセットで持つ。既存画面と同じ）
 */

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useActivityLogsStore()
const { items, total, limit, offset, loading, error, isEmpty } = storeToRefs(store)

const targetsStore = useActivityLogTargetsStore()
const { options: targetOptions, error: targetsError } = storeToRefs(targetsStore)

// 対象種別の選択肢は一度取れたら使い回す（ストア側で未取得のときだけ読む）
onMounted(() => targetsStore.ensureLoaded())

/*
 * 操作区分の選択肢はコードマスタ `操作区分`（依頼中の契約提案）から。
 * App.vue がコードマスタを読み終えてから画面を描くので、setup の時点で揃っていて、
 * URL クエリの検査にもそのまま使える。一覧のバッジと名前は utils/activityLogTypes.js のまま。
 */
const codes = useCodesStore()
const operationOptions = codes.optionsFor('操作区分')
const isActivityOperation = (value) => operationOptions.some((option) => option.value === value)

const columns = [
  { key: 'at', label: '操作日時' },
  { key: 'targetTypeName', label: '対象種別' },
  { key: 'operation', label: '操作区分' },
  { key: 'operator', label: '操作者' },
  { key: 'targetKey', label: '対象キー' },
  { key: 'changedFields', label: '変更項目' },
  { key: 'actions', label: '' },
]

/*
 * ページ位置と検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名は実 API のクエリ名にそろえてある（ブックマークした URL と API の対応が読みやすい）。
 *
 * 選択肢が決まっている条件には parse を付け、手で書き換えられた URL クエリを空に落とす。
 * 対象種別は選択肢が API から来る（URL を読む時点ではまだ無いことがある）ので検査しない。
 * 知らない値はサーバが絞り込みに使うだけで、画面のセレクトは「全て」の表示になる。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'dateFrom', query: 'start_date' },
    { key: 'dateTo', query: 'end_date' },
    { key: 'operator', query: 'operator' },
    { key: 'operation', query: 'operation', parse: (v) => (isActivityOperation(v) ? v : '') },
    { key: 'targetType', query: 'target_types' },
    { key: 'targetKey', query: 'target_key' },
    { key: 'sort', query: 'sort', parse: (v) => (isActivitySort(v) ? v : '') },
  ],
  load: (params) => store.load(params),
})

/** 詳細ダイアログに出している行。閉じている間は null */
const detailLog = ref(null)

function openDetail(row) {
  detailLog.value = row
}

function closeDetail() {
  detailLog.value = null
}
</script>

<template>
  <section class="activity-log-list">
    <!-- 画面の説明。4 状態や検索結果に関わらず常時出す -->
    <BaseAlert variant="info" data-testid="activity-logs-description">
      各マスタの登録・更新・削除の履歴を横断して検索します。記録は参照のみで、追加・訂正・削除はできません。
    </BaseAlert>

    <!-- 画面モックの検索フォームが 3 列なので columns も 3 にする（既定は 4） -->
    <MasterSearchCard
      testid-prefix="activity-logs"
      :columns="3"
      :disabled="loading"
      @submit="submitSearch"
      @clear="clearSearch"
    >
      <FormField v-slot="{ field }" label="期間（From）">
        <BaseInput
          v-bind="field"
          v-model="inputs.dateFrom"
          type="date"
          data-testid="activity-logs-date-from"
        />
      </FormField>
      <FormField v-slot="{ field }" label="期間（To）">
        <BaseInput
          v-bind="field"
          v-model="inputs.dateTo"
          type="date"
          data-testid="activity-logs-date-to"
        />
      </FormField>
      <FormField v-slot="{ field }" label="操作者コード">
        <BaseInput
          v-bind="field"
          v-model="inputs.operator"
          placeholder="完全一致"
          data-testid="activity-logs-operator"
        />
      </FormField>
      <FormField v-slot="{ field }" label="操作区分">
        <BaseSelect
          v-bind="field"
          v-model="inputs.operation"
          :options="operationOptions"
          placeholder="-- 全て --"
          data-testid="activity-logs-operation"
        />
      </FormField>
      <!-- 取得に失敗しても検索自体はできる（対象種別なしで全マスタを横断する）ので、欄の下に出すだけ -->
      <FormField
        v-slot="{ field }"
        label="対象種別"
        :error="targetsError ? `対象種別を取得できませんでした（${targetsError.message}）` : ''"
      >
        <BaseSelect
          v-bind="field"
          v-model="inputs.targetType"
          :options="targetOptions"
          placeholder="-- 全て --"
          data-testid="activity-logs-target-type"
        />
      </FormField>
      <FormField v-slot="{ field }" label="対象キー">
        <BaseInput
          v-bind="field"
          v-model="inputs.targetKey"
          placeholder="口座番号・銘柄コードなど（部分一致）"
          data-testid="activity-logs-target-key"
        />
      </FormField>
      <!-- ボタンの並びなので label 要素と結び付けられない。名前は aria-label で持たせる -->
      <FormField label="並び順（操作日時）">
        <BaseSegmentedControl
          v-model="inputs.sort"
          :options="ACTIVITY_SORT_OPTIONS"
          aria-label="並び順（操作日時）"
          data-testid="activity-logs-sort"
        />
      </FormField>
    </MasterSearchCard>

    <MasterListCard
      testid-prefix="activity-logs"
      title="操作ログ"
      empty-message="該当する操作ログはありません。"
      :total="total"
      :limit="limit"
      :offset="offset"
      :loading="loading"
      :is-empty="isEmpty"
      :error="error"
      @reload="store.reload()"
      @update:offset="goToOffset"
    >
      <DataTable flat data-testid="activity-logs-table" :columns="columns" :rows="items">
        <template #cell-at="{ row }">
          <span class="activity-log-list__at">{{ formatActivityAt(row.at) }}</span>
        </template>

        <template #cell-operation="{ row }">
          <div class="activity-log-list__center">
            <BaseBadge :variant="operationBadgeVariant(row.operation)">
              {{ operationLabel(row.operation) }}
            </BaseBadge>
          </div>
        </template>

        <!-- 一括処理の行は操作者を持たない -->
        <template #cell-operator="{ row }">
          {{ row.operator || '—' }}
        </template>

        <template #cell-targetKey="{ row }">
          {{ row.targetKey || '—' }}
        </template>

        <template #cell-changedFields="{ row }">
          <span class="activity-log-list__fields">
            {{ row.changedFields.length > 0 ? row.changedFields.join('、') : '—' }}
          </span>
        </template>

        <template #cell-actions="{ row }">
          <BaseButton
            variant="secondary"
            size="sm"
            :data-testid="`activity-logs-detail-${row.id}`"
            @click="openDetail(row)"
          >
            詳細
          </BaseButton>
        </template>
      </DataTable>
    </MasterListCard>

    <ActivityLogDetailDialog :open="detailLog !== null" :log="detailLog" @close="closeDetail" />
  </section>
</template>

<style scoped>
.activity-log-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* 操作日時は桁を揃える（モックの ui-code 相当） */
.activity-log-list__at {
  font-variant-numeric: tabular-nums;
}

/* バッジだけを置くセル。モックと同じく中央寄せにする */
.activity-log-list__center {
  text-align: center;
}

.activity-log-list__fields {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
</style>
