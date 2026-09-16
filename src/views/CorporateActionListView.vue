<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormField from '@/components/ui/FormField.vue'
import CorporateActionFormFields from '@/components/ca/CorporateActionFormFields.vue'
import ConfirmDeleteDialog from '@/components/masters/ConfirmDeleteDialog.vue'
import MasterFormDialog from '@/components/masters/MasterFormDialog.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import MasterSearchCard from '@/components/masters/MasterSearchCard.vue'
import { useListQuery } from '@/composables/useListQuery'
import { CA_PAGE_SIZE, useCaStore } from '@/stores/ca'
import { useCodesStore } from '@/stores/codes'
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
  updating,
  updateError,
  updateValidationErrors,
  deleting,
  deleteError,
} = storeToRefs(store)

/*
 * ステータスの選択肢はコードマスタから。読み込みは main.js が起動時に 1 回だけ行うので、
 * ここでは load を呼ばない。storeToRefs ではなく computed で受けるのは、
 * 読み込みが終わった時点で選択肢が自動的に埋まるようにするため。
 */
const codes = useCodesStore()
// 一覧の loading と名前がぶつかるので別名で受ける
const { loading: codesLoading } = storeToRefs(codes)
const statusOptions = computed(() => codes.optionsFor('ステータス'))

/*
 * 列は画面モック（https://uspreorder-vmbhej3k.manus.space/masters/ca）に合わせる。
 *   - ステータスは実 API（docs/api/openapi.json の CAItem）に無い**仮の項目**。値は MSW の
 *     モックだけが返し、選択肢とラベルはコードマスタ `ステータス` から引く。実 API に当てると
 *     空になり '—' が並ぶ（src/api/ca.js のコメント参照）
 *   - モックの「権利確定日」は実 API に無く、列に対応する値の当てもないので依然として出さない。
 *     日付は 権利付最終日 / 効力発生日 / 支払日 の 3 つ
 *   - 操作列の「編集」は画面モックには無いが、行から直せないと備考の誤記を直すだけでも
 *     「新規追加 → 削除」の 2 操作が必要になるため足している。新規追加はヘッダのボタンから開く
 *   - 「削除」は編集の右端に置く。破壊的な操作を最後にする既存の並び
 *     （モーダルのフッタも キャンセル → 危険色）に合わせる
 */
const columns = [
  { key: 'stockCode', label: '銘柄' },
  { key: 'caType', label: 'CA種別' },
  { key: 'exRightsDate', label: '権利付最終日' },
  { key: 'effectiveDate', label: '効力発生日' },
  { key: 'paymentDate', label: '支払日' },
  { key: 'ratio', label: '比率' },
  { key: 'note', label: '備考' },
  { key: 'status', label: 'ステータス' },
  // 行ごとの操作（編集・削除）。画面モックに合わせて見出しは空にする
  { key: 'actions', label: '' },
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
    /*
     * ステータスには parse を付けない。選択肢がコードマスタ（`GET /codes`）由来で、
     * URL を読む時点では読み込みが終わっているとは限らず、静的な集合として検証できない。
     * `/codes` 由来の他の条件（CustomerListView の取引規制・口座区分）も同じく素通ししており、
     * 未知の値は「該当 0 件」として現れる。
     */
    { key: 'status', query: 'status' },
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
 * ステータスの表示名。コードマスタの選択肢から引く。
 *
 * CA種別と違いサーバは表示名を返さない（項目そのものが実 API 未実装）。未設定・未知のコード・
 * コードマスタ未読込のいずれも '—' になる（他の列の空値表現とそろえる）。
 */
function statusLabel(row) {
  return statusOptions.value.find((option) => option.value === row.status)?.label || '—'
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
    /*
     * ステータスは任意だが、新しく登録する CA は「予定」から始まるのが自然なので
     * 未選択ではなくこれを初期値にする（コード値の意味は fixtures/codes.js の statusCodes）。
     */
    status: '1',
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

  await store.create(
    {
      ...form,
      stockCode: form.stockCode.trim(),
      note: form.note.trim(),
    },
    {
      /*
       * 閉じるのは登録が受理された時点。store.create の戻り値を待つと、
       * そこに含まれる一覧の読み直しのあいだモーダルが開いたまま残る。
       * 失敗時は呼ばれないので、モーダルは開いたままになり入力を直せる
       * （理由は createError に出る）。
       */
      onSuccess: (created) => {
        isAddOpen.value = false
        /*
         * 一覧は効力発生日の降順なので、追加した行が 1 ページ目に出るとは限らない
         * （日付を空にした行はサーバ側で先頭に来る）。行を追いかけることはせず、
         * どの行が増えたのかをメッセージで示して、ユーザがその条件で検索できるようにする。
         */
        noticeMessage.value = `${caLabel(created)} を追加しました。`
      },
    },
  )
}

/*
 * 編集。モーダルは「開いているか」と「どの行か」を editTarget 1 つで持つ。
 * 入力欄はその行の現在値で初期化し、editTarget が握っている updatedAt が
 * 楽観的ロックの合札になる（他の利用者が先に更新していればサーバが 409 で弾く）。
 *
 * エラーの出し先は新規追加と同じ 3 系統。409 の競合も通信・サーバ障害と同じ枠に出すので、
 * ここに競合専用のコードは無い（code を見て分岐すると、view が API のコード値を知る約束事が増える）。
 * 競合時に一覧を自動で読み直すこともしない。一覧だけ読み直してもモーダルが握る合札は古いままで
 * 再度 409 になり、モーダル側まで差し替えると他人の変更を見せずに上書きさせることになる。
 */
const editTarget = ref(null)
const editForm = ref(emptyForm())
const editErrors = ref(emptyErrors())

/** 一覧の 1 行を編集フォームの形に開く（分母・分子は入力欄が文字列を持つので寄せる） */
function toForm(ca) {
  return {
    stockCode: ca.stockCode,
    caType: ca.caType,
    exRightsDate: ca.exRightsDate,
    effectiveDate: ca.effectiveDate,
    paymentDate: ca.paymentDate,
    // null（未設定）と 0 を混ぜないよう、空文字に寄せるのは null のときだけ
    denominator: ca.denominator ?? '',
    numerator: ca.numerator ?? '',
    note: ca.note,
    status: ca.status,
  }
}

function openEdit(ca) {
  editForm.value = toForm(ca)
  editErrors.value = emptyErrors()
  // 前回の失敗と成功をどちらも持ち込まない
  store.clearUpdateError()
  noticeMessage.value = ''
  editTarget.value = ca
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
  editErrors.value = {
    stockCode: form.stockCode.trim() ? '' : '銘柄コードを入力してください。',
    caType: form.caType ? '' : 'CA種別を選択してください。',
    ...ratioErrors(form),
  }
  if (Object.values(editErrors.value).some(Boolean)) return

  const updated = await store.update(
    {
      ...form,
      id: target.id,
      stockCode: form.stockCode.trim(),
      note: form.note.trim(),
      updatedAt: target.updatedAt,
    },
    {
      // 追加と同じく、一覧の読み直しを待たずに閉じる。失敗時は呼ばれないので
      // モーダルは開いたままになり入力を直せる（理由は updateError に出る）
      onSuccess: (item) => {
        editTarget.value = null
        // 銘柄・CA種別・日付のどれも変えられるので、サーバが受理した内容をそのまま出す
        noticeMessage.value = `${caLabel(item)} を更新しました。`
      },
    },
  )
  if (!updated) return

  /*
   * 絞り込み中に条件の圏外へ変えると total が 1 減り、最終ページが空になり得る
   * （銘柄コードや CA種別を変えたとき）。行が別ページへ移ったことそのものは追わない
   * （サーバが新しいインデックスを返さないため）。成功メッセージが新しい内容を含むので、
   * ユーザはその条件で検索できる。
   */
  stepBackIfPageEmpty()
}

/*
 * 削除。確認モーダルは「開いているか」と「何を消すか」を deleteTarget 1 つで持つ（編集と同じ形）。
 * 実 API は論理削除で、一覧は既定で取消済みを返さないので、読み直すと行が消える。
 * 事前検証は無い（DELETE は本文を取らない）ので、サーバの拒否は deleteError をモーダル内に出す。
 */
const deleteTarget = ref(null)

function openDelete(ca) {
  store.clearDeleteError()
  noticeMessage.value = ''
  deleteTarget.value = ca
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
      noticeMessage.value = `${caLabel(target)} を削除しました。`
    },
  })
  if (!deleted) return

  stepBackIfPageEmpty()
}

