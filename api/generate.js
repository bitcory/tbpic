// Vercel Serverless Function — proxies image generation to Gemini.
// Keeps GEMINI_API_KEY server-side. Enforces per-user quota via Postgres.
import { reserveQuota, refundQuota, logGeneration, getUser, countSavedImages } from './_db.js';

const MODEL = 'gemini-3.1-flash-image-preview';
const SAVED_LIMIT = 20;

export const config = {
  api: { bodyParser: { sizeLimit: '12mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

  const { kakaoId, styleId, prompt, imageBase64, mimeType } = req.body || {};
  if (!kakaoId) return res.status(401).json({ error: '로그인이 필요합니다' });
  if (!prompt || !imageBase64) return res.status(400).json({ error: 'prompt와 imageBase64는 필수입니다' });

  // 1a) check saved image storage limit
  const savedCount = await countSavedImages(kakaoId);
  if (savedCount >= SAVED_LIMIT) {
    return res.status(409).json({
      error: `사진 보관함이 가득 찼어요 (${savedCount}/${SAVED_LIMIT}장).\n마이페이지에서 다운로드 후 오래된 사진을 삭제해주세요.`,
      savedCount, savedLimit: SAVED_LIMIT,
    });
  }

  // 1) reserve a quota slot atomically
  const reservation = await reserveQuota(kakaoId);
  if (!reservation) {
    const u = await getUser(kakaoId);
    if (u?.is_blocked) return res.status(403).json({ error: '차단된 계정입니다' });
    return res.status(402).json({
      error: '무료 횟수를 모두 사용했습니다',
      quota: u?.quota ?? 0,
      used: u?.used ?? 0,
    });
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType || 'image/png', data: imageBase64 } },
          { text: prompt },
        ],
      }],
      generationConfig: {
        imageConfig: {
          aspectRatio: '3:4',
        },
      },
    };
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await upstream.json();
    if (!upstream.ok) {
      await refundQuota(kakaoId);
      await logGeneration({ kakaoId, styleId, ok: false, error: json?.error?.message });
      return res.status(upstream.status).json({
        error: json?.error?.message || 'Gemini API 호출 실패',
      });
    }
    const parts = json?.candidates?.[0]?.content?.parts || [];
    const inline = parts.find(p => p.inline_data || p.inlineData);
    const blob = inline?.inline_data || inline?.inlineData;
    if (!blob?.data) {
      await refundQuota(kakaoId);
      await logGeneration({ kakaoId, styleId, ok: false, error: 'no image returned' });
      return res.status(502).json({ error: '이미지가 반환되지 않았습니다' });
    }
    const outMime = blob.mime_type || blob.mimeType || 'image/png';
    await logGeneration({
      kakaoId, styleId, ok: true,
      imageData: blob.data, imageMime: outMime,
    });
    return res.status(200).json({
      dataUrl: `data:${outMime};base64,${blob.data}`,
      remaining: Math.max(reservation.quota - reservation.used, 0),
      quota: reservation.quota,
      used: reservation.used,
    });
  } catch (err) {
    await refundQuota(kakaoId);
    await logGeneration({ kakaoId, styleId, ok: false, error: err?.message });
    return res.status(500).json({ error: err?.message || 'unknown error' });
  }
}
