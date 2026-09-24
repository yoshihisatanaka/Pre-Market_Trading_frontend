<script setup>
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
import BalanceAdjustDialog from '@/components/balance/BalanceAdjustDialog.vue'
import BalanceQuantityPanel from '@/components/balance/BalanceQuantityPanel.vue'
import { useListQuery } from '@/composables/useListQuery'
import { useBalanceAdjustmentsStore } from '@/stores/balanceAdjustments'
import { useCodesStore } from '@/stores/codes'
import { useCustomerOptionsStore } from '@/stores/customerOptions'
import {
  SPECIFIC_DEPOSIT_DEFAULT,
  SPECIFIC_DEPOSIT_OPTIONS,
  formatSpecificDeposit,
} from '@/utils/balanceTypes'
import { formatMonthDayTime, formatQuantity, joinWide } from '@/utils/format'
import { OPERATOR_CODE } from '@/utils/operator'

/*
 * 残高マスタ（顧客残高の管理）。いまは見た目だけで、実 API とは繋がっていない
 * （src/mocks/handlers/index.js のモックが応えている）。
 * モックと実 API の食い違いは src/api/balanceAdjustments.js の冒頭に書いてある。
 *
 * 画面モック（/masters/balance-adjustments）からの意図的なずれが 3 つある。
 *   - モックは全件を 1 つのスクロール領域に出すが、ここは 50 件ごとのページャー
 *     （MasterListCard が持つ）。残高は 顧客 × 銘柄 × 口座区分 の直積なので、
 *     出さないと 51 件目以降が黙って消える
 *   - モックは「新規保有を追加」を一覧カードの見出し横に置くが、ここはヘッダ
 *     （#topbar-actions）に差す。画面固有の操作の置き場所は既存の画面と揃える
 *   - 検索カードに「クリア」が増える（MasterSearchCard が検索とセットで持つ）。
 *     読み直しの導線はヘッダではなく、エラー状態の「再試行」だけにする
 *
 * **列見出しの「口座区分」の中身は 特定預り区分。** 顧客マスタに出ている 口座区分
 * （一般 / 自己 / 同業者）とは別物で、同じ語が 2 つの意味で使われている。
 * 見出しは画面モックに合わせたもので、コード側の名前は API の項目名のまま
 * （`specificDeposit`）。経緯は src/utils/balanceTypes.js。
 */

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useBalanceAdjustmentsStore()
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
  updating,
  updateError,
} = storeToRefs(store)

const codes = useCodesStore()
const customerOptions = useCustomerOptionsStore()

/*
 * 対象顧客のプルダウンはこの画面だけが使うので、起動時ではなくここで 1 度だけ読む。
 * 失敗しても一覧は出せるので、読み込みの成否はモーダル側でしか見ない。
 */
onMounted(() => customerOptions.loadOnce())

/* 列は画面モックの並びどおり */
const columns = [
  { key: 'branchCode', label: '部店' },
  { key: 'accountNumber', label: '口座番号' },
  { key: 'handler', label: '扱者' },
  { key: 'customerName', label: '顧客名' },
  { key: 'ticker', label: 'ティッカー' },
  { key: 'symbolName', label: '銘柄名' },
  { key: 'specificDeposit', label: '口座区分' },
  { key: 'balance', label: '現在数量', numeric: true },
  { key: 'sellProhibited', label: '売却不可区分' },
  { key: 'updated', label: '最終更新' },
  // 行ごとの操作（数量を加算）。画面モックに合わせて見出しは空にする
  { key: 'actions', label: '' },
]

/*
 * ページ位置と検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名は画面モックの form と同じ契約で、この filters 定義にだけ現れる。
 * `symbol_name`（銘柄名）は実 API に送り先が無く、モックだけが解釈する
 * （src/api/balanceAdjustments.js の冒頭コメント）。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'branchCode', query: 'branch_code' },
    { key: 'accountNumber', query: 'account_no' },
    { key: 'customerName', query: 'customer_name' },
    { key: 'ticker', query: 'symbol' },
    { key: 'symbolName', query: 'symbol_name' },
  ],
  load: (params) => store.load(params),
})

/*
 * 手で補正された行は、取込のままの行と見分けられるよう行ごと淡く塗る
 * （銘柄マスタ・顧客マスタと同じ印）。
 */
function rowClass(row) {
  return row.userModified ? 'is-user-modified' : null
}

