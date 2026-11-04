#!/usr/bin/env python3
"""Inventory character sheets without inventing missing animation metadata.

Requires Pillow. The six catalog grids are measured as declared; a cell is not
therefore a verified animation frame. Unknown sheets retain null grid fields.
All coordinates are zero based, with exclusive right/bottom bounds.
"""

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public" / "assets"
THRESHOLDS = (0, 16, 32)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def bounds(alpha, threshold=0):
    mask = alpha if threshold == 0 else alpha.point(lambda value: 255 if value > threshold else 0)
    rectangle = mask.getbbox()
    if rectangle is None:
        return None
    left, top, right, bottom = rectangle
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


def edges(rectangle, width, height):
    if rectangle is None:
        return []
    return [name for name, touching in (
        ("left", rectangle["x"] == 0),
        ("top", rectangle["y"] == 0),
        ("right", rectangle["x"] + rectangle["width"] == width),
        ("bottom", rectangle["y"] + rectangle["height"] == height),
    ) if touching]


def pixel_hash(image):
    # Ignore RGB stored under fully transparent pixels, but preserve every
    # nontransparent RGBA value. This compares decoded pixels, not WebP bytes.
    mask = image.getchannel("A").point(lambda value: 255 if value else 0)
    normalized = Image.composite(image, Image.new("RGBA", image.size), mask)
    return digest(normalized.tobytes())


def frame_data(image, row, column):
    alpha = image.getchannel("A")
    histogram = alpha.histogram()
    boxes = {str(level): bounds(alpha, level) for level in THRESHOLDS}
    return {
        "row": row,
        "column": column,
        "bounds": boxes["0"],
        "boundsByAlphaThreshold": boxes,
        "pixels": sum(histogram[1:]),
        "pixelsAbove16": sum(histogram[17:]),
        "pixelsAbove32": sum(histogram[33:]),
        "hash": pixel_hash(image),
        "touchingEdgesByAlphaThreshold": {
            str(level): edges(boxes[str(level)], *image.size) for level in THRESHOLDS
        },
        "mappedActions": [],
    }


def validate_catalog(catalog, findings):
    """Validate before any range/crop; bool is deliberately not an integer."""
    entries = catalog.get("fighters") if isinstance(catalog, dict) else None
    if not isinstance(entries, list):
        findings.append({"severity": "error", "code": "invalid-fighters-list"})
        return {}, {}, {}
    fighters, valid_grids, valid_actions = {}, {}, {}
    for index, fighter in enumerate(entries):
        if not isinstance(fighter, dict) or not isinstance(fighter.get("id"), str) or not fighter["id"]:
            findings.append({"severity": "error", "code": "invalid-fighter-id", "index": index})
            continue
        identifier = fighter["id"]
        if identifier in fighters:
            findings.append({"severity": "error", "code": "duplicate-fighter-id", "character": identifier})
            continue
        fighters[identifier] = fighter
        if not isinstance(fighter.get("path"), str) or not fighter["path"]:
            findings.append({"severity": "error", "code": "invalid-fighter-path", "character": identifier})
        invalid_dimensions = [field for field in ("frameWidth", "frameHeight", "columns", "rows")
                              if type(fighter.get(field)) is not int or fighter[field] < 1]
        valid_grids[identifier] = not invalid_dimensions
        if invalid_dimensions:
            findings.append({"severity": "error", "code": "invalid-grid-fields",
                             "character": identifier, "fields": invalid_dimensions,
                             "message": "Grid dimensions must be positive integers; booleans are invalid."})
        valid_actions[identifier] = {}
        animations = fighter.get("animations")
        if not isinstance(animations, dict) or not animations:
            findings.append({"severity": "error", "code": "invalid-animations-map", "character": identifier})
            continue
        for action, animation in animations.items():
            invalid_fields = [field for field, minimum in (("row", 0), ("startColumn", 0), ("frames", 1))
                              if not isinstance(animation, dict)
                              or type(animation.get(field)) is not int or animation[field] < minimum]
            if invalid_fields:
                findings.append({"severity": "error", "code": "invalid-animation-fields",
                                 "character": identifier, "action": action, "fields": invalid_fields,
                                 "message": "Animation row/startColumn must be nonnegative integers and frames a positive integer; booleans are invalid."})
                continue
            if valid_grids[identifier] and (animation["row"] >= fighter["rows"]
                                            or animation["startColumn"] + animation["frames"] > fighter["columns"]):
                findings.append({"severity": "error", "code": "mapped-out-of-bounds",
                                 "character": identifier, "action": action,
                                 "row": animation["row"], "startColumn": animation["startColumn"],
                                 "frames": animation["frames"]})
                continue
            valid_actions[identifier][action] = animation
    return fighters, valid_grids, valid_actions


