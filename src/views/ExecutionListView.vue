<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import DataTable from '@/components/ui/DataTable.vue'
import DownloadIcon from '@/components/ui/DownloadIcon.vue'
import FormField from '@/components/ui/FormField.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
import { useListQuery } from '@/composables/useListQuery'
import { useCurrentOperatorStore } from '@/stores/currentOperator'
import { useExecutionsStore } from '@/stores/executions'
import { downloadBlob } from '@/utils/download'
import { formatMonthDayTime, formatQuantity, formatUsd } from '@/utils/format'

/*
 * 約定照会。一部出来 / 全部出来 / 取消済（出来有）の約定を検索する（読むだけの一覧）。
 *   - ヘッダの「CSV出力」は、いま一覧に出ている検索条件で GET /executions/export-csv を落とす
 *   - 預託先（検索条件の「預託先区分」と列の「預託先」）は管理者・管理責任者にだけ出す（GET /auth/me のロール）
 *
 * 画面モック（premarket-order-202609 の execution_management.html）からの意図的なずれ:
 *   - 約定金額は円ではなく USD の約定代金を出す（ExecutionItem が円貨の項目を持たない）
 *   - 「一部出来」の件数カードは '—' のまま（ExecutionSummary に一部出来の件数が無い）
 *   - 一覧カードのヘッダにある 2 つ目の CSV ボタンは置かない（ヘッダの「CSV出力」と同じ操作。
 *     MasterListCard のヘッダは件数の表示が占めている）
 *   - 件数カードの売買の色は表と同じ 買=赤 / 売=青 に揃えた（モックはカードだけ逆）
 *   - モックは全件を sticky ヘッダ付きのスクロール領域に出すが、ここは 50 件ごとのページャー
 *   - 検索カードに「クリア」が常に出る（MasterSearchCard が検索とセットで持つ。既存画面と同じ）
 */

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useExecutionsStore()
const { items, total, limit, offset, loading, error, isEmpty, summary, exporting, exportError } =
  storeToRefs(store)

/*
 * 預託先を見られるロール（値は /auth/me のロールコード）。
 * 画面モックは manager と admin に出すが、admin は開発中用のロールなので、
 * 実在する上位のロールである管理責任者（supervisor）に置き換えた。
 *
 * /auth/me を読み終える前と、読めなかったときは出さない（誤って出さない側に倒す。
 * stores/currentOperator.js と同じ方針）。ensureLoaded は main.js が起動時に始めているので
 * 通常は何もしない（ガードを通らない単体テストのための保険）。
 */
const ROUTE_VIEWER_ROLES = ['manager', 'supervisor']

const currentOperator = useCurrentOperatorStore()
currentOperator.ensureLoaded()
const canViewRoute = computed(() =>
  ROUTE_VIEWER_ROLES.includes(currentOperator.operator?.roleCode),
)

/** 売買区分。値はアプリ内の向きで、コードへの変換は api 層が行う */
const SIDE_OPTIONS = [
  { value: 'buy', label: '買い' },
  { value: 'sell', label: '売り' },
]

/*
 * 出来状況。値は処理状況コード（実 API の status にそのまま載る）。
 * 取消済は 032 / 034 の 2 つがあるが、status は 1 つのコードしか受けないので、
 * ひとまず即時取消・発注失敗の取消済（034）だけを選ばせる。
 * TODO(処理実装): 032 も拾う指定のしかたをバックエンドに確認する
 */
const STATUS_OPTIONS = [
  { value: '011', label: '全部出来' },
  { value: '010', label: '一部出来' },
  { value: '034', label: '取消済（出来有）' },
]

/** 預託先区分。値は注文ルートのコード（0:みずほ / 1:IB） */
const ROUTE_OPTIONS = [
  { value: '1', label: 'IB' },
  { value: '0', label: 'みずほ' },
]

/**
 * 出来状況の表示名と色。約定のある注文しか載らない一覧なので、取消済は必ず「出来有」になる
 * （モックの表記に合わせ、サーバの処理状況名ではなくここの名前を出す）。
 * 知らないコードはサーバの処理状況名をそのまま出し、色は付けない。
 */
