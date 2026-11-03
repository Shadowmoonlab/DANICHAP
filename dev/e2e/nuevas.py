"""Prueba de punta a punta de lo nuevo (listas por proveedor, PDF, búsqueda, filtros, ganancia, venta a mano, dólar).
Contra el ambiente local (npm run dev). Usa las listas reales que mandó Daniel (carpeta Descargas).
Uso: python dev/e2e/nuevas.py
"""
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

BASE = "http://localhost:8080"
DESCARGAS = Path.home() / "Downloads"
CAPTURAS = Path(__file__).parent / "capturas"
CAPTURAS.mkdir(exist_ok=True)
JOEL = Path(__file__).resolve().parents[2] / "entrega" / "listas" / "Joel-enganches.xlsx"
resultados, errores = [], []


def paso(nombre):
    def envolver(fn):
        def correr(page):
            try:
                resultados.append((nombre, True, fn(page) or ""))
            except Exception as e:  # noqa: BLE001
                cap = CAPTURAS / ("nuevas_" + re.sub(r"\W+", "_", nombre)[:40] + ".png")
                try:
                    page.screenshot(path=str(cap), full_page=True)
                except Exception:  # noqa: BLE001
                    pass
                resultados.append((nombre, False, f"{type(e).__name__}: {str(e).splitlines()[0][:230]} ({cap.name})"))
        return correr
    return envolver


def vista(page, v):
    page.click(f".tab[data-view='{v}']")
    page.wait_for_load_state("networkidle")


def contar(page, slug):
    return page.evaluate(f"async () => (await _supabase.from('precios_distribuidor').select('id', {{count:'exact', head:true}}).eq('distribuidor','{slug}').eq('activo', true)).count")


def importar(page, slug, archivos, moneda=None, reemplazar=False):
    # Espera el aviso de ESTE proveedor (el de una importación anterior puede seguir en pantalla)
    page.evaluate("document.querySelectorAll('#toast-container > *').forEach(t => t.remove())")
    vista(page, "proveedores")
    tarjeta = page.locator(".prov-card", has=page.locator("h3", has_text=re.compile(rf"^{re.escape(slug)}$", re.I)))
    tarjeta.locator("button", has_text="Lista").click()
    expect(page.locator("#modal-title")).to_contain_text("Lista de precios", timeout=5000)
    page.locator("#modal-body input[type=file]").set_input_files([str(a) for a in archivos])
    expect(page.locator("#modal-body .aviso")).to_be_visible(timeout=60000)
    aviso = page.inner_text("#modal-body .aviso")
    if moneda:
        page.locator("#modal-body select").first.select_option(moneda)
    casilla = page.locator("#modal-body label.check", has_text="Reemplaza").locator("input")
    if casilla.is_checked() != reemplazar:
        casilla.click()
    page.click("#modal-foot button:has-text('Importar')")
    # Al cambiar la moneda (o si se pidió reemplazar) el panel pide confirmar el reemplazo de la lista
    if reemplazar or moneda:
        page.click("#modal-foot button:has-text('Sí, reemplazar')")
    expect(page.locator("#toast-container *").filter(has_text=re.compile(rf"Lista de {re.escape(slug)}.*productos")).first).to_be_visible(timeout=180000)
    return aviso


@paso("Entrar al panel")
def entrar(page):
    page.goto(f"{BASE}/login.html")
    page.evaluate("localStorage.setItem('danichap-dev-usuario', 'admin')")
    page.goto(f"{BASE}/gestion.html")
    page.wait_for_load_state("networkidle")
    expect(page.locator("#g-user")).not_to_be_empty(timeout=8000)


@paso("Importar Francar (Excel, 17 hojas) desde su tarjeta")
def francar(page):
    aviso = importar(page, "Francar", [DESCARGAS / "LISTA FRANCAR Nº3 - 2026   03-08-26.xls"], reemplazar=True)
    n = contar(page, "francar")
    assert n >= 600, f"quedaron {n} activos"
    return f"{n} productos · vista previa: {aviso[:90]}"


@paso("Importar Gómez Torralba (2 archivos juntos)")
def gomez(page):
    importar(page, "Gómez Torralba", [DESCARGAS / "1 gomez torralba.xls", DESCARGAS / "gomez toralba especiales.xlsx"])
    n = contar(page, "gomeztorralba")
    assert n >= 130, f"quedaron {n}"
    return f"{n} productos de los dos archivos"


@paso("Importar Liqui Moly (2 PDF)")
def liqui(page):
    importar(page, "Liqui Moly (DAZ)", [DESCARGAS / "LIQUI MOLI ACEITES.pdf", DESCARGAS / "LIQUI MOLI ADITIVOS.pdf"])
    n = contar(page, "liquimoly")
    assert n >= 120, f"quedaron {n}"
    fila = page.evaluate("async () => (await _supabase.from('precios_distribuidor').select('codigo,descripcion,precio_neto').eq('distribuidor','liquimoly').eq('codigo','8909')).data[0]")
    assert fila and float(fila["precio_neto"]) == 153639, f"8909 mal leído: {fila}"
    return f"{n} productos · 8909 = ${fila['precio_neto']}"


