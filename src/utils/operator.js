/**
 * 操作している担当者（社員コード）。
 *
 * この画面群にログインの仕組みはまだ無い。更新系の API が要求する `X-User-Code` は
 * src/api/client.js が `.env` の `VITE_USER_CODE` から載せており、ここはその値を
 * **画面に表示するため**に読むもの（残高マスタの確認ステップの「更新者」）。
 *
 * **同じ 1 行が src/api/client.js にもある。** あちらは通信の都合、こちらは表示の都合で、
 * 依存の向き（api → utils）を作らないために別に持つ。SSO が入るときは両方を差し替える。
 */

/** 操作者の社員コード。未設定なら空文字（画面は「—」に落とす） */
export const OPERATOR_CODE = import.meta.env.VITE_USER_CODE || ''
