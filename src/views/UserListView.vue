<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
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
import { useCodesStore } from '@/stores/codes'
import { USER_STATUS_ACTIVE, USERS_PAGE_SIZE, useUsersStore } from '@/stores/users'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useUsersStore()
const {
  items,
  total,
  limit,
  offset,
  loading,
  error,
  isEmpty,
  updating,
  updateError,
  roleOptions,
  rolesError,
  rolesLoading,
} = storeToRefs(store)

// ロールの選択肢（検索・編集のプルダウン）。一覧の読み込みとは独立に、画面を開くたびに読む
store.loadRoles()

/*
 * 部店の選択肢はコードマスタから。読み込みは main.js が起動時に 1 回だけ行うので、
 * ここでは load を呼ばない（顧客マスタと同じ）。
 */
const codes = useCodesStore()
const { loading: codesLoading } = storeToRefs(codes)
const branchOptions = computed(() => codes.optionsFor('部店'))

/*
 * 所属部店名。OperatorItem に部店名が無い（docs/api/requests.md #67）ので、部店の選択肢
 * （GET /branches）から引く。選択肢の label は「123 A支店」とコードを前置した形
 * （src/api/codes.js の fetchBranches）なので、前置を外して名前だけにする。
 */
const branchNames = computed(
  () =>
    new Map(
      branchOptions.value.map(({ value, label }) => [
        value,
        label.startsWith(`${value} `) ? label.slice(value.length + 1) : '',
      ]),
    ),
)

/** 部店コード → 「123 A支店」（編集モーダルの読み取り専用欄）。未登録の部店はコードだけ */
function branchLabel(code) {
  if (!code) return '—'
  const name = branchNames.value.get(code)
  return name ? `${code} ${name}` : code
}

const statusOptions = [{ value: USER_STATUS_ACTIVE, label: '有効' }]

/*
 * 列は画面モック（../premarket-order-202609 の master_users.html）の並びどおり。
 *   - モックの 1 列目は Entra ID（メールアドレス）だが、仕様（OperatorItem）にメールアドレスが無い。
 *     代わりに利用者を指す業務キーの社員コード（操作者コード）を出す（docs/api/requests.md #67）
 *   - モックが氏名の下に添えるカナも仕様に無いので出さない
 *   - 操作列は「編集」だけ。モックに新規追加・削除は無い
 */
const columns = [
  { key: 'code', label: '社員コード' },
  { key: 'name', label: '氏名' },
  { key: 'branchCode', label: '所属部店コード' },
  { key: 'branchName', label: '所属部店名' },
  { key: 'role', label: 'ロール' },
  { key: 'status', label: '状態' },
  { key: 'actions', label: '操作' },
]

/*
 * ページ位置と検索条件は URL クエリを正とする単方向フローで扱う（詳細は useListQuery）。
 * バックエンドが受け取るクエリ名（role / branch_code / include_inactive / keyword）は
 * src/api/users.js の中に閉じている。状態は stores/users.js が include_inactive に読み替える。
 */
const { inputs, submitSearch, clearSearch, goToOffset } = useListQuery({
  filters: [
    { key: 'branchCode', query: 'branch_code' },
    { key: 'role', query: 'role' },
    // 手で書き換えられた未知の値は「すべて」に寄せる（select が空白の選択を出さないように）
    {
      key: 'status',
      query: 'status',
      parse: (value) => (value === USER_STATUS_ACTIVE ? value : ''),
    },
    { key: 'keyword', query: 'keyword' },
  ],
  load: (params) => store.load(params),
})

// 成功メッセージ
const noticeMessage = ref('')

/*
 * 編集。「開いているか」と「どの行か」を editTarget 1 つで持つ（顧客マスタと同じ形）。
 * 変えられるのはロールと状態だけ（モックの「ユーザの権限設定」）。社員コード・氏名・所属部店は
 * 読み取り専用で、更新の本文には今の値をそのまま載せる（src/api/users.js の updateUser）。
 *
 * 状態は select で持つので、真偽値ではなく 'true' / 'false' の文字列にする。
 */
