"""Recorrido de prueba de punta a punta (los 13 pasos de la guía de Daniel) contra el ambiente local.

Requisitos: `npm run dev` corriendo (web en http://localhost:8080) y Playwright para Python:
    python -m pip install playwright && python -m playwright install chromium
Uso:
    python dev/e2e/recorrido.py            # informe en consola, capturas en dev/e2e/capturas/
Escribe datos de prueba SOLO en la base local (ventas, un cliente y un presupuesto de prueba).
"""
import re
import sys
from datetime import date, timedelta
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

BASE = "http://localhost:8080"
CAPTURAS = Path(__file__).parent / "capturas"
CAPTURAS.mkdir(exist_ok=True)
CLIENTE = "Cliente Prueba E2E"

resultados = []
errores_consola = []


def paso(nombre):
    """Decorador: corre el paso, registra OK/FALLA y saca captura si falla (sigue con el resto)."""
    def envolver(fn):
        def correr(page):
            try:
                detalle = fn(page) or ""
                resultados.append((nombre, True, detalle))
            except Exception as e:  # noqa: BLE001 — se informa cualquier falla y se sigue
                captura = CAPTURAS / (re.sub(r"\W+", "_", nombre)[:40] + ".png")
                try:
                    page.screenshot(path=str(captura), full_page=True)
                except Exception:  # noqa: BLE001
                    pass
                resultados.append((nombre, False, f"{type(e).__name__}: {str(e).splitlines()[0][:220]} (captura: {captura.name})"))
        return correr
    return envolver


def escuchar_errores(page, donde):
    page.on("pageerror", lambda e: errores_consola.append(f"[{donde}] JS: {e}"))
    page.on("console", lambda m: m.type == "error" and errores_consola.append(f"[{donde}] consola: {m.text[:200]}"))


def ultima_venta(page):
    return page.evaluate("async () => (await _supabase.from('ventas').select('id,total,anulada,medio_pago').order('id',{ascending:false}).limit(1)).data[0]")


def vista(page, nombre):
    page.click(f".tab[data-view='{nombre}']")
    page.wait_for_load_state("networkidle")


def agregar(page, codigo):
    page.keyboard.press("F2")
    page.keyboard.type(codigo)
    page.keyboard.press("Enter")
    expect(page.locator("#pos-items .ti", has_text=codigo)).to_be_visible(timeout=8000)


def toast_con(page, texto):
    expect(page.locator(".toast, #toast-container *").filter(has_text=re.compile(texto)).first).to_be_visible(timeout=8000)


# ── Sitio público (sin sesión) ─────────────────────────────────────────────
@paso("1. Catálogo sin registrarse")
def catalogo_publico(page):
    page.goto(f"{BASE}/catalogo.html")
    page.wait_for_load_state("networkidle")
    tarjetas = page.locator(".product-card")
    expect(tarjetas.first).to_be_visible(timeout=10000)
    total = tarjetas.count()
    href = page.locator(".product-card a", has_text="Consultar precio").first.get_attribute("href")
    assert href and "wa.me" in href, f"Consultar precio no abre WhatsApp: {href}"
    gestion_visible = page.locator(".solo-admin").evaluate_all("els => els.filter(e => e.offsetParent !== null).length")
    assert gestion_visible == 0, f"{gestion_visible} botones de admin visibles para un visitante"
    page.fill("#search-text", "paragolpe")
    page.wait_for_timeout(600)
    return f"{total} productos, WhatsApp OK, sin botones de admin"


@paso("1b. Detalle: 'Agregar al carrito' pide ingresar")
def detalle_carrito(page):
    page.locator(".product-card h3").first.click()
    expect(page.locator("#pd-cart-btn")).to_be_visible(timeout=5000)
    pid = page.locator("#pd-cart-btn").get_attribute("data-producto-id")
    assert pid, "el botón del detalle no tiene data-producto-id"
    page.click("#pd-cart-btn")
    page.wait_for_timeout(800)
    return f"producto {pid[:8]}…, botón responde"


@paso("1c. Celular: sin scroll horizontal")
def celular(page):
    page.set_viewport_size({"width": 375, "height": 812})
    malas = []
    for ruta in ("index.html", "catalogo.html", "contacto.html", "login.html"):
        page.goto(f"{BASE}/{ruta}")
        page.wait_for_load_state("networkidle")
        ancho = page.evaluate("document.documentElement.scrollWidth")
        if ancho > 380:
            malas.append(f"{ruta} ({ancho}px)")
    page.set_viewport_size({"width": 1280, "height": 900})
    assert not malas, "se corre de costado en: " + ", ".join(malas)
    return "index, catálogo, contacto y login entran en 375px"


