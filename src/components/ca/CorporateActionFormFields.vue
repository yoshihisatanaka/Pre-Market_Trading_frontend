<script setup>
/**
 * CA 1 件の入力項目（新規追加・編集で共用する）。
 *
 * `MasterFormDialog` の既定スロットに差す中身だけを持つ。枠・ボタン・エラーの出し先は
 * ダイアログ側の責務で、この部品は「どんな項目を、どの制約で並べるか」だけを決める。
 *
 * 項目が 8 つあり、追加と編集で 1 つでもずれると（maxlength の付け忘れなど）
 * 画面のどちらか片方だけが実 API に弾かれる。**そのずれを起こさないために部品にしている**
 * ので、ここに画面ごとの分岐を持ち込まないこと。
 *
 * 出す data-testid（testidPrefix が 'ca-add' なら ca-add-stock-code など）:
 *   {prefix}-stock-code / {prefix}-type / {prefix}-ex-rights-date / {prefix}-effective-date
 *   / {prefix}-payment-date / {prefix}-denominator / {prefix}-numerator / {prefix}-note
 *
 * 単体テストは持たない。挙動は `src/views/CorporateActionListView.spec.js`（CAV）が
 * 追加・編集それぞれのダイアログを通して担保する（`src/components/masters/` と同じ扱い）。
 */
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import FormField from '@/components/ui/FormField.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import { CA_TYPE_OPTIONS } from '@/utils/caTypes'

defineProps({
  /** data-testid の接頭辞。'ca-add' / 'ca-edit' のように操作まで含めて渡す */
  testidPrefix: {
    type: String,
    required: true,
  },
  /**
   * 項目ごとの入力エラー（`{ stockCode, caType, denominator, numerator }`）。
   * 文言は画面が決めるので、この部品は出す場所だけを持つ。
   */
  errors: {
    type: Object,
    default: () => ({}),
  },
})

/*
 * フォームの値。オブジェクトごと v-model する（項目が 8 つあり、
 * 1 項目 1 model にすると呼び出し側が 8 本の ref を並べることになるため）。
 * 中身の形は src/views/CorporateActionListView.vue の emptyForm() が正。
 */
const form = defineModel({ type: Object, required: true })
</script>

<template>
  <!-- 銘柄コードと CA種別 は必須。どちらも短いので横に並べる -->
  <FormGrid :columns="2">
    <!-- maxlength は実 API（CARequest の 銘柄コード）の 14 文字に合わせる -->
    <FormField v-slot="{ field }" label="銘柄コード" required :error="errors.stockCode">
      <BaseInput
        v-bind="field"
        v-model="form.stockCode"
        placeholder="例: A0001"
        maxlength="14"
        :data-testid="`${testidPrefix}-stock-code`"
      />
    </FormField>
    <FormField v-slot="{ field }" label="CA種別" required :error="errors.caType">
      <BaseSelect
        v-bind="field"
        v-model="form.caType"
        :options="CA_TYPE_OPTIONS"
        placeholder="-- 選択してください --"
        :data-testid="`${testidPrefix}-type`"
      />
    </FormField>
  </FormGrid>

  <!-- 日付 3 種はすべて任意。前後関係はサーバの事前検証に委ねる（画面では弾かない） -->
  <FormGrid :columns="3">
    <FormField v-slot="{ field }" label="権利付最終日">
      <BaseInput
        v-bind="field"
        v-model="form.exRightsDate"
        type="date"
        :data-testid="`${testidPrefix}-ex-rights-date`"
      />
    </FormField>
    <FormField v-slot="{ field }" label="効力発生日">
      <BaseInput
        v-bind="field"
        v-model="form.effectiveDate"
        type="date"
        :data-testid="`${testidPrefix}-effective-date`"
      />
    </FormField>
    <FormField v-slot="{ field }" label="支払日">
      <BaseInput
        v-bind="field"
        v-model="form.paymentDate"
        type="date"
        :data-testid="`${testidPrefix}-payment-date`"
      />
    </FormField>
  </FormGrid>

  <!-- 一覧に出る「比率」はサーバが 分母:分子 から組む表示項目。入力はこの 2 つ -->
  <FormGrid :columns="2">
    <FormField v-slot="{ field }" label="比率（分母）" :error="errors.denominator">
      <BaseInput
        v-bind="field"
        v-model="form.denominator"
        type="number"
        min="0"
        step="any"
        placeholder="例: 1"
        :data-testid="`${testidPrefix}-denominator`"
      />
    </FormField>
    <FormField v-slot="{ field }" label="比率（分子）" :error="errors.numerator">
      <BaseInput
        v-bind="field"
        v-model="form.numerator"
        type="number"
        min="0"
        step="any"
        placeholder="例: 2"
        :data-testid="`${testidPrefix}-numerator`"
      />
    </FormField>
  </FormGrid>

  <!-- maxlength は実 API（CARequest の 備考）の 200 文字に合わせる -->
  <FormField v-slot="{ field }" label="備考">
    <BaseInput
      v-bind="field"
      v-model="form.note"
      placeholder="例: Q1現金配当"
      maxlength="200"
      :data-testid="`${testidPrefix}-note`"
    />
  </FormField>
</template>
