import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { suspensionTargets } from '@/mocks/fixtures/incidents'
import BaseModal from '@/components/ui/BaseModal.vue'
import { formatDateTime } from '@/utils/format'
import IncidentControlDialog from './IncidentControlDialog.vue'

/*
 * 対象の行は store の targets と同じアプリ内モデル。component から api 層は import できないので、
 * フィクスチャ（生の形）からここで組み立てる。
 */
function toTarget(raw, overrides = {}) {
  return {
    id: raw['ID'],
    target: raw['停止対象'],
    targetName: raw['停止対象名'],
    suspended: raw['発注停止中'],
    reason: raw['停止理由'],
    suspendedAt: raw['停止日時'],
    suspendedBy: raw['停止者'],
    resumedAt: raw['再開日時'],
    resumedBy: raw['再開者'],
    updatedAt: raw['更新日時'],
    updatedBy: raw['更新者'],
    ...overrides,
  }
}

const rawOf = (code) => suspensionTargets.find((row) => row['停止対象'] === code)

const REASON = 'IB回線障害'
const IB = toTarget(rawOf('1'))
const ALL = toTarget(rawOf('ALL'))
// 停止中の IB（停止時の記録はフィクスチャの値を使い、理由だけシナリオの値にする）
const SUSPENDED_IB = toTarget(rawOf('1'), { suspended: true, reason: REASON })

const ALL_WARNING = '全ルートの発注が止まり、注文の新規受付・取消も停止します。'
const REQUIRED_ERROR = '停止理由を入力してください。'

/*
 * BaseModal の Teleport で body に出るため、teleport を stub して wrapper 内に描画させる。
 * 既定は IB の停止確認。
 */
function mountDialog(props = {}) {
  return mount(IncidentControlDialog, {
    props: { open: true, mode: 'suspend', target: IB, ...props },
    global: { stubs: { teleport: true } },
  })
}

const byTestid = (wrapper, suffix) => wrapper.find(`[data-testid="incidents-control-${suffix}"]`)
const dialogOf = (wrapper) => wrapper.find('[role="dialog"]')
/** 本文は要素をまたぐので、改行と字下げを潰してから照合する */
const dialogText = (wrapper) => dialogOf(wrapper).text().replace(/\s+/g, ' ')
/** 停止理由の未入力エラー（FormField が role="alert" で出す） */
const reasonError = (wrapper) => byTestid(wrapper, 'reason-field').find('[role="alert"]')