# ── Panel Gestión (admin local) ────────────────────────────────────────────
@paso("2. Entrar al panel y buscar un repuesto (Esc borra)")
def entrar_y_buscar(page):
    page.goto(f"{BASE}/login.html")
    page.evaluate("localStorage.setItem('danichap-dev-usuario', 'admin')")
    page.goto(f"{BASE}/gestion.html")
    page.wait_for_load_state("networkidle")
    expect(page.locator("#g-user")).not_to_be_empty(timeout=8000)
    page.keyboard.press("F2")
    page.keyboard.type("G12345")
    expect(page.locator("#pos-results .res").first).to_be_visible(timeout=8000)
    page.keyboard.press("Escape")
    assert page.input_value("#pos-search") == "", "Esc no borró la búsqueda"
    return "resultados en pantalla, Esc limpia"


@paso("3. 'Buscalo en sus webs'")
def webs(page):
    page.fill("#pos-search", "radiador corsa xyz")
    page.wait_for_timeout(1500)
    botones = page.locator(".pos-webs button").count()
    assert botones > 0, "no aparecen botones de webs de proveedores"
    return f"{botones} proveedores para buscar a mano"


@paso("4. Venta con precio '12.000' tecleado y F9")
def venta(page):
    page.keyboard.press("Escape")
    agregar(page, "G12345")
    page.uncheck("#pos-print")
    antes = ultima_venta(page)["id"]
    precio = page.locator("#pos-items input.pr").first
    precio.click()
    precio.press("Control+a")
    page.keyboard.type("12.000")
    page.keyboard.press("F9")
    toast_con(page, r"Venta N")
    v = ultima_venta(page)
    assert v["id"] != antes, "no se registró la venta"
    assert float(v["total"]) == 12000, f"total {v['total']} en vez de 12000"
    page.evaluate(f"window.__ventaPrueba = {v['id']}")
    return f"venta Nº {v['id']} por $12.000"


@paso("4b. Doble F9 registra una sola venta")
def doble_cobro(page):
    agregar(page, "G12346")
    antes = ultima_venta(page)["id"]
    page.keyboard.press("F9")
    page.keyboard.press("F9")
    page.wait_for_timeout(2500)
    nuevas = ultima_venta(page)["id"] - antes
    assert nuevas == 1, f"se registraron {nuevas} ventas"
    return "una sola venta"


@paso("5. Presupuesto (F4) y guardar")
def presupuesto(page):
    agregar(page, "G12347")
    page.keyboard.press("F4")
    expect(page.locator("#modal-title")).to_have_text("Presupuesto por WhatsApp", timeout=5000)
    page.click("#modal-foot button:has-text('Solo guardar')")
    toast_con(page, "Presupuesto guardado")
    page.click("#pos-clear")
    return "presupuesto guardado"


@paso("6. Fiado a un cliente y saldo en Clientes")
def fiado(page):
    vista(page, "clientes")
    ya = page.evaluate(f"async () => (await _supabase.from('clientes').select('id').eq('nombre', '{CLIENTE}')).data.length")
    if not ya:
        page.click("#cli-nuevo")
        page.locator("#modal-body input").first.fill(CLIENTE)
        page.click("#modal-foot button:has-text('Guardar')")
        page.wait_for_timeout(1000)
    vista(page, "mostrador")
    agregar(page, "G12348")
    page.fill("#pos-cliente", CLIENTE)
    page.select_option("#pos-pago", "cuenta_corriente")
    page.keyboard.press("F9")
    toast_con(page, "cuenta corriente")
    aviso_oculto = page.locator("#pos-cc-aviso").is_hidden()
    vista(page, "clientes")
    page.fill("#cli-search", CLIENTE)
    page.wait_for_timeout(800)
    fila = page.locator("#cli-body tr", has_text=CLIENTE).first
    expect(fila).to_be_visible()
    texto = fila.inner_text()
    assert "$" in texto, f"no muestra saldo: {texto}"
    assert aviso_oculto, "el cartel de fiado quedó visible después de cobrar"
    return "saldo visible: " + re.sub(r"\s+", " ", texto)[:80]


@paso("7. Recepción: carga a mano disponible")
def recepcion(page):
    vista(page, "recepcion")
    page.click("button:has-text('Cargar factura o remito')")
    expect(page.locator(".archivo-btn")).to_be_visible(timeout=5000)
    entrada = page.locator("#recepcion-trabajo input[type=file]").first
    assert entrada.get_attribute("capture") is None, "el selector abre directo la cámara (no deja elegir PDF/galería)"
    expect(page.locator("button:has-text('Cargar a mano')")).to_be_visible()
    page.click("button:has-text('Cargar a mano')")
    expect(page.locator("text=Revisá lo que llegó")).to_be_visible(timeout=5000)
    page.locator(".tbl-recep input[aria-label='Costo unitario']").first.click()
    page.keyboard.type("12.500")
    page.locator(".tbl-recep input[aria-label='Cantidad']").first.click()   # pasar de campo con el mouse
    page.keyboard.press("Control+a")
    page.keyboard.type("2")
    page.keyboard.press("Tab")
    page.wait_for_timeout(300)
    total = page.locator(".recep-total").inner_text()
    assert "25.000" in total, f"12.500 × 2 debería dar $25.000 y dio {total}"
    page.click("button:has-text('Cancelar')")
    return "editor manual OK, 12.500 × 2 = " + total


