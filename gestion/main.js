// gestion/main.js — Entrada del panel: acceso solo admin, pestañas, atajos de teclado e inicio de módulos.
import {
  $, closeModal, modalAbierto, mostrarVista, vistaActual, cargarConfig, cargarProveedores, actualizarBadgeRepo,
} from './core.js?v=14';
import { iniciarMostrador, limpiarBusqueda } from './mostrador.js?v=14';
import { iniciarReposicion } from './reposicion.js?v=14';
import { iniciarRecepcion } from './recepcion.js?v=14';
import { iniciarVentas } from './ventas.js?v=14';
import { iniciarLibro } from './libro.js?v=14';
import { iniciarClientes, cargarClientes } from './clientes.js?v=14';
import { iniciarProveedores } from './proveedores.js?v=14';
import { iniciarAjustes } from './ajustes.js?v=14';

const VISTAS = ['mostrador', 'reposicion', 'recepcion', 'ventas', 'libro', 'clientes', 'proveedores', 'ajustes'];

async function verificarAcceso() {
  const user = await Auth.getUser();
  if (!user) { window.location.href = 'login.html'; return null; }
  let perfil = null;
  for (let i = 0; i < 3 && !perfil; i++) {
    perfil = await Perfiles.get(user.id);
    if (!perfil) await new Promise(r => setTimeout(r, 600 * (i + 1)));
  }
  $('g-loading').classList.add('hidden');
  if (perfil?.rol !== 'admin') { $('g-guard').classList.remove('hidden'); return null; }
  $('g-user').textContent = perfil.nombre || user.email;
  return perfil;
}

function atajos() {
  document.addEventListener('keydown', e => {
    if (modalAbierto()) { if (e.key === 'Escape') closeModal(); return; }
    if (e.key === 'F2') { e.preventDefault(); mostrarVista('mostrador'); $('pos-search').select(); }
    // blur antes: si el cursor sigue en el precio o la cantidad del ticket, primero se aplica lo que se escribió
    else if (e.key === 'F9' && vistaActual() === 'mostrador') { e.preventDefault(); document.activeElement?.blur(); $('pos-cobrar').click(); }
    else if (e.key === 'F4' && vistaActual() === 'mostrador') { e.preventDefault(); document.activeElement?.blur(); $('pos-presu').click(); }
    // Esc funciona aunque el cursor no esté en el buscador (antes solo andaba con el foco ahí)
    // pero no si el cursor está en otro campo (cliente, cantidad, precio del ticket): ahí Esc no borra la búsqueda
    else if (e.key === 'Escape' && vistaActual() === 'mostrador'
      && !(e.target.matches?.('input, select, textarea') && e.target.id !== 'pos-search')) { e.preventDefault(); limpiarBusqueda(); }
  });
}

async function iniciar() {
  if (!(await verificarAcceso())) return;
  $('g-logout').addEventListener('click', async () => { await Auth.signOut(); window.location.href = 'index.html'; });
  $('modal-close').addEventListener('click', closeModal);
  $('modal-bg').addEventListener('click', e => { if (e.target === $('modal-bg')) closeModal(); });
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => mostrarVista(t.dataset.view)));

  await Promise.all([cargarConfig(), cargarProveedores()]);
  iniciarMostrador(); iniciarReposicion(); iniciarRecepcion(); iniciarVentas(); iniciarLibro();
  iniciarClientes(); iniciarProveedores(); iniciarAjustes();
  atajos();
  cargarClientes();
  actualizarBadgeRepo();

  let inicial = 'mostrador';
  try { const v = localStorage.getItem('danichap-vista'); if (VISTAS.includes(v)) inicial = v; } catch { /* modo privado */ }
  mostrarVista(inicial);
}

iniciar();
