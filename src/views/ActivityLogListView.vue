<script setup>
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
import { useListQuery } from '@/composables/useListQuery'
import { useActivityLogsStore } from '@/stores/activityLogs'
import {
  ACTIVITY_ACTION_OPTIONS,
  ACTIVITY_ACTOR_GROUP_OPTIONS,
  ACTIVITY_ACTOR_OPTIONS,
  ACTIVITY_CATEGORY_OPTIONS,
  ACTIVITY_FEATURE_OPTIONS,
  ACTIVITY_RESULT_OPTIONS,
  categoryBadgeVariant,
  formatActivityAt,
  isActivityAction,
  isActivityActor,
  isActivityActorGroup,
  isActivityCategory,
  isActivityFeature,
  isActivityResult,
  resultBadgeVariant,
} from '@/utils/activityLogTypes'

/*
 * 操作ログ（監査ログ）の一覧。いまは見た目だけで、実 API とは繋がっていない
 * （src/mocks/handlers/index.js のモックが応えている）。
 * モックと実 API の食い違いは src/api/activityLogs.js の冒頭に書いてある。
 *
 * 画面モックからの意図的なずれが 3 つある。
 *   - モックは全件を sticky ヘッダ付きのスクロール領域に出すが、ここは 50 件ごとのページャー
 *     （MasterListCard が持つ）。件数が増えても壊れないほうを採る
 *   - 検索カードに「クリア」が増える（MasterSearchCard が検索とセットで持つ。既存 6 画面と同じ）
 *   - ヘッダに「再読み込み」を置く（同上。エラー状態からの復帰導線にもなる）
 */

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useActivityLogsStore()
const { items, total, limit, offset, loading, error, isEmpty } = storeToRefs(store)

/* 列は画面モック（https://uspreorder-vmbhej3k.manus.space/operations/activity-logs）の並びどおり */
const columns = [
  { key: 'at', label: '操作日時' },
  { key: 'category', label: '操作区分' },
  { key: 'actor', label: '操作者' },
  { key: 'action', label: '対象機能・操作' },
  { key: 'target', label: '対象' },
  { key: 'change', label: '変更前／変更後' },
  { key: 'note', label: '内容・理由' },
  { key: 'result', label: '結果' },
]

/*
 * ページ位置と検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名は画面モックの form と同じ契約で、この filters 定義にだけ現れる
 * （実 API 側の operator / target_key への読み替えは api 層が行う）。
 *
 * 選択肢が決まっている条件には parse を付け、手で書き換えられた URL クエリを空に落とす。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'dateFrom', query: 'date_from' },
    { key: 'dateTo', query: 'date_to' },
    { key: 'actorCode', query: 'actor_code', parse: (v) => (isActivityActor(v) ? v : '') },
    { key: 'category', query: 'category', parse: (v) => (isActivityCategory(v) ? v : '') },
    { key: 'feature', query: 'feature', parse: (v) => (isActivityFeature(v) ? v : '') },
    { key: 'action', query: 'action', parse: (v) => (isActivityAction(v) ? v : '') },
    { key: 'actorGroup', query: 'actor_group', parse: (v) => (isActivityActorGroup(v) ? v : '') },
    { key: 'result', query: 'result', parse: (v) => (isActivityResult(v) ? v : '') },
    { key: 'keyword', query: 'keyword' },
  ],
  load: (params) => store.load(params),
})

/**
 * 操作者セルの副行。`営業員・003` の形。
 * 取込バッチのように操作者コードを持たない行では、実行者区分だけを出す。
 */
function actorRoleLabel(row) {
  return row.actorCode ? `${row.actorRole}・${row.actorCode}` : row.actorRole
}
</script>

