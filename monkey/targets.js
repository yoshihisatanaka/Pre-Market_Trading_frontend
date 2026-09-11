/**
 * モンキーテストの対象画面。
 *
 * 一覧の正は src/components/layout/navigation.js（サイドメニュー）。ここで二重管理しない。
 * ルート未定義の path は「ページが見つかりません」に落ちるが、それは対象から外す理由には
 * ならない（未実装として報告する。判定は monkey/runner.js の isNotFound）。
 */
import { navItems } from '../src/components/layout/navigation.js'

/** サイドメニューに載らないが対象にしたい画面 */
const EXTRA_TARGETS = [
  { label: '注文一覧（参考実装）', to: '/' },
  { label: 'UI カタログ（開発用）', to: '/dev/ui-catalog' },
]

export const allTargets = [...navItems.map(({ label, to }) => ({ label, to })), ...EXTRA_TARGETS]

/** path を安全なファイル名にする（レポートの保存名に使う） */
export function slugify(path) {
  const body = path.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9-]+/g, '-')
  return body === '' ? 'root' : body
}

/**
 * MONKEY_TARGETS の指定を対象一覧に解決する。
 * 指定はカンマ区切りで、path（/masters/fx）でもラベル（為替マスタ）でもよい。
 * 'all' または未指定は全画面。
 *
 * @param {string | undefined} spec
 * @returns {{ targets: Array<{label: string, to: string}>, unknown: string[] }}
 */
export function resolveTargets(spec) {
  const raw = (spec ?? '').trim()
  if (raw === '' || raw.toLowerCase() === 'all') {
    return { targets: allTargets, unknown: [] }
  }

  const targets = []
  const unknown = []
  for (const token of raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const found = allTargets.find((t) => t.to === token || t.label === token)
    if (!found) {
      unknown.push(token)
    } else if (!targets.includes(found)) {
      targets.push(found)
    }
  }
  return { targets, unknown }
}
