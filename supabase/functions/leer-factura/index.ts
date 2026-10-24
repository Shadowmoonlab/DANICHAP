// Supabase Edge Function: leer-factura
// Recibe { archivo: base64, media_type, proveedor? } de un admin y devuelve los renglones leídos.
// Deploy:  supabase functions deploy leer-factura
// Secreto: supabase secrets set ANTHROPIC_API_KEY=...   (SUPABASE_URL y SUPABASE_ANON_KEY ya existen)
// Opcional: supabase secrets set LECTURA_MODELO=claude-haiku-5-5   (más barato; ver MODELOS)
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ErrorLectura, LIMITE_DIARIO_DEFECTO, leerFacturaConLimite } from '../_shared/leer-factura.js';

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

  // Límite diario y registro de consumo con el JWT de quien llama (RLS: solo admin)
  const base = {
    limite: async () => {
      const { data } = await sb.from('config_negocio').select('lecturas_ia_por_dia').eq('id', 1).maybeSingle();
      return data?.lecturas_ia_por_dia ?? LIMITE_DIARIO_DEFECTO;
    },
    contarHoy: async (desde: string) => {
      const { count, error } = await sb.from('lecturas_ia').select('id', { count: 'exact', head: true }).gte('created_at', desde);
      if (error) throw new Error(`No se pudo controlar el límite diario: ${error.message}`);
      return count ?? 0;
    },
    registrar: async (fila: Record<string, unknown>) => { await sb.from('lecturas_ia').insert(fila); },
  };

  try {
    const entrada = await req.json();
    const resultado = await leerFacturaConLimite(new Anthropic({ apiKey }), entrada, { modelo: Deno.env.get('LECTURA_MODELO'), base });
    return json(200, resultado);
  } catch (e) {
    if (e instanceof ErrorLectura) return json(e.codigo === 'entrada' ? 400 : e.codigo === 'limite_diario' ? 429 : 422, { error: e.message, codigo: e.codigo });
    if (e instanceof Anthropic.RateLimitError) return json(429, { error: 'Muchas lecturas seguidas, probá en un minuto', codigo: 'limite' });
    if (e instanceof Anthropic.APIError) return json(502, { error: `Error del servicio de lectura (${e.status})`, codigo: 'api' });
    console.error('[leer-factura]', e);
    return json(500, { error: 'Error inesperado leyendo el comprobante', codigo: 'interno' });
  }
});