const STATUS_DISPLAY = {
  '011': { label: '全部出来', tone: 'full' },
  '010': { label: '一部出来', tone: 'partial' },
  '032': { label: '取消済（出来有）', tone: 'canceled' },
  '034': { label: '取消済（出来有）', tone: 'canceled' },
}

const SIDE_LABELS = { buy: '買', sell: '売' }

/**
 * 列は画面モックの並びどおり（約定金額だけ USD に置き換えた。冒頭のコメント）。
 * 末尾の「預託先」は見られるロールのときだけ足す
 */
const BASE_COLUMNS = [
  { key: 'id', label: '約定ID' },
  { key: 'orderId', label: '注文ID' },
  { key: 'accountNumber', label: '口座番号', numeric: true },
  { key: 'customerName', label: '顧客名' },
  { key: 'ticker', label: '銘柄' },
  { key: 'side', label: '売買' },
  { key: 'orderQuantity', label: '元注文数量', numeric: true },
  { key: 'quantity', label: '約定数量', numeric: true },
  { key: 'price', label: '約定単価(USD)', numeric: true },
  { key: 'amountUsd', label: '約定代金(USD)', numeric: true },
  { key: 'executedAt', label: '約定日時' },
  { key: 'status', label: '出来状況' },
]

const columns = computed(() => [
  ...BASE_COLUMNS,
  ...(canViewRoute.value ? [{ key: 'routeName', label: '預託先' }] : []),
])

/** 選択肢に無い値（手で書き換えられた URL クエリ）を空に落とす */
function oneOf(options) {
  return (value) => (options.some((option) => option.value === value) ? value : '')
}

/*
 * 預託先を見られない利用者は、URL に route が残っていても（ブックマーク・手書き）条件に使わない。
 * 見えない条件で絞られると、件数が合わない理由を画面から辿れないため（CSV 出力も同じ条件を使う）。
 * useListQuery の queryKey は computed なので、ここで読んだ canViewRoute の変化も追う。
 * /auth/me が一覧より後に届いたときは、route を含めた条件で読み直される。
 */
const parseRoute = oneOf(ROUTE_OPTIONS)

/*
 * ページ位置と検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名は実 API のクエリ名にそろえてある（ブックマークした URL と API の対応が読みやすい）。
 * 売買区分だけは値がアプリ内の向き（buy / sell）で、コードとは違う。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'branchCode', query: 'branch_code' },
    { key: 'symbol', query: 'symbol' },
    { key: 'side', query: 'side', parse: oneOf(SIDE_OPTIONS) },
    { key: 'status', query: 'status', parse: oneOf(STATUS_OPTIONS) },
    { key: 'dateFrom', query: 'start_date' },
    { key: 'dateTo', query: 'end_date' },
    {
      key: 'route',
      query: 'route',
      parse: (value) => (canViewRoute.value ? parseRoute(value) : ''),
    },
  ],
  load: (params) => store.load(params),
})

/*
 * 件数カード。集計は一覧と同じ応答に入っている。
 * 取得中とエラーのときは '—' にする（確定前の値を出すと、前回の集計が新しい結果に見える）。
 */
const summaryReady = computed(() => !loading.value && !error.value && summary.value !== null)

const stats = computed(() => [
  {
    testid: 'executions-summary-count',
    label: '総約定件数',
    value: summaryReady.value ? summary.value.count : null,
    tone: '',
  },
  {
    testid: 'executions-summary-buy',
    label: '買い約定',
    value: summaryReady.value ? summary.value.buyCount : null,
    tone: 'buy',
  },
  {
    testid: 'executions-summary-sell',
    label: '売り約定',
    value: summaryReady.value ? summary.value.sellCount : null,
    tone: 'sell',
  },
  // TODO(処理実装): ExecutionSummary に一部出来の件数が入ったら api 層の toSummary() に足して出す
  { testid: 'executions-summary-partial', label: '一部出来', value: null, tone: 'partial' },
])

/**
 * 約定単価はモックどおり小数第 4 位まで出す（formatUsd は第 2 位まで）。
 * 表記は全画面の金額と同じく「数字 + ドル」の後置
 */
const usdPrice = new Intl.NumberFormat('ja-JP', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
})

function priceLabel(value) {
  return value === null ? '—' : `${usdPrice.format(value)} ドル`
}

