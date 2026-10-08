<script setup>
import { reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import FormField from '@/components/ui/FormField.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import { useCalculationSettingsStore } from '@/stores/calculationSettings'
import { formatDateTime } from '@/utils/format'

/*
 * 仮計算マスタ。画面モックは「現在の設定」と「設定変更」の 2 カードで、スライス基準マスタと同じ構成。
 *
 * 一覧・検索・追加・削除が無い単一レコードの画面なので、マスタ一覧の型（useListQuery / useCrudList /
 * MasterSearchCard / MasterListCard）には乗せない。
 *
 * モックとの違い:
 *   - 「更新可能 / 閲覧のみ」の出し分けを置かない。ルートが requiredPermission: 'master' なので、
 *     開けた人は更新できる（為替マスタと同じ。2026-09-29 決定）
 *   - 更新者は社員コードだけを出す。API が名前を返さない
 * API にはあるがモックに無い 消費税率・譲渡益所得税率・譲渡益住民税率・備考 は出さない（保存でも送らない）。
 */

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useCalculationSettingsStore()
const { settings, loading, error, isEmpty, saving, saveError } = storeToRefs(store)

/*
 * 単位の換算。ストア（＝バックエンド）は取引所税率を比率（0.00002）、現地手数料率を bp（10）で持ち、
 * 画面はどちらも %（0.002000% / 0.100000%）で見せる。換算をここに閉じ込め、表示・入力欄の初期値・
 * 保存時の 3 か所で同じ規則を使う。スプレッド（円/USD）と NISA為替上乗せ率（%）は単位が同じなので換算しない。
 */
function ratioToPercent(ratio) {
  return ratio * 100
}

function bpToPercent(bp) {
  return bp / 100
}

// 保存のときは API の列の精度（比率は小数第 10 位、bp は第 4 位）に丸め、浮動小数の誤差を送らない
function percentToRatio(percent) {
  return Number((percent / 100).toFixed(10))
}

function percentToBp(percent) {
  return Number((percent * 100).toFixed(4))
}

/** 小数第 digits 位までの固定表記。画面モックと同じく末尾の 0 も残す */
function formatFixed(value, digits) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—'
}

/*
 * 設定変更フォーム。精度は画面モックに合わせ、取引所税・現地手数料率が小数第 6 位、
 * スプレッド・NISA為替上乗せ率が小数第 4 位。
 */
const INPUT_RULES = [
  { key: 'exchangeTax', label: '取引所税', digits: 6 },
  { key: 'spread', label: 'スプレッド', digits: 4 },
  { key: 'commission', label: '現地手数料率', digits: 6 },
  { key: 'nisaMarkup', label: 'NISA仮計算用為替上乗せ率', digits: 4 },
]

const inputs = reactive({ exchangeTax: '', spread: '', commission: '', nisaMarkup: '' })
const inputErrors = reactive({ exchangeTax: '', spread: '', commission: '', nisaMarkup: '' })

/*
 * 現在値が変わるたび（初回読み込み・再読み込み・保存成功）に入力欄を洗い替える。
 * 入力途中の値を握りっぱなしにしないので、保存後に画面と入力欄がずれない。
 */
watch(
  settings,
  (value) => {
    if (!value) return
    inputs.exchangeTax = formatFixed(ratioToPercent(value.exchangeTaxRate), 6)
    inputs.spread = formatFixed(value.fxSpread, 4)
    inputs.commission = formatFixed(bpToPercent(value.localCommissionBp), 6)
    inputs.nisaMarkup = formatFixed(value.nisaFxMarkupRate, 4)
    for (const rule of INPUT_RULES) inputErrors[rule.key] = ''
  },
  { immediate: true },
)

/*
 * 画面で見るのは「空欄」「数値でない」「画面に出せる桁を超える」の 3 つだけ。
 * どの項目も 0 が有効値なので、空欄を Number('') の 0 として送らないためにここで止める。
 * 値の範囲（0 以上・比率は 1 以下 など）はサーバ（未実装のあいだは MSW ハンドラ）に任せ、
 * 拒否の理由をそのまま出す。画面側にも同じ規則を書くと二重管理になって食い違う。
 */
function inputError(value, { label, digits }) {
  // type="number" の v-model は数値を返すことがある（空欄だけ ''）ので文字列に寄せてから見る
  const text = String(value ?? '').trim()
  if (!text) return `${label}を入力してください。`

  const number = Number(text)
  if (!Number.isFinite(number)) return `${label}は数値で入力してください。`

  // 表示が小数第 digits 位までなので、それより細かい値は保存しても画面で確かめられない
  const scaled = number * 10 ** digits
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) {
    return `${label}は小数第${digits}位までで入力してください。`
  }
  return ''
}

