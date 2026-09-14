<script setup>
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import MasterFormDialog from '@/components/masters/MasterFormDialog.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
import { useListQuery } from '@/composables/useListQuery'
import { useCaStore } from '@/stores/ca'
import { CA_TYPE_OPTIONS, formatCaType, isCaType } from '@/utils/caTypes'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useCaStore()
const {
  items,
  total,
  limit,
  offset,
  loading,
  error,
  isEmpty,
  creating,
  createError,
  validationErrors,
} = storeToRefs(store)

/*
 * 列は画面モック（https://uspreorder-vmbhej3k.manus.space/masters/ca）に合わせつつ、
 * 実 API（docs/api/openapi.json の CAItem）が持つ項目だけを出す。
 *   - ステータスは実 API に無い（モックにはあるが、対応する列も値も無いので出さない）
 *   - モックの「権利確定日」も実 API に無い。日付は 権利付最終日 / 効力発生日 / 支払日 の 3 つ
 *   - 操作列（編集・削除）は別途。新規追加はヘッダのボタンから開くので、列は増えない
 */
const columns = [
  { key: 'stockCode', label: '銘柄' },
  { key: 'caType', label: 'CA種別' },
  { key: 'exRightsDate', label: '権利付最終日' },
  { key: 'effectiveDate', label: '効力発生日' },
  { key: 'paymentDate', label: '支払日' },
  { key: 'ratio', label: '比率' },
  { key: 'note', label: '備考' },
]

/*
 * ページ位置と検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名（stock_code / ca_type）はこの filters 定義にだけ現れる。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'stockCode', query: 'stock_code' },
    // 未知のコード（?ca_type=999 など）は条件なしとして捨てる
    {
      key: 'caType',
      query: 'ca_type',
      parse: (value) => (isCaType(value) ? value : ''),
    },
  ],
  load: (params) => store.load(params),
})

/**
 * CA種別の表示名。実 API が付けて返す `CA種別名` を優先し、
 * 欠けているときだけコードから補う（どちらも無ければ '—'）。
 */
function caTypeLabel(row) {
  return row.caTypeName || formatCaType(row.caType)
}

/**
 * 手動操作された行（ユーザー操作フラグ=1）に付けるクラス。
 * 自動取込のままの行と見分けられるよう、行ごと淡く塗る。
 */
function rowClass(row) {
  return row.userModified ? 'is-user-modified' : null
}

/*
 * 新規追加。ヘッダの「新規追加」からモーダルを開く（受注不可日マスタと同じ形）。
 * URL は変えない（一覧の単方向フローに触らない）。
 *
 * 登録は store 側で「サーバの事前検証 → 登録」の 2 段になっている。ここでの検証は
 * 必須の未入力を弾いて無駄な往復を防ぐためのもので、銘柄コードが銘柄マスタに実在するか・
 * 日付が妥当かはサーバが見る。
 *
 * エラーは 3 種類あり、出し先を分ける。
 *   入力の不備      … FormField の error（項目の直下）
 *   事前検証の不合格 … store.validationErrors をモーダル内の BaseAlert
 *   通信・サーバ障害 … store.createError を同じ位置の BaseAlert
 */
const isAddOpen = ref(false)

// 項目が 8 つあるので、受注不可日のように ref を項目ごとに分けず 1 つのオブジェクトで持つ
const addForm = ref(emptyForm())
const addErrors = ref(emptyErrors())

// 成功メッセージ（追加・編集・削除で同じ枠に出す。同時に成功することは無い）
const noticeMessage = ref('')

function emptyForm() {
  return {
    stockCode: '',
    // CA種別 に中立な既定値は無いので未選択から始める（placeholder を出して必須にする）
    caType: '',
    exRightsDate: '',
    effectiveDate: '',
    paymentDate: '',
    denominator: '',
    numerator: '',
    note: '',
  }
}

function emptyErrors() {
  return { stockCode: '', caType: '', denominator: '', numerator: '' }
}

function openAdd() {
  addForm.value = emptyForm()
  addErrors.value = emptyErrors()
  // 前回の失敗と成功をどちらも持ち込まない
  store.clearCreateError()
  noticeMessage.value = ''
  isAddOpen.value = true
}

function closeAdd() {
  // 登録中に閉じると結果の行き先が無くなるので、終わるまで閉じさせない
  if (creating.value) return
  isAddOpen.value = false
}