function statusLabel(row) {
  return STATUS_DISPLAY[row.status]?.label ?? (row.statusName || '—')
}

function statusTone(row) {
  return STATUS_DISPLAY[row.status]?.tone ?? 'unknown'
}

/*
 * CSV 出力。条件はいま一覧に出ているもの（ストアが最後に読んだ条件で、検索欄に入力しただけの値は使わない）。
 * 取得中・エラー・0 件のときは押せない（一覧と食い違う条件で出る・出すものが無い）。
 * 列と並びはバックエンドが決める（条件に合う全件。上限 10,000 件・約定日時の昇順）。
 */
const canExport = computed(
  () => !loading.value && !error.value && !isEmpty.value && !exporting.value,
)

// ストアは画面を離れても残る。戻ってきたときに前回の出力の失敗を出し直さない
store.clearExportError()

async function exportCsv() {
  const file = await store.exportCsv()
  // 失敗の理由は exportError で出す
  if (file) downloadBlob(file.filename, file.blob)
}
</script>

<template>
  <section class="execution-list">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む -->
    <Teleport defer to="#topbar-actions">
      <BaseButton
        variant="secondary"
        size="sm"
        data-testid="executions-export"
        :disabled="!canExport"
        @click="exportCsv"
      >
        <DownloadIcon />
        {{ exporting ? '出力中…' : 'CSV出力' }}
      </BaseButton>
    </Teleport>

    <!-- CSV 出力の失敗。ボタンがヘッダにあるので画面の先頭に出す（一覧はそのまま残す） -->
    <BaseAlert v-if="exportError" variant="error" data-testid="executions-export-error">
      {{ exportError.message }}
    </BaseAlert>

    <MasterSearchCard
      testid-prefix="executions"
      :disabled="loading"
      @submit="submitSearch"
      @clear="clearSearch"
    >
      <FormField v-slot="{ field }" label="部店コード">
        <BaseInput
          v-bind="field"
          v-model="inputs.branchCode"
          placeholder="例: 123"
          data-testid="executions-branch-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="銘柄コード">
        <BaseInput
          v-bind="field"
          v-model="inputs.symbol"
          placeholder="例: AAPL"
          data-testid="executions-symbol"
        />
      </FormField>
      <FormField v-slot="{ field }" label="売買区分">
        <BaseSelect
          v-bind="field"
          v-model="inputs.side"
          :options="SIDE_OPTIONS"
          placeholder="-- 全て --"
          data-testid="executions-side"
        />
      </FormField>
      <FormField v-slot="{ field }" label="出来状況">
        <BaseSelect
          v-bind="field"
          v-model="inputs.status"
          :options="STATUS_OPTIONS"
          placeholder="-- 全て --"
          data-testid="executions-status"
        />
      </FormField>
      <FormField v-slot="{ field }" label="約定日（From）">
        <BaseInput
          v-bind="field"
          v-model="inputs.dateFrom"
          type="date"
          data-testid="executions-date-from"
        />
      </FormField>
      <FormField v-slot="{ field }" label="約定日（To）">
        <BaseInput
          v-bind="field"
          v-model="inputs.dateTo"
          type="date"
          data-testid="executions-date-to"
        />
      </FormField>
      <!-- 見られるロールのときだけ出す（列の「預託先」と同じ） -->
      <FormField v-if="canViewRoute" v-slot="{ field }" label="預託先区分">
        <BaseSelect
          v-bind="field"
          v-model="inputs.route"
          :options="ROUTE_OPTIONS"
          placeholder="-- 全て --"
          data-testid="executions-route"
        />
      </FormField>
    </MasterSearchCard>

    <!-- 件数カード。一覧の 4 状態の外に置く（0 件でも「0」を出す） -->
    <div class="execution-list__stats">
      <BaseCard v-for="stat in stats" :key="stat.testid" :data-testid="stat.testid">
        <div class="execution-list__stat-label">{{ stat.label }}</div>
        <!-- 値が無い（'—'）ときは色を付けない。色付きの '—' は値の一種に見える -->
        <div
          :class="[
            'execution-list__stat-value',
            stat.value !== null && stat.tone && `is-${stat.tone}`,
          ]"
        >
          {{ formatQuantity(stat.value) }}
        </div>
      </BaseCard>
    </div>

    <MasterListCard
      testid-prefix="executions"
      title="約定一覧"
      empty-message="該当する約定はありません。"
      :total="total"
      :limit="limit"
      :offset="offset"
      :loading="loading"
      :is-empty="isEmpty"
      :error="error"
      @reload="store.reload()"
      @update:offset="goToOffset"
    >
      <!-- 行のキーは DataTable の既定（id = 約定ID）に任せる -->
      <DataTable flat data-testid="executions-table" :columns="columns" :rows="items">
        <!-- 約定ID・注文ID はモックに合わせて # を前置する -->
        <template #cell-id="{ value }">
          <span class="execution-list__code">#{{ value }}</span>
        </template>
        <template #cell-orderId="{ value }">
          <span class="execution-list__code">#{{ value }}</span>
        </template>

        <template #cell-accountNumber="{ value }">{{ value || '—' }}</template>
        <template #cell-customerName="{ value }">{{ value || '—' }}</template>

        <!-- 銘柄はティッカーで出す。未設定のときは銘柄コードで代える -->
        <template #cell-ticker="{ row }">
          <span class="execution-list__symbol">{{ row.ticker || row.symbolCode || '—' }}</span>
        </template>

        <!-- 売買はモックどおり 買=赤 / 売=青 の太字。知らないコードのときは色を付けない -->
        <template #cell-side="{ value }">
          <span :class="['execution-list__side', `is-${value || 'unknown'}`]">
            {{ SIDE_LABELS[value] ?? '—' }}
          </span>
        </template>

        <template #cell-orderQuantity="{ value }">{{ formatQuantity(value) }}</template>
        <template #cell-quantity="{ value }">{{ formatQuantity(value) }}</template>
        <template #cell-price="{ value }">{{ priceLabel(value) }}</template>
        <template #cell-amountUsd="{ value }">{{ formatUsd(value) }}</template>

        <template #cell-executedAt="{ value }">
          <span class="execution-list__at">{{ formatMonthDayTime(value) }}</span>
        </template>

        <template #cell-status="{ row }">
          <span :class="['execution-list__status', `is-${statusTone(row)}`]">
            {{ statusLabel(row) }}
          </span>
        </template>

        <template #cell-routeName="{ value }">
          <div class="execution-list__center">{{ value || '—' }}</div>
        </template>
      </DataTable>
    </MasterListCard>
  </section>
