// plan.mjs — Imprime la lista de robots activos para la matriz del workflow (lista=[...] en GITHUB_OUTPUT).
import fs from 'node:fs';
import { DISTRIBUIDORES } from './distribuidores.mjs';

const activos = DISTRIBUIDORES.filter(d => d.activo && fs.existsSync(new URL(`./${d.archivo}.mjs`, import.meta.url)));
const lista = JSON.stringify(activos.map(d => ({ slug: d.slug, archivo: d.archivo })));
console.log(`Robots activos: ${activos.map(d => d.slug).join(', ')}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `lista=${lista}\n`);
