// Supabase Edge Function: leer-factura
// Recibe { archivo: base64, media_type, proveedor? } de un admin y devuelve los renglones leídos.
// Deploy:  supabase functions deploy leer-factura
// Secreto: supabase secrets set ANTHROPIC_API_KEY=...   (SUPABASE_URL y SUPABASE_ANON_KEY ya existen)
// Gratis:   supabase secrets set GEMINI_API_KEY=...   (Google AI Studio; si está, se usa en lugar de Claude)
// Opcional: supabase secrets set LECTURA_MODELO=claude-haiku-5-5   (más barato; ver MODELOS)
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';   // misma versión que se probó en local
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ErrorLectura, LIMITE_DIARIO_DEFECTO, leerFacturaConLimite, leerFacturaGemini } from '../_shared/leer-factura.js';

const ORIGENES = ['https://danichap.com', 'https://www.danichap.com'];

Deno.serve(async (req) => {
  const origen = req.headers.get('Origin') ?? '';
  // Por pedido (no global): con dos pedidos a la vez de orígenes distintos no se mezclan los encabezados
  const CORS: Record<string, string> = {
    'Access-Control-Allow-Origin': ORIGENES.includes(origen) ? origen : ORIGENES[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido' });

  // Solo el admin (RLS + is_admin con el JWT de quien llama)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: esAdmin, error: errAdmin } = await sb.rpc('is_admin');
  if (errAdmin || esAdmin !== true) return json(403, { error: 'Solo el administrador puede leer comprobantes' });

  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!geminiKey && !apiKey) return json(501, { error: 'La lectura automática no está configurada', codigo: 'ia_no_configurada' });

  // Límite diario y registro de consumo con el JWT de quien llama (RLS: solo admin)
  const base = {
    limite: async () => {
      const { data } = await sb.from('config_negocio').select('lecturas_ia_por_dia').eq('id', 1).maybeSingle();
      return data?.lecturas_ia_por_dia ?? LIMITE_DIARIO_DEFECTO;
    },
    contarHoy: async (desde: string, hastaId?: number) => {
      // Una reserva "leyendo" de hace más de 3 min es de una lectura que se cortó (la función murió antes de liberarla): no cuenta
      const hace3min = new Date(Date.now() - 180_000).toISOString();
      let q = sb.from('lecturas_ia').select('id', { count: 'exact', head: true }).gte('created_at', desde)
        .or(`modelo.is.null,modelo.neq.leyendo,created_at.gt.${hace3min}`);
      if (hastaId) q = q.lte('id', hastaId);
      const { count, error } = await q;
      if (error) throw new Error(`No se pudo controlar el límite diario: ${error.message}`);
      return count ?? 0;
    },
    reservar: async () => {
      const { data, error } = await sb.from('lecturas_ia').insert({ modelo: 'leyendo' }).select('id').single();
      if (error) throw new Error(`No se pudo reservar la lectura: ${error.message}`);
      return data.id;
    },
    liberar: async (id: number) => { await sb.from('lecturas_ia').delete().eq('id', id); },
    completar: async (id: number, fila: Record<string, unknown>) => { await sb.from('lecturas_ia').update(fila).eq('id', id); },
  };

  try {
    const entrada = await req.json().catch(() => { throw new ErrorLectura('El pedido llegó mal armado', 'entrada'); });
    const resultado = geminiKey
      ? await leerFacturaConLimite(null, entrada, { base, lector: (_c: unknown, e: any) => leerFacturaGemini(geminiKey, e, { modelo: Deno.env.get('GEMINI_MODELO') }) })
      : await leerFacturaConLimite(new Anthropic({ apiKey, timeout: 100_000, maxRetries: 0 }), entrada, { modelo: Deno.env.get('LECTURA_MODELO'), base });
    return json(200, resultado);
  } catch (e) {
    if (e instanceof ErrorLectura) return json(e.codigo === 'entrada' ? 400 : e.codigo === 'limite_diario' || e.codigo === 'limite' ? 429 : e.codigo === 'api' ? 502 : e.codigo === 'demora' ? 504 : 422, { error: e.message, codigo: e.codigo });
    if (e instanceof Anthropic.RateLimitError) return json(429, { error: 'Muchas lecturas seguidas, probá en un minuto', codigo: 'limite' });
    if (e instanceof Anthropic.APIError) return json(502, { error: `Error del servicio de lectura (${e.status})`, codigo: 'api' });
    console.error('[leer-factura]', e);
    return json(500, { error: 'Error inesperado leyendo el comprobante', codigo: 'interno' });
  }
});
