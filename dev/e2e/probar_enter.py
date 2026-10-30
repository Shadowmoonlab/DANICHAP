"""Enter apretado enseguida (antes de que lleguen los resultados) tiene que agregar el artículo NUEVO, nunca el anterior."""
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    page = b.new_page(viewport={"width": 1366, "height": 900})
    page.goto("http://localhost:8080/login.html")
    page.evaluate("localStorage.setItem('danichap-dev-usuario', 'admin')")
    page.goto("http://localhost:8080/gestion.html")
    page.wait_for_load_state("networkidle")
    # Deja en pantalla los resultados de una búsqueda anterior (G12347)
    page.keyboard.press("F2")
    page.keyboard.type("G12347")
    expect(page.locator("#pos-results .res").first).to_be_visible(timeout=8000)
    # Tecleo rápido + Enter sin esperar, como un vendedor apurado
    page.keyboard.press("F2")
    page.keyboard.type("G12348")
    page.keyboard.press("Enter")
    page.wait_for_timeout(2500)
    items = page.locator("#pos-items .ti").all_inner_texts()
    print({"items": [i.splitlines()[0] for i in items]})
    ok = len(items) == 1 and "12348" in items[0]
    print("OK: agregó el artículo nuevo" if ok else "FALLA: " + ("no agregó nada" if not items else "agregó otro artículo"))
    b.close()
