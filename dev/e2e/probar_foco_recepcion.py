"""Reproduce: en Recepción, escribir el costo y pasar con el mouse a Cantidad pierde lo que se tipea."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    page = b.new_page(viewport={"width": 1366, "height": 900})
    page.goto("http://localhost:8080/login.html")
    page.evaluate("localStorage.setItem('danichap-dev-usuario', 'admin')")
    page.goto("http://localhost:8080/gestion.html")
    page.wait_for_load_state("networkidle")
    page.click(".tab[data-view='recepcion']")
    page.click("button:has-text('Cargar factura o remito')")
    page.click("button:has-text('Cargar a mano')")
    costo = page.locator(".tbl-recep input[aria-label='Costo unitario']").first
    costo.click()
    page.keyboard.type("12.500")
    page.locator(".tbl-recep input[aria-label='Cantidad']").first.click()   # como Daniel: clic en el campo siguiente
    foco = page.evaluate("({conectado: document.activeElement.isConnected, campo: document.activeElement.getAttribute('aria-label')})")
    page.keyboard.press("Control+a")
    page.keyboard.type("2")
    page.keyboard.press("Tab")
    page.wait_for_timeout(300)
    cantidad = page.locator(".tbl-recep input[aria-label='Cantidad']").first.input_value()
    total = page.inner_text(".recep-total")
    print({"foco_tras_clic": foco, "cantidad": cantidad, "total": total})
    print("REPRODUCIDO: se perdió lo tipeado" if cantidad != "2" else "OK: la cantidad quedó en 2")
    b.close()
