<script setup>
/**
 * 注文照会の表の 1 注文ぶんのセル（部店 〜 受注日時の 16 列。showCustomer が false なら
 * 部店・口座番号・顧客名を除く 13 列）。
 *
 * 表の行には「元注文ごとの行」と、その下に畳む「訂正前の版の行」の 2 種類があり、
 * 中ほどの 16 列は同じ並び・同じ整形なのでここにまとめてある。行ごとに違う先頭の
 * 注文ID 列と末尾の操作列は呼び出し側（OrderInquiryTable）が描く。
 *
 * ルート要素が複数の <td> なので、<tr> の中に直接置く。td の枠線・余白は
 * 呼び出し側の表が当てる（このファイルが持つのはセルの中身の見た目だけ）。
 *
 * 出す data-testid は無い。
 */
import { formatJpyUnit, formatMonthDayTime, formatQuantity, formatUsd } from '@/utils/format'
import { marketScopeLabel } from '@/utils/orderTypes'

const props = defineProps({
  /** 1 注文（src/api/orderInquiry.js の OrderInquiryOrder） */
  order: {
    type: Object,
    required: true,
  },
  /** 訂正前の版の行で、銘柄の下に添える版の名前（「原注文（訂正済）」など）。元注文の行は空 */
  versionLabel: {
    type: String,
    default: '',
  },
  /** 訂正前の版の行。出来状況の色分けを外して、いまの注文と見分けやすくする */
  muted: {
    type: Boolean,
    default: false,
  },
  /**
   * 部店・口座番号・顧客名の 3 列を出すか。顧客詳細の注文照会タブ（1 顧客に固定した一覧）は
   * 顧客カードに同じものが出ているので false にする（画面モック customer_order_inquiry.html も持たない）
   */
  showCustomer: {
    type: Boolean,
    default: true,
  },
})

const sideLabels = { buy: '買', sell: '売' }
const orderTypeLabels = { LO: '指値', MO: '成行' }

/** 値が取れなかったセルはモックと同じく空にせず '—' を出す */
function textOrDash(value) {
  return value || '—'
}

/** 0 はモックと同じく「まだ無い」ものとして '—' にする（出来数量・約定代金） */
function positiveOrDash(value, format) {
  return value ? format(value) : '—'
}

/** 価格は指値のときだけ出す。成行は単価を持たない */
function priceLabel() {
  return props.order.orderType === 'LO' ? formatUsd(props.order.limitPrice) : '—'
}
</script>

<template>
  <template v-if="showCustomer">
    <td>{{ textOrDash(order.branchCode) }}</td>
    <td class="numeric">{{ textOrDash(order.accountNumber) }}</td>
    <td>{{ textOrDash(order.customerName) }}</td>
  </template>

  <td>
    <span class="order-inquiry-cells__symbol" :class="{ 'is-muted': muted }">
      {{ textOrDash(order.symbol) }}
    </span>
    <span v-if="versionLabel" class="order-inquiry-cells__sub">{{ versionLabel }}</span>
  </td>

  <td>
    <span :class="['order-inquiry-cells__side', `is-${order.side || 'unknown'}`]">
      {{ sideLabels[order.side] ?? '—' }}
    </span>
  </td>

  <!-- 取消された株数は数量の下に小さく添える（取消済の脚でも元の数量は残す） -->
  <td class="numeric">
    {{ formatQuantity(order.quantity) }}
    <span v-if="order.canceledQuantity" class="order-inquiry-cells__sub">
      取消 {{ formatQuantity(order.canceledQuantity) }}
    </span>
  </td>

  <td class="order-inquiry-cells__center">{{ orderTypeLabels[order.orderType] ?? '—' }}</td>
  <td class="numeric">{{ priceLabel() }}</td>
  <td class="numeric">{{ positiveOrDash(order.filledQuantity, formatQuantity) }}</td>
  <td class="numeric order-inquiry-cells__remaining">
    {{ formatQuantity(order.remainingQuantity) }}
  </td>
  <td class="numeric">{{ positiveOrDash(order.filledAmountUsd, formatUsd) }}</td>
  <td class="numeric">{{ positiveOrDash(order.filledAmountJpy, formatJpyUnit) }}</td>

  <!--
    市場区分。API は 発注範囲 のコード（'01'〜'06'）しか返さないので、名前はバックエンドの
    コードマスタの写し（src/utils/orderTypes.js）で引く。知らないコードはコードのまま出す。
  -->
  <td class="order-inquiry-cells__center">
    {{ marketScopeLabel(order.marketScope) }}
    <span v-if="order.vwap" class="order-inquiry-cells__sub">VWAP</span>
  </td>

  <!-- 注文エラーは理由をホバーで読めるようにする（モックと同じく title） -->
  <td>
    <span
      :class="[
        'order-inquiry-cells__status',
        muted ? 'is-muted' : `is-${order.statusTone || 'none'}`,
      ]"
      :title="order.errorReason || undefined"
    >
      {{ textOrDash(order.statusName) }}
    </span>
  </td>

  <!--
    送信日時。OrderItemResponse に対応する項目が無く、値の出所が決まっていない。
    見出しだけ確保し、セルは常に '—' にしてある（顧客マスタの米国株評価額と同じ扱い）。
  -->
  <td class="order-inquiry-cells__muted">—</td>
  <td class="order-inquiry-cells__muted">{{ formatMonthDayTime(order.orderedAt) }}</td>
</template>

<style scoped>
.order-inquiry-cells__symbol {
  font-weight: 600;
}

.order-inquiry-cells__symbol.is-muted {
  font-weight: 400;
}

/* 数量の「取消 N」・銘柄の版の名前・市場区分の VWAP。本文の下に小さく添える */
.order-inquiry-cells__sub {
  display: block;
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 400;
}

.order-inquiry-cells__center {
  text-align: center;
}

.order-inquiry-cells__muted {
  color: var(--color-text-muted);
}

/* 売買はモックどおり 買=赤 / 売=青 の太字。知らないコードのときは色を付けない */
.order-inquiry-cells__side.is-buy {
  color: var(--color-buy);
  font-weight: 600;
}

.order-inquiry-cells__side.is-sell {
  color: var(--color-sell);
  font-weight: 600;
}

/* 未出来残数量は「いま生きている株数」なので、他の数量より一段強く出す */
.order-inquiry-cells__remaining {
  font-weight: 600;
}

/* 出来状況。色は処理状況のコードから api 層が決めた statusTone で当てる */
.order-inquiry-cells__status.is-pending {
  color: var(--color-warning);
}

.order-inquiry-cells__status.is-working {
  color: var(--color-sell);
  font-weight: 600;
}

.order-inquiry-cells__status.is-partial {
  color: var(--color-warning);
  font-weight: 600;
}

.order-inquiry-cells__status.is-filled {
  color: var(--color-success);
}

.order-inquiry-cells__status.is-canceled,
.order-inquiry-cells__status.is-muted {
  color: var(--color-text-muted);
}

.order-inquiry-cells__status.is-error {
  color: var(--color-danger-text);
  font-weight: 600;
  cursor: help;
}
</style>
