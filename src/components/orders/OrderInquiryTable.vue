<script setup>
/**
 * 注文照会の表。元注文ごとに 1 行を出し、その下に 2 種類の行を畳んで持つ。
 *   - 訂正履歴 … 「+」で開く。訂正前の版を古い順に並べる（先頭が原注文）
 *   - 自動分割 … 「自動分割 N件」で開く。スライス基準で分けた子注文の明細
 *
 * DataTable は 1 データ = 1 行の汎用部品で、行の下に別の行を差し込めないため、
 * この表は自前で描く（見た目は DataTable に揃えてある）。どの行を開いているかは
 * この部品の中だけの表示状態なので、ストアにも URL にも持たせない。
 *
 * 訂正・取消は押されたことを emit するだけで、処理（画面の遷移）は呼び出し側が持つ。
 * 発注権限の無い利用者（canOrder が false）には、ボタンの代わりに「閲覧のみ」を出す（画面モックと同じ）。
 *
 * 出す data-testid:
 *   order-inquiry-row（元注文の行） / order-inquiry-history-toggle / order-inquiry-history-row /
 *   order-inquiry-split-toggle / order-inquiry-split-detail / order-inquiry-amend / order-inquiry-cancel /
 *   order-inquiry-view-only / order-inquiry-forced（OrderInquiryCells が描く）
 *   表そのものの testid は呼び出し側がフォールスルーで渡す。
 */
import { computed, reactive } from 'vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import OrderInquiryCells from '@/components/orders/OrderInquiryCells.vue'
import { formatQuantity, formatUsd } from '@/utils/format'

const props = defineProps({
  /** 元注文ごとのまとまり（src/api/orderInquiry.js の OrderInquiryGroup）の配列 */
  groups: {
    type: Array,
    required: true,
  },
  /**
   * 発注権限（発注・取消・訂正）があるか。既定は false（権限が分からないうちは操作を出さない側に倒す。
   * stores/currentOperator.js の can() と同じ方針）
   */
  canOrder: {
    type: Boolean,
    default: false,
  },
  /**
   * 部店・口座番号・顧客名の 3 列を出すか。顧客詳細の注文照会タブ（1 顧客に固定した一覧）は false
   * （OrderInquiryCells の同名 prop と同じ）
   */
  showCustomer: {
    type: Boolean,
    default: true,
  },
})

const emit = defineEmits(['amend', 'cancel'])

/** 顧客を特定する 3 列（showCustomer が false のときに外す） */
const CUSTOMER_COLUMN_KEYS = ['branchCode', 'accountNumber', 'customerName']

/** 列の並びは画面モックのとおり。中ほどの 17 列は OrderInquiryCells が描く */
const COLUMNS = [
  { key: 'id', label: '注文ID' },
  { key: 'branchCode', label: '部店' },
  { key: 'accountNumber', label: '口座番号', numeric: true },
  { key: 'customerName', label: '顧客名' },
  { key: 'symbol', label: '銘柄' },
  { key: 'side', label: '売買' },
  { key: 'quantity', label: '数量', numeric: true },
  { key: 'orderType', label: '指値／成行' },
  { key: 'limitPrice', label: '価格', numeric: true },
  { key: 'filledQuantity', label: '出来数量', numeric: true },
  { key: 'remainingQuantity', label: '未出来残数量', numeric: true },
  { key: 'filledAmountUsd', label: '約定代金（USD）', numeric: true },
  { key: 'filledAmountJpy', label: '約定代金（円貨）', numeric: true },
  { key: 'marketScope', label: '市場区分' },
  { key: 'statusName', label: '出来状況' },
  { key: 'forced', label: '強制' },
  { key: 'sentAt', label: '送信日時' },
  { key: 'orderedAt', label: '受注日時' },
  { key: 'actions', label: '操作' },
]

const columns = computed(() =>
  props.showCustomer
    ? COLUMNS
    : COLUMNS.filter((column) => !CUSTOMER_COLUMN_KEYS.includes(column.key)),
)

/**
 * 自動分割の明細の見出しにある 4 項目（発注時のスライス判定の結果。src/api/orderInquiry.js の SlicePlan）。
 * 値は親の行（latest）が持つ。OrderItemResponse に無い契約提案（docs/api/requests.md #57）なので、
 * いまの実 API では plan が null で、4 項目とも '—' になる。
 *
 * @param {object|null} plan SlicePlan（無ければ null）
 * @returns {{ label: string, value: string }[]}
 */
function splitMeta(plan) {
  return [
    {
      label: '適用上限',
      value: withUnit(plan?.maxSliceQuantity, (value) => `${formatQuantity(value)} 株／スライス`),
    },
    { label: '適用理由', value: plan?.reasons.length ? plan.reasons.join('・') : '—' },
    {
      label: '5営業日平均出来高（取込値）',
      value: withUnit(plan?.averageVolume, (value) => `${formatQuantity(value)} 株`),
    },
    { label: '参照価格', value: withUnit(plan?.referencePrice, formatUsd) },
  ]
}