</template>

<style scoped>
.execution-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* 件数カードの並び。モックの .grid-4 と同じく、狭い画面では 2 列 → 1 列へ畳む */
.execution-list__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
}

@media (max-width: 900px) {
  .execution-list__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .execution-list__stats {
    grid-template-columns: 1fr;
  }
}

.execution-list__stat-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  letter-spacing: 0.05em;
}

.execution-list__stat-value {
  margin-top: var(--space-1);
  color: var(--color-text-heading);
  font-size: var(--font-size-2xl);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.execution-list__stat-value.is-buy {
  color: var(--color-buy);
}

.execution-list__stat-value.is-sell {
  color: var(--color-sell);
}

.execution-list__stat-value.is-partial {
  color: var(--color-warning);
}

/* 約定ID・注文ID。モックの ui-code（小さめ・桁揃え） */
.execution-list__code {
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
}

.execution-list__symbol {
  font-weight: 500;
}

.execution-list__side.is-buy {
  color: var(--color-buy);
  font-weight: 600;
}

.execution-list__side.is-sell {
  color: var(--color-sell);
  font-weight: 600;
}

.execution-list__at {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
}

/* 出来状況。全部出来=緑 / 一部出来=琥珀 / 取消済（出来有）=赤（モックの配色） */
.execution-list__status.is-full {
  color: var(--color-success);
  font-weight: 600;
}

.execution-list__status.is-partial {
  color: var(--color-warning);
  font-weight: 600;
}

.execution-list__status.is-canceled {
  color: var(--color-danger-text);
  font-weight: 600;
}

/* 預託先はモックと同じく中央寄せにする */
.execution-list__center {
  text-align: center;
  font-size: var(--font-size-xs);
}
</style>
