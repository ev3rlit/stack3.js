# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["numpy==2.2.6", "pillow==11.3.0", "opencv-python-headless==4.11.0.86", "pyyaml==6.0.2"]
# ///
"""Verification entry point shared by the workspace CLI and the packaged executable."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import sys

import yaml
from acceptance import acceptance
from assembly import assemble
from landmarks import landmarks
from panels import atlas, read_manifest, scalar, unregistered
from projections import projections


def tolerance(config):
    value = scalar(config.get("tolerancePx", 1), "tolerancePx")
    if value < 0:
        raise ValueError("tolerancePx must be nonnegative")
    return value


def measure_atlas(data, panels, save_overlay, prefix="", check=None):
    tol = tolerance(data)
    missing = unregistered(panels)
    results = {}
    for name in ([check] if check else ["projections", "landmarks"]):
        if name == "landmarks" and not data.get("landmarks"):
            result, image = dict(status="skipped", reason="No annotated landmarks"), None
        elif name == "projections" and missing:
            result, image = dict(status="registration-needed", reason="Missing origin or scale", views=missing), None
        elif name == "projections":
            result, image = projections(panels, tol)
        else:
            result, image = landmarks(panels, data["landmarks"], tol)
        save_overlay(prefix + name, result, image)
        results[name] = result
    return dict(kind="atlas", tolerancePx=tol, results=results)


def run(args):
    path = Path(args.file).resolve()
    config = read_manifest(path)
    kind = config.get("kind")
    if kind is None:
        is_atlas = "views" in config
        is_assembly = "whole" in config and "parts" in config
        if is_atlas == is_assembly:
            raise ValueError("specify kind: atlas or assembly for this manifest")
        kind = "atlas" if is_atlas else "assembly"
    if kind not in ("atlas", "assembly") or (args.kind and kind != args.kind):
        raise ValueError("expected an atlas or assembly manifest matching the requested resource")

    out = Path(args.output_dir) if args.output_dir else None
    overlays = []
    def save_overlay(name, result, image):
        if out and image is not None:
            out.mkdir(parents=True, exist_ok=True)
            filename = name + ".png"
            path = out / filename
            image.save(path)
            result["overlay"] = filename
            if name == "atlas-guides":
                result["overlaySha256"] = sha256(path.read_bytes()).hexdigest()
            overlays.append(filename)

    if kind == "atlas":
        data, panels = atlas(path, config)
        report = measure_atlas(data, panels, save_overlay, check=args.check)
        if not args.check:
            report["acceptance"] = acceptance(data, panels, report["results"], report["tolerancePx"], save_overlay)
    else:
        parts = config["parts"]
        if not isinstance(parts, dict) or not parts or (args.part and args.part not in parts):
            raise ValueError("expected a manifest with matching named parts")
        whole_data, whole = atlas(path.parent / config["whole"])
        atlases = dict(whole=measure_atlas(whole_data, whole, save_overlay, "whole-"), parts={})
        tol = tolerance(config)
        results = {}
        missing = unregistered(whole)
        for i, (name, spec) in enumerate(parts.items(), start=1):
            if args.part and name != args.part:
                continue
            part_data, local = atlas(path.parent / spec["atlas"])
            atlases["parts"][name] = measure_atlas(part_data, local, save_overlay, f"part-{i}-")
            if missing:
                result, image = dict(status="registration-needed", reason="Missing whole registration", views=missing), None
            else:
                result, image = assemble(whole, local, spec, tol)
            save_overlay(f"assembly-{i}", result, image)
            results[name] = result
        report = dict(kind=kind, tolerancePx=tol, atlases=atlases, results=results)
    if out:
        out.mkdir(parents=True, exist_ok=True)
        report["overlays"] = overlays
    output = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)
    if out:
        (out/"report.json").write_text(output+"\n", encoding="utf8")
    print(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=["atlas", "assembly"])
    parser.add_argument("file")
    for option in ("check","part","output-dir"):
        parser.add_argument("--"+option)
    try:
        run(parser.parse_args())
    except (ValueError, KeyError, TypeError, OSError, yaml.YAMLError) as error:
        sys.exit(f"Invalid verification input: {error}")
