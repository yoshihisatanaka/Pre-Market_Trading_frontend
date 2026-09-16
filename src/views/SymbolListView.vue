<script setup>
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import MasterFormDialog from '@/components/masters/MasterFormDialog.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
import SymbolFormFields from '@/components/symbol/SymbolFormFields.vue'
import { useListQuery } from '@/composables/useListQuery'
import { SYMBOLS_PAGE_SIZE, useSymbolsStore } from '@/stores/symbols'
import { formatQuantity, formatUsdUnit } from '@/utils/format'
import {
  ORDER_ROUTE_OPTIONS,
  REGULATION_OPTIONS,
  VWAP_TARGET_OPTIONS,
  formatOrderRoute,
  formatRegulation,
  formatVwapTarget,
  isOrderRoute,
  isRegulation,
  isVwapTarget,
} from '@/utils/symbolTypes'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する
const store = useSymbolsStore()
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
  updating,
  updateError,
  updateValidationErrors,
} = storeToRefs(store)

/*
 * 列は画面モック（https://uspreorder-vmbhej3k.manus.space/masters/symbols）に合わせつつ、
 * 実 API（docs/api/openapi.json の SymbolItem）が持つ項目だけを出す。
 *   - モックには無い「前日出来高」を足し、相場の 3 列を
 *     前日終値 / 前日出来高 / 5日平均出来高 の順でまとめている
 *   - ユーザー操作フラグは列にせず、行の色で表す（下の rowClass）
 *   - 市場名・Pre区分はモックに列が無いので出さない（API には項目がある）
 *   - 操作列の「編集」は画面モックには無いが、行から直せないと備考の誤記を直すだけでも
 *     「新規追加 → 削除」の 2 操作が必要になるため足している。新規追加はヘッダのボタンから開く
 *   - 「削除」はまだ無い。足すときは編集の右端に置く（破壊的な操作を最後にする既存の並び）
 */
const columns = [
  { key: 'symbolCode', label: '銘柄コード' },
  { key: 'ticker', label: 'ティッカーコード' },
  { key: 'nameEn', label: '銘柄名（英語）' },
  { key: 'name', label: '銘柄名（日本語）' },
  { key: 'previousClose', label: '前日終値', numeric: true },
  { key: 'previousVolume', label: '前日出来高', numeric: true },
  { key: 'averageVolume', label: '5日平均出来高', numeric: true },
  { key: 'regulation', label: '取引可否' },
  { key: 'orderRoute', label: '預託先区分' },
  { key: 'vwapTarget', label: 'VWAP対象区分' },
  { key: 'note', label: '備考' },
  // 行ごとの操作（いまは編集だけ）。画面モックに合わせて見出しは空にする
  { key: 'actions', label: '' },
]

/*
 * ページ位置と検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * URL 上のクエリ名（symbol_code / regulation / …）はこの filters 定義にだけ現れる。
 *
 * 検索欄は画面モックどおり 4 つだが、実 API は銘柄コード・Ticker・銘柄名を別々の
 * パラメータに分けていて 1 語でまとめて探せない。この欄は `symbol` に乗るので、
 * 効くのは銘柄コードと Ticker だけ（ラベルもそう書いてある）。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'symbolCode', query: 'symbol_code' },
    // 未知のコード（?regulation=9 など）は条件なしとして捨てる
    {
      key: 'regulation',
      query: 'regulation',
      parse: (value) => (isRegulation(value) ? value : ''),
    },
    {
      key: 'orderRoute',
      query: 'order_route',
      parse: (value) => (isOrderRoute(value) ? value : ''),
    },
    {
      key: 'vwapTarget',
      query: 'vwap_target',
      parse: (value) => (isVwapTarget(value) ? value : ''),
    },
  ],
  load: (params) => store.load(params),
})

/*
 * 区分の表示名。実 API が付けて返す名称を優先し、
 * 欠けているときだけコードから補う（どちらも無ければ '—'）。
 */