async function submitAdd() {
  const form = addForm.value
  addErrors.value = {
    stockCode: form.stockCode.trim() ? '' : '銘柄コードを入力してください。',
    caType: form.caType ? '' : 'CA種別を選択してください。',
    ...ratioErrors(form),
  }
  if (Object.values(addErrors.value).some(Boolean)) return

  const created = await store.create({
    ...form,
    stockCode: form.stockCode.trim(),
    note: form.note.trim(),
  })
  // 失敗時はモーダルを開いたままにして、入力を直せるようにする（理由は createError に出る）
  if (!created) return

  isAddOpen.value = false
  /*
   * 一覧は効力発生日の降順なので、追加した行が 1 ページ目に出るとは限らない
   * （日付を空にした行はサーバ側で先頭に来る）。行を追いかけることはせず、
   * どの行が増えたのかをメッセージで示して、ユーザがその条件で検索できるようにする。
   */
  noticeMessage.value = `${caLabel(created)} を追加しました。`
}

/**
 * 比率（分母・分子）の入力検証。
 *
 * サーバは 分母 と 分子 がそろって初めて「1:2」を組むので、片方だけ送ると 201 で通ったうえで
 * 一覧の比率が空になる（入力した数値が消えたように見える）。エラーは**欠けている側**に出す。
 * 正の数値であることも見る（CARequest に minimum の宣言が無く、サーバまで往復してしまうため）。
 */
function ratioErrors({ denominator, numerator }) {
  const errors = { denominator: '', numerator: '' }
  const fields = [
    { key: 'denominator', label: '分母', value: denominator },
    { key: 'numerator', label: '分子', value: numerator },
  ]

  const filled = fields.filter((field) => field.value !== '')
  if (filled.length === 1) {
    const missing = fields.find((field) => field.value === '')
    errors[missing.key] = '比率は分母と分子の両方を入力してください。'
  }

  for (const field of filled) {
    if (!(Number(field.value) > 0)) {
      errors[field.key] = `${field.label}には正の数値を入力してください。`
    }
  }

  return errors
}

/**
 * 1 件を 1 行で示す文字列（成功メッセージに使う）。
 * CA には自然キーが無いので、一覧で行を見分けるのに実際に読む 3 点を並べる。
 */
function caLabel(ca) {
  const parts = [ca.stockCode || '—', caTypeLabel(ca)]
  /*
   * 効力発生日を持たない CA（分割・併合など）は日付を出さない。
   * 権利付最終日へ暗黙に落とすと、ラベルの無い日付欄に別の意味の日付が入って誤読させる。
   */
  if (ca.effectiveDate) parts.push(ca.effectiveDate)

  return parts.join(' / ')
}
</script>

