// api/shopify.js — Vercel serverless proxy para Shopify Admin API
// Evita CORS pasando todas las calls por este endpoint

export default async function handler(req, res) {
  // CORS headers para que el frontend pueda llamar
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-shop, x-token');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const shop  = req.headers['x-shop'];
  const token = req.headers['x-token'];

  if (!shop || !token) {
    return res.status(400).json({ error: 'Faltan x-shop y x-token en headers' });
  }

  // El path de Shopify viene como query param: ?path=/products.json&limit=250&...
  const { path, ...rest } = req.query;
  if (!path) return res.status(400).json({ error: 'Falta query param: path' });

  // Construir URL destino
  const params = rest.page_info ? new URLSearchParams({ page_info: rest.page_info, limit: rest.limit || 250 }).toString() : new URLSearchParams(rest).toString();
  const fullUrl = `https://${shop}/admin/api/2024-04${path}${params ? '?' + params : ''}`;

  try {
    const upstream = await fetch(fullUrl, {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
    });

    // Pasar Link header para paginación
    const linkHeader = upstream.headers.get('Link');
    if (linkHeader) res.setHeader('Link', linkHeader);

    const data = await upstream.json();

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: data.errors || data });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('[shopify-proxy]', err);
    return res.status(500).json({ error: err.message });
  }
}