@paso("Importar Reposiciones (9.500 artículos, por lotes)")
def reposiciones(page):
    importar(page, "Reposiciones", [DESCARGAS / "REPOSICIONES 17 ABRIL 2026.xls"])
    n = contar(page, "reposiciones")
    assert n >= 9000, f"quedaron {n}"
    return f"{n} productos"


@paso("Importar Mello (5 PDF de ofertas)")
def mello(page):
    archivos = [DESCARGAS / f"Ofertas {m} Septiembre 2026.pdf" for m in ("Fiat", "Chevrolet", "Ford", "Renault", "Volkswagen")]
    importar(page, "Mello", archivos)
    n = contar(page, "mello")
    assert n >= 250, f"quedaron {n}"
    return f"{n} productos"


@paso("Importar Joel en dólares: se ve en pesos con la cotización")
def joel_dolares(page):
    importar(page, "Joel Enganches", [JOEL], moneda="USD")
    cot = page.evaluate("async () => (await _supabase.from('config_negocio').select('cotizacion_usd').eq('id',1)).data[0].cotizacion_usd")
    vista(page, "mostrador")
    page.keyboard.press("F2")
    page.keyboard.type("malacate 400")
    expect(page.locator("#pos-results .res").first).to_be_visible(timeout=8000)
    costo = page.locator("#pos-results .res", has_text="Malacate").first.locator(".pc").inner_text()
    esperado = f"{int(42000 * float(cot)):,}".replace(",", ".")
    assert esperado in costo.replace(" ", " "), f"costo mostrado {costo!r}, esperado {esperado}"
    return f"US$ 42000 × {cot} → {costo.strip()}"


@paso("Cambiar la cotización en Ajustes actualiza el precio")
def cotizacion(page):
    vista(page, "ajustes")
    page.fill("#cfg-usd", "1.500")
    page.click("#cfg-guardar")
    page.wait_for_timeout(800)
    vista(page, "mostrador")
    page.keyboard.press("F2")
    page.keyboard.type("malacate 400")
    page.wait_for_timeout(1500)
    costo = page.locator("#pos-results .res", has_text="Malacate").first.locator(".pc").inner_text()
    assert "63.000.000" in costo.replace(" ", " "), f"con dólar 1500 esperaba 63.000.000, vi {costo!r}"
    # vuelve todo como estaba (Joel en pesos, dólar 1400)
    page.evaluate("async () => { await _supabase.from('proveedores').update({moneda:'ARS'}).eq('slug','joel'); await _supabase.from('config_negocio').update({cotizacion_usd:1400}).eq('id',1); }")
    return costo.strip()


@paso("Búsqueda exacta: 'gol' no trae paragolpes; orden por la primera palabra")
def busqueda(page):
    page.goto(f"{BASE}/gestion.html")
    page.wait_for_load_state("networkidle")
    page.keyboard.press("F2")
    page.keyboard.type("alma de paragolpe agile")
    expect(page.locator("#pos-results .res").first).to_be_visible(timeout=8000)
    primero = page.locator("#pos-results .res .desc").first.inner_text()
    assert primero.upper().startswith("ALMA"), f"primer resultado: {primero}"
    page.keyboard.press("Escape")
    page.keyboard.type("cola")
    page.wait_for_timeout(1500)
    textos = page.locator("#pos-results .res .desc").all_inner_texts()
    assert textos and all(re.search(r"(^|\s)cola", t, re.I) for t in textos), f"resultados que no empiezan palabra con 'cola': {[t for t in textos if not re.search(r'(^|\s)cola', t, re.I)][:3]}"
    return f"'{primero[:45]}' primero; {len(textos)} resultados con 'cola' como palabra"


@paso("Filtro por proveedor")
def filtros(page):
    page.keyboard.press("Escape")
    page.keyboard.type("paragolpe")
    expect(page.locator("#pos-filtros .filtro").first).to_be_visible(timeout=8000)
    botones = page.locator("#pos-filtros .filtro").all_inner_texts()
    francar = page.locator("#pos-filtros .filtro", has_text="Francar")
    francar.click()
    origenes = set(page.locator("#pos-results .res .meta .chip").first.all_inner_texts())
    todos = page.locator("#pos-results .res .meta .chip:first-child").all_inner_texts()
    assert todos and all(t.strip().upper() == "FRANCAR" for t in todos), f"con el filtro Francar aparecen: {set(todos)}"
    page.keyboard.press("Enter")
    expect(page.locator("#pos-items .ti").first).to_be_visible(timeout=5000)
    return f"botones: {', '.join(b.replace(chr(10), ' ') for b in botones[:5])}…"