function regulationLabel(row) {
  return row.regulationName || formatRegulation(row.regulation)
}

function orderRouteLabel(row) {
  return row.orderRouteName || formatOrderRoute(row.orderRoute)
}

function vwapTargetLabel(row) {
  return row.vwapTargetName || formatVwapTarget(row.vwapTarget)
}

/**
 * 手動操作された行（ユーザー操作フラグ=1）に付けるクラス。
 * 自動取込のままの行と見分けられるよう、行ごと淡く塗る。
 */
function rowClass(row) {
  return row.userModified ? 'is-user-modified' : null
}

/*
 * 新規追加。ヘッダの「新規追加」からモーダルを開く（CAマスタ・受注不可日マスタと同じ形）。
 * URL は変えない（一覧の単方向フローに触らない）。
 *
 * 登録は store 側で「サーバの事前検証 → 登録」の 2 段になっている。ここでの検証は
 * 必須の未入力を弾いて無駄な往復を防ぐためのもので、銘柄コードの重複・文字数・
 * 区分コードの実在はサーバが見る。
 *
 * エラーは 3 種類あり、出し先を分ける。
 *   入力の不備      … FormField の error（項目の直下）
 *   事前検証の不合格 … store.validationErrors をモーダル内の BaseAlert
 *   通信・サーバ障害 … store.createError を同じ位置の BaseAlert
 */
const isAddOpen = ref(false)

// 項目が 10 あるので、ref を項目ごとに分けず 1 つのオブジェクトで持つ
const addForm = ref(emptyForm())
const addErrors = ref(emptyErrors())

// 成功メッセージ（編集・削除を足したときも同じ枠に出す）
const noticeMessage = ref('')

function emptyForm() {
  return {
    symbolCode: '',
    ticker: '',
    name: '',
    nameEn: '',
    /*
     * 区分 3 つは未選択を作らず、実 API の既定と同じ '0' から始める
     * （注文ルートは型宣言が null を許さない。理由は api 層の toSymbolRequest）。
     */
    regulation: '0',
    orderRoute: '0',
    vwapTarget: '0',
    // 数値 2 つは入力欄が文字列を持つ。数値への変換は api 層に任せる
    previousClose: '',
    averageVolume: '',
    note: '',
  }
}

function emptyErrors() {
  return { symbolCode: '', ticker: '', name: '' }
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
    symbolCode: form.symbolCode.trim() ? '' : '銘柄コードを入力してください。',
    ticker: form.ticker.trim() ? '' : 'ティッカーコードを入力してください。',
    name: form.name.trim() ? '' : '銘柄名（日本語）を入力してください。',
  }
  if (Object.values(addErrors.value).some(Boolean)) return

  await store.create(
    {
      ...form,
      symbolCode: form.symbolCode.trim(),
      ticker: form.ticker.trim(),
      name: form.name.trim(),
      nameEn: form.nameEn.trim(),
      note: form.note.trim(),
    },
    {
      /*
       * 閉じるのは登録が受理された時点。store.create の戻り値を待つと、
       * そこに含まれる一覧の読み直しのあいだモーダルが開いたまま残る。
       * 失敗時は呼ばれないので、モーダルは開いたままになり入力を直せる
       * （理由は createError / validationErrors に出る）。
       */
      onSuccess: (created) => {
        isAddOpen.value = false
        /*
         * 一覧は銘柄コードの昇順なので、追加した行が 1 ページ目に出るとは限らない。
         * 行を追いかけることはせず、どの行が増えたのかをメッセージで示して、
         * ユーザがその銘柄コードで検索できるようにする。
         */
        noticeMessage.value = `${symbolLabel(created)} を追加しました。`
      },
    },
  )
}