/** 口座区分セル。サーバが付けた名前を優先し、無ければフロントの対応表に落とす */
function depositLabel(row) {
  return row.specificDepositName || formatSpecificDeposit(row.specificDeposit)
}

/**
 * 更新者の表示名。**更新者コードが扱者コードと同じ体系だと仮定して引いている**
 * （コードマスタの label は「001 田中」の形なのでコードも一緒に出る）。
 * 引けなければ空文字を返し、呼び出し側がコードのままにする。→ バックエンドへの確認事項
 */
function handlerNameOf(code) {
  if (!code) return ''
  return codes.optionsFor('扱者').find((option) => option.value === code)?.label ?? ''
}

/** 確認ステップの「更新者」。ログインの仕組みが無いので .env の社員コードから引く */
const operatorLabel = computed(
  () => handlerNameOf(OPERATOR_CODE) || OPERATOR_CODE || '—',
)

/* ------------------------------------------------------------------ *
 * 加算数量の入力（加算モーダルと新規追加モーダルで同じ規則を使う）
 * ------------------------------------------------------------------ */

/**
 * 入力欄の文字列 → 整数。符号は許す（補正で減らすこともあるため）。
 * 空文字や数値でないものは null（集計パネルは '—' を出し、送信は弾かれる）。
 */
function toIntegerOrNull(value) {
  const text = String(value ?? '').trim()
  return /^[+-]?\d+$/.test(text) ? Number(text) : null
}

/** 成功メッセージ。加算と新規追加で同じ枠に出す（同時に成功することは無い） */
const noticeMessage = ref('')

/* ------------------------------------------------------------------ *
 * 既存保有への数量加算（行の「数量を加算」）
 *
 * 2 段階の step は view が持つ。ダイアログ部品は状態を持たない。
 * エラーの出し先は 2 つに分かれる。
 *   入力の不備      … FormField の error（項目の直下）
 *   通信・サーバ障害 … store.updateError をモーダル内の BaseAlert（409 の競合もここ）
 * ------------------------------------------------------------------ */
const increaseTarget = ref(null)
const increaseStep = ref('input')
const increaseQuantity = ref('')
const increaseError = ref('')

const increaseBefore = computed(() => increaseTarget.value?.balance ?? 0)
// 読み取り専用の「対象銘柄」。Ticker が無い行は銘柄コードで代用する
const increaseSymbolLabel = computed(() => {
  const target = increaseTarget.value
  if (!target) return '—'
  return joinWide(target.ticker || target.symbolCode, target.symbolName)
})
const increaseAdded = computed(() => toIntegerOrNull(increaseQuantity.value))
const increaseAfter = computed(() => increaseBefore.value + (increaseAdded.value ?? 0))

function openIncrease(row) {
  increaseTarget.value = row
  increaseStep.value = 'input'
  increaseQuantity.value = ''
  increaseError.value = ''
  // 前回の失敗と成功をどちらも持ち込まない
  store.clearUpdateError()
  noticeMessage.value = ''
}

function closeIncrease() {
  // 更新中に閉じると結果の行き先が無くなるので、終わるまで閉じさせない
  if (updating.value) return
  increaseTarget.value = null
}

/** 入力ステップ →確認ステップ。サーバへは行かず、必須と桁だけをここで見る */
function confirmIncrease() {
  increaseError.value = quantityError(increaseAdded.value, increaseAfter.value)
  if (increaseError.value) return
  increaseStep.value = 'confirm'
}

async function submitIncrease() {
  const target = increaseTarget.value
  if (!target) return

  /*
   * 補正後数量は increaseTarget から導く computed なので、モーダルを閉じた（= target を
   * null にした）瞬間に 0 起点へ戻る。成功メッセージで使うぶんはここで確定させておく。
   */
  const nextBalance = increaseAfter.value

  await store.update(
    {
      id: target.id,
      // 送るのは加算数量ではなく補正後の絶対値（実 API に加算の概念は無い）。
      // 画面に出ている「補正後数量」と同じ値をそのまま渡す
      balance: nextBalance,
      // 取得時の更新日時を合札として返す。ずれていればサーバが 409 で弾く
      updatedAt: target.updatedAt,
    },
    {
      /*
       * 閉じるのは更新が受理された時点。store.update の戻り値を待つと、
       * そこに含まれる一覧の読み直しのあいだモーダルが開いたまま残る。
       * 失敗時は呼ばれないので、モーダルは開いたままになり理由を読ませる。
       */
      onSuccess: () => {
        increaseTarget.value = null
        noticeMessage.value = `${target.ticker || target.symbolCode} の残高を ${formatQuantity(nextBalance)}株 に更新しました。`
      },
    },
  )
}