/**
 * 読み直した結果が 0 件になったら 1 ページ戻す。
 * 最終ページの最後の 1 件が今の offset から居なくなる操作（削除、絞り込み中の変更）で使う。
 */
function stepBackIfPageEmpty() {
  if (items.value.length === 0 && offset.value > 0) {
    goToOffset(offset.value - CA_PAGE_SIZE)
  }
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
      :options-loading="codesLoading"
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
      <FormField v-slot="{ field }" label="ステータス">
        <BaseSelect
          v-bind="field"
          v-model="inputs.status"
          :options="statusOptions"
          placeholder="-- すべて --"
          data-testid="ca-status"
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

        <template #cell-status="{ row }">{{ statusLabel(row) }}</template>

        <!-- 編集を左、削除を右端に置く（破壊的な操作を最後にする既存の並び） -->
        <template #cell-actions="{ row }">
          <div class="ca-list__row-actions">
            <BaseButton
              variant="secondary"
              :data-testid="`ca-edit-${row.id}`"
              :disabled="updating"
              @click="openEdit(row)"
            >
              編集
            </BaseButton>
            <BaseButton
              variant="danger"
              :data-testid="`ca-delete-${row.id}`"
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
      title="CA 新規追加"
      testid-prefix="ca"
      :pending="creating"
      :error="createError"
      :validation-errors="validationErrors"
      @close="closeAdd"
      @submit="submitAdd"
    >
      <CorporateActionFormFields
        v-model="addForm"
        testid-prefix="ca-add"
        :status-options="statusOptions"
        :errors="addErrors"
      />
    </MasterFormDialog>

    <MasterFormDialog
      :open="Boolean(editTarget)"
      title="CA 編集"
      testid-prefix="ca"
      action="edit"
      submit-label="更新"
      :pending="updating"
      :error="updateError"
      :validation-errors="updateValidationErrors"
      @close="closeEdit"
      @submit="submitEdit"
    >
      <CorporateActionFormFields
        v-model="editForm"
        testid-prefix="ca-edit"
        :status-options="statusOptions"
        :errors="editErrors"
      />
    </MasterFormDialog>

    <ConfirmDeleteDialog
      :open="Boolean(deleteTarget)"
      testid-prefix="ca"
      :label="deleteTarget ? caLabel(deleteTarget) : ''"
      :pending="deleting"
      :error="deleteError"
      @close="closeDelete"
      @confirm="submitDelete"
    />
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

/* 行ごとの操作（編集）。横に並べ、間隔は他の並列ボタンと同じトークンで取る */
.ca-list__row-actions {
  display: flex;
  gap: var(--space-2);
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

/* ホバー中も印を残す。DataTable の中立なホバー色に塗り潰させず、同系色で一段濃くする */
.ca-list :deep(tr.is-user-modified:hover td) {
  background-color: var(--color-warning-border);
}
</style>