def audit():
    catalog = json.loads((ASSETS / "catalog.json").read_text())
    findings = []
    fighters, valid_grids, valid_actions = validate_catalog(catalog, findings)
    sources = {}
    for manifest in ASSETS.glob("manifest_parte_*.json"):
        for entry in json.loads(manifest.read_text())["files"]:
            sources[entry["path"]] = entry

    characters = []
    hashes = defaultdict(list)
    visited_paths, visited_characters, declared_characters = set(), set(), set()
    for directory in sorted((ASSETS / "characters").iterdir()):
        if not directory.is_dir():
            continue
        fighter = fighters.get(directory.name)
        visited_characters.add(directory.name)
        character = {"id": directory.name, "playable": fighter is not None,
                     "catalog": fighter, "atlases": []}
        for path in sorted(directory.glob("*.webp")):
            relative = path.relative_to(ROOT / "public").as_posix()
            visited_paths.add(relative)
            file_hash = digest(path.read_bytes())
            with Image.open(path) as source:
                image = source.convert("RGBA")
            width, height = image.size
            alpha = image.getchannel("A")
            declared = fighter if fighter and fighter.get("path") == relative else None
            if declared:
                declared_characters.add(directory.name)
            atlas = {
                "path": relative, "width": width, "height": height,
                "sha256": file_hash,
                "source": sources.get(relative, {}).get("source"),
                "manifestSha256Matches": file_hash == sources.get(relative, {}).get("sha256"),
                "bounds": bounds(alpha),
                "boundsByAlphaThreshold": {str(level): bounds(alpha, level) for level in THRESHOLDS},
                "touchingCanvasEdgesByAlphaThreshold": {
                    str(level): edges(bounds(alpha, level), width, height) for level in THRESHOLDS
                },
                "frameWidth": None, "frameHeight": None,
                "columns": None, "rows": None,
                "gridConfidence": "unknown",
                "gridBasis": "No frame rectangles, animation sequences, or pivots supplied for this sheet.",
                "frames": [], "animations": {},
                "mappedFrameCount": 0, "unmappedCellCount": None,
            }
            if declared and not valid_grids[directory.name]:
                atlas.update({"gridConfidence": "catalog-invalid",
                              "gridBasis": "Catalog grid failed positive-integer validation; no cells cropped."})
            elif declared:
                fw, fh = declared["frameWidth"], declared["frameHeight"]
                columns, rows = declared["columns"], declared["rows"]
                atlas.update({"frameWidth": fw, "frameHeight": fh, "columns": columns,
                              "rows": rows, "gridConfidence": "catalog-declared",
                              "gridBasis": "Catalog grid; action meanings remain visually inferred. Unmapped cells may contain mixed poses or cross cell boundaries."})
                if (width, height) != (fw * columns, fh * rows):
                    findings.append({"severity": "error", "code": "grid-dimensions",
                                     "character": directory.name, "path": relative,
                                     "message": "Declared catalog grid does not match image dimensions."})
                else:
                    for row in range(rows):
                        for column in range(columns):
                            cell = image.crop((column * fw, row * fh, (column + 1) * fw, (row + 1) * fh))
                            atlas["frames"].append(frame_data(cell, row, column))
                    indexed = {(frame["row"], frame["column"]): frame for frame in atlas["frames"]}
                    for action, animation in valid_actions[directory.name].items():
                        references = []
                        for column in range(animation["startColumn"], animation["startColumn"] + animation["frames"]):
                            key = (animation["row"], column)
                            frame = indexed.get(key)
                            references.append({"row": key[0], "column": key[1], "inBounds": frame is not None})
                            if frame is None:
                                findings.append({"severity": "error", "code": "mapped-out-of-bounds",
                                                 "character": directory.name, "path": relative,
                                                 "action": action, "row": key[0], "column": key[1]})
                            else:
                                frame["mappedActions"].append(action)
                                if not frame["pixels"]:
                                    findings.append({"severity": "error", "code": "mapped-empty",
                                                     "character": directory.name, "path": relative,
                                                     "action": action, "row": key[0], "column": key[1]})
                        atlas["animations"][action] = {**animation, "frameReferences": references}
                    atlas["mappedFrameCount"] = sum(bool(frame["mappedActions"]) for frame in atlas["frames"])
                    atlas["unmappedCellCount"] = len(atlas["frames"]) - atlas["mappedFrameCount"]
                    atlas["emptyCellCount"] = sum(not frame["pixels"] for frame in atlas["frames"])
                    atlas["edgeTouchCounts"] = {
                        str(level): sum(bool(frame["touchingEdgesByAlphaThreshold"][str(level)]) for frame in atlas["frames"])
                        for level in THRESHOLDS
                    }
                    for frame in atlas["frames"]:
                        if frame["pixels"]:
                            hashes[(fw, fh, frame["hash"])].append({"character": directory.name,
                                                                  "path": relative, "row": frame["row"],
                                                                  "column": frame["column"], "mappedActions": frame["mappedActions"]})
                    atlas["pivotAudit"] = pivot_audit({**declared, "animations": valid_actions[directory.name]}, atlas["frames"])
            else:
                findings.append({"severity": "unverified", "code": "missing-frame-metadata",
                                 "character": directory.name, "path": relative,
                                 "message": "No authored grid/frame rectangles, animation mapping, or pivots available; no frames inferred from dimensions alone."})
            character["atlases"].append(atlas)
        if fighter is None:
            findings.append({"severity": "unimplemented", "code": "not-playable",
                             "character": directory.name,
                             "message": "Character assets exist but are not included in the playable catalog."})
        characters.append(character)

    for identifier, fighter in fighters.items():
        if identifier not in visited_characters:
            findings.append({"severity": "error", "code": "missing-character-directory", "character": identifier})
        if not isinstance(fighter.get("path"), str) or fighter["path"] not in visited_paths:
            findings.append({"severity": "error", "code": "missing-catalog-texture",
                             "character": identifier, "path": fighter.get("path"),
                             "message": "The catalog texture was not visited in the character WebP inventory."})
        if identifier not in declared_characters:
            findings.append({"severity": "error", "code": "unvisited-catalog-grid",
                             "character": identifier, "path": fighter.get("path"),
                             "message": "No inventoried atlas matched this character's declared texture and directory."})

    duplicates = [{"frameWidth": key[0], "frameHeight": key[1], "hash": key[2], "occurrences": values}
                  for key, values in hashes.items() if len(values) > 1]
    atlases = [atlas for character in characters for atlas in character["atlases"]]
    cells = [frame for atlas in atlases for frame in atlas["frames"]]
    return {
        "schemaVersion": 1,
        "provenance": {
            "inputs": [
                {"path": path.relative_to(ROOT).as_posix(), "sha256": digest(path.read_bytes())}
                for path in [ASSETS / "catalog.json", ROOT / "src" / "main.js",
                             *sorted(ASSETS.glob("manifest_parte_*.json"))]
            ],
            "characterAssetHashes": "Each atlas includes its current SHA256. Regenerate after any source/catalog/rendering change.",
        },
        "method": {
            "coordinates": "Zero-based row/column; alpha bounds use exclusive right/bottom.",
            "pixelHash": "SHA256 of decoded RGBA, RGB under alpha=0 normalized to zero; dimensions included when grouping duplicates.",
            "edgeWarning": "Alpha touching a cell edge is a review flag, not proof of clipping or an incorrect grid.",
            "unknownSheets": "No cell segmentation for sheets absent from catalog. Whole-sheet alpha bounds and file hashes only.",
            "scope": "All character WebP files; six catalog-declared grids; source semantics are inferred, never original authored frame data.",
        },
        "summary": {
            "characters": len(characters), "playableCharacters": len(fighters),
            "atlases": len(atlases), "catalogGrids": sum(bool(atlas["frames"]) for atlas in atlases),
            "unknownGridAtlases": sum(atlas["gridConfidence"] == "unknown" for atlas in atlases),
            "declaredCatalogAtlases": len(declared_characters),
            "catalogGridCells": len(cells), "mappedCells": sum(bool(frame["mappedActions"]) for frame in cells),
            "emptyCells": sum(not frame["pixels"] for frame in cells),
            "mappedEmptyCells": sum(bool(frame["mappedActions"]) and not frame["pixels"] for frame in cells),
            "mappedEdgeTouchAbove32": sum(bool(frame["mappedActions"]) and bool(frame["touchingEdgesByAlphaThreshold"]["32"]) for frame in cells),
            "edgeTouchCountsByAlphaThreshold": {
                str(level): sum(bool(frame["touchingEdgesByAlphaThreshold"][str(level)]) for frame in cells)
                for level in THRESHOLDS
            },
            "mappedEdgeTouchCountsByAlphaThreshold": {
                str(level): sum(bool(frame["mappedActions"]) and bool(frame["touchingEdgesByAlphaThreshold"][str(level)]) for frame in cells)
                for level in THRESHOLDS
            },
            "duplicateGroups": len(duplicates),
            "crossCharacterDuplicateGroups": sum(len({item["character"] for item in group["occurrences"]}) > 1 for group in duplicates),
            "manifestMismatches": sum(not atlas["manifestSha256Matches"] for atlas in atlases),
        },
        "characters": characters,
        "duplicateFrameGroups": duplicates,
        "findings": findings,
    }


