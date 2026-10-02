"""Gera os ícones PNG da extensão sem dependências externas.
Uso: python3 scripts/make_icons.py
"""
import os
import struct
import zlib

BG_TOP = (26, 26, 26)       # #1A1A1A (cinza quase preto)
BG_BOTTOM = (0, 0, 0)       # #000000
WHITE = (255, 255, 255)
SS = 4  # supersampling


def rounded_rect(x, y, x0, y0, x1, y1, r):
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r and x0 <= x <= x1 and y0 <= y <= y1


def in_triangle(px, py, a, b, c):
    def s(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
    d1, d2, d3 = s((px, py), a, b), s((px, py), b, c), s((px, py), c, a)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)


def sample(u, v):
    """u, v em [0,1]. Retorna (rgb, alpha)."""
    if not rounded_rect(u, v, 0, 0, 1, 1, 0.22):
        return None
    # Balão de conversa
    bubble = rounded_rect(u, v, 0.2, 0.22, 0.8, 0.68, 0.14) or in_triangle(
        u, v, (0.3, 0.6), (0.46, 0.66), (0.27, 0.82))
    if bubble:
        # três pontos
        for cx in (0.36, 0.5, 0.64):
            if (u - cx) ** 2 + (v - 0.45) ** 2 <= 0.05 ** 2:
                return (0, 0, 0)
        return WHITE
    t = v
    return tuple(round(BG_TOP[i] * (1 - t) + BG_BOTTOM[i] * t) for i in range(3))


def render(size):
    rows = []
    n = size * SS
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    c = sample((x * SS + sx + 0.5) / n, (y * SS + sy + 0.5) / n)
                    if c:
                        r += c[0]; g += c[1]; b += c[2]; a += 1
            total = SS * SS
            if a:
                row += bytes((r // a, g // a, b // a, round(255 * a / total)))
            else:
                row += bytes((0, 0, 0, 0))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
    os.makedirs(out, exist_ok=True)
    for s in (16, 32, 48, 128):
        with open(os.path.join(out, f"icon{s}.png"), "wb") as f:
            f.write(render(s))
        print(f"icons/icon{s}.png")
