<script setup>
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import ConfirmDeleteDialog from '@/components/masters/ConfirmDeleteDialog.vue'
import MasterFormDialog from '@/components/masters/MasterFormDialog.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
import FeePreferenceFormFields from '@/components/feePreference/FeePreferenceFormFields.vue'
import { useListQuery } from '@/composables/useListQuery'
import { useCodesStore } from '@/stores/codes'
import { FEE_PREFERENCES_PAGE_SIZE, useFeePreferencesStore } from '@/stores/feePreferences'
import { formatDateTime, formatJpyUnit, joinWide } from '@/utils/format'
import {
  FEE_PATTERN_FILTER_OPTIONS,
  formatApplyMethod,
  formatFeePattern,
  isFeePatternFilter,
} from '@/utils/feePreferenceOptions'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する
const store = useFeePreferencesStore()
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
  deleting,
  deleteError,
} = storeToRefs(store)

const codes = useCodesStore()

/*
 * 列は実 API（docs/api/openapi.json の FeePreferenceItem）の項目から組む。画面モック
 * （python_app/templates/master_fee_preferences.html）は「設定内容は要件整理中」の表示枠だけで
 * 列（優遇ID / 設定名 / 適用対象 / 優遇内容 / 有効期間 / 状態）が実 API と対応しないため、モックの列は採らない
 * （要件は 2026-10-06 のバックエンド回答で確定。docs/api/requests.md #11）。
 *   - 口座は「部店 / 口座番号 / 顧客名」の 3 列（部店・顧客名はサーバが口座マスタを結合して返す）
 *   - 方式ごとの下限・上限は 1 列にまとめる（列が 14 になって横に溢れるのを避ける）
 *   - 適用されない方式の列は淡く出す（値が入っていても計算には使われない。下の unusedClass）
 *   - 操作列の並びは編集が左・削除が右端（破壊的な操作を最後にする既存の並び）
 */
const columns = [
  { key: 'branchCode', label: '部店' },
  { key: 'accountNumber', label: '口座番号' },
  { key: 'customerName', label: '顧客名' },
  { key: 'applyMethod', label: '適用方式' },
  { key: 'feePattern', label: '手数料パターン' },
  { key: 'feeMultiplier', label: '掛目', numeric: true },
  { key: 'feeRange', label: '手数料 下限〜上限' },
  { key: 'basisPoints', label: 'ベイシス', numeric: true },
  { key: 'basisRange', label: 'ベイシス 下限〜上限' },
  { key: 'fxSpread', label: '為替スプレッド', numeric: true },
  { key: 'updatedAt', label: '更新日時' },
  // 行ごとの操作（編集・削除）。他のマスタ画面に合わせて見出しは空にする
  { key: 'actions', label: '' },
]

/*
 * ページ位置と検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名（branch_code / account_no / fee_pattern）はこの filters 定義にだけ現れる。
 * 手数料パターンの「デフォルト」は空文字と区別できないので目印（DEFAULT_FEE_PATTERN_FILTER）で持つ
 * （src/utils/feePreferenceOptions.js）。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'branchCode', query: 'branch_code' },
    { key: 'accountNumber', query: 'account_no' },
    // 未知の値（?fee_pattern=ZZ など）は条件なしとして捨てる
    {
      key: 'feePattern',
      query: 'fee_pattern',
      parse: (value) => (isFeePatternFilter(value) ? value : ''),
    },
  ],
  load: (params) => store.load(params),
})

const branchOptions = computed(() => codes.optionsFor('部店'))

/** 小数（掛目・ベイシス・スプレッド）。スプレッドが小数第 4 位まであるので 4 桁まで出す */
const decimal = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 4 })

function formatDecimal(value, unit) {
  if (value === null || value === undefined) return '—'
  return `${decimal.format(value)} ${unit}`
}

/** 下限〜上限。どちらも未設定なら '—' だけにする */
function formatRange(min, max) {
  if (min === null && max === null) return '—'
  return `${formatJpyUnit(min)} 〜 ${formatJpyUnit(max)}`
}

/**
 * 適用されない方式の列に付けるクラス。ベイシス方式の口座ではパターン方式の項目（パターン・掛目・
 * 手数料の下限上限）が、パターン方式の口座ではベイシスの下限上限が計算に使われない。
 */
function unusedClass(row, method) {
  return row.applyMethod && row.applyMethod !== method ? 'is-unused' : null
}