const editTarget = ref(null)
const editForm = ref({ roleCode: '', active: 'true' })
const editErrors = ref({})

const activeOptions = [
  { value: 'true', label: '有効' },
  { value: 'false', label: '無効' },
]

/*
 * 編集のロールの選択肢。権限マスタの読み込みに失敗した・権限マスタに無いロールの利用者でも、
 * 今のロールが空白に見えないよう、無ければ今のロールを足す。
 */
const editRoleOptions = computed(() => {
  const target = editTarget.value
  if (!target?.roleCode || roleOptions.value.some((option) => option.value === target.roleCode)) {
    return roleOptions.value
  }
  return [
    ...roleOptions.value,
    { value: target.roleCode, label: target.roleName || target.roleCode },
  ]
})

function openEdit(user) {
  editForm.value = { roleCode: user.roleCode, active: String(user.active) }
  editErrors.value = {}
  store.clearUpdateError()
  noticeMessage.value = ''
  editTarget.value = user
}

function closeEdit() {
  // 更新中に閉じると結果の行き先が無くなるので、終わるまで閉じさせない
  if (updating.value) return
  editTarget.value = null
}

async function submitEdit() {
  const target = editTarget.value
  if (!target) return

  editErrors.value = editForm.value.roleCode ? {} : { roleCode: 'ロールを選択してください。' }
  if (editErrors.value.roleCode) return

  const updated = await store.update(
    {
      code: target.code,
      name: target.name,
      branchCode: target.branchCode,
      // 画面に出さないが、省くと null で上書きされるので今の値を送り返す
      orderTakerCode: target.orderTakerCode,
      roleCode: editForm.value.roleCode,
      active: editForm.value.active === 'true',
    },
    {
      onSuccess: (user) => {
        editTarget.value = null
        noticeMessage.value = `${user.name || user.code}の権限設定を更新しました。`
      },
    },
  )
  if (!updated) return

  /*
   * 絞り込み中に条件の圏外へ変えると（ロールで絞っていてロールを変えた、有効だけを出していて
   * 無効にした）、最終ページが空になり得る。そのときは 1 ページ戻す（顧客マスタと同じ）
   */
  if (items.value.length === 0 && offset.value > 0) {
    goToOffset(offset.value - USERS_PAGE_SIZE)
  }
}
</script>

