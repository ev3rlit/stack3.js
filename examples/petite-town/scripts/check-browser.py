"""Run against the dev server or dist served over HTTP. Requires Chrome, Playwright and Pillow."""

from io import BytesIO
from pathlib import Path
from math import atan2, sin, cos, pi
import json
import sys
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / "verification"
URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4318/"
errors = []


def snapshot(page):
    return page.evaluate("inspectTown()")


def angle_delta(a, b):
    return atan2(sin(a - b), cos(a - b))


def ready(page):
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.on(
        "response",
        lambda r: errors.append(f"{r.status} {r.url}") if r.status >= 400 else None,
    )
    page.goto(URL + "?inspect")
    page.wait_for_function('typeof window.inspectTown === "function"', timeout=90000)
    page.evaluate(
        "new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)))"
    )
    assert page.locator("#guide option").count() == 13


def check_fullscreen(page):
    viewport = page.viewport_size
    frame = page.locator("main").bounding_box()
    canvas = page.locator("canvas").bounding_box()
    assert frame == {"x": 0, "y": 0, **viewport}, frame
    assert canvas["x"] == 0 and canvas["width"] == viewport["width"], canvas
    assert 0 < canvas["height"] <= viewport["height"], canvas
    assert page.evaluate("document.documentElement.scrollHeight === innerHeight")
    return frame


def swipemouse(page, box, dx):
    x = box["x"] + box["width"] / 2
    y = box["y"] + box["height"] * 0.49
    page.mouse.move(x - dx / 2, y)
    page.mouse.down()
    page.mouse.move(x + dx / 2, y, steps=4)
    page.mouse.up()


def touch(cdp, phase, points):
    cdp.send(
        "Input.dispatchTouchEvent",
        {
            "type": "touch" + phase,
            "touchPoints": [
                {"x": x, "y": y, "id": i, "radiusX": 4, "radiusY": 4}
                for i, (x, y) in enumerate(points)
            ],
        },
    )


def part_point(page, part):
    record = next(m for m in snapshot(page)["meshes"] if m["key"] == part)
    x, y, _ = record["screen"]
    box = page.locator("canvas").bounding_box()
    return (box["x"] + (x + 1) * box["width"] / 2,
            box["y"] + (1 - y) * box["height"] / 2)


def verify_editor(page):
    # Pick in the town first, then isolate a repeated prop to check the GPU instance mapping.
    page.mouse.click(*part_point(page, "well/well-roof/1"))
    assert page.locator("#layer-editor").is_visible()
    assert snapshot(page)["selected"].startswith("well/")
    page.locator("#layer-close").click()
    page.select_option("#guide", "apple-crate")
    page.evaluate("new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)))")
    page.mouse.click(*part_point(page, "apple-crate/apple/5"))
    assert snapshot(page)["selected"].startswith("apple-crate/apple/")
    key = "apple-crate/apple/1"
    page.select_option("#layer-part", key)
    before = snapshot(page)
    def change(value):
        page.locator("#layer-count").fill(str(value))
        page.locator("#layer-apply").click()
        page.wait_for_function("([k,v])=>inspectTown().meshes.find(m=>m.key===k).layers===v",arg=[key,value])
    page.select_option("#texture-projection", "top-contour")
    change(56)
    edited = snapshot(page)
    assert next(m["projection"] for m in edited["meshes"] if m["key"]==key)=="top-contour"
    assert edited["triangles"] != before["triangles"]
    assert [m["layers"] for m in edited["meshes"] if m["part"]=="apple" and m["key"]!=key] == [32]*9
    assert {v["key"]:v["count"] for v in edited["batches"]} == {"crate/32":1,"apple/32":4,"apple/56/top-contour":1}
    page.locator("#layer-reset").click()
    page.wait_for_function("inspectTown().batches.length===2")
    page.select_option("#texture-projection", "top-contour")
    change(56)
    assert snapshot(page)["cache"]["built"]==edited["cache"]["built"]
    page.locator("main").screenshot(path=QA / "layer-editor.jpg",quality=90)
    page.reload()
    page.wait_for_function("typeof inspectTown==='function'",timeout=90000)
    restored = snapshot(page)
    assert restored["cache"]["built"]==0 and restored["cache"]["disk"]==len(restored["batches"])
    assert next(m["layers"] for m in restored["meshes"] if m["key"]==key)==56
    page.select_option("#guide","apple-crate")
    page.locator("#edit-open").click()
    page.select_option("#layer-part",key)
    assert page.locator("#texture-projection").input_value()=="top-contour"
    page.locator("#layer-reset").click()
    page.wait_for_function("inspectTown().batches.length===2")
    page.locator("#home").click()
    return {"changedInstance":key,"originalLayers":32,"editedLayers":56,
            "separateBatches":edited["batches"],"reloadCache":restored["cache"]}


