<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import ActivityLogDetailDialog from '@/components/activityLog/ActivityLogDetailDialog.vue'
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
  ACTIVITY_CATEGORY_OPTIONS,
  ACTIVITY_SORT_OPTIONS,
  categoryBadgeVariant,
  categoryLabel,
  categoryOf,
  formatActivityAt,
  isActivityCategory,
  isActivitySort,
  operationLabel,
  targetTypesFor,
} from '@/utils/activityLogTypes'

/*
 * 操作ログ（監査ログ）の一覧。各マスタと運用管理（発注停止・お知らせ）の変更履歴を横断して検索する。
 * 検索条件と列の呼び名は画面モック（https://uspreorder-vmbhej3k.manus.space/operations/activity-logs）に
 * 合わせ、実 API（openapi.json の ActivityLogItem と GET /operations/activity-logs のクエリ）に
 * 無いものはクエリに載せない。
 *
 * モックと実 API の言葉の対応（utils/activityLogTypes.js の冒頭も参照）:
 *   - 操作区分（業務操作 / マスタ更新 / 運用管理）… 実 API に無い。対象種別から導く区分で、
 *     検索では `target_types`（対象種別のカンマ区切り）に展開して送る。業務操作は注文の操作ログが
 *     実 API に無いので選択肢に出さない（docs/api/requests.md #38）
 *   - 対象機能 … 実 API の対象種別（`target_types`）
 *   - 操作内容 … 実 API の操作区分（`operation`。登録 / 更新 / 削除 / 停止 …）
 *   - 対象キー … 実 API の `target_key`（口座番号・銘柄コードなどの部分一致。モックの「対象ID・名称」の
 *     うち顧客名などの名称は実 API が対象キーに持たないので、名前は「対象キー」のまま）
 *
 * モックからの意図的なずれ:
 *   - モックにある 実行者区分 / 結果 の条件は実 API のクエリに無いので置かない
 *     （実行者区分は #38 で依頼中。結果 は「履歴は成功した変更しか残さない」ため追加しない回答）
 *   - 操作者はモックのように氏名付きの選択肢にできない（操作者の一覧 API が無い。#38）。コードの入力欄
 *   - 変更前／変更後の 1 行表示の代わりに、変更項目を一覧に出し、差分は「詳細」のダイアログで見せる
 *     （実 API の変更前後はレコード全体の JSON なので、1 セルには収まらない）
 *   - モックは全件を sticky ヘッダ付きのスクロール領域に出すが、ここは 50 件ごとのページャー
 *   - 検索カードに「クリア」と並び順が増える（MasterSearchCard が検索とセットで持つ。既存画面と同じ）
 */

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useActivityLogsStore()
const { items, total, limit, offset, loading, error, isEmpty } = storeToRefs(store)

const targetsStore = useActivityLogTargetsStore()
const { targets, options: targetOptions, error: targetsError } = storeToRefs(targetsStore)

/*
 * 対象種別の選択肢は一度取れたら使い回す（ストア側で未取得のときだけ読む）。
 * 一覧の初回読み込み（下の useListQuery）が「区分」を対象種別に展開するときに完了を待つので、
 * onMounted ではなく setup で先に始める。
 */
targetsStore.ensureLoaded()

/*
 * 操作内容の選択肢はコードマスタ `操作区分` から。
 * App.vue がコードマスタを読み終えてから画面を描くので、setup の時点で揃っていて、
 * URL クエリの検査にもそのまま使える。
 */
const codes = useCodesStore()
const operationOptions = codes.optionsFor('操作区分')
const isActivityOperation = (value) => operationOptions.some((option) => option.value === value)

/** 操作内容の表示名。コードマスタの名称を優先し、無ければ utils の表示名（未知の値はそのまま） */
function operationName(operation) {
  return operationOptions.find((option) => option.value === operation)?.label ?? operationLabel(operation)
}

const columns = [
  { key: 'at', label: '操作日時' },
  { key: 'category', label: '操作区分' },
  { key: 'operator', label: '操作者' },
  { key: 'feature', label: '対象機能・操作' },
  { key: 'targetKey', label: '対象キー' },
  { key: 'changedFields', label: '変更項目' },
  { key: 'actions', label: '' },
]