/* ------------------------------------------------------------------ *
 * 売却の停止 / 解除（行の「売却を停止」「売却停止を解除」）
 *
 * 入力が無いので数量の補正のような 2 段階は要らないが、画面モックは
 * confirm() を挟んでいるので、同じ問いを出す確認ダイアログを 1 枚置く。
 * 「開いているか」と「どの行か」を sellTarget 1 つで持つ（削除確認と同じ作法）。
 * ------------------------------------------------------------------ */
const sellTarget = ref(null)

/** 押したときに向かう先。true なら停止、false なら解除 */
const sellNext = computed(() => !sellTarget.value?.sellProhibited)

/** 問いの下に添える対象の 1 行。どの保有を触るのかを取り違えないようにする */
const sellTargetLabel = computed(() => {
  const target = sellTarget.value
  if (!target) return ''
  const symbol = joinWide(target.ticker || target.symbolCode, target.symbolName)
  return `${symbol}（${target.accountNumber} ${target.customerName}）`
})

// 問いの文言は画面モックの confirm() と同じ
const sellConfirmMessage = computed(() =>
  sellNext.value ? '売却を停止します。よろしいですか？' : '売却停止を解除します。よろしいですか？',
)

function openSell(row) {
  store.clearUpdateError()
  noticeMessage.value = ''
  sellTarget.value = row
}

function closeSell() {
  // 更新中に閉じると結果の行き先が無くなるので、終わるまで閉じさせない
  if (updating.value) return
  sellTarget.value = null
}

async function submitSell() {
  const target = sellTarget.value
  if (!target) return

  const next = sellNext.value
  const label = target.ticker || target.symbolCode

  await store.update(
    { id: target.id, sellProhibited: next, updatedAt: target.updatedAt },
    {
      onSuccess: () => {
        sellTarget.value = null
        noticeMessage.value = next
          ? `${label} の売却を停止しました。`
          : `${label} の売却停止を解除しました。`
      },
    },
  )
}

/* ------------------------------------------------------------------ *
 * 新規保有を追加（ヘッダの「新規保有を追加」）
 * ------------------------------------------------------------------ */
const isAddOpen = ref(false)
const addStep = ref('input')
const addForm = ref(emptyAddForm())
const addErrors = ref(emptyAddErrors())

function emptyAddForm() {
  return { customer: '', ticker: '', symbolName: '', specificDeposit: SPECIFIC_DEPOSIT_DEFAULT }
}

function emptyAddErrors() {
  return { customer: '', ticker: '', symbolName: '', quantity: '' }
}

// 新規なので補正前は常に 0。集計パネルの形は加算モーダルと同じにする
const addQuantity = ref('')
const addAdded = computed(() => toIntegerOrNull(addQuantity.value))
const addAfter = computed(() => addAdded.value ?? 0)

/** 選択された対象顧客（部店コード・口座番号・顧客名の引き戻しに使う） */
const addCustomer = computed(() => customerOptions.findByValue(addForm.value.customer))

function openAdd() {
  addForm.value = emptyAddForm()
  addErrors.value = emptyAddErrors()
  addQuantity.value = ''
  addStep.value = 'input'
  store.clearCreateError()
  noticeMessage.value = ''
  isAddOpen.value = true
}

function closeAdd() {
  // 登録中に閉じると結果の行き先が無くなるので、終わるまで閉じさせない
  if (creating.value) return
  isAddOpen.value = false
}

/** 入力ステップ → 確認ステップ。重複（同じ顧客・銘柄・区分）はサーバが見る */
function confirmAdd() {
  addErrors.value = {
    customer: addForm.value.customer ? '' : '対象顧客を選択してください。',
    ticker: addForm.value.ticker.trim() ? '' : 'ティッカーを入力してください。',
    symbolName: addForm.value.symbolName.trim() ? '' : '銘柄名を入力してください。',
    // 新規の保有なので 0 以下は作らせない（加算モーダルと違い減算に意味が無い）
    quantity: newHoldingQuantityError(addAdded.value),
  }
  if (Object.values(addErrors.value).some(Boolean)) return
  addStep.value = 'confirm'
}