// シナリオ: docs/unit/components-incidents-incident-control-dialog.md
describe('IncidentControlDialog', () => {
  it('[IND-01] open が false なら何も描画しない', () => {
    const wrapper = mountDialog({ open: false })

    expect(dialogOf(wrapper).exists()).toBe(false)
    expect(byTestid(wrapper, 'dialog').exists()).toBe(false)
  })

  it('[IND-02] 停止の確認は見出し・対象名・必須の停止理由欄を出し、全ルート停止の警告は出さない', () => {
    const wrapper = mountDialog()

    expect(dialogOf(wrapper).attributes('aria-label')).toBe('発注停止の確認')
    expect(dialogText(wrapper)).toContain(`「${IB.targetName}」`)
    const reason = byTestid(wrapper, 'reason')
    expect(reason.exists()).toBe(true)
    expect(reason.attributes('required')).toBeDefined()
    expect(byTestid(wrapper, 'reason-field').text()).toContain('必須')
    expect(byTestid(wrapper, 'warning').exists()).toBe(false)
  })

  it('[IND-03] 全体の停止確認は全ルート停止の警告を出す', () => {
    const wrapper = mountDialog({ target: ALL })

    expect(byTestid(wrapper, 'warning').text()).toBe(ALL_WARNING)
  })

  it('[IND-06] 「キャンセル」で close を emit する', async () => {
    const wrapper = mountDialog()

    await byTestid(wrapper, 'cancel').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('[IND-07] mode と target が null でも例外を投げずに描画する', () => {
    const wrapper = mountDialog({ mode: null, target: null })

    expect(byTestid(wrapper, 'dialog').exists()).toBe(true)
  })

  it('[IND-08] 停止理由を入れて「停止する」を押すと理由付きで confirm を 1 回 emit する', async () => {
    const wrapper = mountDialog()

    await byTestid(wrapper, 'reason').setValue(REASON)
    await byTestid(wrapper, 'submit').trigger('click')

    expect(wrapper.emitted('confirm')).toEqual([[{ reason: REASON }]])
  })

  it('[IND-09] 停止理由が空または空白だけなら未入力エラーを出し confirm は emit しない', async () => {
    const wrapper = mountDialog()

    await byTestid(wrapper, 'submit').trigger('click')
    expect(reasonError(wrapper).text()).toBe(REQUIRED_ERROR)

    await byTestid(wrapper, 'reason').setValue('   ')
    await byTestid(wrapper, 'submit').trigger('click')
    expect(reasonError(wrapper).text()).toBe(REQUIRED_ERROR)

    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('[IND-10] 閉じて開き直すと入力欄が空に戻り未入力エラーも消える', async () => {
    const wrapper = mountDialog()
    await byTestid(wrapper, 'reason').setValue('   ')
    await byTestid(wrapper, 'submit').trigger('click')
    expect(reasonError(wrapper).exists()).toBe(true)

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(byTestid(wrapper, 'reason').element.value).toBe('')
    expect(reasonError(wrapper).exists()).toBe(false)
  })

  it('[IND-11] pending 中は主ボタンが「停止中…」で押せず、キャンセルも押せない', () => {
    const wrapper = mountDialog({ pending: true })

    expect(byTestid(wrapper, 'submit').text()).toBe('停止中…')
    expect(byTestid(wrapper, 'submit').attributes('disabled')).toBeDefined()
    expect(byTestid(wrapper, 'cancel').attributes('disabled')).toBeDefined()
  })

  it('[IND-12] pending 中はモーダルが close を発火しても close を emit しない', async () => {
    const wrapper = mountDialog({ pending: true })

    // Esc / オーバーレイのクリックは BaseModal が close にまとめて伝える
    wrapper.findComponent(BaseModal).vm.$emit('close')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('[IND-13] error の文言をダイアログ先頭に出す', () => {
    // 部品が読むのは message だけ（component から api 層の ApiError は import できない）
    const error = new Error(`${IB.targetName}はすでに停止中です。`)
    const wrapper = mountDialog({ error })

    const alert = byTestid(wrapper, 'error')
    expect(alert.text()).toBe(error.message)
    // ダイアログ本体の最初の要素として出る
    expect(byTestid(wrapper, 'dialog').element.firstElementChild).toBe(alert.element)
  })

  it('[IND-14] 停止理由の入力欄は maxlength が 200', () => {
    const wrapper = mountDialog()

    expect(byTestid(wrapper, 'reason').attributes('maxlength')).toBe('200')
  })

  it('[IND-15] 再開の確認は見出し・対象名・停止時の記録を読み取り専用で出し、入力欄と警告は出さない', () => {
    const wrapper = mountDialog({ mode: 'resume', target: SUSPENDED_IB })

    expect(dialogOf(wrapper).attributes('aria-label')).toBe('発注再開の確認')
    expect(dialogText(wrapper)).toContain(`「${SUSPENDED_IB.targetName}」`)

    const summary = byTestid(wrapper, 'summary')
    const pairs = Object.fromEntries(
      summary.findAll('dt').map((dt, index) => [dt.text(), summary.findAll('dd')[index].text()]),
    )
    expect(pairs).toEqual({
      停止理由: REASON,
      停止日時: formatDateTime(SUSPENDED_IB.suspendedAt),
      停止者: SUSPENDED_IB.suspendedBy,
    })
    // 読み取り専用（入力部品が無い）
    expect(summary.find('input, textarea, select').exists()).toBe(false)
    expect(byTestid(wrapper, 'reason').exists()).toBe(false)
    expect(byTestid(wrapper, 'reason-field').exists()).toBe(false)
    expect(byTestid(wrapper, 'warning').exists()).toBe(false)
  })

  it('[IND-16] 再開の確認で「再開する」を押すと reason null で confirm を 1 回 emit する', async () => {
    const wrapper = mountDialog({ mode: 'resume', target: SUSPENDED_IB })

    expect(byTestid(wrapper, 'submit').text()).toBe('再開する')
    await byTestid(wrapper, 'submit').trigger('click')

    expect(wrapper.emitted('confirm')).toEqual([[{ reason: null }]])
  })

  it('[IND-17] 再開の pending 中は主ボタンが「再開中…」で押せない', () => {
    const wrapper = mountDialog({ mode: 'resume', target: SUSPENDED_IB, pending: true })

    expect(byTestid(wrapper, 'submit').text()).toBe('再開中…')
    expect(byTestid(wrapper, 'submit').attributes('disabled')).toBeDefined()
  })
})
