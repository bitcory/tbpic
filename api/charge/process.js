import { approveCharge, rejectCharge, isAdminRequest } from '../_db.js';

export default async function handler(req, res) {
  if (!(await isAdminRequest(req))) return res.status(401).json({ error: '관리자 권한 필요' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { id, action, note } = req.body || {};
    if (!id || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'id, action(approve|reject) 필요' });
    }
    const adminKakaoId = req.headers['x-kakao-id'] || req.headers['X-Kakao-Id'];
    const result = action === 'approve'
      ? await approveCharge({ id, adminKakaoId, note })
      : await rejectCharge({ id, adminKakaoId, note });
    if (result.error) return res.status(400).json({ error: result.error });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'process failed' });
  }
}
