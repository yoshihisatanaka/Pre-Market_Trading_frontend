<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import CustomerFormFields from '@/components/customers/CustomerFormFields.vue'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import MasterFormDialog from '@/components/masters/MasterFormDialog.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
import { useListQuery } from '@/composables/useListQuery'
import { useCodesStore } from '@/stores/codes'
import { CUSTOMERS_PAGE_SIZE, useCustomersStore } from '@/stores/customers'
import {
  emptyCustomerForm,
  hasCustomerFormErrors,
  toCustomerForm,
  validateCustomerForm,
} from '@/utils/customerFields'
import { formatJpyUnit, formatUsdUnit } from '@/utils/format'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useCustomersStore()
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
  validationWarnings,
  updating,
  updateError,
  updateValidationErrors,
} = storeToRefs(store)

/*
 * プルダウンの選択肢はコードマスタから。読み込みは main.js が起動時に 1 回だけ行うので、
 * ここでは load を呼ばない。storeToRefs ではなく computed で受けるのは、
 * 読み込みが終わった時点で選択肢が自動的に埋まるようにするため。
 */
const codes = useCodesStore()
// 一覧の loading と名前がぶつかるので別名で受ける
const { loading: codesLoading } = storeToRefs(codes)
const branchOptions = computed(() => codes.optionsFor('部店'))
const handlerOptions = computed(() => codes.optionsFor('扱者'))
const restrictionOptions = computed(() => codes.optionsFor('取引停止区分_全取引'))
const accountTypeOptions = computed(() => codes.optionsFor('口座区分'))
const corporateTypeOptions = computed(() => codes.optionsFor('法人区分'))

/*
 * 列は画面モック（https://uspreorder-vmbhej3k.manus.space/masters/customers）の並びどおり。
 *   - 米国株評価額 / 評価損益 はモックにあるが不要になった（2026-09-28 決定）ので出さない
 *   - 操作列は「編集」だけ。削除は実装しない（2026-09-28 決定）。新規追加はヘッダのボタンから開く
 */
const columns = [
  { key: 'branch', label: '部店' },
  { key: 'handler', label: '扱者' },
  { key: 'accountNumber', label: '口座番号', numeric: true },
  { key: 'customerName', label: '顧客名' },
  { key: 'age', label: '年齢' },
  { key: 'restriction', label: '取引規制' },
  { key: 'investmentPolicy', label: '投資方針' },
  { key: 'compliance', label: 'コンプラ' },
  { key: 'accountType', label: '口座区分' },
  { key: 'corporateType', label: '個人／法人' },
  { key: 'cashJpy', label: '円貨預り金', numeric: true },
  { key: 'cashUsd', label: 'USD預り金', numeric: true },
  { key: 'growthQuota', label: '成長投資枠', numeric: true },
  // 行ごとの操作（編集）。銘柄マスタと同じく見出しは空にする
  { key: 'actions', label: '' },
]

/*
 * ページ位置と検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名（branch_code / account_type など）はこの filters 定義にだけ現れる。
 * バックエンドが受け取る英語のクエリ名（branch_code / account_no / customer_name）は
 * src/api/customers.js の中に閉じている。扱者コードは /masters/customers に対応する
 * クエリが無く、取引規制・口座区分・個人法人と同じくモックだけが解釈する。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'branchCode', query: 'branch_code' },
    { key: 'handlerCode', query: 'handler_code' },
    { key: 'accountNumber', query: 'account_number' },
    { key: 'customerName', query: 'customer_name' },
    { key: 'restriction', query: 'restriction' },
    { key: 'accountType', query: 'account_type' },
    { key: 'corporateType', query: 'corporate_type' },
  ],
  load: (params) => store.load(params),
})

/** 年齢。実 API では文字列で、法人は空（その場合は '—'） */
function ageLabel(row) {
  return row.age ? `${row.age}歳` : '—'
}

/**
 * 手動操作された行（ユーザー操作フラグ=1）に付けるクラス。
 * 自動取込のままの行と見分けられるよう、行ごと淡く塗る。
 */
function rowClass(row) {
  return row.userModified ? 'is-user-modified' : null
}