/*
 * 新規追加。ヘッダの「新規追加」からモーダルを開く（銘柄マスタ・CAマスタと同じ形）。
 * URL は変えない（一覧の単方向フローに触らない）。
 *
 * 登録は store 側で「サーバの事前検証 → 登録」の 2 段になっている。ここでの検証は
 * 口座番号の未入力と数値の形を弾くためのもので、口座の存在・重複・範囲はサーバが見る。
 * 数値の形を画面で見るのは、api 層が数値にならない入力を null（未設定）に寄せるため
 * （黙って「未設定」で送られるのを防ぐ）。
 *
 * 出し先は 4 つに分かれる（MasterFormDialog の約束どおり）。
 *   入力の不備      … FormField の error（項目の直下）
 *   事前検証の不合格 … store.validationErrors（口座が無い・既に登録がある など）
 *   事前検証の警告   … store.validationWarnings（未登録の手数料パターン・方式で使われない項目）
 *   通信・サーバ障害 … store.createError（範囲外の値の 422 もここ）
 */
const isAddOpen = ref(false)

// 項目が 9 あるので、ref を項目ごとに分けず 1 つのオブジェクトで持つ
const addForm = ref(emptyForm())
const addErrors = ref(emptyErrors())

// 成功メッセージ（追加・編集・削除で同じ枠に出す）と、変更の応答が返した警告
const noticeMessage = ref('')
const noticeWarnings = ref([])

function emptyForm() {
  return {
    accountNumber: '',
    // 空文字がデフォルトパターン（未選択は作らない）
    feePattern: '',
    // 数値は入力欄が文字列を持つ。数値への変換は api 層に任せる
    feeMultiplier: '',
    minFee: '',
    maxFee: '',
    basisPoints: '',
    minBasisFee: '',
    maxBasisFee: '',
    fxSpread: '',
  }
}

function emptyErrors() {
  return {
    accountNumber: '',
    feeMultiplier: '',
    minFee: '',
    maxFee: '',
    basisPoints: '',
    minBasisFee: '',
    maxBasisFee: '',
    fxSpread: '',
  }
}

/** 数値の項目と、エラー文言に使う名前 */
const NUMBER_FIELD_LABELS = {
  feeMultiplier: '掛目',
  minFee: '下限手数料',
  maxFee: '上限手数料',
  basisPoints: 'ベイシス',
  minBasisFee: '下限ベイシス',
  maxBasisFee: '上限ベイシス',
  fxSpread: '為替スプレッド',
}

/**
 * 画面で見る入力の不備（追加・編集で共用）。口座番号の未入力と形、数値の形だけを見る。
 * 範囲（掛目・スプレッドは 100 まで）はサーバの宣言に任せる（二重に持つと食い違う）。
 */
function validateForm(form) {
  const errors = emptyErrors()

  const accountNumber = form.accountNumber.trim()
  if (!accountNumber) {
    errors.accountNumber = '口座番号を入力してください。'
  } else if (!/^\d+$/.test(accountNumber)) {
    errors.accountNumber = '口座番号は数字で入力してください。'
  }

  for (const [key, label] of Object.entries(NUMBER_FIELD_LABELS)) {
    const value = String(form[key] ?? '').trim()
    if (value === '') continue
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) {
      errors[key] = `${label}は 0 以上の数値で入力してください。`
    }
  }

  return errors
}

/** フォームの値を送る形に整える（前後の空白を落とす。数値への変換は api 層） */
function toPayload(form) {
  return Object.fromEntries(
    Object.entries(form).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.trim() : value,
    ]),
  )
}

/*
 * 事前検証の警告が出ているあいだは、送信は「承知して続行」の意味になる。
 * 文言も変えて、同じボタンを押しても結果が変わることを見せる（海外休場日マスタと同じ）。
 */
const hasAddWarnings = computed(() => validationWarnings.value.length > 0)
const addSubmitLabel = computed(() => (hasAddWarnings.value ? '続行' : '追加'))

// 入力を変えたら前回の検証結果は当てにならない。承知済みの警告も持ち越さない
watch(addForm, () => store.clearCreateError(), { deep: true })

function clearNotice() {
  noticeMessage.value = ''
  noticeWarnings.value = []
}

function openAdd() {
  addForm.value = emptyForm()
  addErrors.value = emptyErrors()
  // 前回の失敗と成功をどちらも持ち込まない
  store.clearCreateError()
  clearNotice()
  isAddOpen.value = true
}

function closeAdd() {
  // 登録中に閉じると結果の行き先が無くなるので、終わるまで閉じさせない
  if (creating.value) return
  isAddOpen.value = false
}

