<script setup>
/**
 * 手数料優遇 1 件の入力項目（新規追加・編集で共用する）。
 *
 * `MasterFormDialog` の既定スロットに差す中身だけを持つ。枠・ボタン・エラーの出し先は
 * ダイアログ側の責務で、この部品は「どんな項目を、どの制約で並べるか」だけを決める。
 * 項目が 9 あり、追加と編集で 1 つでもずれると画面のどちらか片方だけが実 API に弾かれるので、
 * そのずれを起こさないために部品にしている（SymbolFormFields と同じ）。**add / edit の差は無い**
 * （パスキーが ID なので、口座番号も編集で変えられる）。
 *
 * 数値の項目は方式ごとにまとめて並べる。どちらの方式で計算されるかはベイシスの有無で決まり
 * （設定するとベイシス方式、未設定ならパターン方式）、使われない方の項目を入れるとサーバが警告を返す。
 *
 * 数値は type="number" ではなく inputmode で受ける（スピナーや誤スクロールでの増減を避ける。
 * SymbolFormFields と同じ）。数値への変換は api 層、形の検査は画面が行う。
 *
 * 出す data-testid（testidPrefix が 'fee-preferences-add' なら fee-preferences-add-account-number など）:
 *   {prefix}-account-number / {prefix}-fee-pattern / {prefix}-fee-multiplier / {prefix}-min-fee
 *   / {prefix}-max-fee / {prefix}-basis-points / {prefix}-min-basis-fee / {prefix}-max-basis-fee
 *   / {prefix}-fx-spread
 *
 * 単体テストは持たない。挙動は `src/views/FeePreferenceListView.spec.js`（FPV）が
 * 追加・編集のダイアログを通して担保する（SymbolFormFields と同じ扱い）。
 */
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import FormField from '@/components/ui/FormField.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import { FEE_PATTERN_FORM_OPTIONS } from '@/utils/feePreferenceOptions'

defineProps({
  /** data-testid の接頭辞。'fee-preferences-add' / 'fee-preferences-edit' のように操作まで含めて渡す */
  testidPrefix: {
    type: String,
    required: true,
  },
  /**
   * 項目ごとの入力エラー（`{ accountNumber, feeMultiplier, … }`。キーは form と同じ名前）。
   * 文言は画面が決めるので、この部品は出す場所だけを持つ。
   */
  errors: {
    type: Object,
    default: () => ({}),
  },
})

/*
 * フォームの値。オブジェクトごと v-model する（項目が 9 あるため）。
 * 中身の形は src/views/FeePreferenceListView.vue の emptyForm() が正。
 */
const form = defineModel({ type: Object, required: true })
</script>

<template>
  <!-- 手数料パターンは未選択を作らない（空文字 = デフォルトから始める） -->
  <FormGrid :columns="2">
    <FormField v-slot="{ field }" label="口座番号" required :error="errors.accountNumber">
      <BaseInput
        v-bind="field"
        v-model="form.accountNumber"
        inputmode="numeric"
        placeholder="例: 1230001"
        maxlength="10"
        :data-testid="`${testidPrefix}-account-number`"
      />
    </FormField>
    <FormField v-slot="{ field }" label="手数料パターン">
      <BaseSelect
        v-bind="field"
        v-model="form.feePattern"
        :options="FEE_PATTERN_FORM_OPTIONS"
        :data-testid="`${testidPrefix}-fee-pattern`"
      />
    </FormField>
  </FormGrid>

  <p class="fee-preference-form__group">パターン方式（ベイシスが未設定のときに使う）</p>
  <FormGrid :columns="3">
    <FormField
      v-slot="{ field }"
      label="掛目（%）"
      hint="未設定は 100%"
      :error="errors.feeMultiplier"
    >
      <BaseInput
        v-bind="field"
        v-model="form.feeMultiplier"
        inputmode="decimal"
        placeholder="例: 80"
        :data-testid="`${testidPrefix}-fee-multiplier`"
      />
    </FormField>
    <FormField v-slot="{ field }" label="下限手数料（円）" :error="errors.minFee">
      <BaseInput
        v-bind="field"
        v-model="form.minFee"
        inputmode="decimal"
        placeholder="例: 1000"
        :data-testid="`${testidPrefix}-min-fee`"
      />
    </FormField>
    <FormField v-slot="{ field }" label="上限手数料（円）" :error="errors.maxFee">
      <BaseInput
        v-bind="field"
        v-model="form.maxFee"
        inputmode="decimal"
        placeholder="例: 50000"
        :data-testid="`${testidPrefix}-max-fee`"
      />
    </FormField>
  </FormGrid>

  <p class="fee-preference-form__group">ベイシス方式（ベイシスを設定するとこちらで計算する）</p>
  <FormGrid :columns="3">
    <FormField v-slot="{ field }" label="ベイシス（bp）" :error="errors.basisPoints">
      <BaseInput
        v-bind="field"
        v-model="form.basisPoints"
        inputmode="decimal"
        placeholder="例: 30"
        :data-testid="`${testidPrefix}-basis-points`"
      />
    </FormField>
    <FormField v-slot="{ field }" label="下限ベイシス（円）" :error="errors.minBasisFee">
      <BaseInput
        v-bind="field"
        v-model="form.minBasisFee"
        inputmode="decimal"
        placeholder="例: 500"
        :data-testid="`${testidPrefix}-min-basis-fee`"
      />
    </FormField>
    <FormField v-slot="{ field }" label="上限ベイシス（円）" :error="errors.maxBasisFee">
      <BaseInput
        v-bind="field"
        v-model="form.maxBasisFee"
        inputmode="decimal"
        placeholder="例: 30000"
        :data-testid="`${testidPrefix}-max-basis-fee`"
      />
    </FormField>
  </FormGrid>

  <!-- 為替スプレッドはどちらの方式でも使う -->
  <FormGrid :columns="3">
    <FormField
      v-slot="{ field }"
      label="為替スプレッド（円/USD）"
      hint="0 は為替手数料の免除。未設定は仮計算マスタの値"
      :error="errors.fxSpread"
    >
      <BaseInput
        v-bind="field"
        v-model="form.fxSpread"
        inputmode="decimal"
        placeholder="例: 0.25"
        :data-testid="`${testidPrefix}-fx-spread`"
      />
    </FormField>
  </FormGrid>
</template>

<style scoped>
/* 方式ごとのまとまりの見出し。ラベルより一段弱く、入力欄の並びを区切るだけ */
.fee-preference-form__group {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 600;
}
</style>
