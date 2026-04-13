import { listChargeRequests, isAdminRequest } from '../_db.js';

export default async function handler(req, res) {
  if (!(await isAdminRequest(req))) return res.status(401).json({ error: '관리자 권한 필요' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const status = req.query?.status; // 'pending' 등
    const list = await listChargeRequests({ status, limit: 100 });
    return res.status(200).json({
      requests: list.map(r => ({
        id: r.id,
        kakaoId: r.kakao_id,
        nickname: r.nickname,
        profileImage: r.profile_image,
        packageSize: r.package_size,
        amountWon: r.amount_won,
        depositorName: r.depositor_name,
        status: r.status,
        note: r.note,
        createdAt: r.created_at,
        processedAt: r.processed_at,
        processedBy: r.processed_by,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'list failed' });
  }
}
