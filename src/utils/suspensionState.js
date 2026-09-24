/**
 * 発注停止の総合状態（画面の「現在の運用状態」）を組み立てる。
 *
 * サーバは 発注停止中 / 全体停止中 / 停止中の対象 のフラグだけを返し、総合の表示名を返さない。
 * 表示名はここだけで合成する（画面に散らすと、呼び名の変更が複数箇所に要る）。
 *
 *   全体停止中         → 「全体停止中」（danger）
 *   ルート別だけ停止中 → 「一部停止中（IB, VWAP）」（warning）。名前は targets の並び順
 *   どれも停止していない → 「通常運用」（normal）
 *
 * @param {{ suspended: boolean, allSuspended: boolean, suspendedTargets: string[],
 *   targets: Array<{ target: string, targetName: string }> } | null} status
 * @returns {{ label: string, tone: 'normal' | 'warning' | 'danger' } | null}
 */
export function summarizeSuspension(status) {
  if (!status) return null

  if (status.allSuspended) return { label: '全体停止中', tone: 'danger' }

  if (status.suspended) {
    // 停止中の対象（コード）を、表と同じ並びの表示名に引き直す。表に無いコードはそのまま出す
    const codes = new Set(status.suspendedTargets)
    const known = status.targets.filter((row) => codes.has(row.target))
    const unknown = [...codes].filter((code) => !known.some((row) => row.target === code))
    const names = [...known.map((row) => row.targetName), ...unknown]

    const label = names.length > 0 ? `一部停止中（${names.join(', ')}）` : '一部停止中'
    return { label, tone: 'warning' }
  }

  return { label: '通常運用', tone: 'normal' }
}
