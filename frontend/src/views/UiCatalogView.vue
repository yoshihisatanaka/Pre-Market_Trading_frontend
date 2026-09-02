<script setup>
/**
 * 開発用の部品カタログ。components/ui/ の見た目と状態を実物で確認するためだけの画面。
 * 業務データも API も扱わないので、ストアも useAsync も使わない。
 * 新しい汎用部品を足したらここにも並べる。
 */
import { ref } from 'vue'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseCheckbox from '@/components/ui/BaseCheckbox.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSegmentedControl from '@/components/ui/BaseSegmentedControl.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import FileDropZone from '@/components/ui/FileDropZone.vue'
import FormField from '@/components/ui/FormField.vue'
import FormGrid from '@/components/ui/FormGrid.vue'

const branchOptions = [
  { value: '123', label: '123 A支店' },
  { value: '234', label: '234 B支店' },
  { value: '345', label: '345 C支店' },
]
const accountTypeOptions = [
  { value: '特定', label: '特定' },
  { value: '一般', label: '一般' },
  { value: 'NISA', label: 'NISA' },
]
const sideOptions = [
  { value: '買', label: '買い', tone: 'buy' },
  { value: '売', label: '売り', tone: 'sell' },
]

const branch = ref('')
const accountNumber = ref('')
const symbol = ref('AAPL')
const quantity = ref('')
const blockedDate = ref('')
const accountType = ref('特定')
const side = ref('買')
const forced = ref(false)
const csvFile = ref(null)
const isModalOpen = ref(false)
</script>

<template>
  <div class="catalog">
    <BaseCard title="ボタン">
      <div class="catalog__row">
        <BaseButton>Primary</BaseButton>
        <BaseButton variant="secondary">Secondary</BaseButton>
        <BaseButton variant="danger">Danger</BaseButton>
        <BaseButton variant="success">Success</BaseButton>
        <BaseButton size="sm">Primary sm</BaseButton>
        <BaseButton variant="secondary" size="sm">Secondary sm</BaseButton>
        <BaseButton disabled>Disabled</BaseButton>
      </div>
    </BaseCard>

    <BaseCard title="入力（boxed）― 検索カード / モーダルの様式">
      <FormGrid>
        <FormField v-slot="{ field }" label="部店コード">
          <BaseSelect v-bind="field" v-model="branch" :options="branchOptions" placeholder="-- 全部店 --" />
        </FormField>
        <FormField v-slot="{ field }" label="口座番号" hint="半角数字6桁">
          <BaseInput v-bind="field" v-model="accountNumber" placeholder="例: 123456" />
        </FormField>
        <FormField v-slot="{ field }" label="日付" required>
          <BaseInput v-bind="field" v-model="blockedDate" type="date" />
        </FormField>
        <FormField v-slot="{ field }" label="理由" required error="入力してください">
          <BaseInput v-bind="field" placeholder="例: 社内システムメンテナンス" />
        </FormField>
      </FormGrid>

      <div class="catalog__row catalog__row--top">
        <BaseButton>検索</BaseButton>
        <BaseButton variant="secondary" size="sm">クリア</BaseButton>
      </div>
    </BaseCard>

    <BaseCard title="入力（underline）― 注文入力画面の様式">
      <FormField v-slot="{ field }" label="銘柄コード" required layout="inline">
        <BaseInput v-bind="field" v-model="symbol" variant="underline" class="catalog__w-160" />
      </FormField>
      <FormField v-slot="{ field }" label="注文数量" required layout="inline">
        <BaseInput
          v-bind="field"
          v-model="quantity"
          variant="underline"
          class="catalog__w-120 numeric"
          inputmode="numeric"
        />
        <span class="catalog__unit">株</span>
      </FormField>
      <FormField label="売買区分（委託）" required layout="inline">
        <BaseSegmentedControl v-model="side" :options="sideOptions" />
      </FormField>
      <FormField label="預り売買区分" layout="inline">
        <BaseSegmentedControl v-model="accountType" :options="accountTypeOptions" />
      </FormField>
      <FormField label="強制区分" layout="inline">
        <BaseCheckbox v-model="forced" label="強制的に受け付ける" />
      </FormField>
    </BaseCard>

    <BaseCard title="ファイル取込み">
      <FileDropZone
        v-model="csvFile"
        accept=".csv"
        label="クリックまたはドラッグ＆ドロップでCSVを選択"
        hint="UTF-8 / Shift-JIS 対応 · .csv ファイル"
      />
    </BaseCard>

    <BaseCard title="通知とチップ">
      <div class="catalog__stack">
        <BaseAlert>1行目はヘッダー行です。2行目以降が注文データとして取込まれます。</BaseAlert>
        <BaseAlert variant="success">3 件の注文を受け付けました。</BaseAlert>
        <BaseAlert variant="warning">受注不可日が含まれています。</BaseAlert>
        <BaseAlert variant="error">サーバーでエラーが発生しました。</BaseAlert>
      </div>

      <div class="catalog__row catalog__row--top">
        <BaseBadge>特定</BaseBadge>
        <BaseBadge variant="buy">買</BaseBadge>
        <BaseBadge variant="sell">売</BaseBadge>
        <BaseBadge variant="success">約定済</BaseBadge>
        <BaseBadge variant="warning">プレ</BaseBadge>
        <BaseBadge variant="info">執行中</BaseBadge>
      </div>
    </BaseCard>

    <BaseCard title="カードとダイアログ">
      <template #header-actions>
        <span class="catalog__count">6 件</span>
      </template>

      <BaseButton variant="danger" @click="isModalOpen = true">削除確認を開く</BaseButton>

      <BaseModal :open="isModalOpen" title="削除確認" size="sm" @close="isModalOpen = false">
        <p>2026-01-01 を削除しますか？</p>
        <p class="catalog__warning">この操作は元に戻せません。</p>

        <template #footer>
          <BaseButton variant="secondary" @click="isModalOpen = false">キャンセル</BaseButton>
          <BaseButton variant="danger" @click="isModalOpen = false">削除する</BaseButton>
        </template>
      </BaseModal>
    </BaseCard>
  </div>
</template>

<style scoped>
.catalog {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.catalog__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.catalog__row--top {
  margin-top: var(--space-3);
}

.catalog__stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.catalog__unit {
  color: var(--color-text-muted);
}

.catalog__count {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.catalog__warning {
  color: var(--color-danger-text);
  font-size: var(--font-size-sm);
}

.catalog__w-160 {
  width: 160px;
}

.catalog__w-120 {
  width: 120px;
}
</style>
