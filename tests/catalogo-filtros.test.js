/**
 * tests/catalogo-filtros.test.js
 * Tests unitarios de la lógica de filtrado del catálogo
 * Ejecutar: node tests/catalogo-filtros.test.js
 */

let passed = 0, failed = 0;
function assert(desc, cond) {
  if (cond) { console.log(`  ✓ ${desc}`); passed++; }
  else      { console.error(`  ✗ ${desc}`); failed++; }
}
function section(title) { console.log(`\n── ${title}`); }

// ── Helpers (copiados 1:1 de catalogo.js) ──────────────────────────────────
function normalizar(s) {
  return String(s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function filtrar(productos, filtros) {
  let lista = [...productos];

  if (filtros.texto) {
    const q = normalizar(filtros.texto);
    lista = lista.filter(p =>
      normalizar(p.nombre).includes(q) ||
      normalizar(p.marca_rep).includes(q) ||
      normalizar(p.modelo).includes(q) ||
      normalizar(p.descripcion).includes(q) ||
      normalizar(p.categoria).includes(q) ||
      normalizar(p.sub).includes(q)
    );
  }

  if (filtros.cat) {
    const catFilt = normalizar(filtros.cat);
    lista = lista.filter(p => normalizar(p.categoria) === catFilt);
  }

  if (filtros.sub) {
    const subFilt = normalizar(filtros.sub);
    lista = lista.filter(p => normalizar(p.sub) === subFilt);
  }

  const vehParts = [filtros.marca, filtros.modelo, filtros.version, filtros.año]
    .filter(Boolean).map(normalizar);

  if (vehParts.length > 0) {
    const modeloFilt = normalizar(filtros.modelo);
    lista = lista.filter(p => {
      if (p.modelo && modeloFilt) {
        const modelosProducto = normalizar(p.modelo)
          .split('/').map(s => s.trim()).filter(Boolean);
        return modelosProducto.some(m => m.includes(modeloFilt) || modeloFilt.includes(m));
      }
      if (!p.modelo) {
        return (p.compatibilidades || ['Universal']).some(c => {
          const cl = normalizar(c);
          if (cl.includes('universal')) return true;
          return vehParts.every(parte => cl.includes(parte));
        });
      }
      return false;
    });
  }

  if (filtros.sort === 'price-asc') {
    lista.sort((a, b) => {
      if (a.precio == null && b.precio == null) return 0;
      if (a.precio == null) return 1;
      if (b.precio == null) return -1;
      return a.precio - b.precio;
    });
  } else if (filtros.sort === 'price-desc') {
    lista.sort((a, b) => {
      if (a.precio == null && b.precio == null) return 0;
      if (a.precio == null) return 1;
      if (b.precio == null) return -1;
      return b.precio - a.precio;
    });
  } else if (filtros.sort === 'name-asc') {
    lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  }

  return lista;
}

// ── Dataset de prueba ──────────────────────────────────────────────────────
const productos = [
  { id: 1, nombre: 'Pastillas de freno',   categoria: 'frenos',       sub: 'pastillas',    marca_rep: 'Brembo', modelo: 'Corolla / Yaris', precio: 15000, descripcion: 'Pastillas cerámicas', compatibilidades: ['Universal'] },
  { id: 2, nombre: 'Filtro de aceite',     categoria: 'mecánica',     sub: 'filtros',      marca_rep: 'Bosch',  modelo: 'Corolla 2.0',      precio: 3500,  descripcion: null,                 compatibilidades: ['Universal'] },
  { id: 3, nombre: 'Bujía NGK',            categoria: 'electricidad', sub: 'bujías',       marca_rep: 'NGK',    modelo: null,               precio: 2800,  descripcion: 'Iridio',             compatibilidades: ['Universal'] },
  { id: 4, nombre: 'Disco de freno',       categoria: 'frenos',       sub: 'discos',       marca_rep: 'Brembo', modelo: 'Focus / Fiesta',   precio: null,  descripcion: null,                 compatibilidades: ['Universal'] },
  { id: 5, nombre: 'Bateria 12V',          categoria: 'electricidad', sub: 'baterías',     marca_rep: 'Moura',  modelo: null,               precio: 95000, descripcion: null,                 compatibilidades: ['Ford Focus 2015'] },
  { id: 6, nombre: 'Aceite 10W40',         categoria: 'mecánica',     sub: 'aceites',      marca_rep: 'Liqui-Moly', modelo: null,           precio: 8500,  descripcion: 'Sintético',          compatibilidades: ['Universal'] },
];

// ── Tests ──────────────────────────────────────────────────────────────────

section('1. Búsqueda texto libre');
assert('busca por nombre',            filtrar(productos, { texto: 'pastillas' }).length === 1);
assert('busca por marca_rep',         filtrar(productos, { texto: 'brembo' }).length === 2);
assert('busca por modelo',            filtrar(productos, { texto: 'corolla' }).length === 2);
assert('busca por descripción',       filtrar(productos, { texto: 'cerámicas' }).length === 1);
assert('busca sin acentos matchea',   filtrar(productos, { texto: 'ceramicas' }).length === 1);
assert('busca con acentos matchea',   filtrar(productos, { texto: 'mecánica' }).length === 2);
assert('busca mayúsculas',            filtrar(productos, { texto: 'FOCUS' }).length === 1); // solo disco (modelo) — bateria tiene Focus en compatibilidades, no indexado en búsqueda texto
assert('texto vacío devuelve todos',  filtrar(productos, { texto: '' }).length === 6);

section('2. Filtro categoría');
assert('frenos devuelve 2',           filtrar(productos, { cat: 'frenos' }).length === 2);
assert('mecánica devuelve 2',         filtrar(productos, { cat: 'mecánica' }).length === 2);
assert('case-insensitive',            filtrar(productos, { cat: 'FRENOS' }).length === 2);
assert('sin acentos matchea',         filtrar(productos, { cat: 'mecanica' }).length === 2);
assert('categoría inexistente = 0',   filtrar(productos, { cat: 'nonexistent' }).length === 0);

section('3. Filtro subcategoría');
assert('pastillas devuelve 1',        filtrar(productos, { sub: 'pastillas' }).length === 1);
assert('case-insensitive',            filtrar(productos, { sub: 'PASTILLAS' }).length === 1);

section('4. Combinación cat + sub');
assert('frenos + pastillas = 1',      filtrar(productos, { cat: 'frenos', sub: 'pastillas' }).length === 1);
assert('frenos + discos = 1',         filtrar(productos, { cat: 'frenos', sub: 'discos' }).length === 1);

section('5. Filtro vehículo (modelo campo nuevo)');
// Corolla → 2 con modelo específico (pastillas, filtro) + 2 universales (bujía, aceite) + 0 del compat Ford = 4
assert('modelo Corolla matchea 4',    filtrar(productos, { modelo: 'Corolla' }).length === 4);
// Yaris → 1 específico (pastillas) + 2 universales + bateria(compat Ford Focus 2015, no matchea Yaris) = 3
assert('modelo Yaris matchea 3',      filtrar(productos, { modelo: 'Yaris' }).length === 3);
// Focus → 1 específico (disco) + 2 universales + bateria(compat "Ford Focus 2015" matchea "focus") = 4
assert('modelo Focus matchea 4',      filtrar(productos, { modelo: 'Focus' }).length === 4);
// Corolla 2.0 → filtro aceite (modelo "Corolla 2.0" includes "corolla 2.0") ✓
// pastillas (modelo "Corolla / Yaris") — "corolla 2.0" includes "corolla" ✓ (bidireccional)
// + 2 universales = 4
assert('modelo Corolla 2.0 matchea 4',filtrar(productos, { modelo: 'Corolla 2.0' }).length === 4);
// Modelo inexistente → solo los universales (bujía, aceite) = 2
assert('modelo inexistente = solo universales',
       filtrar(productos, { modelo: 'Taxi' }).length === 2);

section('6. Productos con modelo específico vs universales');
// Si el usuario filtra por Corolla, los productos con modelo="Corolla / Yaris" matchean,
// los universales (sin modelo) NO deben matchear (el usuario quiere específico)
const corollaResult = filtrar(productos, { modelo: 'Corolla' });
assert('Pastillas (Corolla/Yaris) aparece',  corollaResult.some(p => p.id === 1));
assert('Filtro aceite (Corolla 2.0) aparece', corollaResult.some(p => p.id === 2));
// Pero la bujía (modelo:null, compat:['Universal']) también debería aparecer (es universal)
assert('Bujía universal también aparece',    corollaResult.some(p => p.id === 3));
assert('Aceite universal también aparece',   corollaResult.some(p => p.id === 6));
assert('Disco Focus NO aparece',             !corollaResult.some(p => p.id === 4));

section('7. Orden por precio');
const asc  = filtrar(productos, { sort: 'price-asc' });
const desc = filtrar(productos, { sort: 'price-desc' });
assert('asc: primero el más barato',         asc[0].precio === 2800);
assert('asc: null queda al final',           asc[asc.length - 1].precio === null);
assert('desc: primero el más caro',          desc[0].precio === 95000);
assert('desc: null queda al final (no al principio)', desc[desc.length - 1].precio === null);

section('8. Orden por nombre');
const byName = filtrar(productos, { sort: 'name-asc' });
assert('primero alfabético',                 byName[0].nombre === 'Aceite 10W40');
assert('último alfabético',                  byName[byName.length - 1].nombre === 'Pastillas de freno');

section('9. Combinación texto + cat + modelo');
const combo = filtrar(productos, { texto: 'freno', cat: 'frenos', modelo: 'Corolla' });
assert('texto freno + cat frenos + Corolla = 1 (pastillas)', combo.length === 1 && combo[0].id === 1);

console.log(`\n${'─'.repeat(40)}`);
console.log(`Resultado: ${passed} pasaron, ${failed} fallaron`);
if (failed > 0) process.exit(1);
console.log('✓ Todos los tests pasaron');
