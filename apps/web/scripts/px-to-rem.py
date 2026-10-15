#!/usr/bin/env python3
"""Turn pixel sizes into rem so the whole site grows with the root font size on big screens (globals.css).

Usage: python3 scripts/px-to-rem.py FILE...
.css files: every length of 2px or more. .tsx files: only arbitrary Tailwind values like text-[13px], and not
breakpoint variants like max-[359px]:. Hairlines (1px, 1.5px) stay in px so they stay crisp.
"""
import re
import sys

PX = re.compile(r'(?<![A-Za-z0-9.])(\d*\.?\d+)px(?![A-Za-z0-9])')


def rem(m: re.Match) -> str:
    n = float(m.group(1))
    if n < 2:
        return m.group(0)
    return f"{n / 16:.5f}".rstrip("0").rstrip(".") + "rem"


def tsx(text: str) -> str:
    # [ ... ] inside a class token, unless it's a max-[..]: / min-[..]: breakpoint variant.
    def bracket(m: re.Match) -> str:
        if m.group(1) in ("max-", "min-") and text[m.end():m.end() + 1] == ":":
            return m.group(0)
        return m.group(1) + PX.sub(rem, m.group(2))
    return re.sub(r'(max-|min-|)(\[[^\]"\'`\s]*\])', bracket, text)


if __name__ == "__main__":
    for path in sys.argv[1:]:
        src = open(path).read()
        out = PX.sub(rem, src) if path.endswith(".css") else tsx(src)
        if out != src:
            open(path, "w").write(out)
            print("updated", path)
