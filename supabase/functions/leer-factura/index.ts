// Supabase Edge Function: leer-factura
// Recibe { archivo: base64, media_type, proveedor? } de un admin y devuelve los renglones leídos.
// Deploy:  supabase functions deploy leer-factura
// Secreto: supabase secrets set ANTHROPIC_API_KEY=...   (SUPABASE_URL y SUPABASE_ANON_KEY ya existen)
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ErrorLectura, leerFactura } from '../_shared/leer-factura.js';

const ORIGENES = ['https://danichap.com', 'https://www.danichap.com'];
let CORS: Record<string, string> = {};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const origen = req.headers.get('Origin') ?? '';
  CORS = {
    'Access-Control-Allow-Origin': ORIGENES.includes(origen) ? origen : ORIGENES[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido' });

  // Solo el admin (RLS + is_admin con el JWT de quien llama)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: esAdmin, error: errAdmin } = await sb.rpc('is_admin');
  if (errAdmin || esAdmin !== true) return json(403, { error: 'Solo el administrador puede leer comprobantes' });

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json(501, { error: 'La lectura automática no está configurada', codigo: 'ia_no_configurada' });

  try {
    const entrada = await req.json();
    const resultado = await leerFactura(new Anthropic({ apiKey }), entrada);
    return json(200, resultado);
  } catch (e) {
    if (e instanceof ErrorLectura) return json(e.codigo === 'entrada' ? 400 : 422, { error: e.message, codigo: e.codigo });
    if (e instanceof Anthropic.RateLimitError) return json(429, { error: 'Muchas lecturas seguidas, probá en un minuto', codigo: 'limite' });
    if (e instanceof Anthropic.APIError) return json(502, { error: `Error del servicio de lectura (${e.status})`, codigo: 'api' });
    console.error('[leer-factura]', e);
    return json(500, { error: 'Error inesperado leyendo el comprobante', codigo: 'interno' });
  }
});
