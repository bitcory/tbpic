import { getUser, listGenerations } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const kakaoId = req.headers['x-kakao-id'] || req.headers['X-Kakao-Id'];
  if (!kakaoId) return res.status(401).json({ error: '로그인이 필요합니다' });
  try {
    const user = await getUser(kakaoId);
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });
    const history = await listGenerations(kakaoId, { limit: 30 });
    return res.status(200).json({
      kakaoId: user.kakao_id,
      nickname: user.nickname,
      profileImage: user.profile_image,
      quota: user.quota,
      used: user.used,
      remaining: Math.max(user.quota - user.used, 0),
      isBlocked: user.is_blocked,
      isAdmin: user.is_admin,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      lastUsedAt: user.last_used_at,
      history: history.map(h => ({
        id: h.id, styleId: h.style_id, ok: h.ok, error: h.error, createdAt: h.created_at,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'me failed' });
  }
}
