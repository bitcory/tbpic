import { getGenerationImage } from './_db.js';

export const config = { api: { responseLimit: false } };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const kakaoId = req.headers['x-kakao-id'] || req.headers['X-Kakao-Id'] || req.query?.k;
  const id = req.query?.id;
  if (!kakaoId || !id) return res.status(400).json({ error: 'id, kakao id 필요' });
  try {
    const row = await getGenerationImage(id, kakaoId);
    if (!row?.image_data) return res.status(404).json({ error: '이미지를 찾을 수 없습니다' });
    const buf = Buffer.from(row.image_data, 'base64');
    res.setHeader('Content-Type', row.image_mime || 'image/png');
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (req.query?.dl) {
      res.setHeader('Content-Disposition', `attachment; filename="tbpic-${id}.png"`);
    }
    return res.status(200).send(buf);
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'image fetch failed' });
  }
}