<template>
  <section class="ca-list">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む -->
    <Teleport defer to="#topbar-actions">
      <BaseButton
        variant="secondary"
        data-testid="ca-reload"
        :disabled="loading"
        @click="store.reload()"
      >
        再読み込み
      </BaseButton>
      <BaseButton data-testid="ca-add" @click="openAdd">新規追加</BaseButton>
    </Teleport>

    <BaseAlert v-if="noticeMessage" variant="success" data-testid="ca-notice">
      {{ noticeMessage }}
    </BaseAlert>

    <!-- 画面の説明。4 状態や検索結果に関わらず常時出す -->
    <BaseAlert variant="info" data-testid="ca-description">
      銘柄ごとのコーポレートアクション（配当・分割・併合など）を管理します。<strong>色の付いた行</strong>は画面や
      API から手動で操作された行で、自動取込のままの行と区別しています。
    </BaseAlert>

    <MasterSearchCard
      testid-prefix="ca"
      :disabled="loading"
      @submit="submitSearch"
      @clear="clearSearch"
    >
      <FormField v-slot="{ field }" label="銘柄コード">
        <BaseInput
          v-bind="field"
          v-model="inputs.stockCode"
          placeholder="例: A0001 / AAPL"
          data-testid="ca-stock-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="CA種別">
        <BaseSelect
          v-bind="field"
          v-model="inputs.caType"
          :options="CA_TYPE_OPTIONS"
          placeholder="-- すべて --"
          data-testid="ca-type"
        />
      </FormField>
    </MasterSearchCard>

    <MasterListCard
      testid-prefix="ca"
      title="CA一覧"
      empty-message="該当するCAはありません。"
      :total="total"
      :limit="limit"
      :offset="offset"
      :loading="loading"
      :is-empty="isEmpty"
      :error="error"
      @reload="store.reload()"
      @update:offset="goToOffset"
    >
      <DataTable flat data-testid="ca-table" :columns="columns" :rows="items" :row-class="rowClass">
        <!-- 銘柄は当社銘柄コードが主、Ticker はその下に添える（画面モックの 2 段表示） -->
        <template #cell-stockCode="{ row }">
          <div class="ca-list__stock">
            <span class="ca-list__stock-code">{{ row.stockCode || '—' }}</span>
            <span v-if="row.ticker" class="ca-list__ticker">{{ row.ticker }}</span>
          </div>
        </template>

        <template #cell-caType="{ row }">{{ caTypeLabel(row) }}</template>

        <template #cell-exRightsDate="{ value }">
          <span class="ca-list__date">{{ value || '—' }}</span>
        </template>
        <template #cell-effectiveDate="{ value }">
          <span class="ca-list__date">{{ value || '—' }}</span>
        </template>
        <template #cell-paymentDate="{ value }">
          <span class="ca-list__date">{{ value || '—' }}</span>
        </template>

        <template #cell-ratio="{ value }">
          <span class="ca-list__ratio">{{ value || '—' }}</span>
        </template>

        <template #cell-note="{ value }">{{ value || '—' }}</template>
      </DataTable>
    </MasterListCard>

    <MasterFormDialog
      :open="isAddOpen"
      title="CA 新規追加"
      testid-prefix="ca"
      :pending="creating"
      :error="createError"
      :validation-errors="validationErrors"
      @close="closeAdd"
      @submit="submitAdd"
    >
      <!-- 銘柄コードと CA種別 は必須。どちらも短いので横に並べる -->
      <FormGrid :columns="2">
        <!-- maxlength は実 API（CARequest の 銘柄コード）の 14 文字に合わせる -->
        <FormField v-slot="{ field }" label="銘柄コード" required :error="addErrors.stockCode">
          <BaseInput
            v-bind="field"
            v-model="addForm.stockCode"
            placeholder="例: A0001"
            maxlength="14"
            data-testid="ca-add-stock-code"
          />
        </FormField>
        <FormField v-slot="{ field }" label="CA種別" required :error="addErrors.caType">
          <BaseSelect
            v-bind="field"
            v-model="addForm.caType"
            :options="CA_TYPE_OPTIONS"
            placeholder="-- 選択してください --"
            data-testid="ca-add-type"
          />
        </FormField>
      </FormGrid>

      <!-- 日付 3 種はすべて任意。前後関係はサーバの事前検証に委ねる（画面では弾かない） -->
      <FormGrid :columns="3">
        <FormField v-slot="{ field }" label="権利付最終日">
          <BaseInput
            v-bind="field"
            v-model="addForm.exRightsDate"
            type="date"
            data-testid="ca-add-ex-rights-date"
          />
        </FormField>
        <FormField v-slot="{ field }" label="効力発生日">
          <BaseInput
            v-bind="field"
            v-model="addForm.effectiveDate"
            type="date"
            data-testid="ca-add-effective-date"
          />
        </FormField>
        <FormField v-slot="{ field }" label="支払日">
          <BaseInput
            v-bind="field"
            v-model="addForm.paymentDate"
            type="date"
            data-testid="ca-add-payment-date"
          />
        </FormField>
      </FormGrid>

      <!-- 一覧に出る「比率」はサーバが 分母:分子 から組む表示項目。入力はこの 2 つ -->
      <FormGrid :columns="2">
        <FormField v-slot="{ field }" label="比率（分母）" :error="addErrors.denominator">
          <BaseInput
            v-bind="field"
            v-model="addForm.denominator"
            type="number"
            min="0"
            step="any"
            placeholder="例: 1"
            data-testid="ca-add-denominator"
          />
        </FormField>
        <FormField v-slot="{ field }" label="比率（分子）" :error="addErrors.numerator">
          <BaseInput
            v-bind="field"
            v-model="addForm.numerator"
            type="number"
            min="0"
            step="any"
            placeholder="例: 2"
            data-testid="ca-add-numerator"
          />
        </FormField>
      </FormGrid>

      <!-- maxlength は実 API（CARequest の 備考）の 200 文字に合わせる -->
      <FormField v-slot="{ field }" label="備考">
        <BaseInput
          v-bind="field"
          v-model="addForm.note"
          placeholder="例: Q1現金配当"
          maxlength="200"
          data-testid="ca-add-note"
        />
      </FormField>
    </MasterFormDialog>
  </section>
</template>

<style scoped>
.ca-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.ca-list__stock {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.ca-list__stock-code {
  font-weight: 600;
}

.ca-list__ticker {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

/* 日付と比率は桁を揃えて読ませる（受注不可日マスタの日付列と同じ扱い） */
.ca-list__date,
.ca-list__ratio {
  font-variant-numeric: tabular-nums;
}

/*
 * 手動操作された行（ユーザー操作フラグ=1）。
 * 行は DataTable が描くので、scoped のままでは届かない（:deep が要る）。
 * 色は警告色の淡色面を借りる。「異常」ではなく「自動取込のままではない」ことの印。
 */
.ca-list :deep(tr.is-user-modified) {
  background-color: var(--color-warning-bg);
}
</style>
