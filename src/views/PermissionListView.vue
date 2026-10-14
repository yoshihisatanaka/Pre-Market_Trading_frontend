<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import MasterFormDialog from '@/components/masters/MasterFormDialog.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import PermissionCheckList from '@/components/permissions/PermissionCheckList.vue'
import { usePermissionsStore } from '@/stores/permissions'
import {
  EDITABLE_PERMISSION_ITEMS,
  PERMISSION_ITEMS,
  UNSUPPORTED_LABEL,
  permissionBadge,
  validatePermissions,
} from '@/utils/permissionTypes'

/*
 * 権限マスタ（ロール別権限の一覧と編集）。
 *
 * 一覧は GET /masters/permissions、保存は PUT /masters/permissions/{role_code}。
 * 編集できるか（「操作」列を出すか）は GET /auth/me のロールが管理責任者かで決まる
 * （判定は src/stores/permissions.js）。
 *
 * 権限の列は画面モック（../premarket-order-202609 の 7ee3ad9。2026-10-12）の 8 列。
 * うち 4 列（参照 / 発注（強制） / CSV一括発注 / ユーザ管理）は実 API に保存先が無い契約提案で、
 * 実 API が返さない間は「—」を出し、編集のチェックは押せない（src/utils/permissionTypes.js）。
 *
 * 画面モックからの意図的なずれがある。
 *   - ロール追加・ロール名 / 説明の編集は作らない（API に POST も ロール名 の更新も無い）
 *   - 「閲覧のみ」への切替入口（モックの ?as_user= セレクタ）は作らない。操作者は
 *     /auth/me（SSO セッションか開発用の X-User-Code）で決まる
 *   - 列見出しの改行（「発注<br>（強制）」）はせず 1 行で出す
 */

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = usePermissionsStore()
const { roles, canEdit, loading, error, isEmpty, saving, saveError } = storeToRefs(store)

store.load()

/*
 * 列は画面モックの並びどおり（ロール・説明・権限・操作）。権限の列は PERMISSION_ITEMS から
 * 生やすので、項目を足すときも一覧とモーダルがずれない。
 * 「操作」列は編集できるときだけ出す（モックも管理責任者以外では列ごと消える）。
 */
const columns = computed(() => [
  { key: 'role', label: 'ロール' },
  { key: 'description', label: '説明' },
  ...PERMISSION_ITEMS.map((item) => ({ key: item.key, label: item.columnLabel })),
  ...(canEdit.value ? [{ key: 'actions', label: '操作' }] : []),
])

/*
 * 権限セルの slot 名（cell-canOrder など）。
 * 動的な slot 名には式を書けないので、あらかじめ文字列にして配列に持たせる。
 */
const permissionSlots = PERMISSION_ITEMS.map((item) => ({ ...item, slot: `cell-${item.key}` }))

/** 編集中のロール。null なら閉じている（開閉と対象を 1 つの ref で兼ねる） */
const editTarget = ref(null)
const editForm = ref({})
/** 権限の組み合わせの不備（発注なしで強制を許可した等）。保存を押したときに検証する */
const ruleErrors = ref([])

const editTitle = computed(() => (editTarget.value ? `${editTarget.value.roleLabel}の権限設定` : ''))

/** 保存の成功通知。次の編集を開くか再試行するまで出しておく */
const noticeMessage = ref('')

function openEdit(row) {
  noticeMessage.value = ''
  // 前回の保存失敗の文言を持ち越さない
  store.clearSaveError()
  ruleErrors.value = []
  editTarget.value = row
  // 一覧の行をそのまま編むと、キャンセルしたときに戻せない。保存する項目の値だけ写して持つ
  // （null は未対応の印なので真偽値に寄せない。api 層が null の項目を送らない）
  editForm.value = Object.fromEntries(
    EDITABLE_PERMISSION_ITEMS.map((item) => [item.key, row[item.key] ?? null]),
  )
}

function closeEdit() {
  editTarget.value = null
}

/**
 * 保存。失敗（403 / 404 / 409 など）したらダイアログを開いたまま、理由を
 * MasterFormDialog の error に出す（入力した内容は残る）。
 */