with sync_playwright() as pw:
    browser = pw.chromium.launch(
        channel="chrome",
        headless=True,
        args=["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
    )
    desktop = browser.new_context(
        viewport={"width": 1280, "height": 900},
        device_scale_factor=1,
        reduced_motion="reduce",
    )
    page = desktop.new_page()
    ready(page)
    data = snapshot(page)
    box = page.locator("canvas").bounding_box()
    frame = check_fullscreen(page)
    page.screenshot(path=QA / "desktop.png")
    assert len(data["groups"]) == 12
    assert data["models"] == len(set(p["part"] for p in data["meshes"]))
    editor = verify_editor(page)
    matrix = QA / "scene-matrices.json"
    matrix.write_text(json.dumps(data["meshes"], indent=1) + "\n")
    zoom = data["zoom"]
    page.mouse.move(box["x"] + 200, box["y"] + 180)
    page.mouse.wheel(0, -180)
    page.wait_for_function("(z)=>inspectTown().zoom>z", arg=zoom)
    wheelzoom = snapshot(page)["zoom"]
    page.locator("#home").click()
    turns = {}
    sheet = Image.new("RGB", (4 * 218, 12 * 170), "#f5edd9")
    draw = ImageDraw.Draw(sheet)
    for row, item in enumerate(data["groups"]):
        key = item["id"]
        page.select_option("#guide", key)
        total = 0
        old = snapshot(page)["angle"]
        # OrbitControls uses viewport height and rotateSpeed .8 for horizontal turns.
        dx = box["height"] / (8 * 0.8)
        for step in range(8):
            if step % 2 == 0:
                pic = Image.open(BytesIO(page.locator("canvas").screenshot())).convert(
                    "RGB"
                )
                pic.thumbnail((200, 149))
                x = step // 2 * 218
                y = row * 170
                sheet.paste(pic, (x + (218 - pic.width) // 2, y + 18))
                draw.text((x + 8, y + 3), f"{key}   {step * 45} deg", fill="#5a5548")
            swipemouse(page, box, dx)
            a = snapshot(page)["angle"]
            total += angle_delta(a, old)
            old = a
        degrees = round(abs(total) * 180 / pi, 2)
        assert 358 <= degrees <= 362, (key, degrees)
        turns[key] = degrees
    sheet.save(QA / "orbit-review.jpg", quality=90)
    page.locator("#home").click()
    page.emulate_media(reduced_motion="no-preference")
    a = snapshot(page)["rotor"]
    page.wait_for_function("(a)=>Math.abs(inspectTown().rotor-a)>.12", arg=a)
    spin = abs(snapshot(page)["rotor"] - a)
    desktop.close()
    mobile = browser.new_context(
        viewport={"width": 390, "height": 844},
        is_mobile=True,
        has_touch=True,
        device_scale_factor=1,
        reduced_motion="reduce",
    )
    phone = mobile.new_page()
    ready(phone)
    check_fullscreen(phone)
    phone.screenshot(path=QA / "mobile.png")
    cdp = mobile.new_cdp_session(phone)
    canvas = phone.locator("canvas").bounding_box()
    x = 195
    y = canvas["y"] + canvas["height"] * 0.48
    initial = snapshot(phone)
    touch(cdp, "Start", [(x - 45, y)])
    for d in range(0, 101, 10):
        touch(cdp, "Move", [(x - 45 + d, y)])
    touch(cdp, "End", [])
    delta = abs(angle_delta(snapshot(phone)["angle"], initial["angle"]))
    assert delta > 0.2
    z = snapshot(phone)["zoom"]
    touch(cdp, "Start", [(x - 32, y), (x + 32, y)])
    for d in range(35, 77, 5):
        touch(cdp, "Move", [(x - d, y), (x + d, y)])
    touch(cdp, "End", [])
    pinch = snapshot(phone)["zoom"]
    assert pinch > z * 1.3
    phone.locator("#home").click()
    assert abs(snapshot(phone)["zoom"] - 1) < 0.002
    assert not phone.locator("#layer-editor").is_visible()
    phone.touchscreen.tap(*part_point(phone, "well/well-roof/1"))
    assert phone.locator("#layer-editor").is_visible() and snapshot(phone)["selected"].startswith("well/")
    phone.locator("#layer-close").tap()
    phone.set_viewport_size({"width": 844, "height": 390})
    landscape = check_fullscreen(phone)
    assert not errors, errors
    report = {
        "browser": browser.version,
        "desktopViewport": [1280, 900],
        "desktopFrame": frame,
        "mobileViewport": [390, 844],
        "landscapeFrame": landscape,
        "mobileInput": "Chrome CDP touch on emulated device",
        "loadedItems": len(data["groups"]),
        "distinctModels": data["models"],
        "instances": len(data["meshes"]),
        "instanceBatches": len(data["batches"]),
        "coldCache":data["cache"],
        "layerEditor":editor,
        "mouseWheelZoom": [zoom, wheelzoom],
        "orbitDegrees": turns,
        "touchOrbitRadians": delta,
        "pinchZoom": [z, pinch],
        "rotorMotionRadians": spin,
        "triangles": data["triangles"],
        "drawCalls": data["calls"],
        "errors": errors,
    }
    (QA / "browser.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    browser.close()
