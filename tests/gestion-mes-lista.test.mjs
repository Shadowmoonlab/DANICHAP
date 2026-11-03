// tests/gestion-mes-lista.test.mjs — de qué mes es una lista de precios (para mostrarlo en el buscador)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mesDeLista, mesCorto } from '../gestion/listas.js';

const hoy = new Date(2026, 10, 3);   // 3 de noviembre de 2026

test('mesDeLista: el mes sale del nombre del archivo', () => {
  assert.equal(mesDeLista({ nombres: ['Ofertas Ford Septiembre 2026.pdf'] }, hoy), '2026-09');
  assert.equal(mesDeLista({ nombres: ['REPOSICIONES 17 ABRIL 2026.xls'] }, hoy), '2026-04');
  assert.equal(mesDeLista({ nombres: ['LISTA FRANCAR Nº3 - 2026   03-08-26.xls'] }, hoy), '2026-08');
  assert.equal(mesDeLista({ nombres: ['chriva agosto.xlsx'] }, hoy), '2026-08');          // sin año: el último agosto
  assert.equal(mesDeLista({ nombres: ['lista diciembre.xlsx'] }, new Date(2026, 2, 1)), '2025-12');
});

test('mesDeLista: si el nombre no dice, busca en las hojas y queda la fecha más nueva', () => {
  const hojas = [
    { nombre: '01-07-2026', filas: [['LISTA ABRIL 2023'], ['COD', 'DESCRIPCION', 'PRECIO']] },
    { nombre: 'Hoja1', filas: [['N°13 01/07/2025']] },
  ];
  assert.equal(mesDeLista({ nombres: ['1 gomez torralba.xls'], hojas }, hoy), '2026-07');
  assert.equal(mesDeLista({ nombres: ['espindola.xlsx'], hojas: [{ nombre: 'LISTA', filas: [['Fecha de modificación 03-08-2026 - LISTA N° 93']] }] }, hoy), '2026-08');
});

test('mesDeLista: números que no son fechas, fechas futuras o sin fecha → null', () => {
  const hojas = [{ nombre: 'doduco', filas: [['157V', 'PLATINO VW/FORD/GH/12-13-15- 65-69', 0]] }];
  assert.equal(mesDeLista({ nombres: ['204 SENESA.xlsx'], hojas }, hoy), null);
  assert.equal(mesDeLista({ nombres: ['lista 01-12-2026.xlsx'] }, hoy), null);           // diciembre todavía no llegó
  assert.equal(mesDeLista({ nombres: ['Lista ALMAS NUEVA.xlsx'] }, hoy), null);
});

test('mesCorto', () => {
  assert.equal(mesCorto('2026-08'), 'ago 2026');
  assert.equal(mesCorto(null), '');
});
