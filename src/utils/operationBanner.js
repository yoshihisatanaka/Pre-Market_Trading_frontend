/*
 * 全画面の運用バナー（AppOperationBanner）が描く内容を、Banner モデルから組み立てる。
 *
 * 発注停止（INCIDENT）とお知らせ（NOTICE）のどちらを出すかはサーバが決めている
 * （src/api/banner.js）。ここは kind を見て文言と配色を当てるだけで、優先順位を組み立て直さない。
 *
 *   配色  … severity で決める（critical は赤、それ以外は青）
 *   ラベル … kind で決める
 *
 * 時間（取り直し）と閉じた状態は composables/useOperationBanner の担当。
 */

/** kind ごとのラベルと、利用者が閉じてよいか */
const KINDS = {
  INCIDENT: { label: '発注停止中', dismissible: false },
  NOTICE: { label: 'お知らせ', dismissible: true },
}

/**
 * @typedef {{
 *   kind: string,
 *   tone: 'info' | 'danger',
 *   label: string,
 *   message: string,
 *   targets: string,
 *   dismissible: boolean,
 * }} BannerDisplay
 *   targets は INCIDENT の停止対象を「停止対象: 全注文」の形にしたもの。無ければ空文字
 */

/**
 * @param {import('@/api/banner').Banner | null} banner
 * @returns {BannerDisplay | null} 出すものが無い（NONE・未取得・本文が空）ときは null
 */
export function toBannerDisplay(banner) {
  const kind = KINDS[banner?.kind]
  if (!kind) return null

  // 本文が空の帯は「何かあるのに読めない」状態になるので出さない
  const message = banner.message.trim()
  if (!message) return null

  const names = banner.kind === 'INCIDENT' ? banner.suspendedTargetNames : []

  return {
    kind: banner.kind,
    tone: banner.severity === 'critical' ? 'danger' : 'info',
    label: kind.label,
    message,
    targets: names.length ? `停止対象: ${names.join('、')}` : '',
    dismissible: kind.dismissible,
  }
}