@paso("Ganancia en el ticket: elegir 50% y 'a toda la venta'")
def ganancia(page):
    linea = page.locator("#pos-items .ti").first
    linea.locator("button.gan").click()
    expect(page.locator(".gan-selector")).to_be_visible()
    op = page.locator(".gan-op", has_text="50%")
    precio_op = op.locator("span").inner_text()
    op.click()
    precio = page.input_value("#pos-items .ti input.pr")
    chip = page.locator("#pos-items .ti button.gan").first.inner_text()
    assert "50%" in chip, f"chip después de elegir 50%: {chip}"
    return f"50% → {precio_op} (input {precio}) · {chip}"


@paso("Vender a mano (no está en las listas) y cobrar")
def a_mano(page):
    page.click("#pos-manual")
    expect(page.locator("#modal-title")).to_have_text("Vender algo que no está en las listas")
    page.fill("#modal-body input[aria-label='Qué se vende']", "Trabajo de soldadura")
    page.fill("#modal-body input[aria-label='Costo']", "10.000")
    page.fill("#modal-body input[aria-label='Ganancia %']", "50")
    page.locator("#modal-body input[aria-label='Ganancia %']").dispatch_event("input")
    precio = page.input_value("#modal-body input[aria-label='Precio de venta']")
    assert precio in ("15000", "15.000"), f"precio calculado {precio}"
    page.click("#modal-foot button:has-text('Agregar a la venta')")
    expect(page.locator("#pos-items .ti", has_text="Trabajo de soldadura")).to_be_visible()
    page.uncheck("#pos-print")
    page.keyboard.press("F9")
    expect(page.locator(".toast, #toast-container *").filter(has_text=re.compile("Venta N")).first).to_be_visible(timeout=8000)
    item = page.evaluate("async () => (await _supabase.from('venta_items').select('descripcion,precio_unit,costo_unit').eq('descripcion','Trabajo de soldadura').order('id',{ascending:false}).limit(1)).data[0]")
    assert item and float(item["precio_unit"]) == 15000 and float(item["costo_unit"]) == 10000, f"guardado: {item}"
    return f"vendido: {item}"


@paso("Errores de tipeo: 'paragople agil' encuentra parecidos y lo avisa")
def tipeo(page):
    vista(page, "mostrador")
    page.keyboard.press("F2")
    page.keyboard.press("Control+a")
    page.keyboard.type("alma paragople agil")
    expect(page.locator(".aviso-parecidos")).to_be_visible(timeout=8000)
    primero = page.locator("#pos-results .res .desc").first.inner_text()
    assert "PARAGOLPE" in primero.upper() and "AGILE" in primero.upper(), f"primer parecido: {primero}"
    return f"parecido: {primero[:50]}"


@paso("Resaltado de lo buscado y búsquedas recientes")
def resaltado(page):
    page.keyboard.press("Control+a")
    page.keyboard.type("alma agile")
    expect(page.locator("#pos-results .res mark").first).to_be_visible(timeout=8000)
    marcas = page.locator("#pos-results .res").first.locator("mark").all_inner_texts()
    assert marcas and all(" " not in m.strip() for m in marcas), f"tiene que marcar palabras sueltas, marcó: {marcas}"
    page.keyboard.press("Enter")
    page.keyboard.press("Escape")
    expect(page.locator(".recientes .filtro").first).to_be_visible(timeout=3000)
    reciente = page.locator(".recientes .filtro").first.inner_text()
    assert reciente == "alma agile", f"reciente: {reciente}"
    return f"marcado: {marcas} · reciente: {reciente}"


@paso("Celular: Buscar y vender y Proveedores sin correrse de costado")
def celular(page):
    page.set_viewport_size({"width": 390, "height": 844})
    malas = []
    for v in ("mostrador", "proveedores"):
        vista(page, v)
        page.wait_for_timeout(500)
        ancho = page.evaluate("document.documentElement.scrollWidth")
        page.screenshot(path=str(CAPTURAS / f"celular_{v}.png"))
        if ancho > 395:
            malas.append(f"{v} ({ancho}px)")
    page.set_viewport_size({"width": 1366, "height": 900})
    assert not malas, "se corre de costado: " + ", ".join(malas)
    return "entra en 390px (capturas en dev/e2e/capturas)"


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        page = b.new_page(viewport={"width": 1366, "height": 900})
        page.on("pageerror", lambda e: errores.append(f"JS: {e}"))
        page.on("console", lambda m: m.type == "error" and not any(x in m.text for x in ("frame-ancestors", "X-Frame")) and errores.append(f"consola: {m.text[:200]}"))
        for f in (entrar, francar, gomez, liqui, reposiciones, mello, joel_dolares, cotizacion, busqueda, filtros, ganancia, a_mano, tipeo, resaltado, celular):
            f(page)
        b.close()
    ok = sum(1 for _, bien, _ in resultados if bien)
    print(f"\nNuevas funciones: {ok}/{len(resultados)} OK\n")
    for n, bien, d in resultados:
        print(f"{'OK   ' if bien else 'FALLA'} {n} — {d}")
    print(f"\nErrores de consola/JS: {len(errores)}")
    for e in errores[:20]:
        print("  " + e)
    sys.exit(0 if ok == len(resultados) and not errores else 1)


if __name__ == "__main__":
    main()