@paso("8. Reposición")
def reposicion(page):
    vista(page, "reposicion")
    expect(page.locator("#repo-list > *").first).to_be_visible(timeout=8000)
    return "lista cargada"


@paso("9. Ventas: anular la venta de prueba")
def anular(page):
    vista(page, "ventas")
    vid = page.evaluate("window.__ventaPrueba")
    assert vid, "no hay venta de prueba del paso 4"
    page.locator("#ventas-body tr", has=page.locator("td", has_text=re.compile(rf"^{vid}$"))).first.click()
    page.click("#modal-foot button:has-text('Anular')")
    page.click("#modal-foot button:text-is('Anular')")
    page.wait_for_timeout(1500)
    v = page.evaluate(f"async () => (await _supabase.from('ventas').select('anulada').eq('id', {vid})).data[0]")
    assert v["anulada"], "la venta no quedó anulada"
    return f"venta Nº {vid} anulada"


@paso("9b. Cerrar caja (Esc no traba el botón)")
def cerrar_caja(page):
    page.click("#ventas-cerrar")
    expect(page.locator("#modal-bg")).to_be_visible(timeout=5000)
    page.keyboard.press("Escape")
    expect(page.locator("#modal-bg")).to_be_hidden()
    page.click("#ventas-cerrar")
    expect(page.locator("#modal-bg")).to_be_visible(timeout=5000)
    titulo = page.inner_text("#modal-title")
    page.keyboard.press("Escape")
    return f"se abre de nuevo: «{titulo}»"


@paso("10. Libro diario: cambiar de día y 'Cargar gasto'")
def libro(page):
    vista(page, "libro")
    antes = page.inner_text("#libro-titulo")
    ayer = (date.today() - timedelta(days=1)).isoformat()
    page.fill("#libro-dia", ayer)
    page.dispatch_event("#libro-dia", "change")
    page.wait_for_timeout(1200)
    despues = page.inner_text("#libro-titulo")
    assert despues != antes, f"el título no cambió al elegir {ayer}"
    page.click("#libro-nuevo")
    expect(page.locator("#modal-bg")).to_be_visible(timeout=5000)
    page.keyboard.press("Escape")
    return f"«{antes}» → «{despues}»"


@paso("11. Proveedores")
def proveedores(page):
    vista(page, "proveedores")
    expect(page.locator("#prov-list .prov-card").first).to_be_visible(timeout=8000)
    return f"{page.locator('#prov-list .prov-card').count()} proveedores"


@paso("12. Ajustes: copia de seguridad")
def copia(page):
    vista(page, "ajustes")
    with page.expect_download(timeout=30000) as d:
        page.click("#cfg-backup")
    nombre = d.value.suggested_filename
    assert nombre.endswith(".xlsx"), nombre
    return f"descargó {nombre}"


@paso("13. Admin de productos")
def admin(page):
    page.goto(f"{BASE}/admin.html")
    page.wait_for_load_state("networkidle")
    filas = page.locator("#admin-productos-table tr")
    expect(filas.first).to_be_visible(timeout=10000)
    return f"{filas.count()} filas en la tabla"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        publico = browser.new_context(viewport={"width": 1280, "height": 900})
        page = publico.new_page()
        escuchar_errores(page, "público")
        for f in (catalogo_publico, detalle_carrito, celular):
            f(page)
        publico.close()

        panel = browser.new_context(viewport={"width": 1366, "height": 900}, accept_downloads=True)
        page = panel.new_page()
        escuchar_errores(page, "panel")
        for f in (entrar_y_buscar, webs, venta, doble_cobro, presupuesto, fiado, recepcion,
                  reposicion, anular, cerrar_caja, libro, proveedores, copia, admin):
            f(page)
        browser.close()

    ok = sum(1 for _, bien, _ in resultados if bien)
    print(f"\nRecorrido: {ok}/{len(resultados)} pasos OK\n")
    for nombre, bien, detalle in resultados:
        print(f"{'OK   ' if bien else 'FALLA'} {nombre} — {detalle}")
    ignorar = ("frame-ancestors", "X-Frame-Options")
    reales = [e for e in errores_consola if not any(i in e for i in ignorar)]
    print(f"\nErrores de consola/JS: {len(reales)}")
    for e in reales[:30]:
        print("  " + e)
    sys.exit(0 if ok == len(resultados) and not reales else 1)


if __name__ == "__main__":
    main()