/*
 * 新規追加と編集。入力項目は CustomerFormFields が src/utils/customerFields.js の表から組み立てる
 * （項目が増えてもこの画面は触らない）。流れは銘柄マスタと同じで、store 側が
 * 「サーバの事前検証 → 登録 / 更新」の 2 段を持つ。ここでの検査（validateCustomerForm）は
 * 必須・書式の漏れで往復しないためのもの。
 *
 * エラーの出し先は 3 系統（MasterFormDialog の JSDoc）。
 *   入力の不備      … 項目の直下
 *   事前検証の不合格 … validationErrors / updateValidationErrors
 *   通信・サーバ障害 … createError / updateError（楽観的ロックの 409 もここ）
 *
 * 事前検証の警告（validationWarnings）は登録だけが扱う。1 回目は登録せずに警告を出し、
 * 利用者が承知して押し直すと acknowledgedWarnings を付けて登録する（海外休場日マスタと同じ）。
 */
const isAddOpen = ref(false)
const addForm = ref(emptyCustomerForm())
const addErrors = ref({})

/*
 * 警告を出したときの入力の写し。押し直しを「承知した」と扱うのは、入力がこれと同じときだけ。
 * 警告のあとに口座番号などを書き換えたら、新しい入力はもう一度事前検証から通す
 * （警告の確認を経ずに別の内容が登録されるのを防ぐ）。
 */
const warnedForm = ref('')

// 成功メッセージ（追加・編集で同じ枠に出す）
const noticeMessage = ref('')

function openAdd() {
  addForm.value = emptyCustomerForm()
  addErrors.value = {}
  warnedForm.value = ''
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
  addErrors.value = validateCustomerForm(addForm.value)
  if (hasCustomerFormErrors(addErrors.value)) return

  const snapshot = JSON.stringify(addForm.value)
  await store.create(
    {
      ...addForm.value,
      // 警告を出したときと同じ入力で押し直したら、承知したものとして登録へ進める
      acknowledgedWarnings: validationWarnings.value.length > 0 && warnedForm.value === snapshot,
    },
    {
      // 閉じるのは登録が受理された時点（一覧の読み直しを待たない。理由は SymbolListView）
      onSuccess: (created) => {
        isAddOpen.value = false
        // 口座番号の昇順なので追加した行が今のページに出るとは限らない。何が増えたかを文言で示す
        noticeMessage.value = `${customerLabel(created)} を追加しました。`
      },
    },
  )
  // 警告で止まったら、そのときの入力を覚えておく（次の押し直しの判定に使う）
  warnedForm.value = validationWarnings.value.length > 0 ? snapshot : ''
}

/*
 * 編集。「開いているか」と「どの行か」を editTarget 1 つで持つ（銘柄マスタと同じ形）。
 * id が更新対象を、updatedAt が楽観的ロックの合札を受け持つ。
 * **口座番号は変更させない**（業務キー。CustomerUpdateRequest に無い）。
 */
const editTarget = ref(null)
const editForm = ref(emptyCustomerForm())
const editErrors = ref({})

function openEdit(customer) {
  editForm.value = toCustomerForm(customer)
  editErrors.value = {}
  store.clearUpdateError()
  noticeMessage.value = ''
  editTarget.value = customer
}

function closeEdit() {
  if (updating.value) return
  editTarget.value = null
}

async function submitEdit() {
  const target = editTarget.value
  if (!target) return

  editErrors.value = validateCustomerForm(editForm.value)
  if (hasCustomerFormErrors(editErrors.value)) return

  const updated = await store.update(
    // id と合札はフォームの外から来る（利用者が触れる値ではない）
    { ...editForm.value, id: target.id, updatedAt: target.updatedAt },
    {
      onSuccess: (customer) => {
        editTarget.value = null
        noticeMessage.value = `${customerLabel(customer)} を更新しました。`
      },
    },
  )
  if (!updated) return

  /*
   * 絞り込み中に条件の圏外へ変えると、最終ページが空になり得る。そのときは 1 ページ戻す
   * （銘柄マスタの stepBackIfPageEmpty と同じ）
   */
  if (items.value.length === 0 && offset.value > 0) {
    goToOffset(offset.value - CUSTOMERS_PAGE_SIZE)
  }
}