/*
 * ページ位置と検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名は実 API のクエリ名にそろえてある（ブックマークした URL と API の対応が読みやすい）。
 * `category`（区分）だけは実 API に無い画面側の条件なので、画面の言葉のまま置く。
 *
 * 選択肢が決まっている条件には parse を付け、手で書き換えられた URL クエリを空に落とす。
 * 対象機能は選択肢が API から来る（URL を読む時点ではまだ無いことがある）ので検査しない。
 * 知らない値はサーバが絞り込みに使うだけで、画面のセレクトは「全て」の表示になる。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'dateFrom', query: 'start_date' },
    { key: 'dateTo', query: 'end_date' },
    { key: 'operator', query: 'operator' },
    { key: 'category', query: 'category', parse: (v) => (isActivityCategory(v) ? v : '') },
    { key: 'targetType', query: 'target_types' },
    { key: 'operation', query: 'operation', parse: (v) => (isActivityOperation(v) ? v : '') },
    { key: 'targetKey', query: 'target_key' },
    { key: 'sort', query: 'sort', parse: (v) => (isActivitySort(v) ? v : '') },
  ],
  load: loadLogs,
})

/**
 * 区分 / 対象機能 を実 API の対象種別の並びに展開してから読み込む。
 * マスタ更新の展開には対象種別の一覧が要るので、区分だけで絞るときは取得の完了を待つ
 * （取得済みなら ensureLoaded は undefined を返し、待ちは入らない）。
 */
async function loadLogs({ category, targetType, ...rest }) {
  if (category && !targetType) {
    const loadingTargets = targetsStore.ensureLoaded()
    if (loadingTargets) await loadingTargets
  }
  return store.load({
    ...rest,
    targetTypes: targetTypesFor({ category, targetType, targets: targets.value }),
  })
}

/*
 * 対象機能の選択肢は区分で絞る（運用管理を選べば発注停止・お知らせだけが並ぶ）。
 * 区分を変えたとき、いま選んでいる対象機能がその区分に無ければ外す。
 */
const targetOptionsForCategory = computed(() =>
  inputs.category
    ? targetOptions.value.filter((option) => categoryOf(option.value) === inputs.category)
    : targetOptions.value,
)

function onCategoryChange(category) {
  inputs.category = category
  if (category && inputs.targetType && categoryOf(inputs.targetType) !== category) {
    inputs.targetType = ''
  }
}

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
      <FormField v-slot="{ field }" label="操作者">
        <BaseInput
          v-bind="field"
          v-model="inputs.operator"
          placeholder="操作者コード（完全一致）"
          data-testid="activity-logs-operator"
        />
      </FormField>
      <FormField v-slot="{ field }" label="操作区分">
        <BaseSelect
          v-bind="field"
          :model-value="inputs.category"
          :options="ACTIVITY_CATEGORY_OPTIONS"
          placeholder="-- 全て --"
          data-testid="activity-logs-category"
          @update:model-value="onCategoryChange"
        />
      </FormField>
      <!-- 取得に失敗しても検索自体はできる（対象機能なしで全マスタを横断する）ので、欄の下に出すだけ -->
      <FormField
        v-slot="{ field }"
        label="対象機能"
        :error="targetsError ? `対象機能を取得できませんでした（${targetsError.message}）` : ''"
      >
        <BaseSelect
          v-bind="field"
          v-model="inputs.targetType"
          :options="targetOptionsForCategory"
          placeholder="-- 全て --"
          data-testid="activity-logs-target-type"
        />
      </FormField>
      <FormField v-slot="{ field }" label="操作内容">
        <BaseSelect
          v-bind="field"
          v-model="inputs.operation"
          :options="operationOptions"
          placeholder="-- 全て --"
          data-testid="activity-logs-operation"
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

        <!-- 区分は対象種別から導く（モックの .activity-kind。マスタ更新は緑、運用管理は灰） -->
        <template #cell-category="{ row }">
          <div class="activity-log-list__center">
            <BaseBadge :variant="categoryBadgeVariant(categoryOf(row.targetType))">
              {{ categoryLabel(categoryOf(row.targetType)) }}
            </BaseBadge>
          </div>
        </template>

        <!-- 氏名の下に 実行者区分・コード（モックと同じ）。一括処理の行は操作者コードを持たない -->
        <template #cell-operator="{ row }">
          <span>{{ row.operatorName || row.operator || '—' }}</span>
          <span v-if="row.operatorRole || row.operator" class="activity-log-list__sub">
            {{ [row.operatorRole, row.operator].filter(Boolean).join('・') }}
          </span>
        </template>

        <!-- 対象機能（対象種別名）の下に操作内容（サーバの表示文。無ければ操作区分の名称） -->
        <template #cell-feature="{ row }">
          <span class="activity-log-list__sub">{{ row.feature || row.targetTypeName }}</span>
          <span>{{ row.operationText || operationName(row.operation) }}</span>
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

/* セルの 2 段目（実行者区分・コード / 対象機能）。モックの .activity-role / .activity-feature 相当 */
.activity-log-list__sub {
  display: block;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.activity-log-list__fields {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
</style>
