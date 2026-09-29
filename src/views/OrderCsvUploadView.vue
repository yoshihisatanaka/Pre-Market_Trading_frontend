<script setup>
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FileDropZone from '@/components/ui/FileDropZone.vue'
import { useOrderCsvStore } from '@/stores/orderCsv'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useOrderCsvStore()
const { columns, columnsLoading, columnsError, isColumnsEmpty } = storeToRefs(store)

/** 取込む注文 CSV。選ぶまでは null */
const csvFile = ref(null)

/*
 * CSVフォーマットの表の列。行は実 API の列の仕様（全 22 列）で、画面モックの 17 列ではない。
 * 条件付きの必須（指値単価など）は説明の下に添える。
 */
const FORMAT_COLUMNS = [
  { key: 'name', label: '列名' },
  { key: 'description', label: '説明' },
  { key: 'example', label: '例' },
  { key: 'required', label: '必須' },
]

/*
 * テンプレートDL と内容の確認（事前検証）は処理が未実装（UI だけ先に置く）。
 * 押しても何も起きない。
 */
function downloadTemplate() {
  // TODO(処理実装): `GET /orders/csv-template` の CSV を order_template.csv として保存させる
}

function confirmContents() {
  // TODO(処理実装): csvFile を `POST /orders/validate-csv` に送り、結果をストアに置いて
  //   プレビュー画面（/orders/csv/preview。処理と一緒に作る）へ進む。
  //   送信中はボタンを押せなくし、失敗はこのカードに出す
}

// 初回読み込み。onMounted に置くと最初の描画で一瞬「空」が出る
store.loadColumns()
</script>

<template>
  <section class="order-csv-upload">
    <BaseCard title="CSVファイル取込み">
      <template #header-actions>
        <BaseButton
          variant="secondary"
          size="sm"
          data-testid="order-csv-template"
          @click="downloadTemplate"
        >
          <svg
            class="order-csv-upload__button-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          テンプレートDL
        </BaseButton>
      </template>

      <FileDropZone
        v-model="csvFile"
        accept=".csv,text/csv"
        label="クリックまたはドラッグ＆ドロップでCSVを選択"
        hint="UTF-8 / Shift-JIS 対応 · .csv ファイル"
        data-testid="order-csv-file"
      >
        <template #icon>
          <svg
            class="order-csv-upload__drop-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </template>
      </FileDropZone>

      <div class="order-csv-upload__submit">
        <BaseButton
          class="order-csv-upload__confirm"
          data-testid="order-csv-confirm"
          :disabled="!csvFile"
          @click="confirmContents"
        >
          <svg
            class="order-csv-upload__button-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          内容を確認する
        </BaseButton>
      </div>
    </BaseCard>

    <BaseCard title="CSVフォーマット">
      <!-- ローディング / エラー / 空 / データあり の 4 状態 -->
      <p
        v-if="columnsLoading"
        data-testid="order-csv-format-loading"
        class="order-csv-upload__status is-loading"
      >
        <BaseSpinner />
      </p>

      <div
        v-else-if="columnsError"
        data-testid="order-csv-format-error"
        class="order-csv-upload__status is-error"
      >
        <p>{{ columnsError.message }}</p>
        <BaseButton variant="secondary" @click="store.loadColumns()">再試行</BaseButton>
      </div>

      <p
        v-else-if="isColumnsEmpty"
        data-testid="order-csv-format-empty"
        class="order-csv-upload__status"
      >
        CSVフォーマットの定義がありません
      </p>

      <template v-else>
        <BaseAlert
          variant="info"
          class="order-csv-upload__legend"
          data-testid="order-csv-format-legend"
        >
          1行目はヘッダー行です。2行目以降が注文データとして取込まれます。<span
            class="order-csv-upload__required"
            >赤字</span
          >は必須項目です。
        </BaseAlert>

        <DataTable
          flat
          :columns="FORMAT_COLUMNS"
          :rows="columns"
          row-key="name"
          data-testid="order-csv-format-table"
        >
          <template #cell-name="{ row }">
            <span :class="{ 'order-csv-upload__required': row.required }">{{ row.name }}</span>
          </template>

          <template #cell-description="{ row }">
            <span class="order-csv-upload__description">
              {{ row.description }}
              <small v-if="row.condition" class="order-csv-upload__condition">
                {{ row.condition }}
              </small>
            </span>
          </template>

          <template #cell-example="{ value }">{{ value || '—' }}</template>

          <!-- ● / — は読み上げで意味を成さないので、支援技術には「必須 / 任意」を読ませる -->
          <template #cell-required="{ value }">
            <span :class="['order-csv-upload__mark', { 'is-required': value }]">
              <span aria-hidden="true">{{ value ? '●' : '—' }}</span>
              <span class="visually-hidden">{{ value ? '必須' : '任意' }}</span>
            </span>
          </template>
        </DataTable>
      </template>
    </BaseCard>
  </section>
</template>

<style scoped>
/* モックは本文を 860px に絞って中央に置く */
.order-csv-upload {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  max-width: 860px;
  margin: 0 auto;
}

/* アイコンの寸法は余白の尺度（--space-*）ではないので直値で持つ（既存方針） */
.order-csv-upload__button-icon {
  width: 15px;
  height: 15px;
}

.order-csv-upload__drop-icon {
  width: 48px;
  height: 48px;
}

.order-csv-upload__submit {
  display: flex;
  justify-content: center;
  margin-top: var(--space-4);
}

.order-csv-upload__confirm {
  min-width: 160px;
}

.order-csv-upload__status {
  padding: var(--space-6) var(--space-5);
  color: var(--color-text-muted);
  text-align: center;
}

.order-csv-upload__status.is-loading {
  display: flex;
  justify-content: center;
}

.order-csv-upload__status.is-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  color: var(--color-danger);
}

.order-csv-upload__legend {
  margin-bottom: var(--space-4);
}

/* 必須の列名と凡例の「赤字」。モックの .required-col */
.order-csv-upload__required {
  color: var(--color-danger);
  font-weight: 600;
}

/*
 * 説明は長文（発注範囲は 6 区分を並べる）。DataTable のセルは既定で nowrap だが、
 * white-space は継承なので span 側で normal に戻せば折り返せる。
 */
.order-csv-upload__description {
  display: inline-block;
  min-width: 260px;
  white-space: normal;
  font-size: var(--font-size-sm);
}

.order-csv-upload__condition {
  display: block;
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.order-csv-upload__mark {
  display: block;
  color: var(--color-input-placeholder);
  text-align: center;
}

.order-csv-upload__mark.is-required {
  color: var(--color-danger);
}
</style>