<template>
  <section class="user-list">
    <BaseAlert v-if="noticeMessage" variant="success" data-testid="users-notice">
      {{ noticeMessage }}
    </BaseAlert>

    <!-- 画面の説明。4 状態や検索結果に関わらず常時出す（モックの「権限判定の流れ」） -->
    <BaseAlert variant="info" data-testid="users-description">
      <strong>権限判定の流れ：</strong
      >ログインした利用者を社員コードで特定し、ここで割り当てた<strong>ロール</strong>をキーに権限マスタを参照します。<br />
      この画面では個別の操作権限を持たず、ロールと有効／無効だけを管理します。無効な利用者はログインしても操作権限を取得できません。
    </BaseAlert>

    <!-- ロールの選択肢が取れなくても一覧は使えるので、画面全体のエラーにはしない -->
    <BaseAlert v-if="rolesError" variant="error" data-testid="users-roles-error">
      ロールの選択肢を読み込めませんでした（{{ rolesError.message }}）。
      <BaseButton variant="secondary" data-testid="users-roles-retry" @click="store.loadRoles()">
        再読み込み
      </BaseButton>
    </BaseAlert>

    <MasterSearchCard
      testid-prefix="users"
      :disabled="loading"
      :options-loading="codesLoading || rolesLoading"
      @submit="submitSearch"
      @clear="clearSearch"
    >
      <FormField v-slot="{ field }" label="所属部店">
        <BaseSelect
          v-bind="field"
          v-model="inputs.branchCode"
          :options="branchOptions"
          placeholder="すべて"
          data-testid="users-branch-code"
        />
      </FormField>
      <FormField v-slot="{ field }" label="ロール">
        <BaseSelect
          v-bind="field"
          v-model="inputs.role"
          :options="roleOptions"
          placeholder="すべて"
          data-testid="users-role"
        />
      </FormField>
      <!-- 仕様の絞り込みは「無効も含めるか」だけなので、「無効」だけを選ぶ選択肢は置かない -->
      <FormField v-slot="{ field }" label="状態">
        <BaseSelect
          v-bind="field"
          v-model="inputs.status"
          :options="statusOptions"
          placeholder="すべて"
          data-testid="users-status"
        />
      </FormField>
      <!-- モックは「メールアドレス・氏名」。メールアドレスが仕様に無いので社員コードに当てる -->
      <FormField v-slot="{ field }" label="社員コード・氏名">
        <BaseInput
          v-bind="field"
          v-model="inputs.keyword"
          placeholder="例: 001 / 山田"
          data-testid="users-keyword"
        />
      </FormField>
    </MasterSearchCard>

    <MasterListCard
      testid-prefix="users"
      title="ユーザ一覧"
      empty-message="該当するユーザがありません。"
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
      <DataTable flat data-testid="users-table" :columns="columns" :rows="items">
        <template #cell-code="{ row }">{{ row.code || '—' }}</template>
        <template #cell-name="{ row }">
          <strong>{{ row.name || '—' }}</strong>
        </template>
        <template #cell-branchCode="{ row }">{{ row.branchCode || '—' }}</template>
        <template #cell-branchName="{ row }">
          {{ (row.branchCode && branchNames.get(row.branchCode)) || '—' }}
        </template>
        <template #cell-role="{ row }">{{ row.roleName || row.roleCode || '—' }}</template>

        <template #cell-status="{ row }">
          <BaseBadge :variant="row.active ? 'success' : 'gray'">
            {{ row.active ? '有効' : '無効' }}
          </BaseBadge>
        </template>

        <!-- 削除は無いので編集だけ -->
        <template #cell-actions="{ row }">
          <BaseButton
            variant="secondary"
            :data-testid="`users-edit-${row.id}`"
            :disabled="updating"
            @click="openEdit(row)"
          >
            編集
          </BaseButton>
        </template>
      </DataTable>
    </MasterListCard>

    <MasterFormDialog
      :open="Boolean(editTarget)"
      title="ユーザの権限設定"
      testid-prefix="users"
      action="edit"
      submit-label="保存"
      :pending="updating"
      :error="updateError"
      @close="closeEdit"
      @submit="submitEdit"
    >
      <template v-if="editTarget">
        <!--
          社員コード・氏名・所属部店は読み取り専用。disabled ではなく readonly にする理由は
          SymbolFormFields の symbolCodeLocked と同じ（disabled はこの画面群で「処理中」の意味を持つ）
        -->
        <FormField v-slot="{ field }" label="社員コード">
          <BaseInput
            v-bind="field"
            :model-value="editTarget.code"
            readonly
            data-testid="users-edit-code"
          />
        </FormField>
        <FormGrid :columns="2">
          <FormField v-slot="{ field }" label="氏名">
            <BaseInput
              v-bind="field"
              :model-value="editTarget.name"
              readonly
              data-testid="users-edit-name"
            />
          </FormField>
          <FormField v-slot="{ field }" label="所属部店">
            <BaseInput
              v-bind="field"
              :model-value="branchLabel(editTarget.branchCode)"
              readonly
              data-testid="users-edit-branch"
            />
          </FormField>
        </FormGrid>
        <FormGrid :columns="2">
          <FormField v-slot="{ field }" label="ロール" required :error="editErrors.roleCode">
            <BaseSelect
              v-bind="field"
              v-model="editForm.roleCode"
              :options="editRoleOptions"
              data-testid="users-edit-role"
            />
          </FormField>
          <FormField v-slot="{ field }" label="状態" required>
            <BaseSelect
              v-bind="field"
              v-model="editForm.active"
              :options="activeOptions"
              data-testid="users-edit-active"
            />
          </FormField>
        </FormGrid>
        <p class="user-list__hint">ロールごとの操作範囲は、権限マスタで管理します。</p>
      </template>
    </MasterFormDialog>
  </section>
</template>

<style scoped>
.user-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.user-list__hint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}
</style>
