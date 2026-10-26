"""End-to-end tests: run the real static app in Chromium and drive every main workflow.

Run:  pip install pytest playwright && python -m playwright install chromium && pytest tests/e2e -q
"""
from __future__ import annotations

import functools
import http.server
import threading
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
IGNORED = ("fonts.googleapis", "fonts.gstatic", "ERR_TUNNEL", "ERR_NAME_NOT_RESOLVED", "Failed to load resource")


@pytest.fixture(scope="session")
def base_url():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}/"
    srv.shutdown()


@pytest.fixture(scope="session")
def pw():
    with sync_playwright() as p:
        yield p


@pytest.fixture(scope="session")
def browser(pw):
    b = pw.chromium.launch(args=GL_ARGS)
    yield b
    b.close()


def open_app(browser, url, width=1280, height=900, **ctx):
    context = browser.new_context(viewport={"width": width, "height": height}, **ctx)
    page = context.new_page()
    errors: list[str] = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and not any(s in m.text for s in IGNORED) else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function("window.__app && window.__app.ready", timeout=30_000)
    page.wait_for_function("document.querySelectorAll('#ledgerList li').length >= 1", timeout=30_000)
    return context, page, errors


def test_loads_computes_and_recommends(browser, base_url):
    ctx, page, errors = open_app(browser, base_url)
    last = page.evaluate("window.__app.last")
    assert last["kstar"] == 3 and last["kstarPoint"] == 4
    expect(page.locator("#liveRec")).to_have_text("Recommendation: cap k = 3")
    expect(page.locator("#memoBody .verdict")).to_contain_text("cap k = 3")
    assert page.locator("#chSavings svg circle").count() == 8
    assert page.locator("#chTornado svg rect").count() >= 5
    assert "Web Worker" in page.inner_text("#status")
    assert not errors, errors
    ctx.close()


def test_mobile_layout_has_no_horizontal_scroll(browser, base_url):
    ctx, page, errors = open_app(browser, base_url, 375, 812)
    assert page.evaluate("document.documentElement.scrollWidth") <= 375
    assert not errors, errors
    ctx.close()


def test_slider_reruns_model_and_updates_decision(browser, base_url):
    ctx, page, _ = open_app(browser, base_url)
    page.locator("#qCatch").fill("95")
    page.wait_for_function("window.__app.last.params.qCatch === 0.95")
    assert page.evaluate("window.__app.last.kstar") > 3
    assert "qCatch=0.95" in page.url  # scenario is shareable via the URL
    ctx.close()


def test_url_hash_restores_scenario(browser, base_url):
    ctx, page, _ = open_app(browser, base_url + "#tasks=6&capK=2&pPair=0.01&qCatch=0.5&coldShare=0.3&seed=7")
    assert page.evaluate("window.__app.last.params") == {"tasks": 6, "capK": 2, "pPair": 0.01, "qCatch": 0.5, "coldShare": 0.3, "seed": 7}
    ctx.close()


def test_terrain_keyboard_navigation_drives_controls(browser, base_url):
    ctx, page, _ = open_app(browser, base_url)
    assert page.locator("#fallback2d").count() == 0, "WebGL terrain should be active"
    page.focus("#terrain3d")
    page.keyboard.press("ArrowRight")
    page.wait_for_function("window.__app.last.params.capK === 5")
    page.keyboard.press("ArrowUp")
    page.wait_for_function("Math.abs(window.__app.last.params.pPair - 0.008) < 1e-9")
    ctx.close()


def test_table_view_toggle(browser, base_url):
    ctx, page, _ = open_app(browser, base_url)
    page.click("#tableToggle")
    expect(page.locator("#surfaceTable tbody tr")).to_have_count(13)
    expect(page.locator("#tableToggle")).to_have_attribute("aria-pressed", "true")
    ctx.close()


def test_sql_ledger_save_query_persist_and_console_guard(browser, base_url):
    ctx, page, _ = open_app(browser, base_url)
    expect(page.locator("#ledgerList li")).to_have_count(4)  # labelled demo scenarios
    page.fill("#scName", "e2e scenario")
    page.click("#saveForm button[type=submit]")
    expect(page.locator("#ledgerList li").first).to_contain_text("e2e scenario")
    page.click("button[data-q=rule]")
    expect(page.locator("#qSql")).to_contain_text("kstar_point")
    page.click("button[data-q=stability]")
    assert page.locator("#qOut tbody tr").count() >= 1
    page.click("#ledger summary")
    page.fill("#console", "DELETE FROM scenarios")
    page.click("#runSql")
    expect(page.locator("#consoleOut .err")).to_be_visible()
    page.fill("#console", "SELECT COUNT(*) AS n FROM scenarios")
    page.click("#runSql")
    expect(page.locator("#consoleOut td")).to_have_text("5")
    # reload: IndexedDB snapshot restores the ledger
    page.reload()
    page.wait_for_function("document.querySelectorAll('#ledgerList li').length === 5", timeout=30_000)
    page.locator("button[data-load]").first.click()
    page.wait_for_function("window.__app.ready")
    ctx.close()


def test_reduced_motion_still_renders_everything(browser, base_url):
    ctx, page, errors = open_app(browser, base_url, reduced_motion="reduce")
    expect(page.locator(".reveal").first).to_have_css("opacity", "1")
    assert page.evaluate("window.__app.last.kstar") == 3
    assert not errors, errors
    ctx.close()


def test_no_webgl_falls_back_to_table(pw, base_url):
    b = pw.chromium.launch(args=["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"])
    try:
        ctx, page, errors = open_app(b, base_url)
        expect(page.locator("#fallback2d table")).to_be_visible()
        assert page.evaluate("window.__app.last.kstar") == 3
        assert not errors, errors
        ctx.close()
    finally:
        b.close()
