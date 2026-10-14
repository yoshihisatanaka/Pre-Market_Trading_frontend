<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseCheckbox from '@/components/ui/BaseCheckbox.vue'
import DataTable from '@/components/ui/DataTable.vue'
import { useOrderCsvStore } from '@/stores/orderCsv'
import { formatCompactMonthDay, formatCompactTime, formatQuantity } from '@/utils/format'
import {
  DEPOSIT_CATEGORY_LABELS,
  EXECUTION_SCOPE_LABELS,
  SETTLEMENT_CURRENCY_LABELS,
  SIDE_LABELS,
  TRANSACTION_TYPE_LABELS,
  codeLabel,
  orderPriceLabel,
} from '@/utils/orderCodeLabels'

/*
 * CSV取込みプレビュー。取込み画面で事前検証した結果（ストアの validation）を行ごとに見せ、
 * NG の行が無くなったら一括受付へ進める。
 *
 * NG の行のうち強制区分=1 なら受け付けられる行（余力不足など。サーバが forceable で返す）は、
 * 「強制」欄のチェックで強制を指定できる。CSV に強制区分の列は書けない（2026-10-13 の方針変更で廃止。
 * docs/api/requests.md #58）ので、エラー内容を画面で確かめてから行ごとに決めてもらう。
 * NG の行がすべて強制で救われたら受付でき、その行は強制区分=1 で送る。
 *
 * 検証そのものは取込み画面で済んでいて、この画面は読み込みを持たない。4 状態は次のとおり:
 *   ローディング … 取込み画面の「内容を確認する」が受け持つ（この画面に来た時点で結果がある）
 *   エラー       … 取込み画面に留まって理由を出す。この画面のエラーは一括受付の失敗だけ
 *   空           … 結果が無い（URL を直接開いた・再読み込みした・受付を済ませた）/ CSV にデータ行が無い
 *   データあり   … 件数・表・受付ボタン
 *
 * 顧客名はサーバが口座から引いた名前（docs/api/requests.md #27）。引けなかった行は「—」。
 */

const store = useOrderCsvStore()
const { validation, submitting, submitError, canSubmit, forcedCount, unresolvedCount } =
  storeToRefs(store)
const { isForced, setForced } = store
const router = useRouter()

/** 列の並びは画面モック（order_csv_preview）どおり。値は行の order から slot で描く */
const COLUMNS = [
  { key: 'rowNumber', label: '行', numeric: true },
  { key: 'state', label: '状態' },
  { key: 'account', label: '口座番号' },
  { key: 'customerName', label: '顧客名' },
  { key: 'symbol', label: '銘柄' },
  { key: 'side', label: '売買' },
  { key: 'quantity', label: '数量', numeric: true },
  { key: 'price', label: '価格' },
  { key: 'marketScope', label: '市場区分' },
  { key: 'expiryDate', label: '期間指定' },
  { key: 'transactionType', label: '取引' },
  { key: 'settlementCurrency', label: '決済' },
  { key: 'depositCategory', label: '預り売買区分' },
  { key: 'received', label: '受注情報' },
  // 画面モックのプレビューには無い。CSV に強制区分の列が無いので、強制はここで行ごとに指定する
  { key: 'forced', label: '強制' },
  { key: 'messages', label: 'エラー内容' },
]

/** 件数の 3 枠。エラーは 0 件なら緑、1 件以上なら赤（画面モックの配色） */
const stats = computed(() => {
  const current = validation.value
  if (!current) return []
  return [
    { testid: 'order-csv-preview-total', label: '取込み件数', value: current.totalCount, tone: '' },
    { testid: 'order-csv-preview-valid', label: '正常', value: current.validCount, tone: 'ok' },
    {
      testid: 'order-csv-preview-invalid',
      label: 'エラー',
      value: current.invalidCount,
      tone: current.invalidCount > 0 ? 'ng' : 'ok',
    },
  ]
})

/** 受付ボタンの文言。押せないときは理由を出す */
const submitLabel = computed(() => {
  const current = validation.value
  if (!current || current.rows.length === 0) return '受付できる注文がありません'
  if (unresolvedCount.value > 0) return 'エラーを修正してください'
  if (forcedCount.value > 0) return `${current.totalCount}件を受付する（うち強制${forcedCount.value}件）`
  return `${current.totalCount}件を受付する`
})

/** NG の行は赤背景（画面モックの .row-error）。強制を指定した行は警告の色に変える */
function rowClass(row) {
  if (row.valid) return null
  return isForced(row) ? 'is-forced' : 'is-invalid'
}

/** 口座番号は「部店-口座番号」（画面モックの branch-account） */
function accountLabel(order) {
  if (!order.branchCode && order.accountNumber == null) return '—'
  return `${order.branchCode || '—'}-${order.accountNumber ?? '—'}`
}

function backToUpload() {
  router.push({ name: 'order-csv-upload' })
}

async function submit() {
  if (await store.submitOrders()) router.push({ name: 'order-csv-complete' })
}

// ストアは画面をまたいで残るので、前回の受付の失敗を持ち越さない
store.clearSubmitError()
</script>