async function submitAdd() {
  addErrors.value = validateForm(addForm.value)
  if (Object.values(addErrors.value).some(Boolean)) return

  await store.create(
    {
      ...toPayload(addForm.value),
      // 警告を出したうえでもう一度押されたので、承知したものとして登録に進む
      acknowledgedWarnings: hasAddWarnings.value,
    },
    {
      /*
       * 閉じるのは登録が受理された時点。store.create の戻り値を待つと、
       * そこに含まれる一覧の読み直しのあいだモーダルが開いたまま残る。
       * 失敗時は呼ばれないので、モーダルは開いたままになり入力を直せる。
       *
       * 応答の warnings は出さない。事前検証と同じ判定で、承知して「続行」を押した後なので
       * 重ねて見せると同じ注意が 2 回出る。
       */
      onSuccess: (created) => {
        isAddOpen.value = false
        noticeMessage.value = `${feePreferenceLabel(created)} の手数料優遇を追加しました。`
      },
    },
  )
}

/*
 * 編集。モーダルは「開いているか」と「どの行か」を editTarget 1 つで持つ。
 * editTarget が握っている id が更新対象を、updatedAt が楽観的ロックの合札を受け持つ。
 * パスキーが ID なので口座番号も変えられる（業務キーのマスタと違い、読み取り専用にしない）。
 *
 * 事前検証の警告では止まらない（useCrudList の update は warnings を扱わない）。
 * サーバは変更の応答にも同じ警告を返すので、それを成功の通知に添える。
 * エラーの出し先は新規追加と同じ。409 の競合も通信・サーバ障害と同じ枠に出す。
 */
const editTarget = ref(null)
const editForm = ref(emptyForm())
const editErrors = ref(emptyErrors())

/** 一覧の 1 行を編集フォームの形に開く（数値は入力欄が文字列を持つので寄せる） */
function toForm(row) {
  // null（未設定）と 0 を混ぜないよう、空文字に寄せるのは null のときだけ
  const text = (value) => (value === null || value === undefined ? '' : String(value))
  return {
    accountNumber: row.accountNumber,
    feePattern: row.feePattern,
    feeMultiplier: text(row.feeMultiplier),
    minFee: text(row.minFee),
    maxFee: text(row.maxFee),
    basisPoints: text(row.basisPoints),
    minBasisFee: text(row.minBasisFee),
    maxBasisFee: text(row.maxBasisFee),
    fxSpread: text(row.fxSpread),
  }
}

function openEdit(row) {
  editForm.value = toForm(row)
  editErrors.value = emptyErrors()
  // 前回の失敗と成功をどちらも持ち込まない
  store.clearUpdateError()
  clearNotice()
  editTarget.value = row
}

function closeEdit() {
  // 更新中に閉じると結果の行き先が無くなるので、終わるまで閉じさせない
  if (updating.value) return
  editTarget.value = null
}

async function submitEdit() {
  const target = editTarget.value
  if (!target) return

  editErrors.value = validateForm(editForm.value)
  if (Object.values(editErrors.value).some(Boolean)) return

  const updated = await store.update(
    {
      ...toPayload(editForm.value),
      // id と合札はフォームの外から来る（利用者が触れる値ではない）
      id: target.id,
      updatedAt: target.updatedAt,
    },
    {
      // 追加と同じく、一覧の読み直しを待たずに閉じる。失敗時は呼ばれないので
      // モーダルは開いたままになり入力を直せる（理由は updateError に出る）
      onSuccess: (item) => {
        editTarget.value = null
        noticeMessage.value = `${feePreferenceLabel(item)} の手数料優遇を変更しました。`
        noticeWarnings.value = item.warnings ?? []
      },
    },
  )
  if (!updated) return

  // 絞り込み中に条件の圏外へ変えると、最終ページが空になり得る
  stepBackIfPageEmpty()
}

/*
 * 削除。確認モーダルは「開いているか」と「何を消すか」を deleteTarget 1 つで持つ（編集と同じ形）。
 * 実 API は論理削除で、一覧は既定で取消済みを返さないので、読み直すと行が消える。
 * 削除した口座はデフォルトの手数料パターンと仮計算マスタの為替スプレッドで計算される。
 */
const deleteTarget = ref(null)

function openDelete(row) {
  // 前回の失敗と成功をどちらも持ち込まない
  store.clearDeleteError()
  clearNotice()
  deleteTarget.value = row
}

function closeDelete() {
  // 削除中に閉じると結果の行き先が無くなるので、終わるまで閉じさせない
  if (deleting.value) return
  deleteTarget.value = null
}