/*
 * 編集。モーダルは「開いているか」と「どの行か」を editTarget 1 つで持つ。
 * 入力欄はその行の現在値で初期化し、editTarget が握っている id が更新対象を、
 * updatedAt が楽観的ロックの合札を受け持つ（他の利用者が先に更新していればサーバが 409 で弾く）。
 *
 * **銘柄コードは変更させない**（SymbolFormFields に symbol-code-locked を渡す）。
 * 主キーではなくなったが、実 API の詳細照会・更新履歴がこの値で 1 件を指すため。
 *
 * エラーの出し先は新規追加と同じ 3 系統。409 の競合も通信・サーバ障害と同じ枠に出すので、
 * ここに競合専用のコードは無い（code を見て分岐すると、view が API のコード値を知る約束事が増える）。
 * 競合時に一覧を自動で読み直すこともしない。一覧だけ読み直してもモーダルが握る合札は古いままで
 * 再度 409 になり、モーダル側まで差し替えると他人の変更を見せずに上書きさせることになる。
 */
const editTarget = ref(null)
const editForm = ref(emptyForm())
const editErrors = ref(emptyErrors())

/** 一覧の 1 行を編集フォームの形に開く（相場の 2 値は入力欄が文字列を持つので寄せる） */
function toForm(symbol) {
  return {
    symbolCode: symbol.symbolCode,
    ticker: symbol.ticker,
    name: symbol.name,
    nameEn: symbol.nameEn,
    regulation: symbol.regulation,
    orderRoute: symbol.orderRoute,
    vwapTarget: symbol.vwapTarget,
    // null（未取得）と 0 を混ぜないよう、空文字に寄せるのは null のときだけ
    previousClose: symbol.previousClose ?? '',
    averageVolume: symbol.averageVolume ?? '',
    note: symbol.note,
  }
}

function openEdit(symbol) {
  editForm.value = toForm(symbol)
  editErrors.value = emptyErrors()
  // 前回の失敗と成功をどちらも持ち込まない
  store.clearUpdateError()
  noticeMessage.value = ''
  editTarget.value = symbol
}

function closeEdit() {
  // 更新中に閉じると結果の行き先が無くなるので、終わるまで閉じさせない
  if (updating.value) return
  editTarget.value = null
}

async function submitEdit() {
  const target = editTarget.value
  if (!target) return

  const form = editForm.value
  /*
   * 検査項目は追加と揃える。銘柄コードは読み取り専用なので空にはなり得ず常に '' になるが、
   * 外すと add / edit で検査が非対称になり、フォームを部品化した理由に逆行する。
   */
  editErrors.value = {
    symbolCode: form.symbolCode.trim() ? '' : '銘柄コードを入力してください。',
    ticker: form.ticker.trim() ? '' : 'ティッカーコードを入力してください。',
    name: form.name.trim() ? '' : '銘柄名（日本語）を入力してください。',
  }
  if (Object.values(editErrors.value).some(Boolean)) return

  const updated = await store.update(
    {
      ...form,
      // id と合札はフォームの外から来る（利用者が触れる値ではない）
      id: target.id,
      symbolCode: form.symbolCode.trim(),
      ticker: form.ticker.trim(),
      name: form.name.trim(),
      nameEn: form.nameEn.trim(),
      note: form.note.trim(),
      updatedAt: target.updatedAt,
    },
    {
      // 追加と同じく、一覧の読み直しを待たずに閉じる。失敗時は呼ばれないので
      // モーダルは開いたままになり入力を直せる（理由は updateError に出る）
      onSuccess: (item) => {
        editTarget.value = null
        noticeMessage.value = `${symbolLabel(item)} を更新しました。`
      },
    },
  )
  if (!updated) return

  /*
   * 絞り込み中に区分を条件の圏外へ変えると total が 1 減り、最終ページが空になり得る。
   * 行が別ページへ移ったことそのものは追わない（サーバが新しいインデックスを返さないため）。
   * 成功メッセージが銘柄コードを含むので、ユーザはその条件で検索できる。
   */
  stepBackIfPageEmpty()
}

/**
 * 読み直した結果が 0 件になったら 1 ページ戻す。
 * 最終ページの最後の 1 件が今の offset から居なくなる操作（絞り込み中の変更）で使う。
 */
