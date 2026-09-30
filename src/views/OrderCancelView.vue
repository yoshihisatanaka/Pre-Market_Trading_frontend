<script setup>
import { computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import OrderDetailSummary from '@/components/orders/OrderDetailSummary.vue'
import { useOrderActionStore } from '@/stores/orderAction'
import { formatQuantity } from '@/utils/format'
import { marketScopeLabel, orderPriceLabel, orderStatusLabel } from '@/utils/orderTypes'

/*
 * 注文取消（/orders/:orderId/cancel。画面モック `order_cancel.html`）。
 * 注文照会の「取消」から入る。発注権限の無い利用者はルートのガードで入れない。
 * この画面そのものが確認の段で、「取消を確定」を押すと取消 API を呼ぶ（確認ダイアログは挟まない）。
 *
 * 対象注文は訂正画面と同じく、開くたびに GET /orders/{order_id} で読み直す。
 *
 * 画面モックからの意図的なずれ:
 *   - 取消できる状況は API に合わせる（モックは Dream登録待ち / 未出来 / 注文中 / 一部出来、
 *     API は 未発注 / 注文中 / 一部出来 / 取消失敗 / 発注失敗 / 訂正中断）
 *   - 取消後は「取消済」で絞った一覧へ飛ばず、この画面を完了表示に切り替える。
 *     注文中・一部出来の取消は取消依頼（030）になり、すぐには取消済にならないので、
 *     その一覧に飛ぶと取り消した注文が見えない
 *   - 取消理由の欄は置かない（2026-09-29 決定。API の 理由 も削除される予定）
 */

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useOrderActionStore()
const { order, loading, error, cancelResult, canceling, cancelError } = storeToRefs(store)
const route = useRoute()
const router = useRouter()

// ルートの注文 ID が変わるたびに読み直す。画面を離れるときの undefined は読まない
watch(
  () => route.params.orderId,
  (id) => {
    if (id) store.load(String(id))
  },
  { immediate: true },
)

/** 404 は「注文が無い」（空の状態）として、再試行ではなく注文照会へ戻る導線を出す */
const notFound = computed(() => error.value?.status === 404)

// 取消画面の売買は画面モックどおり「買い / 売り」（一覧の「買 / 売」より一語長い）
const sideLabels = { buy: '買い', sell: '売り' }

/** 取消の対象になる株数（未約定残）。約定済みの株数は取り消されない */
const cancelQuantity = computed(() => {
  const target = order.value
  if (!target || target.quantity == null) return null
  return Math.max(target.quantity - target.filledQuantity, 0)
})

/** 「取消対象注文」の中身。並びは画面モックのとおり */
const summaryItems = computed(() => {
  const target = order.value
  if (!target) return []

  return [
    { label: '銘柄', value: target.symbol || '—' },
    { label: '売買', value: sideLabels[target.side] ?? '—' },
    { label: '口座番号', value: target.accountNumber || '—' },
    { label: '注文数量', value: `${formatQuantity(target.quantity)}株` },
    { label: '約定済数量', value: `${formatQuantity(target.filledQuantity)}株` },
    {
      label: '取消対象（未約定残）',
      value: `${formatQuantity(cancelQuantity.value)}株`,
      testid: 'order-cancel-quantity',
    },
    { label: '価格', value: orderPriceLabel(target.orderType, target.limitPrice) },
    { label: '市場区分', value: marketScopeLabel(target.marketScope) },
  ]
})

/** 取消できない状況のときは、確定ボタンを出さずに理由を出す */
const locked = computed(() => !order.value?.cancelable)

async function confirmCancel() {
  if (!order.value || locked.value || canceling.value) return
  // 失敗時は画面をそのまま残す（理由は cancelError に出る）
  await store.cancel()
}

/*
 * 戻る。注文照会から来たなら履歴を戻る（検索条件とページ位置を残したまま一覧へ帰れる）。
 * URL を直接開いたときは戻る先が無いので、注文照会を開く。
 */
function goBack() {
  if (router.options.history.state?.back) router.back()
  else router.push({ name: 'order-inquiry' })
}
</script>

<template>
  <section class="order-cancel">
    <p class="order-cancel__description" data-testid="order-cancel-description">取消内容の確認</p>

    <!-- ローディング / エラー / 空（注文が無い） / データあり の 4 状態 -->
    <p v-if="loading" data-testid="order-cancel-loading" class="order-cancel__status is-loading">
      <BaseSpinner />
    </p>

    <div v-else-if="notFound" data-testid="order-cancel-not-found" class="order-cancel__status">
      <p>注文が見つかりませんでした。</p>
      <BaseButton variant="secondary" @click="goBack">注文照会へ戻る</BaseButton>
    </div>

    <div
      v-else-if="error"
      data-testid="order-cancel-error"
      class="order-cancel__status is-error"
    >
      <p>{{ error.message }}</p>
      <BaseButton variant="secondary" @click="store.reload()">再試行</BaseButton>
    </div>

    <!-- 取消の受付後は完了表示に切り替える。結果の文言はサーバが決める -->
    <BaseCard v-else-if="cancelResult" title="取消の受付" data-testid="order-cancel-complete">
      <div class="order-cancel__complete">
        <BaseAlert variant="success" data-testid="order-cancel-complete-message">
          {{ cancelResult.message || '取消を受け付けました。' }}
        </BaseAlert>

        <p>この注文は取消完了後も注文照会の履歴に残ります。</p>

        <BaseAlert
          v-if="cancelResult.warnings.length > 0"
          variant="warning"
          data-testid="order-cancel-complete-warnings"
        >
          <ul class="order-cancel__messages">
            <li v-for="message in cancelResult.warnings" :key="message">{{ message }}</li>
          </ul>
        </BaseAlert>

        <div class="order-cancel__actions">
          <BaseButton data-testid="order-cancel-back-to-list" @click="goBack">
            注文照会へ戻る
          </BaseButton>
        </div>
      </div>
    </BaseCard>

    <template v-else-if="order">
      <div class="order-cancel__lead">
        <p>対象注文と取消後の扱いを確認してから確定してください。</p>
        <BaseBadge variant="info" data-testid="order-cancel-status">
          {{ orderStatusLabel(order.status) }}
        </BaseBadge>
      </div>

      <BaseCard title="取消対象注文">
        <template #header-actions>
          <span class="order-cancel__order-id" data-testid="order-cancel-order-id">
            注文ID #{{ order.id }}
          </span>
        </template>

        <OrderDetailSummary :items="summaryItems" data-testid="order-cancel-summary" />
      </BaseCard>

      <BaseCard title="取消後の扱い">
        <div class="order-cancel__body">
          <p>この注文は取消完了後も注文照会の履歴に残ります。</p>
          <p data-testid="order-cancel-effect">
            <template v-if="order.filledQuantity > 0">
              約定済 {{ formatQuantity(order.filledQuantity) }} 株は取り消されず、未約定残
              {{ formatQuantity(cancelQuantity) }} 株だけを取消対象にします。
            </template>
            <template v-else>約定済みの数量はなく、注文数量全体を取消対象にします。</template>
          </p>

          <BaseAlert v-if="locked" variant="warning" data-testid="order-cancel-locked">
            この注文は取消できません（処理状況: {{ orderStatusLabel(order.status) }}）。
          </BaseAlert>
          <BaseAlert v-if="cancelError" variant="error" data-testid="order-cancel-submit-error">
            {{ cancelError.message }}
          </BaseAlert>

          <div class="order-cancel__actions">
            <BaseButton
              variant="secondary"
              data-testid="order-cancel-back"
              :disabled="canceling"
              @click="goBack"
            >
              戻る
            </BaseButton>
            <BaseButton
              v-if="!locked"
              variant="danger"
              data-testid="order-cancel-submit"
              :disabled="canceling"
              :loading="canceling"
              @click="confirmCancel"
            >
              {{ canceling ? '取消中…' : '取消を確定' }}
            </BaseButton>
          </div>
        </div>
      </BaseCard>
    </template>
  </section>
</template>

<style scoped>
.order-cancel {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* 説明文はヘッダの見出しに続く小さな添え書き（モックの副題に相当） */
.order-cancel__description {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

/* 導入文と状態のチップを 1 行に並べる */
.order-cancel__lead {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.order-cancel__lead > p {
  margin: 0;
}

.order-cancel__order-id {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
}

.order-cancel__body,
.order-cancel__complete {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.order-cancel__body > p,
.order-cancel__complete > p {
  margin: 0;
}

/* 戻る（左）と確定（右）。破壊的な操作を最後にする既存の並び（モーダルのフッタと同じ） */
.order-cancel__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

/* 警告の箇条書き。1 件のときも体裁が浮かないよう、記号と字下げは付けない */
.order-cancel__messages {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* カードの外に出る 4 状態の表示。面と枠線を自前で持つ（SliceCriteriaMasterView と同じ） */
.order-cancel__status {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin: 0;
  padding: var(--space-5);
  color: var(--color-text-muted);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.order-cancel__status > p {
  margin: 0;
}

/* スピナーだけを置くので中央に寄せる */
.order-cancel__status.is-loading {
  justify-content: center;
}

.order-cancel__status.is-error {
  color: var(--color-danger);
}
</style>
