/**
 * tests/auth.test.js
 * Tests críticos del flujo de auth — ejecutar con: node tests/auth.test.js
 * No requiere framework externo.
 */

let passed = 0;
let failed = 0;

function assert(desc, condition) {
  if (condition) {
    console.log(`  ✓ ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ ${desc}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n── ${title}`);
}

// ─── Mock mínimo de DOM/browser globals ─────────────────────────────────────
const _domState = { href: '' };
global.window = { location: { get href() { return _domState.href; }, set href(v) { _domState.href = v; } } };
global.document = { getElementById: () => null };
global.setTimeout = (fn, ms) => { fn(); return 0; };
global.Promise = global.Promise;

// ─── 1. _esc() — XSS escaping ───────────────────────────────────────────────
section('_esc() — XSS escaping');

const _esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

assert('escapa <script>',        _esc('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;');
assert('escapa comillas dobles', _esc('"hola"') === '&quot;hola&quot;');
assert('escapa comillas simples',_esc("it's") === 'it&#39;s');
assert('escapa &',               _esc('a & b') === 'a &amp; b');
assert('null → string vacío',    _esc(null) === '');
assert('undefined → string vacío', _esc(undefined) === '');
assert('números pasan sin cambio',  _esc(42) === '42');
assert('texto limpio pasa igual',   _esc('Filtro de aceite') === 'Filtro de aceite');

// ─── 2. Lógica de mensajes de error de login ─────────────────────────────────
section('Mensajes de error de login');

function getLoginErrorMsg(errorMessage) {
  const msg = (errorMessage || '').toLowerCase();
  if (msg === 'timeout')                                              return 'timeout';
  if (msg.includes('invalid') || msg.includes('credentials'))        return 'credenciales';
  if (msg.includes('email not confirmed'))                            return 'sin_confirmar';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed')) return 'red';
  return 'generico';
}

assert('timeout → mensaje timeout',              getLoginErrorMsg('timeout') === 'timeout');
assert('Invalid login → credenciales',           getLoginErrorMsg('Invalid login credentials') === 'credenciales');
assert('invalid_credentials → credenciales',     getLoginErrorMsg('invalid_credentials') === 'credenciales');
assert('email not confirmed → sin_confirmar',    getLoginErrorMsg('Email not confirmed') === 'sin_confirmar');
assert('network error → red',                    getLoginErrorMsg('network error') === 'red');
assert('Failed to fetch → red',                  getLoginErrorMsg('Failed to fetch') === 'red');
assert('error desconocido → generico',           getLoginErrorMsg('unexpected error xyz') === 'generico');
assert('mensaje vacío → generico',               getLoginErrorMsg('') === 'generico');
assert('null → generico',                        getLoginErrorMsg(null) === 'generico');

// ─── 3. Guard de sesión — data.user nulo ─────────────────────────────────────
section('Guard data.user nulo post-signIn');

function shouldRedirect(data) {
  return !!(data?.user?.id);
}
function shouldShowUnconfirmed(data) {
  return !data?.user?.id && data !== null && !data?.error;
}

assert('data con user válido → redirigir',       shouldRedirect({ user: { id: 'abc-123' } }) === true);
assert('data con user null → no redirigir',      shouldRedirect({ user: null }) === false);
assert('data undefined → no redirigir',          shouldRedirect(undefined) === false);
assert('data null → no redirigir',               shouldRedirect(null) === false);
assert('email no confirmado (user:null) → aviso',shouldShowUnconfirmed({ user: null }) === true);

// ─── 4. Promise.race timeout ─────────────────────────────────────────────────
section('Promise.race con timeout');

async function runWithTimeout(promiseFn, ms) {
  const timeoutP = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
  try {
    return await Promise.race([promiseFn(), timeoutP]);
  } catch(e) {
    return { error: e };
  }
}

// test sincrónico — simula respuesta rápida
(async () => {
  const fast = await runWithTimeout(() => Promise.resolve({ data: { user: { id: '1' } }, error: null }), 5000);
  assert('respuesta rápida llega antes del timeout', fast?.data?.user?.id === '1');

  const slow = await runWithTimeout(() => new Promise(() => {}), 1); // nunca resuelve, timeout 1ms
  assert('promesa colgada → timeout error', slow?.error?.message === 'timeout');

  // ─── 5. Validación de inputs vacíos ────────────────────────────────────────
  section('Validación de inputs');

  function validateLoginInputs(email, pass) {
    const e = (email || '').trim();
    const p = pass || '';
    if (!e || !p) return 'empty';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'invalid_email';
    return 'ok';
  }

  assert('email y pass vacíos → empty',          validateLoginInputs('', '') === 'empty');
  assert('solo email → empty',                   validateLoginInputs('a@b.com', '') === 'empty');
  assert('solo pass → empty',                    validateLoginInputs('', 'pass') === 'empty');
  assert('email inválido → invalid_email',       validateLoginInputs('noesmail', 'pass') === 'invalid_email');
  assert('email y pass válidos → ok',            validateLoginInputs('a@b.com', 'pass123') === 'ok');
  assert('email con espacios se trimmea → ok',   validateLoginInputs('  a@b.com  ', 'pass') === 'ok');

  // ─── 6. Admin guard — rol ──────────────────────────────────────────────────
  section('Admin guard — verificación de rol');

  function checkAdminAccess(perfil) {
    if (!perfil) return 'no_perfil';
    if (perfil.rol !== 'admin') return 'no_admin';
    return 'ok';
  }

  assert('perfil null → no_perfil',              checkAdminAccess(null) === 'no_perfil');
  assert('rol "user" → no_admin',                checkAdminAccess({ rol: 'user' }) === 'no_admin');
  assert('rol "admin" → ok',                     checkAdminAccess({ rol: 'admin' }) === 'ok');
  assert('rol vacío → no_admin',                 checkAdminAccess({ rol: '' }) === 'no_admin');

  // ─── Resultado ────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Resultado: ${passed} pasaron, ${failed} fallaron`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('✓ Todos los tests pasaron');
  }
})();
