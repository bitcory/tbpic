import { adjustUser, isAdminRequest } from '../_db.js';

export default async function handler(req, res) {
  if (!(await isAdminRequest(req))) return res.status(401).json({ error: '관리자 권한 필요' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { kakaoId, quota, used, isBlocked } = req.body || {};
    if (!kakaoId) return res.status(400).json({ error: 'kakaoId 필요' });
    const updated = await adjustUser(kakaoId, { quota, used, isBlocked });
    if (!updated) return res.status(404).json({ error: '사용자 없음' });
    return res.status(200).json({
      kakaoId: updated.kakao_id,
      quota: updated.quota,
      used: updated.used,
      isBlocked: updated.is_blocked,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'adjust failed' });
  }
}