/** 1 件を 1 行で示す文字列（成功メッセージに使う）。口座番号だけでは誰か分からないので名前を添える */
function customerLabel(customer) {
  return `${customer.accountNumber || '—'} ${customer.customerName || '—'}`
}
</script>

<template>
  <section class="customer-list">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む -->
    <Teleport defer to="#topbar-actions">
      <BaseButton data-testid="customers-add" @click="openAdd">新規追加</BaseButton>
    </Teleport>

    <BaseAlert v-if="noticeMessage" variant="success" data-testid="customers-notice">
      {{ noticeMessage }}
    </BaseAlert>

    <!-- 画面の説明。4 状態や検索結果に関わらず常時出す -->
    <BaseAlert variant="info" data-testid="customers-description">
      口座情報をもとに顧客を検索します。<strong>色の付いた行</strong>は画面や API
      から手動で操作された行で、自動取込のままの行と区別しています。
    </BaseAlert>

    <MasterSearchCard
      testid-prefix="customers"
      :disabled="loading"
      :options-loading="codesLoading"
      @submit="submitSearch"
      @clear="clearSearch"
    >
      <FormField v-slot="{ field }" label="部店コード">
        <BaseSelect
          v-bind="field"
          v-model="inputs.branchCode"
          :options="branchOptions"
          placeholder="-- 全部店 --"
          data-testid="customers-branch-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="扱者コード">
        <BaseSelect
          v-bind="field"
          v-model="inputs.handlerCode"
          :options="handlerOptions"
          placeholder="-- 全扱者 --"
          data-testid="customers-handler-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="口座番号">
        <BaseInput
          v-bind="field"
          v-model="inputs.accountNumber"
          placeholder="例: 1230001"
          data-testid="customers-account-number"
        />
      </FormField>
      <FormField v-slot="{ field }" label="顧客名" hint="顧客名・カナのどちらにも当たります">
        <BaseInput
          v-bind="field"
          v-model="inputs.customerName"
          placeholder="例: 山田"
          data-testid="customers-customer-name"
        />
      </FormField>
      <FormField v-slot="{ field }" label="取引規制">
        <BaseSelect
          v-bind="field"
          v-model="inputs.restriction"
          :options="restrictionOptions"
          placeholder="-- すべて --"
          data-testid="customers-restriction"
        />
      </FormField>
      <FormField v-slot="{ field }" label="口座区分">
        <BaseSelect
          v-bind="field"
          v-model="inputs.accountType"
          :options="accountTypeOptions"
          placeholder="-- 全区分 --"
          data-testid="customers-account-type"
        />
      </FormField>
      <FormField v-slot="{ field }" label="個人／法人">
        <BaseSelect
          v-bind="field"
          v-model="inputs.corporateType"
          :options="corporateTypeOptions"
          placeholder="-- すべて --"
          data-testid="customers-corporate-type"
        />
      </FormField>
    </MasterSearchCard>

    <MasterListCard
      testid-prefix="customers"
      title="顧客一覧"
      empty-message="該当する顧客はありません。"
      :total="total"
      :limit="limit"
      :offset="offset"
      :loading="loading"
      :is-empty="isEmpty"
      :error="error"
      @reload="store.reload()"
      @update:offset="goToOffset"
    >
      <!-- 行のキーは DataTable の既定（id）に任せる。主キーは口座番号ではない -->
      <DataTable
        flat
        data-testid="customers-table"
        :columns="columns"
        :rows="items"
        :row-class="rowClass"
      >
        <!--
          部店・扱者はコードが主で名前をその下に添える 2 段表示（CAマスタの銘柄列と同じ作り）。
          顧客名だけは氏名が主で、カナを下に添える。
        -->
        <template #cell-branch="{ row }">
          <div class="customer-list__stack">
            <span class="customer-list__primary">{{ row.branchCode || '—' }}</span>
            <span v-if="row.branchName" class="customer-list__secondary">{{ row.branchName }}</span>
          </div>
        </template>

        <template #cell-handler="{ row }">
          <div class="customer-list__stack">
            <span class="customer-list__primary">{{ row.handlerCode || '—' }}</span>
            <span v-if="row.handlerName" class="customer-list__secondary">
              {{ row.handlerName }}
            </span>
          </div>
        </template>

        <template #cell-accountNumber="{ row }">
          {{ row.accountNumber || '—' }}
        </template>

        <template #cell-customerName="{ row }">
          <div class="customer-list__stack">
            <span class="customer-list__primary">{{ row.customerName || '—' }}</span>
            <span v-if="row.customerNameKana" class="customer-list__secondary">
              {{ row.customerNameKana }}
            </span>
          </div>
        </template>

        <template #cell-age="{ row }">{{ ageLabel(row) }}</template>

        <!-- 取引停止中だけ目立たせる。通常の行は区分名をそのまま出す -->
        <template #cell-restriction="{ row }">
          <BaseBadge v-if="row.tradingSuspended" variant="warning">
            {{ row.restrictionName || '取引停止' }}
          </BaseBadge>
          <template v-else>{{ row.restrictionName || '—' }}</template>
        </template>

        <template #cell-investmentPolicy="{ row }">{{ row.investmentPolicyName || '—' }}</template>
        <template #cell-compliance="{ row }">{{ row.complianceRankName || '—' }}</template>

        <!-- 事故処理口座は口座区分に併記する（区分そのものとは別の軸なので置き換えない） -->
        <template #cell-accountType="{ row }">
          <span class="customer-list__account-type">
            <span>{{ row.accountTypeName || '—' }}</span>
            <BaseBadge v-if="row.accidentAccount" variant="warning">事故</BaseBadge>
          </span>
        </template>

        <template #cell-corporateType="{ row }">{{ row.corporateTypeName || '—' }}</template>

        <!-- 金額は記号ではなく単位を後置する（3,500,000 円 / 50,000.00 ドル） -->
        <template #cell-cashJpy="{ row }">
          {{ formatJpyUnit(row.cashJpy) }}
        </template>
        <template #cell-cashUsd="{ row }">
          {{ formatUsdUnit(row.cashUsd) }}
        </template>
        <template #cell-growthQuota="{ row }">
          {{ formatJpyUnit(row.growthQuota) }}
        </template>

        <!-- 削除は実装しないので編集だけ -->
        <template #cell-actions="{ row }">
          <BaseButton
            variant="secondary"
            :data-testid="`customers-edit-${row.id}`"
            :disabled="updating"
            @click="openEdit(row)"
          >
            編集
          </BaseButton>
        </template>
      </DataTable>
    </MasterListCard>

    <MasterFormDialog
      :open="isAddOpen"
      title="顧客 新規追加"
      testid-prefix="customers"
      size="lg"
      :pending="creating"
      :error="createError"
      :validation-errors="validationErrors"
      :validation-warnings="validationWarnings"
      @close="closeAdd"
      @submit="submitAdd"
    >
      <CustomerFormFields v-model="addForm" testid-prefix="customers-add" :errors="addErrors" />
    </MasterFormDialog>

    <MasterFormDialog
      :open="Boolean(editTarget)"
      title="顧客 編集"
      testid-prefix="customers"
      action="edit"
      submit-label="更新"
      size="lg"
      :pending="updating"
      :error="updateError"
      :validation-errors="updateValidationErrors"
      @close="closeEdit"
      @submit="submitEdit"
    >
      <CustomerFormFields
        v-model="editForm"
        testid-prefix="customers-edit"
        editing
        :errors="editErrors"
      />
    </MasterFormDialog>
  </section>
</template>

<style scoped>
.customer-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* 2 段表示のセル（部店 / 扱者 / 顧客名） */
.customer-list__stack {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.customer-list__primary {
  font-weight: 600;
}

.customer-list__secondary {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.customer-list__account-type {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

/*
 * 手動操作された行（ユーザー操作フラグ=1）。
 * 行は DataTable が描くので、scoped のままでは届かない（:deep が要る）。
 * 色は警告色の淡色面を借りる。「異常」ではなく「自動取込のままではない」ことの印。
 */
.customer-list :deep(tr.is-user-modified) {
  background-color: var(--color-warning-bg);
}

/* ホバー中も印を残す。DataTable の中立なホバー色に塗り潰させず、同系色で一段濃くする */
.customer-list :deep(tr.is-user-modified:hover td) {
  background-color: var(--color-warning-border);
}
</style>
