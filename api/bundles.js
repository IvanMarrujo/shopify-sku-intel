// api/bundles.js — Claude vision flyer analyzer + bundle logic

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { action, imageBase64, imageType, bundleSku, knownSkus, currentConfig } = req.body;

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada en Vercel env' });

  // ── ANALYZE FLYER ────────────────────────────────────────────────────
  if (action === 'analyze_flyer') {
    if (!imageBase64) return res.status(400).json({ error: 'Falta imageBase64' });

    const skuList = knownSkus?.length
      ? `SKUs disponibles en el catálogo:\n${knownSkus.join('\n')}`
      : 'No se proporcionó lista de SKUs — infiere los componentes del flyer.';

    const prompt = `Eres un analista de productos para una tienda de e-commerce. 
Analiza este flyer promocional e identifica:
1. El nombre del bundle/pack promocional
2. Todos los productos incluidos en el pack
3. La cantidad de cada producto si es visible

${skuList}

Responde ÚNICAMENTE con un JSON válido, sin texto adicional, sin backticks, con esta estructura exacta:
{
  "bundleName": "nombre del pack detectado",
  "components": [
    { "sku": "SKU-EXACTO-DEL-CATALOGO-O-DESCRIPCION", "quantity": 1, "productName": "nombre del producto", "confidence": "high|medium|low" }
  ],
  "notes": "observaciones relevantes sobre cambios o ambigüedades"
}`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: imageType || 'image/jpeg',
                  data: imageBase64,
                },
              },
              { type: 'text', text: prompt },
            ],
          }],
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `Anthropic ${response.status}`);

      const raw = data.content?.[0]?.text || '';
      let parsed;
      try {
        parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      } catch {
        return res.status(200).json({ raw, parsed: null, error: 'No se pudo parsear el JSON de Claude' });
      }

      // Detectar drift si hay config previa
      let drift = null;
      if (currentConfig && parsed?.components) {
        const prevSkus = new Set(currentConfig.map(c => c.sku));
        const newSkus  = new Set(parsed.components.map(c => c.sku));
        const added    = [...newSkus].filter(s => !prevSkus.has(s));
        const removed  = [...prevSkus].filter(s => !newSkus.has(s));
        if (added.length || removed.length) {
          drift = { added, removed };
        }
      }

      return res.status(200).json({ parsed, drift });

    } catch (err) {
      console.error('[bundles/analyze_flyer]', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── EXPLODE CONSUMPTION ──────────────────────────────────────────────
  // Dado un mapa de ventas y una config de bundles, retorna consumo real por SKU
  if (action === 'explode') {
    const { salesMap, bundleConfig } = req.body;
    if (!salesMap || !bundleConfig) return res.status(400).json({ error: 'Faltan salesMap o bundleConfig' });

    const exploded = { ...salesMap };

    for (const bundle of bundleConfig) {
      const bundleSold = salesMap[bundle.bundleSku] || 0;
      if (!bundleSold) continue;

      for (const comp of bundle.components) {
        exploded[comp.sku] = (exploded[comp.sku] || 0) + (bundleSold * comp.quantity);
      }
    }

    return res.status(200).json({ exploded });
  }

  return res.status(400).json({ error: `Acción desconocida: ${action}` });
}
