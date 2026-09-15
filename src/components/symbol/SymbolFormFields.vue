<script setup>
/**
 * 銘柄 1 件の入力項目（新規追加・編集で共用する）。
 *
 * `MasterFormDialog` の既定スロットに差す中身だけを持つ。枠・ボタン・エラーの出し先は
 * ダイアログ側の責務で、この部品は「どんな項目を、どの制約で並べるか」だけを決める。
 *
 * 項目が 10 あり、追加と編集で 1 つでもずれると（maxlength の付け忘れなど）
 * 画面のどちらか片方だけが実 API に弾かれる。**そのずれを起こさないために部品にしている**
 * ので、ここに画面ごとの分岐を持ち込まないこと（CorporateActionFormFields と同じ）。
 *
 * **`市場名` / `前日出来高` / `Pre区分` は持たない。** 実 API の SymbolRequest にはあるが、
 * 画面から作れる項目ではないので送らない（理由は src/api/symbols.js の toSymbolRequest）。
 *
 * 区分 3 つは未選択を作らない（placeholder を置かない）。`注文ルート` は実 API の型宣言が
 * null を許さず、どちらも既定が '0' なので、選択肢の先頭から始めるほうが実 API と噛み合う。
 *
 * 出す data-testid（testidPrefix が 'symbols-add' なら symbols-add-symbol-code など）:
 *   {prefix}-symbol-code / {prefix}-ticker / {prefix}-name / {prefix}-name-en
 *   / {prefix}-regulation / {prefix}-order-route / {prefix}-vwap-target
 *   / {prefix}-previous-close / {prefix}-average-volume / {prefix}-note
 *
 * 単体テストは持たない。挙動は `src/views/SymbolListView.spec.js`（STV）が
 * 追加のダイアログを通して担保する（`src/components/masters/` と同じ扱い）。
 */
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import FormField from '@/components/ui/FormField.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import { ORDER_ROUTE_OPTIONS, REGULATION_OPTIONS, VWAP_TARGET_OPTIONS } from '@/utils/symbolTypes'

defineProps({
  /** data-testid の接頭辞。'symbols-add' / 'symbols-edit' のように操作まで含めて渡す */
  testidPrefix: {
    type: String,
    required: true,
  },
  /**
   * 項目ごとの入力エラー（`{ symbolCode, ticker, name }`）。
   * 文言は画面が決めるので、この部品は出す場所だけを持つ。
   */
  errors: {
    type: Object,
    default: () => ({}),
  },
})

/*
 * フォームの値。オブジェクトごと v-model する（項目が 10 あり、
 * 1 項目 1 model にすると呼び出し側が 10 本の ref を並べることになるため）。
 * 中身の形は src/views/SymbolListView.vue の emptyForm() が正。
 */
const form = defineModel({ type: Object, required: true })
</script>

<template>
  <!-- 必須の 3 項目。maxlength は実 API（SymbolRequest）の宣言に合わせる -->
  <FormGrid :columns="2">
    <FormField v-slot="{ field }" label="銘柄コード" required :error="errors.symbolCode">
      <BaseInput
        v-bind="field"
        v-model="form.symbolCode"
        placeholder="例: S001"
        maxlength="14"
        :data-testid="`${testidPrefix}-symbol-code`"
      />
    </FormField>
    <FormField v-slot="{ field }" label="ティッカーコード" required :error="errors.ticker">
      <BaseInput
        v-bind="field"
        v-model="form.ticker"
        placeholder="例: AAPL"
        maxlength="10"
        :data-testid="`${testidPrefix}-ticker`"
      />
    </FormField>
  </FormGrid>

  <FormGrid :columns="2">
    <FormField v-slot="{ field }" label="銘柄名（日本語）" required :error="errors.name">
      <BaseInput
        v-bind="field"
        v-model="form.name"
        placeholder="例: アップル"
        maxlength="200"
        :data-testid="`${testidPrefix}-name`"
      />
    </FormField>
    <FormField v-slot="{ field }" label="銘柄名（英語）">
      <BaseInput
        v-bind="field"
        v-model="form.nameEn"
        placeholder="例: Apple Inc."
        maxlength="200"
        :data-testid="`${testidPrefix}-name-en`"
      />
    </FormField>
  </FormGrid>

  <!-- 区分 3 つ。いずれも未選択を作らず、実 API の既定と同じ '0' から始める -->
  <FormGrid :columns="3">
    <FormField v-slot="{ field }" label="取引可否">
      <BaseSelect
        v-bind="field"
        v-model="form.regulation"
        :options="REGULATION_OPTIONS"
        :data-testid="`${testidPrefix}-regulation`"
      />
    </FormField>
    <FormField v-slot="{ field }" label="預託先区分">
      <BaseSelect
        v-bind="field"
        v-model="form.orderRoute"
        :options="ORDER_ROUTE_OPTIONS"
        :data-testid="`${testidPrefix}-order-route`"
      />
    </FormField>
    <FormField v-slot="{ field }" label="VWAP対象区分">
      <BaseSelect
        v-bind="field"
        v-model="form.vwapTarget"
        :options="VWAP_TARGET_OPTIONS"
        :data-testid="`${testidPrefix}-vwap-target`"
      />
    </FormField>
  </FormGrid>

  <!--
    相場の 2 項目。type="number" ではなく inputmode を使うのは、実 API が受ける値の桁が
    大きく（出来高）、スピナーや誤スクロールでの増減が事故になりやすいため。
    数値への変換は api 層（toSymbolRequest）が行う。
  -->
  <FormGrid :columns="2">
    <FormField v-slot="{ field }" label="前日終値（USD）">
      <BaseInput
        v-bind="field"
        v-model="form.previousClose"
        inputmode="decimal"
        placeholder="例: 227.16"
        :data-testid="`${testidPrefix}-previous-close`"
      />
    </FormField>
    <FormField v-slot="{ field }" label="5日平均出来高">
      <BaseInput
        v-bind="field"
        v-model="form.averageVolume"
        inputmode="numeric"
        placeholder="例: 50000000"
        :data-testid="`${testidPrefix}-average-volume`"
      />
    </FormField>
  </FormGrid>

  <!-- maxlength は実 API（SymbolRequest の 備考）の 200 文字に合わせる -->
  <FormField v-slot="{ field }" label="備考">
    <BaseInput
      v-bind="field"
      v-model="form.note"
      placeholder="例: 要観察"
      maxlength="200"
      :data-testid="`${testidPrefix}-note`"
    />
  </FormField>
</template>