async function submitAdd() {
  const customer = addCustomer.value
  if (!customer) return

  await store.create(
    {
      branchCode: customer.branchCode,
      accountNumber: customer.accountNumber,
      // ティッカーを 銘柄コード として送る。銘柄名は本文に項目が無いので送らない
      // （どちらも src/api/balanceAdjustments.js の冒頭コメントの 2・3 番）
      symbolCode: addForm.value.ticker.trim().toUpperCase(),
      specificDeposit: addForm.value.specificDeposit,
      balance: addAfter.value,
    },
    {
      onSuccess: () => {
        isAddOpen.value = false
        noticeMessage.value = `${addForm.value.ticker.trim().toUpperCase()} の保有を追加しました。`
      },
    },
  )
}

/* ------------------------------------------------------------------ *
 * 入力の検証（サーバへ行く前に画面で弾くぶんだけ）
 * ------------------------------------------------------------------ */

/** 既存保有への加算。減算もできるが、補正後が負になるものは通さない */
function quantityError(added, after) {
  if (added === null) return '加算数量を整数で入力してください。'
  if (added === 0) return '加算数量に 0 は指定できません。'
  if (after < 0) return '補正後数量が負になります。加算数量を見直してください。'
  return ''
}

/** 新規保有。0 株の保有を作る意味が無いので 1 以上に限る */
function newHoldingQuantityError(added) {
  if (added === null) return '加算数量を整数で入力してください。'
  if (added < 1) return '加算数量は 1 以上で入力してください。'
  return ''
}

/* ------------------------------------------------------------------ *
 * 確認ステップに並べる項目（モックの定義リストと同じ順）
 * ------------------------------------------------------------------ */

/** `+100株` / `-50株`。符号を見せて増減を読み取れるようにする */
function signedQuantity(value) {
  if (value === null) return '—'
  return `${value >= 0 ? '+' : ''}${formatQuantity(value)}株`
}

const increaseSummary = computed(() => {
  const target = increaseTarget.value
  if (!target) return []

  return [
    { label: '操作種別', value: '既存保有への数量加算' },
    {
      label: '対象顧客',
      value: joinWide(`${target.branchCode} / ${target.accountNumber}`, target.customerName || '—'),
    },
    {
      label: '対象銘柄',
      value: joinWide(target.ticker || target.symbolCode, target.symbolName),
    },
    { label: '口座区分', value: depositLabel(target) },
    { label: '補正前数量', value: `${formatQuantity(increaseBefore.value)}株`, numeric: true },
    { label: '加算数量', value: signedQuantity(increaseAdded.value), numeric: true },
    { label: '補正後数量', value: `${formatQuantity(increaseAfter.value)}株`, numeric: true },
    { label: '更新者', value: operatorLabel.value },
  ]
})

const addSummary = computed(() => {
  const customer = addCustomer.value

  return [
    { label: '操作種別', value: '新規銘柄を追加' },
    {
      label: '対象顧客',
      value: customer
        ? joinWide(`${customer.branchCode} / ${customer.accountNumber}`, customer.customerName)
        : '—',
    },
    {
      label: '対象銘柄',
      value: joinWide(
        addForm.value.ticker.trim().toUpperCase(),
        addForm.value.symbolName.trim(),
      ),
    },
    { label: '口座区分', value: formatSpecificDeposit(addForm.value.specificDeposit) },
    { label: '補正前数量', value: '0株', numeric: true },
    { label: '加算数量', value: signedQuantity(addAdded.value), numeric: true },
    { label: '補正後数量', value: `${formatQuantity(addAfter.value)}株`, numeric: true },
    { label: '更新者', value: operatorLabel.value },
  ]
})
</script>