function stepBackIfPageEmpty() {
  if (items.value.length === 0 && offset.value > 0) {
    goToOffset(offset.value - SYMBOLS_PAGE_SIZE)
  }
}

/**
 * 1 件を 1 行で示す文字列（成功メッセージに使う）。
 * 銘柄コードだけでは何の銘柄か分からないので、一覧で実際に読む 3 点を並べる。
 */
function symbolLabel(symbol) {
  return [symbol.symbolCode || '—', symbol.ticker || '—', symbol.name || '—'].join(' / ')
}
</script>

<template>
  <section class="symbol-list">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む -->
    <Teleport defer to="#topbar-actions">
      <BaseButton
        variant="secondary"
        data-testid="symbols-reload"
        :disabled="loading"
        @click="store.reload()"
      >
        再読み込み
      </BaseButton>
      <BaseButton data-testid="symbols-add" @click="openAdd">新規追加</BaseButton>
    </Teleport>

    <BaseAlert v-if="noticeMessage" variant="success" data-testid="symbols-notice">
      {{ noticeMessage }}
    </BaseAlert>

    <!-- 画面の説明。4 状態や検索結果に関わらず常時出す -->
    <BaseAlert variant="info" data-testid="symbols-description">
      取扱銘柄と、取引可否・預託先・VWAP対象の区分を管理します。<strong>色の付いた行</strong>は画面や
      API から手動で操作された行で、自動取込のままの行と区別しています。
    </BaseAlert>

    <MasterSearchCard
      testid-prefix="symbols"
      :disabled="loading"
      @submit="submitSearch"
      @clear="clearSearch"
    >
      <FormField v-slot="{ field }" label="銘柄コード・ティッカーコード">
        <BaseInput
          v-bind="field"
          v-model="inputs.symbolCode"
          placeholder="例: S001 / AAPL"
          data-testid="symbols-symbol-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="取引可否">
        <BaseSelect
          v-bind="field"
          v-model="inputs.regulation"
          :options="REGULATION_OPTIONS"
          placeholder="-- すべて --"
          data-testid="symbols-regulation"
        />
      </FormField>
      <FormField v-slot="{ field }" label="預託先区分">
        <BaseSelect
          v-bind="field"
          v-model="inputs.orderRoute"
          :options="ORDER_ROUTE_OPTIONS"
          placeholder="-- すべて --"
          data-testid="symbols-order-route"
        />
      </FormField>
      <FormField v-slot="{ field }" label="VWAP対象区分">
        <BaseSelect
          v-bind="field"
          v-model="inputs.vwapTarget"
          :options="VWAP_TARGET_OPTIONS"
          placeholder="-- すべて --"
          data-testid="symbols-vwap-target"
        />
      </FormField>
    </MasterSearchCard>

    <MasterListCard
      testid-prefix="symbols"
      title="銘柄一覧"
      empty-message="該当する銘柄はありません。"
      :total="total"
      :limit="limit"
      :offset="offset"
      :loading="loading"
      :is-empty="isEmpty"
      :error="error"
      @reload="store.reload()"
      @update:offset="goToOffset"
    >
      <!-- 行のキーは DataTable の既定（id）に任せる。主キーは銘柄コードではない -->
      <DataTable
        flat
        data-testid="symbols-table"
        :columns="columns"
        :rows="items"
        :row-class="rowClass"
      >
        <template #cell-symbolCode="{ value }">
          <span class="symbol-list__code">{{ value || '—' }}</span>
        </template>
        <template #cell-ticker="{ value }">
          <span class="symbol-list__ticker">{{ value || '—' }}</span>
        </template>
        <template #cell-nameEn="{ value }">{{ value || '—' }}</template>
        <template #cell-name="{ value }">
          <span class="symbol-list__name">{{ value || '—' }}</span>
        </template>

        <!-- 相場の 3 列。未取得（null）は formatUsdUnit / formatQuantity が '—' にする -->
        <template #cell-previousClose="{ value }">{{ formatUsdUnit(value) }}</template>
        <template #cell-previousVolume="{ value }">{{ formatQuantity(value) }}</template>
        <template #cell-averageVolume="{ value }">{{ formatQuantity(value) }}</template>

        <!-- 取引可否は可否が一目で分かるように色を変える（画面モックと同じ扱い） -->
        <template #cell-regulation="{ row }">
          <span :class="['symbol-list__flag', row.regulation === '0' ? 'is-open' : 'is-closed']">
            {{ regulationLabel(row) }}
          </span>
        </template>

        <template #cell-orderRoute="{ row }">
          <span class="symbol-list__route">{{ orderRouteLabel(row) }}</span>
        </template>

        <!-- 対象外は主張させない（対象の行だけを目で拾えるようにする） -->
        <template #cell-vwapTarget="{ row }">
          <span :class="['symbol-list__flag', row.vwapTarget === '1' ? 'is-open' : 'is-muted']">
            {{ vwapTargetLabel(row) }}
          </span>
        </template>

        <template #cell-note="{ value }">
          <span class="symbol-list__note">{{ value || '—' }}</span>
        </template>

        <!-- 行ごとの操作。削除を足すときは編集の右に置く -->
        <template #cell-actions="{ row }">
          <div class="symbol-list__row-actions">
            <BaseButton
              variant="secondary"
              :data-testid="`symbols-edit-${row.id}`"
              :disabled="updating"
              @click="openEdit(row)"
            >
              編集
            </BaseButton>
          </div>
        </template>
      </DataTable>
    </MasterListCard>

    <MasterFormDialog
      :open="isAddOpen"
      title="銘柄 新規追加"
      testid-prefix="symbols"
      :pending="creating"
      :error="createError"
      :validation-errors="validationErrors"
      @close="closeAdd"
      @submit="submitAdd"
    >
      <SymbolFormFields v-model="addForm" testid-prefix="symbols-add" :errors="addErrors" />
    </MasterFormDialog>

    <MasterFormDialog
      :open="Boolean(editTarget)"
      title="銘柄 編集"
      testid-prefix="symbols"
      action="edit"
      submit-label="更新"
      :pending="updating"
      :error="updateError"
      :validation-errors="updateValidationErrors"
      @close="closeEdit"
      @submit="submitEdit"
    >
      <SymbolFormFields
        v-model="editForm"
        testid-prefix="symbols-edit"
        symbol-code-locked
        :errors="editErrors"
      />
    </MasterFormDialog>
  </section>
