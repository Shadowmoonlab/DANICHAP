// gestion/main.js — Entrada del panel: acceso solo admin, pestañas, atajos de teclado e inicio de módulos.
import {
  $, closeModal, modalAbierto, mostrarVista, vistaActual, cargarConfig, cargarProveedores, actualizarBadgeRepo,
} from './core.js';
import { iniciarMostrador } from './mostrador.js';
import { iniciarReposicion } from './reposicion.js';
import { iniciarRecepcion } from './recepcion.js';
import { iniciarVentas } from './ventas.js';
import { iniciarClientes, cargarClientes } from './clientes.js';
import { iniciarProveedores } from './proveedores.js';
import { iniciarAjustes } from './ajustes.js';

const VISTAS = ['mostrador', 'reposicion', 'recepcion', 'ventas', 'clientes', 'proveedores', 'ajustes'];

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
    else if (e.key === 'F9' && vistaActual() === 'mostrador') { e.preventDefault(); $('pos-cobrar').click(); }
    else if (e.key === 'F4' && vistaActual() === 'mostrador') { e.preventDefault(); $('pos-presu').click(); }
  });
}

async function iniciar() {
  if (!(await verificarAcceso())) return;
  $('g-logout').addEventListener('click', async () => { await Auth.signOut(); window.location.href = 'index.html'; });
  $('modal-close').addEventListener('click', closeModal);
  $('modal-bg').addEventListener('click', e => { if (e.target === $('modal-bg')) closeModal(); });
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => mostrarVista(t.dataset.view)));

  await Promise.all([cargarConfig(), cargarProveedores()]);
  iniciarMostrador(); iniciarReposicion(); iniciarRecepcion(); iniciarVentas();
  iniciarClientes(); iniciarProveedores(); iniciarAjustes();
  atajos();
  cargarClientes();
  actualizarBadgeRepo();

  let inicial = 'mostrador';
  try { const v = localStorage.getItem('danichap-vista'); if (VISTAS.includes(v)) inicial = v; } catch { /* modo privado */ }
  mostrarVista(inicial);
}

iniciar();