const noticeMessage = ref('')

async function submitSave() {
  // 保存ボタンは :disabled で塞いであるが、入力欄での Enter でも submit は飛ぶ。
  // 二重送信（PUT が並列に出る）はここで止める
  if (saving.value) return

  noticeMessage.value = ''
  store.clearSaveError()

  for (const rule of INPUT_RULES) inputErrors[rule.key] = inputError(inputs[rule.key], rule)
  if (INPUT_RULES.some((rule) => inputErrors[rule.key])) return

  const message = await store.save({
    exchangeTaxRate: percentToRatio(Number(inputs.exchangeTax)),
    fxSpread: Number(inputs.spread),
    localCommissionBp: percentToBp(Number(inputs.commission)),
    nisaFxMarkupRate: Number(inputs.nisaMarkup),
  })
  // 失敗時は入力をそのまま残して直させる（理由は saveError に出る）
  if (message === null) return

  // 文言はサーバのもの（「仮計算マスタを変更しました。」か、差分が無いときの「変更はありません。」）
  noticeMessage.value = message || '仮計算マスタを変更しました。'
}

function reload() {
  noticeMessage.value = ''
  store.clearSaveError()
  store.load()
}

// 初回読み込み。onMounted に置くと最初の描画で一瞬「未設定」が出るため setup で始める
store.load()
</script>

<template>
  <section class="calc-settings">
    <BaseAlert v-if="noticeMessage" variant="success" data-testid="calc-settings-notice">
      {{ noticeMessage }}
    </BaseAlert>

    <p class="calc-settings__lead">
      <strong>仮計算にだけ使用する設定です。</strong><br />
      未入力の現地手数料・取引所税を自動補完し、円換算時のスプレッドを反映します。
      実際の約定・受渡・手数料・税額を確定するものではありません。
    </p>

    <!-- ローディング / エラー / 空 / データあり の 4 状態 -->
    <p v-if="loading" data-testid="calc-settings-loading" class="calc-settings__status is-loading">
      <BaseSpinner />
    </p>

    <div
      v-else-if="error"
      data-testid="calc-settings-error"
      class="calc-settings__status is-error"
    >
      <p>{{ error.message }}</p>
      <BaseButton variant="secondary" @click="reload">再試行</BaseButton>
    </div>

    <p v-else-if="isEmpty" data-testid="calc-settings-empty" class="calc-settings__status">
      仮計算マスタが設定されていません。
    </p>

    <template v-else>
      <BaseCard title="現在の設定">
        <template #header-actions>
          <span class="calc-settings__caption">仮計算の自動補完値</span>
        </template>

        <dl class="calc-settings__list" data-testid="calc-settings-current">
          <div class="calc-settings__item">
            <dt class="calc-settings__term">取引所税</dt>
            <dd class="calc-settings__detail">
              <span class="calc-settings__value" data-testid="calc-settings-exchange-tax">
                {{ formatFixed(ratioToPercent(settings.exchangeTaxRate), 6)
                }}<span class="calc-settings__unit">%</span>
              </span>
              <span class="calc-settings__note">外貨約定代金に対して自動計算します。</span>
            </dd>
          </div>

          <div class="calc-settings__item">
            <dt class="calc-settings__term">スプレッド</dt>
            <dd class="calc-settings__detail">
              <span class="calc-settings__value" data-testid="calc-settings-spread">
                {{ formatFixed(settings.fxSpread, 4) }}
                <span class="calc-settings__unit">円/USD</span>
              </span>
              <span class="calc-settings__note">外貨額に乗じて円換算費用へ反映します。</span>
            </dd>
          </div>

          <div class="calc-settings__item">
            <dt class="calc-settings__term">現地手数料率</dt>
            <dd class="calc-settings__detail">
              <span class="calc-settings__value" data-testid="calc-settings-commission">
                {{ formatFixed(bpToPercent(settings.localCommissionBp), 6)
                }}<span class="calc-settings__unit">%</span>
              </span>
              <span class="calc-settings__note">通常区分かつ未入力時の現地手数料へ適用します。</span>
            </dd>
          </div>

          <div class="calc-settings__item">
            <dt class="calc-settings__term">NISA仮計算用為替上乗せ率</dt>
            <dd class="calc-settings__detail">
              <span class="calc-settings__value" data-testid="calc-settings-nisa-markup">
                {{ formatFixed(settings.nisaFxMarkupRate, 4)
                }}<span class="calc-settings__unit">%</span>
              </span>
              <span class="calc-settings__note">
                成長投資枠の買付概算だけに通常為替へ上乗せします。
              </span>
            </dd>
          </div>
        </dl>

        <p class="calc-settings__meta" data-testid="calc-settings-updated">
          <span>最終更新：{{ formatDateTime(settings.updatedAt) }}</span>
          <span>更新者：{{ settings.updatedBy || '—' }}</span>
        </p>
      </BaseCard>

      <BaseCard title="設定変更">
        <!--
          novalidate: required はラベルの必須マークと aria のためのもの。ブラウザ標準の吹き出し（英語）に
          任せず、未入力と桁あふれは submitSave が項目ごとの日本語で出す
        -->
        <form
          class="calc-settings__form"
          data-testid="calc-settings-form"
          novalidate
          @submit.prevent="submitSave"
        >
          <BaseAlert v-if="saveError" variant="error" data-testid="calc-settings-save-error">
            {{ saveError.message }}
          </BaseAlert>

          <FormGrid :columns="4">
            <FormField
              v-slot="{ field }"
              label="取引所税（%）"
              required
              hint="外貨約定代金に対する料率（小数第6位まで）"
              :error="inputErrors.exchangeTax"
            >
              <BaseInput
                v-bind="field"
                v-model="inputs.exchangeTax"
                type="number"
                step="0.000001"
                inputmode="decimal"
                data-testid="calc-settings-exchange-tax-input"
              />
            </FormField>

            <FormField
              v-slot="{ field }"
              label="スプレッド（円/USD）"
              required
              hint="外貨額に乗じる円換算費用（小数第4位まで）"
              :error="inputErrors.spread"
            >
              <BaseInput
                v-bind="field"
                v-model="inputs.spread"
                type="number"
                step="0.0001"
                inputmode="decimal"
                data-testid="calc-settings-spread-input"
              />
            </FormField>

            <FormField
              v-slot="{ field }"
              label="現地手数料率（%）"
              required
              hint="通常区分かつ現地手数料①が未入力の場合に適用（小数第6位まで）"
              :error="inputErrors.commission"
            >
              <BaseInput
                v-bind="field"
                v-model="inputs.commission"
                type="number"
                step="0.000001"
                inputmode="decimal"
                data-testid="calc-settings-commission-input"
              />
            </FormField>

            <FormField
              v-slot="{ field }"
              label="NISA仮計算用為替上乗せ率（%）"
              required
              hint="成長投資枠の買付概算に通常為替へ上乗せ（小数第4位まで）"
              :error="inputErrors.nisaMarkup"
            >
              <BaseInput
                v-bind="field"
                v-model="inputs.nisaMarkup"
                type="number"
                step="0.0001"
                inputmode="decimal"
                data-testid="calc-settings-nisa-markup-input"
              />
            </FormField>
          </FormGrid>

          <div class="calc-settings__actions">
            <BaseButton
              type="submit"
              data-testid="calc-settings-save"
              :disabled="saving"
              :loading="saving"
            >
              {{ saving ? '保存中…' : '保存' }}
            </BaseButton>
          </div>
        </form>
      </BaseCard>
    </template>
  </section>
