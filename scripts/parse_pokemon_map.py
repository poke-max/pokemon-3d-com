#!/usr/bin/env python3
"""Utility to parse a TypeScript Pokemon dictionary into JSON."""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from typing import Dict, List


KEY_PATTERN = re.compile(r"^'(?P<id>\d+)'\s*:\s*(?P<value>.+)$")
FORM_PATTERN = re.compile(r"\['([^']*)'\s*,\s*'([^']*)'\s*\]")


def parse_forms_from_text(text: str) -> List[List[str]]:
    """Extract all form tuples (code, name) from a TypeScript fragment."""
    return [[code, name] for code, name in FORM_PATTERN.findall(text)]


def parse_typescript_map(path: pathlib.Path) -> Dict[str, List[List[str]]]:
    """Walk through the TypeScript file and collect Pokemon entries."""
    raw = path.read_text(encoding="utf-8")
    raw = re.sub(r"/\*[\s\S]*?\*/", "", raw)

    entries: Dict[str, List[List[str]]] = {}
    current_id: str | None = None
    current_forms: List[List[str]] = []

    for raw_line in raw.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("//") or line.startswith("export"):
            continue

        if current_id is None:
            match = KEY_PATTERN.match(line.rstrip(","))
            if not match:
                continue

            key = match.group("id")
            rest = match.group("value").rstrip(",").strip()

            if rest.startswith("[") and rest.endswith("]") and rest.count("[") == rest.count("]"):
                entries[key] = parse_forms_from_text(rest)
                continue

            # Start of a multi-line block.
            current_id = key
            current_forms = []

            if rest and rest != "[":
                current_forms.extend(parse_forms_from_text(rest))
            continue

        if line.startswith("]"):
            entries[current_id] = current_forms
            current_id = None
            current_forms = []
            continue

        current_forms.extend(parse_forms_from_text(line))

    if current_id is not None:
        entries[current_id] = current_forms

    return entries


def summarize(entries: Dict[str, List[List[str]]]) -> str:
    total_forms = sum(len(forms) for forms in entries.values())
    longest_name = max(
        (name for forms in entries.values() for _, name in forms), default="", key=len
    )
    return (
        f"pokemon entries: {len(entries)}, total forms: {total_forms}, "
        f"longest name: {longest_name!r}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Parse the POKEMON_NAME_BY_ID map inside a TypeScript file."
    )
    parser.add_argument("input_path", type=pathlib.Path, help="Path to the TypeScript file.")
    parser.add_argument(
        "-o",
        "--output",
        type=pathlib.Path,
        help="Write the resulting JSON to this path (defaults to stdout).",
    )
    parser.add_argument(
        "--stats",
        action="store_true",
        help="Print a short summary about the parsed data.",
    )
    parser.add_argument(
        "--sample",
        type=int,
        default=5,
        help="Show the first N entries after parsing (default: 5). Set to 0 to skip.",
    )

    args = parser.parse_args()
    if not args.input_path.exists():
        parser.error(f"{args.input_path} does not exist")

    entries = parse_typescript_map(args.input_path)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8")
    else:
        sys.stdout.write(json.dumps(entries, indent=2, ensure_ascii=False))
        sys.stdout.write("\n")

    if args.sample > 0:
        print("\nSample entries:")
        for idx, (poke_id, forms) in enumerate(sorted(entries.items(), key=lambda item: int(item[0]))):
            if idx >= args.sample:
                break
            forms_display = ", ".join(f"{code}:{name}" for code, name in forms)
            print(f"  {poke_id}: {forms_display}")

    if args.stats:
        print("\n" + summarize(entries))


if __name__ == "__main__":
    main()