<template>
  <section class="order-csv-preview">
    <BaseCard v-if="!validation" data-testid="order-csv-preview-empty">
      <div class="order-csv-preview__empty">
        <p>取込み内容がありません。CSVファイルを選んで「内容を確認する」を押してください。</p>
        <BaseButton
          variant="secondary"
          data-testid="order-csv-preview-to-upload"
          @click="backToUpload"
        >
          CSV取込みへ
        </BaseButton>
      </div>
    </BaseCard>

    <template v-else>
      <div class="order-csv-preview__stats">
        <BaseCard v-for="stat in stats" :key="stat.testid" :data-testid="stat.testid">
          <div class="order-csv-preview__stat-label">{{ stat.label }}</div>
          <div :class="['order-csv-preview__stat-value', stat.tone && `is-${stat.tone}`]">
            {{ formatQuantity(stat.value) }}
          </div>
        </BaseCard>
      </div>

      <BaseAlert v-if="unresolvedCount > 0" variant="error" data-testid="order-csv-preview-has-error">
        <strong>エラーがあります。</strong>
        エラー行（赤背景）の内容を確認してCSVを修正し、再取込みしてください。
        「強制」欄にチェックを付けられる行は、エラー内容を確認のうえ強制すると受付できます。
      </BaseAlert>
      <BaseAlert
        v-else-if="forcedCount > 0"
        variant="warning"
        data-testid="order-csv-preview-forced-notice"
      >
        <strong>{{ forcedCount }}件を強制で受付します。</strong>
        エラー内容は警告として受け付けられます。内容を確認してから受付してください。
      </BaseAlert>

      <BaseCard title="注文内容プレビュー" flush>
        <template #header-actions>
          <BaseButton
            variant="secondary"
            size="sm"
            data-testid="order-csv-preview-reupload"
            @click="backToUpload"
          >
            ← 再取込み
          </BaseButton>
        </template>

        <p
          v-if="validation.rows.length === 0"
          class="order-csv-preview__status"
          data-testid="order-csv-preview-no-rows"
        >
          取込み対象の注文がありません。
        </p>

        <DataTable
          v-else
          flat
          :columns="COLUMNS"
          :rows="validation.rows"
          row-key="rowNumber"
          :row-class="rowClass"
          data-testid="order-csv-preview-table"
        >
          <template #cell-state="{ row }">
            <span v-if="row.valid" class="order-csv-preview__state is-ok">OK</span>
            <span v-else-if="isForced(row)" class="order-csv-preview__state is-forced">強制</span>
            <span v-else class="order-csv-preview__state is-ng">NG</span>
          </template>

          <template #cell-account="{ row }">{{ accountLabel(row.order) }}</template>
          <template #cell-customerName="{ value }">{{ value || '—' }}</template>

          <!-- 銘柄コードの下に銘柄名を小さく添える（名前はサーバが引く。引けなかった行は出さない） -->
          <template #cell-symbol="{ row }">
            <span class="order-csv-preview__symbol">{{ row.order.symbol || '—' }}</span>
            <span v-if="row.stockName" class="order-csv-preview__sub">{{ row.stockName }}</span>
          </template>

          <!-- 売買はモックどおり 買=赤 / 売=青 の太字。知らないコードのときは色を付けない -->
          <template #cell-side="{ row }">
            <span :class="['order-csv-preview__side', `is-${row.order.side || 'unknown'}`]">
              {{ SIDE_LABELS[row.order.side] ?? '—' }}
            </span>
          </template>

          <template #cell-quantity="{ row }">{{ formatQuantity(row.order.quantity) }}</template>
          <template #cell-price="{ row }">{{ orderPriceLabel(row.order) }}</template>
          <template #cell-marketScope="{ row }">
            {{ codeLabel(EXECUTION_SCOPE_LABELS, row.order.marketScope) }}
          </template>
          <template #cell-expiryDate="{ row }">
            {{ formatCompactMonthDay(row.order.expiryDate) }}
          </template>
          <template #cell-transactionType="{ row }">
            {{ codeLabel(TRANSACTION_TYPE_LABELS, row.order.transactionType) }}
          </template>
          <template #cell-settlementCurrency="{ row }">
            {{ codeLabel(SETTLEMENT_CURRENCY_LABELS, row.order.settlementCurrency) }}
          </template>
          <template #cell-depositCategory="{ row }">
            {{ codeLabel(DEPOSIT_CATEGORY_LABELS, row.order.depositCategory) }}
          </template>

          <template #cell-received="{ row }">
            <span class="order-csv-preview__at">
              {{ formatCompactMonthDay(row.order.orderDate) }}
              {{ formatCompactTime(row.order.orderTime) }}
            </span>
            <span class="order-csv-preview__sub">受注者：{{ row.order.receiver || '—' }}</span>
          </template>

          <!--
            強制で救える NG の行だけチェックを出す。強制でも残るエラーがある NG の行は「不可」
            （CSV を直すしかない）、正常の行は強制が要らないので「—」
          -->
          <template #cell-forced="{ row }">
            <BaseCheckbox
              v-if="!row.valid && row.forceable"
              :model-value="isForced(row)"
              label="強制"
              :aria-label="`${row.rowNumber}行目を強制する`"
              data-testid="order-csv-preview-force"
              @update:model-value="setForced(row, $event)"
            />
            <span
              v-else-if="!row.valid"
              class="order-csv-preview__sub"
              data-testid="order-csv-preview-not-forceable"
            >
              不可
            </span>
            <template v-else>—</template>
          </template>

          <!--
            エラーと警告を同じ欄に色を分けて並べる（警告はモックに無いが、サーバは返す）。
            色だけでは読み上げで区別できないので、種別を支援技術向けに添える
          -->
          <template #cell-messages="{ row }">
            <ul
              v-if="row.errors.length > 0 || row.warnings.length > 0"
              class="order-csv-preview__messages"
            >
              <li
                v-for="(message, index) in row.errors"
                :key="`error-${index}`"
                class="is-error"
                data-testid="order-csv-preview-error"
              >
                <span class="visually-hidden">エラー：</span>・{{ message }}
              </li>
              <li
                v-for="(message, index) in row.warnings"
                :key="`warning-${index}`"
                class="is-warning"
                data-testid="order-csv-preview-warning"
              >
                <span class="visually-hidden">警告：</span>・{{ message }}
              </li>
            </ul>
            <span v-else>—</span>
          </template>
        </DataTable>
      </BaseCard>

      <BaseAlert v-if="submitError" variant="error" data-testid="order-csv-preview-submit-error">
        受付できませんでした。{{ submitError.message }}
      </BaseAlert>

      <div class="order-csv-preview__actions">
        <BaseButton variant="secondary" data-testid="order-csv-preview-back" @click="backToUpload">
          ← CSVを再取込みする
        </BaseButton>
        <BaseButton
          class="order-csv-preview__submit"
          data-testid="order-csv-preview-submit"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="submit"
        >
          {{ submitLabel }}
        </BaseButton>
      </div>
    </template>
  </section>