/** 値が無ければ単位を付けずに '—'（「— 株」にしない） */
function withUnit(value, format) {
  return value == null ? '—' : format(value)
}

/** 開いている元注文の id。reactive な Set なので has() がテンプレートの依存になる */
const openHistories = reactive(new Set())
const openSplits = reactive(new Set())

function toggle(openIds, id) {
  if (openIds.has(id)) openIds.delete(id)
  else openIds.add(id)
}

/** 訂正前の版の名前。history は古い順なので、先頭が原注文 */
function versionLabel(index) {
  return index === 0 ? '原注文（訂正済）' : `第${index}回訂正`
}
</script>

<template>
  <div class="order-inquiry-table">
    <table>
      <thead>
        <tr>
          <th v-for="column in columns" :key="column.key" :class="{ 'is-numeric': column.numeric }">
            {{ column.label }}
          </th>
        </tr>
      </thead>

      <tbody>
        <template v-for="group in groups" :key="group.id">
          <tr class="order-inquiry-table__summary" data-testid="order-inquiry-row">
            <td>
              <div class="order-inquiry-table__id">
                <button
                  v-if="group.history.length > 0"
                  type="button"
                  class="order-inquiry-table__history-toggle"
                  :aria-expanded="openHistories.has(group.id)"
                  :aria-label="`注文 #${group.id} の訂正履歴を${openHistories.has(group.id) ? '閉じる' : '開く'}`"
                  data-testid="order-inquiry-history-toggle"
                  @click="toggle(openHistories, group.id)"
                >
                  {{ openHistories.has(group.id) ? '−' : '+' }}
                </button>
                <span class="numeric">#{{ group.id }}</span>
                <span v-if="group.history.length > 0" class="order-inquiry-table__history-count">
                  訂正 {{ group.history.length }}回
                </span>
              </div>

              <button
                v-if="group.slices.length > 0"
                type="button"
                class="order-inquiry-table__split-toggle"
                :aria-expanded="openSplits.has(group.id)"
                data-testid="order-inquiry-split-toggle"
                @click="toggle(openSplits, group.id)"
              >
                {{
                  openSplits.has(group.id)
                    ? '自動分割を閉じる'
                    : `自動分割 ${group.slices.length}件`
                }}
              </button>
            </td>

            <OrderInquiryCells :order="group.latest" :show-customer="showCustomer" />

            <td>
              <span
                v-if="!canOrder"
                class="order-inquiry-table__view-only"
                data-testid="order-inquiry-view-only"
              >
                閲覧のみ
              </span>
              <div v-else class="order-inquiry-table__actions">
                <BaseButton
                  v-if="group.latest.amendable"
                  variant="secondary"
                  size="sm"
                  data-testid="order-inquiry-amend"
                  @click="emit('amend', group)"
                >
                  訂正
                </BaseButton>
                <BaseButton
                  v-if="group.latest.cancelable"
                  variant="danger"
                  size="sm"
                  data-testid="order-inquiry-cancel"
                  @click="emit('cancel', group)"
                >
                  取消
                </BaseButton>
              </div>
            </td>
          </tr>

          <!-- 自動分割の明細。表の全幅を 1 セルで使い、中に子注文の小さな表を置く -->
          <tr
            v-if="group.slices.length > 0 && openSplits.has(group.id)"
            class="order-inquiry-table__split-row"
            data-testid="order-inquiry-split-detail"
          >
            <td :colspan="columns.length">
              <div class="order-inquiry-table__split">
                <p class="order-inquiry-table__split-title">
                  スライス基準による自動分割
                  <BaseBadge>管理用</BaseBadge>
                </p>

                <dl class="order-inquiry-table__split-meta">
                  <div v-for="meta in splitMeta(group.latest.slicePlan)" :key="meta.label">
                    <dt>{{ meta.label }}</dt>
                    <dd>{{ meta.value }}</dd>
                  </div>
                </dl>

                <table class="order-inquiry-table__slices">
                  <thead>
                    <tr>
                      <th>スライス</th>
                      <th>子注文ID</th>
                      <th class="is-numeric">数量</th>
                      <th class="is-numeric">出来数量</th>
                      <th>出来状況</th>
                      <th class="is-numeric">残数量</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(slice, index) in group.slices" :key="slice.id">
                      <td>{{ index + 1 }} / {{ group.slices.length }}</td>
                      <td class="numeric">#{{ slice.id }}</td>
                      <td class="numeric">{{ formatQuantity(slice.quantity) }}</td>
                      <td class="numeric">{{ formatQuantity(slice.filledQuantity ?? 0) }}</td>
                      <td>{{ slice.statusName || '—' }}</td>
                      <td class="numeric">{{ formatQuantity(slice.remainingQuantity) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </td>
          </tr>

          <!-- 訂正履歴。原注文は一段沈めて、いまの注文ではないことを見せる -->
          <template v-if="openHistories.has(group.id)">
            <tr
              v-for="(order, index) in group.history"
              :key="order.id"
              :class="['order-inquiry-table__history', { 'is-original': index === 0 }]"
              data-testid="order-inquiry-history-row"
            >
              <td class="order-inquiry-table__history-id">
                <span class="order-inquiry-table__history-mark" aria-hidden="true">↳</span>
                <span class="numeric">#{{ order.id }}</span>
              </td>
              <OrderInquiryCells
                :order="order"
                :version-label="versionLabel(index)"
                :show-customer="showCustomer"
                muted
              />
              <td />
            </tr>
          </template>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* 列が 19 本あるので横に流す。見た目は DataTable（flat）に揃える */
.order-inquiry-table {
  overflow-x: auto;
  background-color: var(--color-surface);
}

/*
 * セルの枠線・余白。中ほどのセルは OrderInquiryCells が描く複数ルートの <td> で、
 * scoped の属性が付かないので :deep で当てる。
 * モックの一覧より列が多いので、DataTable より一段詰めた余白・文字にしてある。
 */
.order-inquiry-table > table > thead > tr > th,
.order-inquiry-table > table > tbody > tr > :deep(td) {
  padding: var(--space-2) var(--space-3);
  text-align: left;
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
  font-size: var(--font-size-sm);
  vertical-align: middle;
}

.order-inquiry-table > table > thead > tr > th {
  font-weight: 600;
  color: var(--color-text-muted);
  background-color: var(--color-surface-muted);
}

.order-inquiry-table th.is-numeric,
.order-inquiry-table :deep(td.numeric) {
  text-align: right;
}

/* 注文ID 列: 開閉ボタン・#ID・訂正回数を 1 行に並べる */
.order-inquiry-table__id {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.order-inquiry-table__history-toggle {
  width: 20px;
  height: 20px;
  padding: 0;
  color: var(--color-primary);
  font-size: var(--font-size-md);
  line-height: 1;
  background-color: var(--color-surface);
  border: 1px solid var(--color-info-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.order-inquiry-table__history-toggle:hover {
  background-color: var(--color-info-bg);
}

.order-inquiry-table__history-count {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

/* 「自動分割 N件」はモックどおり ID の下に小さく置く（開閉ボタンのぶん字下げする） */
.order-inquiry-table__split-toggle {
  display: block;
  /* 開閉ボタン（20px）と隙間（4px）のぶん。訂正履歴の無い行でも位置を揃える */
  margin: var(--space-1) 0 0 var(--space-5);
  padding: 2px var(--space-2);
  color: var(--color-text);
  font-size: var(--font-size-xs);
  background-color: var(--color-surface-muted);
  border: 1px solid var(--color-input-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.order-inquiry-table__split-toggle:hover {
  background-color: var(--color-border);
}

.order-inquiry-table__actions {
  display: flex;
  gap: var(--space-1);
}

/* 発注権限が無いときの操作列。ボタンではないことが判るよう、控えめな文字で出す */
.order-inquiry-table__view-only {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

/* 訂正履歴の行。ID を字下げして、元注文の行にぶら下がっていることを見せる */
.order-inquiry-table__history > :deep(td) {
  color: var(--color-text-muted);
}

.order-inquiry-table__history.is-original > :deep(td) {
  background-color: var(--color-surface-muted);
}

/*
 * 行ホバーは DataTable と同じく td に塗る。塗るのは元注文の行だけで、
 * 訂正履歴（原注文は既に沈んだ背景）と自動分割の明細には付けない
 */
.order-inquiry-table__summary:hover > :deep(td) {
  background-color: var(--color-surface-muted);
}

/* 字下げ。上のセル共通の余白（子結合の長いセレクタ）に勝つよう、行のクラスから指す */
.order-inquiry-table__history > td.order-inquiry-table__history-id {
  padding-left: var(--space-5);
}

.order-inquiry-table__history-mark {
  margin-right: var(--space-1);
}

/* 自動分割の明細 */
.order-inquiry-table__split-row > td {
  background-color: var(--color-surface-muted);
}

.order-inquiry-table__split {
  padding: var(--space-2) var(--space-3);
  border-left: 3px solid var(--color-text-muted);
  white-space: normal;
}

.order-inquiry-table__split-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-2);
  color: var(--color-text-heading);
  font-weight: 600;
}

.order-inquiry-table__split-meta {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-2);
  margin: 0 0 var(--space-2);
}

.order-inquiry-table__split-meta dt {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.order-inquiry-table__split-meta dd {
  margin: 0;
  font-weight: 600;
}

.order-inquiry-table__slices {
  width: auto;
  min-width: 540px;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
}

.order-inquiry-table__slices th,
.order-inquiry-table__slices td {
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-size-xs);
  text-align: left;
  border-bottom: 1px solid var(--color-border);
}

.order-inquiry-table__slices th {
  color: var(--color-text-muted);
  background-color: var(--color-surface-muted);
}

.order-inquiry-table__slices .is-numeric,
.order-inquiry-table__slices .numeric {
  text-align: right;
}
</style>
