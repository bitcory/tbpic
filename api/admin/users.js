import { listUsers, isAdminRequest } from '../_db.js';

export default async function handler(req, res) {
  if (!(await isAdminRequest(req))) return res.status(401).json({ error: '관리자 권한 필요' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const users = await listUsers({ limit: 200 });
    return res.status(200).json({
      users: users.map(u => ({
        kakaoId: u.kakao_id,
        nickname: u.nickname,
        profileImage: u.profile_image,
        quota: u.quota,
        used: u.used,
        remaining: Math.max(u.quota - u.used, 0),
        isBlocked: u.is_blocked,
        isAdmin: u.is_admin,
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at,
        lastUsedAt: u.last_used_at,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'list failed' });
  }
}
