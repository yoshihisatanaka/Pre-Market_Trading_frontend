<script setup>
/**
 * 注文内容の読み上げ（確認画面と完了画面で共用。モックの _order_readback.html）。
 * 上から「顧客と銘柄 → 注文内容（売買・価格・数量・市場／期限）→ 注文条件・受注情報 → 概算金額」の順で、
 * 発注前に取り違えやすいものほど上に大きく出す。
 *
 * この部品は文字列を並べるだけで、組み立ては src/utils/orderEntryForm.js の
 * buildOrderReadback / buildEstimateReadback が行う。
 */
defineProps({
  /** buildOrderReadback の戻り値 */
  readback: {
    type: Object,
    required: true,
  },
  /** buildEstimateReadback の戻り値 */
  estimate: {
    type: Object,
    required: true,
  },
})
</script>

<template>
  <div :class="['order-readback', `is-${readback.tone}`]" data-testid="order-readback">
    <section class="order-readback__identity" aria-label="顧客と銘柄の確認">
      <div class="order-readback__item">
        <span>顧客名</span>
        <strong data-testid="order-readback-customer">{{ readback.customerName }}</strong>
      </div>
      <div class="order-readback__item">
        <span>部店／口座番号</span>
        <strong class="order-readback__code" data-testid="order-readback-account">
          {{ readback.branchAccount }}
        </strong>
      </div>
      <div class="order-readback__item">
        <span>銘柄</span>
        <strong class="order-readback__code" data-testid="order-readback-symbol">
          {{ readback.ticker }}
          <small v-if="readback.symbolName">{{ readback.symbolName }}</small>
        </strong>
      </div>
    </section>

    <section class="order-readback__key" aria-label="発注内容の確認">
      <p class="order-readback__key-title">注文内容</p>
      <div class="order-readback__key-grid">
        <div class="order-readback__key-item">
          <span>売買</span>
          <strong class="order-readback__trade" data-testid="order-readback-side">
            {{ readback.side }}
          </strong>
        </div>
        <div class="order-readback__key-item">
          <span>価格</span>
          <strong data-testid="order-readback-price">{{ readback.price }}</strong>
        </div>
        <div class="order-readback__key-item">
          <span>数量</span>
          <strong data-testid="order-readback-quantity">{{ readback.quantity }}</strong>
        </div>
        <div class="order-readback__key-item">
          <span>市場／期限</span>
          <strong data-testid="order-readback-market-expiry">{{ readback.marketExpiry }}</strong>
        </div>
      </div>
    </section>

    <div class="order-readback__details">
      <section class="order-readback__section">
        <p class="order-readback__section-title">注文条件</p>
        <dl class="order-readback__rows">
          <div>
            <dt>注文種別</dt>
            <dd data-testid="order-readback-vwap">{{ readback.vwap }}</dd>
          </div>
          <div>
            <dt>決済通貨</dt>
            <dd data-testid="order-readback-settlement-currency">
              {{ readback.settlementCurrency }}
            </dd>
          </div>
          <div>
            <dt>預り売買区分</dt>
            <dd data-testid="order-readback-deposit-category">{{ readback.depositCategory }}</dd>
          </div>
          <div>
            <dt>金銭受渡方法</dt>
            <dd data-testid="order-readback-cash-delivery">{{ readback.cashDelivery }}</dd>
          </div>
        </dl>
      </section>

      <section class="order-readback__section">
        <p class="order-readback__section-title">受注情報</p>
        <dl class="order-readback__rows">
          <div>
            <dt>受注日／時刻</dt>
            <dd class="order-readback__code" data-testid="order-readback-order-datetime">
              {{ readback.orderDateTime }}
            </dd>
          </div>
          <div>
            <dt>受注者</dt>
            <dd data-testid="order-readback-order-person">{{ readback.orderPerson }}</dd>
          </div>
          <div>
            <dt>勧誘／受注方法</dt>
            <dd data-testid="order-readback-solicitation">{{ readback.solicitationMethod }}</dd>
          </div>
          <div>
            <dt>資金性格／チャネル</dt>
            <dd data-testid="order-readback-fund-channel">{{ readback.fundChannel }}</dd>
          </div>
        </dl>
      </section>
    </div>

    <section class="order-readback__estimate" aria-label="概算金額">
      <div>
        <span>外貨概算金額（USD）</span>
        <strong data-testid="order-readback-estimate-usd">{{ estimate.usd }}</strong>
      </div>
      <div>
        <span>円貨概算金額（JPY）</span>
        <strong data-testid="order-readback-estimate-jpy">{{ estimate.jpy }}</strong>
      </div>
      <p data-testid="order-readback-estimate-note">
        {{ estimate.note }}<br />
        手数料・税金等を含みません。
      </p>
    </section>
  </div>
</template>

<style scoped>
.order-readback {
  --order-signal: var(--color-sell);

  display: grid;
  gap: var(--space-2);
}

.order-readback.is-buy {
  --order-signal: var(--color-buy);
}

.order-readback__identity,
.order-readback__key,
.order-readback__estimate {
  background-color: var(--color-surface-muted);
  border: 1px solid var(--color-border);
}

.order-readback__identity {
  display: grid;
  grid-template-columns: 1fr 1.1fr 1.5fr;
}

.order-readback__item,
.order-readback__key-item {
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border-right: 1px solid var(--color-border);
}

.order-readback__item:last-child,
.order-readback__key-item:last-child {
  border-right: 0;
}

.order-readback__item span,
.order-readback__key-item span,
.order-readback__estimate span {
  display: block;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 500;
}

.order-readback__item strong,
.order-readback__key-item strong {
  display: block;
  overflow: hidden;
  color: var(--color-text-heading);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.order-readback__item strong {
  font-size: var(--font-size-md);
}

.order-readback__item small {
  margin-left: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 400;
}

.order-readback__key-title,
.order-readback__section-title {
  color: var(--color-label);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.order-readback__key-title {
  padding: var(--space-1) var(--space-3) 0;
}

.order-readback__key-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
}

.order-readback__key-item strong {
  font-size: var(--font-size-lg);
}

.order-readback__key-item .order-readback__trade {
  color: var(--order-signal);
}

.order-readback__details {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}

.order-readback__section {
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
}

.order-readback__section-title {
  padding: var(--space-1) var(--space-3);
  background-color: var(--color-surface-muted);
  border-bottom: 1px solid var(--color-border);
}

.order-readback__rows {
  margin: 0;
  padding: 0 var(--space-3);
}

.order-readback__rows div {
  display: grid;
  grid-template-columns: 112px 1fr;
  align-items: center;
  min-height: 26px;
  border-bottom: 1px solid var(--color-border);
}

.order-readback__rows div:last-child {
  border-bottom: 0;
}

.order-readback__rows dt {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.order-readback__rows dd {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.order-readback__estimate {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  align-items: stretch;
}

.order-readback__estimate > div {
  padding: var(--space-2) var(--space-4);
  border-right: 1px solid var(--color-border);
}

.order-readback__estimate strong {
  display: block;
  color: var(--color-text-heading);
  font-size: var(--font-size-xl);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.order-readback__estimate p {
  align-self: center;
  padding: var(--space-2) var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: 1.45;
}

.order-readback__code {
  font-variant-numeric: tabular-nums;
}

@media (max-width: 760px) {
  .order-readback__identity,
  .order-readback__key-grid,
  .order-readback__details,
  .order-readback__estimate {
    grid-template-columns: 1fr;
  }

  .order-readback__item,
  .order-readback__key-item,
  .order-readback__estimate > div {
    border-right: 0;
    border-bottom: 1px solid var(--color-border);
  }
}
</style>
