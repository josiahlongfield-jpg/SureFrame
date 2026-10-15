#!/usr/bin/env python3
"""Swap hard-coded Tailwind palette classes for the theme tokens in globals.css.

Usage: python3 scripts/tokenize-colours.py FILE...
Only class-name tokens change; variants (hover:, sm:, ...) and opacity suffixes are kept.
Run it once per file, then review the diff by eye (status colours, email previews).
"""
import re
import sys

MAP = {
    # text
    "text-slate-950": "text-ink", "text-slate-900": "text-ink", "text-slate-800": "text-ink",
    "text-slate-700": "text-muted", "text-slate-600": "text-muted",
    "text-slate-500": "text-dim", "text-slate-400": "text-dim", "text-slate-300": "text-dim",
    "text-brand-900": "text-ink", "text-brand-800": "text-accent", "text-brand-700": "text-accent", "text-brand-600": "text-accent",
    "placeholder:text-slate-400": "placeholder:text-dim", "placeholder:text-slate-500": "placeholder:text-dim",
    # backgrounds
    "bg-white": "bg-surface", "bg-slate-50": "bg-canvas", "bg-slate-100": "bg-surface-2", "bg-slate-200": "bg-line-strong",
    "bg-slate-900": "bg-solid", "bg-slate-800": "bg-solid-hover",
    "hover:bg-slate-50": "hover:bg-hover", "hover:bg-slate-100": "hover:bg-hover", "hover:bg-white": "hover:bg-hover",
    "hover:bg-slate-800": "hover:bg-solid-hover", "hover:bg-slate-700": "hover:bg-solid-hover",
    "bg-brand-600": "bg-primary", "hover:bg-brand-700": "hover:bg-primary-hover", "bg-brand-700": "bg-primary-hover",
    "bg-brand-50": "bg-primary-soft", "bg-brand-100": "bg-primary-soft", "hover:bg-brand-50": "hover:bg-primary-soft",
    # borders and rings
    "border-slate-100": "border-line", "border-slate-200": "border-line", "border-slate-300": "border-line-strong",
    "border-slate-400": "border-line-strong", "hover:border-slate-400": "hover:border-line-strong",
    "divide-slate-100": "divide-line", "divide-slate-200": "divide-line",
    "border-brand-100": "border-primary-line", "border-brand-200": "border-primary-line", "border-brand-300": "border-primary-line",
    "border-brand-500": "border-primary", "border-brand-600": "border-primary", "focus:border-brand-500": "focus:border-primary",
    "focus:border-brand-600": "focus:border-primary", "ring-brand-500": "ring-primary", "ring-brand-600": "ring-primary",
    "focus:ring-brand-500": "focus:ring-primary", "ring-slate-200": "ring-line", "ring-slate-300": "ring-line-strong",
    "accent-brand-600": "accent-primary",
    # status
    "bg-emerald-50": "bg-ok-bg", "border-emerald-200": "border-ok-line", "text-emerald-700": "text-ok-fg", "text-emerald-800": "text-ok-fg", "text-emerald-900": "text-ok-fg", "text-emerald-600": "text-ok-fg",
    "bg-amber-50": "bg-warn-bg", "border-amber-200": "border-warn-line", "border-amber-300": "border-warn-line", "text-amber-700": "text-warn-fg", "text-amber-800": "text-warn-fg", "text-amber-900": "text-warn-fg",
    "bg-red-50": "bg-danger-bg", "border-red-200": "border-danger-line", "border-red-300": "border-danger-line", "text-red-600": "text-danger-fg", "text-red-700": "text-danger-fg", "text-red-800": "text-danger-fg", "text-red-900": "text-danger-fg",
}

# A class token: optional variants, the utility, optional /opacity. Bounded by quotes, spaces or backticks.
TOKEN = re.compile(r'(?<![\w:/-])((?:[\w\[\]&>*=().-]+:)*)([a-z]+(?:-[a-z0-9]+)*)(/\d+)?(?![\w-])')


def swap(m: re.Match) -> str:
    variants, util, alpha = m.group(1), m.group(2), m.group(3) or ""
    # The map holds a few variant-specific entries (hover:, placeholder:, focus:); try the last variant with the utility first.
    last = variants.rstrip(":").split(":")[-1] if variants else ""
    if last and f"{last}:{util}" in MAP:
        head = variants[: -(len(last) + 1)]
        return head + MAP[f"{last}:{util}"] + alpha
    if util in MAP:
        return variants + MAP[util] + alpha
    return m.group(0)


def convert(text: str) -> str:
    # Only rewrite inside string literals (className strings, template literals, ternaries).
    return re.sub(r'(["`])((?:\\.|(?!\1).)*)\1', lambda s: s.group(1) + TOKEN.sub(swap, s.group(2)) + s.group(1), text, flags=re.S)


if __name__ == "__main__":
    for path in sys.argv[1:]:
        src = open(path).read()
        out = convert(src)
        if out != src:
            open(path, "w").write(out)
            print("updated", path)