async function submitDelete() {
  const target = deleteTarget.value
  if (!target) return

  const deleted = await store.remove(target.id, {
    // 追加・編集と同じく、一覧の読み直しを待たずに閉じる。失敗時は呼ばれないので
    // モーダルは開いたままになり、理由（deleteError）を読ませられる
    onSuccess: () => {
      deleteTarget.value = null
      noticeMessage.value = `${feePreferenceLabel(target)} の手数料優遇を削除しました。`
    },
  })
  if (!deleted) return

  // 最終ページの最後の 1 件を消すと、読み直した結果がそのページで 0 件になる
  stepBackIfPageEmpty()
}

/**
 * 読み直した結果が 0 件になったら 1 ページ戻す。
 * 最終ページの最後の 1 件が今の offset から居なくなる操作（削除、絞り込み中の変更）で使う。
 */
function stepBackIfPageEmpty() {
  if (items.value.length === 0 && offset.value > 0) {
    goToOffset(offset.value - FEE_PREFERENCES_PAGE_SIZE)
  }
}

/** 1 件を 1 行で示す文字列（成功メッセージ・削除確認に使う）。口座番号と顧客名を並べる */
function feePreferenceLabel(row) {
  return joinWide(row.accountNumber || '—', row.customerName || '—')
}
</script>

