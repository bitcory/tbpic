// Vercel Serverless Function — proxies image generation to Gemini.
// Keeps GEMINI_API_KEY server-side only. Frontend POSTs JSON.
const MODEL = 'gemini-3-pro-image-preview';

export const config = {
  api: { bodyParser: { sizeLimit: '12mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

  try {
    const { prompt, imageBase64, mimeType } = req.body || {};
    if (!prompt || !imageBase64) {
      return res.status(400).json({ error: 'prompt와 imageBase64는 필수입니다' });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType || 'image/png', data: imageBase64 } },
        ],
      }],
    };

    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await upstream.json();
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: json?.error?.message || 'Gemini API 호출 실패',
        details: json,
      });
    }

    const parts = json?.candidates?.[0]?.content?.parts || [];
    const inline = parts.find(p => p.inline_data || p.inlineData);
    const blob = inline?.inline_data || inline?.inlineData;
    if (!blob?.data) {
      return res.status(502).json({ error: '이미지가 반환되지 않았습니다', details: json });
    }
    const outMime = blob.mime_type || blob.mimeType || 'image/png';
    return res.status(200).json({ dataUrl: `data:${outMime};base64,${blob.data}` });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'unknown error' });
  }
}