<template>
  <section class="balance-adjustment-list">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む -->
    <Teleport defer to="#topbar-actions">
      <BaseButton data-testid="balance-adjustments-add" @click="openAdd">
        新規保有を追加
      </BaseButton>
    </Teleport>

    <BaseAlert v-if="noticeMessage" variant="success" data-testid="balance-adjustments-notice">
      {{ noticeMessage }}
    </BaseAlert>


    <!-- 画面の説明。4 状態や検索結果に関わらず常時出す（モックのカード見出しの副文） -->
    <BaseAlert v-else variant="info" data-testid="balance-adjustments-description">
      既存保有への数量加算、またはスピンオフ等の新規保有追加を記録します。
    </BaseAlert>

    <!-- 画面モックの検索フォームは 5 項目を 1 行に並べるが、FormGrid が受ける列数は
         2 / 3 / 4 なので既定の 4 のままにし、銘柄名だけを次の行へ折り返す
         （5 列を足すと 1 列あたりが狭くなりすぎ、他の検索カードとも幅がそろわない） -->
    <MasterSearchCard
      testid-prefix="balance-adjustments"
      :disabled="loading"
      @submit="submitSearch"
      @clear="clearSearch"
    >
      <FormField v-slot="{ field }" label="部店コード">
        <BaseSelect
          v-bind="field"
          v-model="inputs.branchCode"
          :options="codes.optionsFor('部店')"
          placeholder="-- 全部店 --"
          data-testid="balance-adjustments-branch-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="口座番号">
        <BaseInput
          v-bind="field"
          v-model="inputs.accountNumber"
          inputmode="numeric"
          placeholder="例: 123456"
          data-testid="balance-adjustments-account-number"
        />
      </FormField>
      <FormField v-slot="{ field }" label="顧客名">
        <BaseInput
          v-bind="field"
          v-model="inputs.customerName"
          placeholder="例: 山田"
          data-testid="balance-adjustments-customer-name"
        />
      </FormField>
      <FormField v-slot="{ field }" label="ティッカー">
        <BaseInput
          v-bind="field"
          v-model="inputs.ticker"
          placeholder="例: AAPL"
          data-testid="balance-adjustments-ticker"
        />
      </FormField>
      <FormField v-slot="{ field }" label="銘柄名">
        <BaseInput
          v-bind="field"
          v-model="inputs.symbolName"
          placeholder="例: Apple"
          data-testid="balance-adjustments-symbol-name"
        />
      </FormField>
    </MasterSearchCard>

    <MasterListCard
      testid-prefix="balance-adjustments"
      title="保有残高一覧"
      empty-message="条件に一致する保有残高がありません。"
      :total="total"
      :limit="limit"
      :offset="offset"
      :loading="loading"
      :is-empty="isEmpty"
      :error="error"
      @reload="store.reload()"
      @update:offset="goToOffset"
    >
      <DataTable
        flat
        data-testid="balance-adjustments-table"
        :columns="columns"
        :rows="items"
        :row-class="rowClass"
      >
        <template #cell-branchCode="{ value }">
          <span class="balance-adjustment-list__code">{{ value || '—' }}</span>
        </template>

        <template #cell-accountNumber="{ value }">
          <span class="balance-adjustment-list__code">{{ value }}</span>
        </template>

        <!-- 扱者はコードを主、氏名を副行に置く（モックの 2 段組） -->
        <template #cell-handler="{ row }">
          {{ row.handlerCode || '—' }}
          <span v-if="row.handlerName" class="balance-adjustment-list__sub">
            {{ row.handlerName }}
          </span>
        </template>

        <!-- 顧客名カナは出さない（モックに無く、行が 2 段になって表が間延びする） -->
        <template #cell-customerName="{ value }">{{ value || '—' }}</template>

        <template #cell-ticker="{ row }">
          <span class="balance-adjustment-list__ticker">{{ row.ticker || row.symbolCode }}</span>
        </template>

        <template #cell-symbolName="{ value }">{{ value || '—' }}</template>

        <template #cell-specificDeposit="{ row }">
          <span class="balance-adjustment-list__deposit">{{ depositLabel(row) }}</span>
        </template>

        <template #cell-balance="{ row }">
          <span class="balance-adjustment-list__quantity">{{ formatQuantity(row.balance) }}株</span>
        </template>

        <!-- 取込のままの行は更新日時を持たない。その場合はセルごと '—' にする -->
        <template #cell-updated="{ row }">
          <template v-if="row.updatedAt">
            <span class="balance-adjustment-list__at">{{ formatMonthDayTime(row.updatedAt) }}</span>
            <span class="balance-adjustment-list__sub">
              {{ handlerNameOf(row.updatedBy) || row.updatedBy || '—' }}
            </span>
          </template>
          <template v-else>—</template>
        </template>

        <!-- 売却可は小さな灰色の文字、売却不可だけバッジで目立たせる（モックの体裁） -->
        <template #cell-sellProhibited="{ row }">
          <BaseBadge v-if="row.sellProhibited" variant="error">売却不可</BaseBadge>
          <span v-else class="balance-adjustment-list__sell-ok">売却可</span>
        </template>

        <!-- 行の操作は 2 つ。モックと同じく横に並べ、どちらも控えめな体裁にする -->
        <template #cell-actions="{ row }">
          <div class="balance-adjustment-list__actions">
            <BaseButton
              variant="secondary"
              size="sm"
              :data-testid="`balance-adjustments-sell-${row.id}`"
              :disabled="updating"
              @click="openSell(row)"
            >
              {{ row.sellProhibited ? '売却停止を解除' : '売却を停止' }}
            </BaseButton>
            <BaseButton
              variant="secondary"
              size="sm"
              :data-testid="`balance-adjustments-increase-${row.id}`"
              :disabled="updating"
              @click="openIncrease(row)"
            >
              数量を加算
            </BaseButton>
          </div>
        </template>
      </DataTable>
    </MasterListCard>

    <!-- 既存保有への数量加算 -->
    <BalanceAdjustDialog
      :open="Boolean(increaseTarget)"
      title="既存保有への数量加算"
      testid-prefix="balance-adjustments"
      action="increase"
      :step="increaseStep"
      :summary="increaseSummary"
      :pending="updating"
      :error="updateError"
      @close="closeIncrease"
      @back="increaseStep = 'input'"
      @next="confirmIncrease"
      @submit="submitIncrease"
    >
      <div class="balance-adjustment-list__readonly">
        <span class="balance-adjustment-list__readonly-label">対象顧客</span>
        <p
          class="balance-adjustment-list__readonly-value"
          data-testid="balance-adjustments-increase-customer"
        >
          {{ increaseTarget?.customerName || '—' }}（{{ increaseTarget?.accountNumber }}）
        </p>
      </div>

      <FormGrid :columns="2">
        <div class="balance-adjustment-list__readonly">
          <span class="balance-adjustment-list__readonly-label">対象銘柄</span>
          <p
            class="balance-adjustment-list__readonly-value"
            data-testid="balance-adjustments-increase-symbol"
          >
            {{ increaseSymbolLabel }}
          </p>
        </div>
        <div class="balance-adjustment-list__readonly">
          <span class="balance-adjustment-list__readonly-label">口座区分</span>
          <p
            class="balance-adjustment-list__readonly-value"
            data-testid="balance-adjustments-increase-deposit"
          >
            {{ increaseTarget ? depositLabel(increaseTarget) : '—' }}
          </p>
        </div>
      </FormGrid>

      <FormField v-slot="{ field }" label="加算数量" required :error="increaseError">
        <div class="balance-adjustment-list__quantity-input">
          <BaseInput
            v-bind="field"
            v-model="increaseQuantity"
            inputmode="numeric"
            placeholder="例: 100"
            data-testid="balance-adjustments-increase-quantity"
          />
          <span class="balance-adjustment-list__unit">株</span>
        </div>
      </FormField>

      <BalanceQuantityPanel
        testid-prefix="balance-adjustments-increase"
        :before="increaseBefore"
        :added="increaseAdded"
        :after="increaseAfter"
      />
    </BalanceAdjustDialog>

    <!-- 売却の停止 / 解除の確認。入力が無いので本文は問い 1 行だけ（モックの confirm 相当） -->
    <BaseModal
      :open="Boolean(sellTarget)"
      title="売却可否の変更"
      size="sm"
      @close="closeSell"
    >
      <BaseAlert v-if="updateError" variant="error" data-testid="balance-adjustments-sell-error">
        {{ updateError.message }}
      </BaseAlert>

      <p data-testid="balance-adjustments-sell-message">{{ sellConfirmMessage }}</p>
      <p class="balance-adjustment-list__sell-target">{{ sellTargetLabel }}</p>

      <template #footer>
        <BaseButton
          variant="secondary"
          data-testid="balance-adjustments-sell-cancel"
          :disabled="updating"
          @click="closeSell"
        >
          キャンセル
        </BaseButton>
        <BaseButton
          data-testid="balance-adjustments-sell-submit"
          :disabled="updating"
          :loading="updating"
          @click="submitSell"
        >
          {{ updating ? '変更中…' : 'OK' }}
        </BaseButton>
      </template>
    </BaseModal>

    <!-- 新規保有を追加 -->
    <BalanceAdjustDialog
      :open="isAddOpen"
      title="新規保有を追加"
      testid-prefix="balance-adjustments"
      action="add"
      :step="addStep"
      :summary="addSummary"
      :pending="creating"
      :error="createError"
      @close="closeAdd"
      @back="addStep = 'input'"
      @next="confirmAdd"
      @submit="submitAdd"
    >
      <FormField v-slot="{ field }" label="対象顧客" required :error="addErrors.customer">
        <BaseSelect
          v-bind="field"
          v-model="addForm.customer"
          :options="customerOptions.options"
          :disabled="customerOptions.loading"
          placeholder="選択してください"
          data-testid="balance-adjustments-add-customer"
        />
      </FormField>

      <FormGrid :columns="2">
        <FormField v-slot="{ field }" label="ティッカー" required :error="addErrors.ticker">
          <BaseInput
            v-bind="field"
            v-model="addForm.ticker"
            maxlength="14"
            placeholder="例: NEWCO"
            data-testid="balance-adjustments-add-ticker"
          />
        </FormField>
        <FormField v-slot="{ field }" label="銘柄名" required :error="addErrors.symbolName">
          <BaseInput
            v-bind="field"
            v-model="addForm.symbolName"
            maxlength="60"
            placeholder="例: NewCo Inc."
            data-testid="balance-adjustments-add-symbol-name"
          />
        </FormField>
      </FormGrid>

      <FormField v-slot="{ field }" label="口座区分" required>
        <BaseSelect
          v-bind="field"
          v-model="addForm.specificDeposit"
          :options="SPECIFIC_DEPOSIT_OPTIONS"
          data-testid="balance-adjustments-add-deposit"
        />
      </FormField>

      <FormField v-slot="{ field }" label="加算数量" required :error="addErrors.quantity">
        <div class="balance-adjustment-list__quantity-input">
          <BaseInput
            v-bind="field"
            v-model="addQuantity"
            inputmode="numeric"
            placeholder="例: 100"
            data-testid="balance-adjustments-add-quantity"
          />
          <span class="balance-adjustment-list__unit">株</span>
        </div>
      </FormField>

      <BalanceQuantityPanel
        testid-prefix="balance-adjustments-add"
        :before="0"
        :added="addAdded"
        :after="addAfter"
      />
    </BalanceAdjustDialog>
  </section>
