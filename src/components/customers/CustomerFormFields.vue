<script setup>
/**
 * 顧客 1 件の入力項目（新規追加・編集で共用する）。
 *
 * `MasterFormDialog` の既定スロットに差す中身だけを持つ（SymbolFormFields と同じ役割）。
 * 違うのは、項目を**テンプレートに書き並べず src/utils/customerFields.js の表から組み立てる**こと。
 * 顧客マスタの項目はこれから大きく増える（2026-09-28 時点で最終形の 3 分の 1 程度）ので、
 * 項目を足すときに画面・部品のテンプレートを触らずに済むようにしてある。
 *
 * 唯一の add / edit 差は `editing`（lockedOnEdit の項目 = 口座番号を読み取り専用にする）。
 * disabled ではなく readonly にする理由は SymbolFormFields の symbolCodeLocked と同じ。
 *
 * 出す data-testid（testidPrefix が 'customers-add' なら customers-add-account-number など）:
 *   {prefix}-{項目の testid}（testid の一覧は src/utils/customerFields.js）
 *   / {prefix}-group-{グループの並び順 1〜}
 *
 * 単体テストは CustomerListView.spec.js（CLV）がダイアログを通して担保する。
 */
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import FormField from '@/components/ui/FormField.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import { useCodesStore } from '@/stores/codes'
import { CUSTOMER_FIELD_GROUPS } from '@/utils/customerFields'

defineProps({
  /** data-testid の接頭辞。'customers-add' / 'customers-edit' のように操作まで含めて渡す */
  testidPrefix: {
    type: String,
    required: true,
  },
  /** 編集で開いているか。true なら lockedOnEdit の項目を読み取り専用にする */
  editing: {
    type: Boolean,
    default: false,
  },
  /** 項目ごとの入力エラー（キーは項目の key）。文言は src/utils/customerFields.js が作る */
  errors: {
    type: Object,
    default: () => ({}),
  },
})

/** フォームの値（キーは項目の key）。形は src/utils/customerFields.js の emptyCustomerForm() が正 */
const form = defineModel({ type: Object, required: true })

/*
 * コードマスタは main.js が起動時に読み込む。computed ではなく関数で引くのは、
 * 項目ごとにコードマスタ名が違うため（読み込みが終われば再描画で選択肢が埋まる）。
 */
const codes = useCodesStore()

function optionsOf(field) {
  return field.codes ? codes.optionsFor(field.codes) : (field.options ?? [])
}

/** 数値の入力欄に付ける inputmode。type="number" はスピナーと誤スクロールの増減が事故になるので使わない */
function inputmodeOf(field) {
  if (field.control === 'integer') return 'numeric'
  if (field.control === 'decimal') return 'decimal'
  return undefined
}
</script>

<template>
  <fieldset
    v-for="(group, index) in CUSTOMER_FIELD_GROUPS"
    :key="group.label"
    class="customer-form__group"
    :data-testid="`${testidPrefix}-group-${index + 1}`"
  >
    <legend class="customer-form__legend">{{ group.label }}</legend>

    <FormGrid :columns="3">
      <FormField
        v-for="field in group.fields"
        :key="field.key"
        v-slot="{ field: bind }"
        :label="field.label"
        :required="field.required"
        :hint="field.hint ?? ''"
        :error="errors[field.key] ?? ''"
      >
        <BaseSelect
          v-if="field.control === 'select'"
          v-bind="bind"
          v-model="form[field.key]"
          :options="optionsOf(field)"
          :placeholder="field.initial === undefined ? '-- 選択してください --' : ''"
          :data-testid="`${testidPrefix}-${field.testid}`"
        />
        <BaseInput
          v-else
          v-bind="bind"
          v-model="form[field.key]"
          :inputmode="inputmodeOf(field)"
          :readonly="editing && field.lockedOnEdit"
          :data-testid="`${testidPrefix}-${field.testid}`"
        />
      </FormField>
    </FormGrid>
  </fieldset>
</template>

<style scoped>
.customer-form__group {
  margin: 0;
  padding: 0;
  border: 0;
}

/* グループの見出し。区切り線で次のグループと分ける */
.customer-form__legend {
  width: 100%;
  margin-bottom: var(--space-3);
  padding-bottom: var(--space-1);
  color: var(--color-text-heading);
  border-bottom: 1px solid var(--color-border);
  font-size: var(--font-size-sm);
  font-weight: 600;
}
</style>