def pivot_audit(fighter, frames):
    # Reproduces current rendering math; alpha edges do not establish foot pivots.
    scale = 1.92 if fighter["frameHeight"] == 120 else 1.72
    actions = {}
    for action in fighter["animations"]:
        selected = [frame for frame in frames if action in frame["mappedActions"] and frame["bounds"]]
        foot_deltas = [round((frame["bounds"]["y"] + frame["bounds"]["height"] - fighter["frameHeight"]) * scale + 12, 4)
                       for frame in selected]
        if foot_deltas:
            actions[action] = {"alphaBottomVsGroundMin": min(foot_deltas), "alphaBottomVsGroundMax": max(foot_deltas),
                               "span": round(max(foot_deltas) - min(foot_deltas), 4)}
    return {
        "authoredPivot": None,
        "runtimeScale": scale,
        "runtimeSourcePivot": {"x": fighter["frameWidth"] / 2, "y": fighter["frameHeight"] - 12 / scale},
        "basis": "src/main.js renders each full cell at (-scaledWidth/2, -scaledHeight+12); fighter ground = ARENA.groundY+5.",
        "warning": "These are silhouette-bottom measurements, not validated anatomical foot anchors. Airborne/effect pixels can affect them; do not automatically recenter every frame.",
        "actions": actions,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "audit-output" / "characters.json")
    args = parser.parse_args()
    result = audit()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result["summary"], ensure_ascii=False))
    print(f"Output: {args.output}")
    if result["summary"]["manifestMismatches"] or any(finding["severity"] == "error" for finding in result["findings"]):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
