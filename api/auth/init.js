import { upsertUser } from '../_db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { kakaoId, nickname, profileImage } = req.body || {};
    if (!kakaoId) return res.status(400).json({ error: 'kakaoId 필요' });
    const user = await upsertUser({ kakaoId, nickname, profileImage });
    return res.status(200).json({
      kakaoId: user.kakao_id,
      nickname: user.nickname,
      quota: user.quota,
      used: user.used,
      remaining: Math.max(user.quota - user.used, 0),
      isBlocked: user.is_blocked,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'init failed' });
  }
}