</template>

<style scoped>
.symbol-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* 銘柄コードと Ticker はコード値。桁を揃えて読ませる */
.symbol-list__code {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.symbol-list__ticker {
  font-weight: 600;
}

.symbol-list__name {
  font-size: var(--font-size-sm);
}

.symbol-list__route {
  white-space: nowrap;
}

.symbol-list__note {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.symbol-list__row-actions {
  display: flex;
  gap: var(--space-2);
}

.symbol-list__flag {
  font-weight: 600;
  white-space: nowrap;
}

.symbol-list__flag.is-open {
  color: var(--color-success);
}

.symbol-list__flag.is-closed {
  color: var(--color-danger-text);
}

.symbol-list__flag.is-muted {
  color: var(--color-text-muted);
  font-weight: 400;
}

/*
 * 手動操作された行（ユーザー操作フラグ=1）。
 * 行は DataTable が描くので、scoped のままでは届かない（:deep が要る）。
 * 色は警告色の淡色面を借りる。「異常」ではなく「自動取込のままではない」ことの印。
 */
.symbol-list :deep(tr.is-user-modified) {
  background-color: var(--color-warning-bg);
}

/* ホバー中も印を残す。DataTable の中立なホバー色に塗り潰させず、同系色で一段濃くする */
.symbol-list :deep(tr.is-user-modified:hover td) {
  background-color: var(--color-warning-border);
}
</style>
