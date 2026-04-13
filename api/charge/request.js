import { createChargeRequest, getUser, listChargeRequests } from '../_db.js';

const PACKAGES = {
  10: 1900,
  20: 3900,
  30: 5900,
};

export default async function handler(req, res) {
  const kakaoId = req.headers['x-kakao-id'] || req.headers['X-Kakao-Id'];
  if (!kakaoId) return res.status(401).json({ error: '로그인이 필요합니다' });

  if (req.method === 'GET') {
    // 본인 요청 이력 조회
    try {
      const list = await listChargeRequests({ kakaoId, limit: 20 });
      return res.status(200).json({
        requests: list.map(r => ({
          id: r.id,
          packageSize: r.package_size,
          amountWon: r.amount_won,
          depositorName: r.depositor_name,
          status: r.status,
          note: r.note,
          createdAt: r.created_at,
          processedAt: r.processed_at,
        })),
      });
    } catch (err) {
      return res.status(500).json({ error: err?.message || 'list failed' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { packageSize, depositorName } = req.body || {};
    const size = parseInt(packageSize, 10);
    if (!PACKAGES[size]) return res.status(400).json({ error: '잘못된 패키지입니다' });

    // 동일 사용자의 pending 요청이 있으면 추가 막기
    const pending = await listChargeRequests({ kakaoId, status: 'pending', limit: 1 });
    if (pending.length) {
      return res.status(409).json({ error: '이미 처리 대기 중인 요청이 있습니다' });
    }

    const user = await getUser(kakaoId);
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });

    const created = await createChargeRequest({
      kakaoId,
      packageSize: size,
      amountWon: PACKAGES[size],
      depositorName: depositorName || user.nickname || null,
    });
    return res.status(200).json({
      id: created.id,
      packageSize: created.package_size,
      amountWon: created.amount_won,
      status: created.status,
      createdAt: created.created_at,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'create failed' });
  }
}