async function submitEdit() {
  ruleErrors.value = validatePermissions(editForm.value)
  if (ruleErrors.value.length > 0) return

  const target = editTarget.value
  const result = await store.save(target.role, editForm.value)
  if (!result) return

  closeEdit()
  // 文言はサーバが決める（変更が無ければ「変更はありません。」）。空なら画面の既定で補う
  noticeMessage.value = result.message || `${result.role.roleLabel}の権限設定を更新しました。`
}

function reload() {
  noticeMessage.value = ''
  store.load()
}
</script>

<template>
  <section class="permission-list">
    <!-- 画面の説明。4 状態に関わらず常時出す。見出しだけが編集可否で変わる -->
    <BaseAlert variant="info" data-testid="permissions-description">
      <strong>{{ canEdit ? '権限設定可能' : '閲覧のみ' }}</strong>
      ユーザマスタでは、利用者ごとにこの一覧のロールを 1 つ割り当てます。
      操作ログ閲覧は、マスタ更新または運用・障害管理を許可したロールへ自動付与されます。
      権限マスタ自体の変更は管理責任者のみ実行できます。
    </BaseAlert>

    <BaseAlert v-if="noticeMessage" variant="success" data-testid="permissions-notice">
      {{ noticeMessage }}
    </BaseAlert>

    <!-- ロールは 4 つ固定で増えないので、件数の単位を言い換えてページャーを出さない -->
    <MasterListCard
      testid-prefix="permissions"
      title="ロール別権限一覧"
      unit="ロール"
      empty-message="ロールが登録されていません。"
      :paginated="false"
      :total="roles.length"
      :loading="loading"
      :is-empty="isEmpty"
      :error="error"
      @reload="reload"
    >
      <DataTable
        flat
        data-testid="permissions-table"
        row-key="role"
        :columns="columns"
        :rows="roles"
      >
        <template #cell-role="{ row }">
          <strong>{{ row.roleLabel }}</strong>
          <span class="permission-list__code">{{ row.role }}</span>
        </template>

        <template #cell-description="{ row }">
          <span class="permission-list__description">{{ row.description }}</span>
        </template>

        <!-- 権限 8 列。許可 / 不可（操作ログ閲覧は 閲覧可 / 不可）のバッジを置く。
             実 API が返さない契約提案の列はバッジを出さず「—」 -->
        <template v-for="item in permissionSlots" #[item.slot]="{ value }" :key="item.key">
          <BaseBadge
            v-if="permissionBadge(value, item)"
            :variant="permissionBadge(value, item).variant"
          >
            {{ permissionBadge(value, item).label }}
          </BaseBadge>
          <span v-else class="permission-list__unsupported" title="バックエンド未対応">
            {{ UNSUPPORTED_LABEL }}
          </span>
        </template>

        <template #cell-actions="{ row }">
          <BaseButton
            variant="secondary"
            size="sm"
            :data-testid="`permissions-edit-${row.role}`"
            @click="openEdit(row)"
          >
            編集
          </BaseButton>
        </template>
      </DataTable>
    </MasterListCard>

    <MasterFormDialog
      testid-prefix="permissions"
      action="edit"
      submit-label="保存"
      :open="editTarget !== null"
      :title="editTitle"
      :pending="saving"
      :error="saveError"
      :validation-errors="ruleErrors"
      @close="closeEdit"
      @submit="submitEdit"
    >
      <p class="permission-list__dialog-subtitle">
        設定はログイン時に判定されたロールに適用されます。
      </p>

      <PermissionCheckList v-model="editForm" testid-prefix="permissions-edit" />
    </MasterFormDialog>
  </section>
</template>

<style scoped>
.permission-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* ロール名の下に添える英字コード（モックの ui-code 相当） */
.permission-list__code {
  display: block;
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  font-family: var(--font-family-numeric);
  font-size: var(--font-size-xs);
}

.permission-list__description {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.permission-list__unsupported {
  color: var(--color-text-muted);
}

/*
 * 3 列目より後（権限 8 列と操作）は見出しもセルも中央寄せ。モックと同じ。
 * DataTable は右寄せ（numeric）しか持たないので、ここで列位置を指して当てる。
 * **列の並びを変えるときはこの指定も見直すこと。**
 */
.permission-list :deep(th:nth-child(n + 3)),
.permission-list :deep(td:nth-child(n + 3)) {
  text-align: center;
}

.permission-list__dialog-subtitle {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
</style>