</template>

<style scoped>
.calc-settings {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* 画面の性格を伝える説明。モックの淡い面＋枠線の注記 */
.calc-settings__lead {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  color: var(--color-text-muted);
  background-color: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  line-height: 1.65;
}

.calc-settings__lead strong {
  color: var(--color-text-heading);
}

/* カードヘッダ右の小さい補足 */
.calc-settings__caption {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.calc-settings__list {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
  margin: 0;
}

@media (max-width: 980px) {
  .calc-settings__list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 800px) {
  .calc-settings__list {
    grid-template-columns: 1fr;
  }
}

.calc-settings__item {
  padding: var(--space-4);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.calc-settings__term {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.calc-settings__detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: var(--space-2) 0 0;
}

/* 4 つ並ぶので桁位置を揃える */
.calc-settings__value {
  color: var(--color-text-heading);
  font-size: var(--font-size-xl);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.calc-settings__unit {
  margin-left: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.calc-settings__note {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: 1.55;
}

/* 最終更新と更新者。モックは全角スペースで区切るが、余白で離す */
.calc-settings__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin: var(--space-4) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.calc-settings__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* モックは保存ボタンを右寄せ */
.calc-settings__actions {
  display: flex;
  justify-content: flex-end;
}

/* カードの外に出る 4 状態の表示。面と枠線を自前で持つ */
.calc-settings__status {
  padding: var(--space-5);
  color: var(--color-text-muted);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

/* スピナーだけを置くので中央に寄せる（文言が無いぶん左端に小さく出ると迷子になる） */
.calc-settings__status.is-loading {
  display: flex;
  justify-content: center;
}

.calc-settings__status.is-error {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--color-danger);
}
</style>