<template>
  <section class="activity-log-list">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む -->
    <Teleport defer to="#topbar-actions">
      <BaseButton
        variant="secondary"
        data-testid="activity-logs-reload"
        :disabled="loading"
        @click="store.reload()"
      >
        再読み込み
      </BaseButton>
    </Teleport>

    <!-- 画面の説明。4 状態や検索結果に関わらず常時出す -->
    <BaseAlert variant="info" data-testid="activity-logs-description">
      注文やマスタ更新の操作履歴を横断して検索します。記録は参照のみで、追加・訂正・削除はできません。
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
      <FormField v-slot="{ field }" label="操作者">
        <BaseSelect
          v-bind="field"
          v-model="inputs.actorCode"
          :options="ACTIVITY_ACTOR_OPTIONS"
          placeholder="-- 全て --"
          data-testid="activity-logs-actor-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="操作区分">
        <BaseSelect
          v-bind="field"
          v-model="inputs.category"
          :options="ACTIVITY_CATEGORY_OPTIONS"
          placeholder="-- 全て --"
          data-testid="activity-logs-category"
        />
      </FormField>
      <FormField v-slot="{ field }" label="対象機能">
        <BaseSelect
          v-bind="field"
          v-model="inputs.feature"
          :options="ACTIVITY_FEATURE_OPTIONS"
          placeholder="-- 全て --"
          data-testid="activity-logs-feature"
        />
      </FormField>
      <FormField v-slot="{ field }" label="操作内容">
        <BaseSelect
          v-bind="field"
          v-model="inputs.action"
          :options="ACTIVITY_ACTION_OPTIONS"
          placeholder="-- 全て --"
          data-testid="activity-logs-action"
        />
      </FormField>
      <FormField v-slot="{ field }" label="実行者区分">
        <BaseSelect
          v-bind="field"
          v-model="inputs.actorGroup"
          :options="ACTIVITY_ACTOR_GROUP_OPTIONS"
          placeholder="-- 全て --"
          data-testid="activity-logs-actor-group"
        />
      </FormField>
      <FormField v-slot="{ field }" label="結果">
        <BaseSelect
          v-bind="field"
          v-model="inputs.result"
          :options="ACTIVITY_RESULT_OPTIONS"
          placeholder="-- 全て --"
          data-testid="activity-logs-result"
        />
      </FormField>
      <FormField v-slot="{ field }" label="対象ID・名称">
        <BaseInput
          v-bind="field"
          v-model="inputs.keyword"
          placeholder="注文ID・銘柄・顧客名など"
          data-testid="activity-logs-keyword"
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

        <template #cell-category="{ row }">
          <div class="activity-log-list__center">
            <BaseBadge :variant="categoryBadgeVariant(row.category)">{{ row.category }}</BaseBadge>
          </div>
        </template>

        <template #cell-actor="{ row }">
          {{ row.actorName }}
          <span class="activity-log-list__sub">{{ actorRoleLabel(row) }}</span>
        </template>

        <!-- 対象機能を小さく上段に、操作内容を下段に置く（モックの activity-feature 相当） -->
        <template #cell-action="{ row }">
          <span class="activity-log-list__feature">{{ row.feature }}</span>
          {{ row.action }}
        </template>

        <template #cell-target="{ row }">
          <span class="activity-log-list__target">{{ row.targetLabel }}</span>
          <span class="activity-log-list__sub">{{ row.targetKey }}</span>
        </template>

        <!-- 変更前と変更後を 2 行で。無い側は他の列の空値表現と同じ '—' を出す -->
        <template #cell-change="{ row }">
          <div class="activity-log-list__change">
            <div>
              <span class="activity-log-list__change-label">変更前</span>{{ row.before || '—' }}
            </div>
            <div>
              <span class="activity-log-list__change-label">変更後</span>{{ row.after || '—' }}
            </div>
          </div>
        </template>

        <template #cell-note="{ row }">
          <div class="activity-log-list__change">
            {{ row.note || '—' }}
            <span v-if="row.targetCount !== null" class="activity-log-list__count">
              対象 {{ row.targetCount }} 件
            </span>
          </div>
        </template>

        <template #cell-result="{ row }">
          <div class="activity-log-list__center">
            <BaseBadge :variant="resultBadgeVariant(row.result)">{{ row.result }}</BaseBadge>
          </div>
        </template>
      </DataTable>
    </MasterListCard>
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

/* 主内容の下に添える小さい灰色の行（操作者の役割・対象のキー） */
.activity-log-list__sub {
  display: block;
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

/* 主内容の上に添える小さい灰色の行（対象機能） */
.activity-log-list__feature {
  display: block;
  margin-bottom: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.activity-log-list__target {
  font-weight: 500;
}

.activity-log-list__change {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  line-height: 1.55;
}

/* 「変更前」「変更後」のラベル。値の開始位置をそろえたいので幅を固定する */
.activity-log-list__change-label {
  display: inline-block;
  width: 3.5em;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.activity-log-list__count {
  display: block;
  margin-top: var(--space-1);
  font-size: var(--font-size-xs);
}
</style>