</template>

<style scoped>
.order-csv-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.order-csv-preview__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-5);
  color: var(--color-text-muted);
  text-align: center;
}

/* 件数の 3 枠。狭い画面では 1 列へ畳む */
.order-csv-preview__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
}

@media (max-width: 600px) {
  .order-csv-preview__stats {
    grid-template-columns: 1fr;
  }
}

.order-csv-preview__stat-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  letter-spacing: 0.05em;
}

.order-csv-preview__stat-value {
  margin-top: var(--space-1);
  color: var(--color-text-heading);
  font-size: var(--font-size-2xl);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.order-csv-preview__stat-value.is-ok {
  color: var(--color-success);
}

.order-csv-preview__stat-value.is-ng {
  color: var(--color-danger-text);
}

.order-csv-preview__status {
  padding: var(--space-6) var(--space-5);
  color: var(--color-text-muted);
  text-align: center;
}

/* NG の行。ホバー中は DataTable の td の色が上に載るので、ホバー色も対で指定する */
.order-csv-preview :deep(tr.is-invalid) {
  background-color: var(--color-danger-bg);
}

.order-csv-preview :deep(tr.is-invalid:hover td) {
  background-color: var(--color-danger-border);
}

/* 強制を指定した NG の行。赤（受付できない）と見分けられるよう警告の色にする */
.order-csv-preview :deep(tr.is-forced) {
  background-color: var(--color-warning-bg);
}

.order-csv-preview :deep(tr.is-forced:hover td) {
  background-color: var(--color-warning-border);
}

.order-csv-preview__state {
  font-weight: 600;
}

.order-csv-preview__state.is-ok {
  color: var(--color-success);
}

.order-csv-preview__state.is-ng {
  color: var(--color-danger-text);
}

.order-csv-preview__state.is-forced {
  color: var(--color-warning);
}

.order-csv-preview__symbol {
  font-weight: 500;
}

/* コードや日時の下に添える 2 行目（銘柄名・受注者） */
.order-csv-preview__sub {
  display: block;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.order-csv-preview__side.is-buy {
  color: var(--color-buy);
  font-weight: 600;
}

.order-csv-preview__side.is-sell {
  color: var(--color-sell);
  font-weight: 600;
}

.order-csv-preview__at {
  font-variant-numeric: tabular-nums;
}

/*
 * エラー内容は長文になる。DataTable のセルは既定で nowrap だが、
 * white-space は継承なので ul 側で normal に戻せば折り返せる。
 */
.order-csv-preview__messages {
  min-width: 240px;
  margin: 0;
  padding: 0;
  list-style: none;
  white-space: normal;
  font-size: var(--font-size-xs);
}

.order-csv-preview__messages .is-error {
  color: var(--color-danger-text);
}

.order-csv-preview__messages .is-warning {
  color: var(--color-warning);
}

.order-csv-preview__actions {
  display: flex;
  justify-content: center;
  gap: var(--space-3);
}

.order-csv-preview__submit {
  min-width: 160px;
}
</style>