</template>

<style scoped>
.balance-adjustment-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* 部店コード・口座番号は桁を揃えて読ませる（モックの ui-code 相当） */
.balance-adjustment-list__code {
  font-variant-numeric: tabular-nums;
}

.balance-adjustment-list__ticker {
  font-weight: 600;
}

.balance-adjustment-list__at {
  font-variant-numeric: tabular-nums;
}

.balance-adjustment-list__quantity {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* 売却可は「印を付けない」状態。バッジにせず小さな灰色の文字にとどめる */
.balance-adjustment-list__sell-target {
  margin-top: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.balance-adjustment-list__sell-ok {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

/* 行の操作ボタン 2 つ。モックと同じく横に並べる */
.balance-adjustment-list__actions {
  display: flex;
  gap: var(--space-2);
}

.balance-adjustment-list__deposit {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

/* 主内容の下に添える小さい灰色の行（扱者名・顧客名カナ・更新者） */
.balance-adjustment-list__sub {
  display: block;
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

/* モーダルの読み取り専用項目。入力欄と同じ高さの淡い箱に値を置く */
.balance-adjustment-list__readonly-label {
  display: block;
  margin-bottom: var(--space-1);
  color: var(--color-label);
  font-size: var(--font-size-xs);
  font-weight: 500;
}

.balance-adjustment-list__readonly-value {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-muted);
  color: var(--color-text);
  font-size: var(--font-size-md);
}

/* 数量の入力欄と単位。単位は入力の幅に含めず右へ添える */
.balance-adjustment-list__quantity-input {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.balance-adjustment-list__quantity-input .base-input {
  width: 12em;
  text-align: right;
}

.balance-adjustment-list__unit {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

/*
 * 手で補正された行の印。DataTable が描く行なので :deep が要る。
 * 色は警告色の淡色面を借りる。「異常」ではなく「取込のままではない」ことの印。
 */
.balance-adjustment-list :deep(tr.is-user-modified) {
  background-color: var(--color-warning-bg);
}

/* ホバー中も印を残す。DataTable の中立なホバー色に塗り潰させず、同系色で一段濃くする */
.balance-adjustment-list :deep(tr.is-user-modified:hover td) {
  background-color: var(--color-warning-border);
}
</style>