<template>
  <section class="fee-preference-list">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む -->
    <Teleport defer to="#topbar-actions">
      <BaseButton data-testid="fee-preferences-add" @click="openAdd">新規追加</BaseButton>
    </Teleport>

    <BaseAlert v-if="noticeMessage" variant="success" data-testid="fee-preferences-notice">
      {{ noticeMessage }}
    </BaseAlert>

    <!-- 変更の応答が返した警告（変更自体は済んでいる） -->
    <BaseAlert
      v-if="noticeWarnings.length > 0"
      variant="warning"
      data-testid="fee-preferences-notice-warning"
    >
      <ul class="fee-preference-list__messages">
        <li v-for="message in noticeWarnings" :key="message">{{ message }}</li>
      </ul>
    </BaseAlert>

    <!-- 画面の説明。4 状態や検索結果に関わらず常時出す -->
    <BaseAlert variant="info" data-testid="fee-preferences-description">
      口座ごとに手数料と為替スプレッドの優遇を設定します（1 口座 1 件）。登録の無い口座は
      デフォルトの手数料パターンと仮計算マスタの為替スプレッドで計算します。ベイシスを設定した口座は
      ベイシス方式、それ以外はパターン方式で計算し、為替スプレッドの 0 は為替手数料の免除です。
    </BaseAlert>

    <MasterSearchCard
      testid-prefix="fee-preferences"
      :disabled="loading"
      @submit="submitSearch"
      @clear="clearSearch"
    >
      <FormField v-slot="{ field }" label="部店コード">
        <BaseSelect
          v-bind="field"
          v-model="inputs.branchCode"
          :options="branchOptions"
          placeholder="-- 全部店 --"
          data-testid="fee-preferences-branch-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="口座番号">
        <BaseInput
          v-bind="field"
          v-model="inputs.accountNumber"
          inputmode="numeric"
          placeholder="例: 1230001"
          data-testid="fee-preferences-account-number"
        />
      </FormField>
      <FormField v-slot="{ field }" label="手数料パターン">
        <BaseSelect
          v-bind="field"
          v-model="inputs.feePattern"
          :options="FEE_PATTERN_FILTER_OPTIONS"
          placeholder="-- すべて --"
          data-testid="fee-preferences-fee-pattern"
        />
      </FormField>
    </MasterSearchCard>

    <MasterListCard
      testid-prefix="fee-preferences"
      title="手数料優遇一覧"
      empty-message="該当する手数料優遇はありません。"
      :total="total"
      :limit="limit"
      :offset="offset"
      :loading="loading"
      :is-empty="isEmpty"
      :error="error"
      @reload="store.reload()"
      @update:offset="goToOffset"
    >
      <!-- 行のキーは DataTable の既定（id）に任せる -->
      <DataTable flat data-testid="fee-preferences-table" :columns="columns" :rows="items">
        <template #cell-branchCode="{ value }">
          <span class="fee-preference-list__code">{{ value || '—' }}</span>
        </template>
        <template #cell-accountNumber="{ value }">
          <span class="fee-preference-list__code">{{ value || '—' }}</span>
        </template>
        <template #cell-customerName="{ value }">{{ value || '—' }}</template>

        <template #cell-applyMethod="{ value }">
          <span class="fee-preference-list__method">{{ formatApplyMethod(value) }}</span>
        </template>

        <!-- パターン方式の 3 列。ベイシス方式の口座では計算に使われないので淡く出す -->
        <template #cell-feePattern="{ row }">
          <span :class="unusedClass(row, 'PATTERN')">{{ formatFeePattern(row.feePattern) }}</span>
        </template>
        <template #cell-feeMultiplier="{ row }">
          <span :class="unusedClass(row, 'PATTERN')">{{ formatDecimal(row.feeMultiplier, '%') }}</span>
        </template>
        <template #cell-feeRange="{ row }">
          <span :class="['fee-preference-list__range', unusedClass(row, 'PATTERN')]">
            {{ formatRange(row.minFee, row.maxFee) }}
          </span>
        </template>

        <!-- ベイシス方式の 2 列 -->
        <template #cell-basisPoints="{ row }">{{ formatDecimal(row.basisPoints, 'bp') }}</template>
        <template #cell-basisRange="{ row }">
          <span :class="['fee-preference-list__range', unusedClass(row, 'BASIS')]">
            {{ formatRange(row.minBasisFee, row.maxBasisFee) }}
          </span>
        </template>

        <!-- 為替スプレッドはどちらの方式でも使う。0 は免除、未設定（'—'）は仮計算マスタの値 -->
        <template #cell-fxSpread="{ row }">{{ formatDecimal(row.fxSpread, '円/USD') }}</template>

        <template #cell-updatedAt="{ value }">
          <span class="fee-preference-list__updated">{{ value ? formatDateTime(value) : '—' }}</span>
        </template>

        <!-- 編集を左、削除を右端に置く（破壊的な操作を最後にする既存の並び） -->
        <template #cell-actions="{ row }">
          <div class="fee-preference-list__row-actions">
            <BaseButton
              variant="secondary"
              :data-testid="`fee-preferences-edit-${row.id}`"
              :disabled="updating"
              @click="openEdit(row)"
            >
              編集
            </BaseButton>
            <BaseButton
              variant="danger"
              :data-testid="`fee-preferences-delete-${row.id}`"
              :disabled="deleting"
              @click="openDelete(row)"
            >
              削除
            </BaseButton>
          </div>
        </template>
      </DataTable>
    </MasterListCard>

    <MasterFormDialog
      :open="isAddOpen"
      title="手数料優遇 新規追加"
      testid-prefix="fee-preferences"
      size="lg"
      :submit-label="addSubmitLabel"
      :pending="creating"
      :error="createError"
      :validation-errors="validationErrors"
      :validation-warnings="validationWarnings"
      @close="closeAdd"
      @submit="submitAdd"
    >
      <FeePreferenceFormFields
        v-model="addForm"
        testid-prefix="fee-preferences-add"
        :errors="addErrors"
      />
    </MasterFormDialog>

    <MasterFormDialog
      :open="Boolean(editTarget)"
      title="手数料優遇 編集"
      testid-prefix="fee-preferences"
      action="edit"
      size="lg"
      submit-label="更新"
      :pending="updating"
      :error="updateError"
      :validation-errors="updateValidationErrors"
      @close="closeEdit"
      @submit="submitEdit"
    >
      <FeePreferenceFormFields
        v-model="editForm"
        testid-prefix="fee-preferences-edit"
        :errors="editErrors"
      />
    </MasterFormDialog>

    <ConfirmDeleteDialog
      :open="Boolean(deleteTarget)"
      testid-prefix="fee-preferences"
      :label="deleteTarget ? `${feePreferenceLabel(deleteTarget)} の手数料優遇` : ''"
      :pending="deleting"
      :error="deleteError"
      @close="closeDelete"
      @confirm="submitDelete"
    />
  </section>
</template>

<style scoped>
.fee-preference-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* 部店・口座番号はコード値。桁を揃えて読ませる */
.fee-preference-list__code {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.fee-preference-list__method {
  font-weight: 600;
  white-space: nowrap;
}

.fee-preference-list__range,
.fee-preference-list__updated {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.fee-preference-list__row-actions {
  display: flex;
  gap: var(--space-2);
}

/* 適用されない方式の値。消さずに淡く出す（入っていること自体は見せる） */
.is-unused {
  color: var(--color-text-muted);
  opacity: 0.6;
}

/* 変更の応答が返した警告。MasterFormDialog の箇条書きと同じく記号と字下げを付けない */
.fee-preference-list__messages {
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
