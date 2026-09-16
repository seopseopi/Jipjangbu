"""Build the 집장부 mark from one set of polygons so SVG and PNG outputs match.

The mark is the syllable 집 drawn on a 48-unit grid: ㅈ on top-left, ㅣ at right,
ㅂ as a ruled box below (it doubles as the ledger).

    python3 scripts/make_logo.py

Writes the app icons to public/ (file names are allowlisted in worker/security.ts)
and editable SVG sources to docs/assets/. Requires Pillow.
"""
from pathlib import Path
from PIL import Image, ImageDraw

INK = (31, 35, 40, 255)      # --ink #1f2328
WHITE = (255, 255, 255, 255)
W = 4.2                      # stroke weight in grid units


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def leg(top, foot, top_y, foot_y):
    # A diagonal stroke with horizontal cuts at both ends, constant weight W.
    dx, dy = foot - top, foot_y - top_y
    half = W * (dx * dx + dy * dy) ** 0.5 / dy / 2
    return [(top - half, top_y), (top + half, top_y), (foot + half, foot_y), (foot - half, foot_y)]


def glyph(offset_x=0.0):
    apex, bar_top = 17.0, 7.0
    feet = 23.0
    shapes = [
        rect(7.5, bar_top, 26.5, bar_top + W),          # ㅈ top stroke
        leg(apex, 9.8, bar_top + W / 2, feet),          # ㅈ left leg
        leg(apex, 24.2, bar_top + W / 2, feet),         # ㅈ right leg
        rect(35.0, 6.0, 35.0 + W, 24.0),                # ㅣ
        rect(9.0, 27.0, 9.0 + W, 43.5),                 # ㅂ left
        rect(39.2 - W, 27.0, 39.2, 43.5),               # ㅂ right
        rect(9.0, 31.4, 39.2, 31.4 + W),                # ㅂ middle rule
        rect(9.0, 43.5 - W, 39.2, 43.5),                # ㅂ bottom
    ]
    return [[(x + offset_x, y) for x, y in poly] for poly in shapes]


def svg_path(polys, scale=1.0, dx=0.0, dy=0.0):
    parts = []
    for poly in polys:
        pts = [f"{x * scale + dx:.2f} {y * scale + dy:.2f}" for x, y in poly]
        parts.append("M" + "L".join(pts) + "Z")
    return "".join(parts)


def render(size, tile, out):
    ss = 8  # supersample for smooth diagonals
    canvas = size * ss
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    polys = glyph(0.5)
    if tile:
        radius = round(canvas * 0.22)
        draw.rounded_rectangle([0, 0, canvas - 1, canvas - 1], radius=radius, fill=INK)
        inset, scale, color = canvas * 0.19, canvas * 0.62 / 48, WHITE
    else:
        inset, scale, color = 0, canvas / 48, INK
    for poly in polys:
        draw.polygon([(x * scale + inset, y * scale + inset) for x, y in poly], fill=color)
    img.resize((size, size), Image.LANCZOS).save(out)


def main():
    root = Path(__file__).resolve().parent.parent
    public, svg = root / "public", root / "docs" / "assets"
    # Tile everywhere the app shows its icon: sidebar, login, favicon, touch icon.
    render(512, True, public / "jipjangbu-logo.png")
    render(192, True, public / "jipjangbu-icon-bright.png")
    render(96, True, public / "jipjangbu-icon.png")
    tile_path = svg_path(glyph(0.5), scale=0.62, dx=48 * 0.19, dy=48 * 0.19)
    (svg / "jipjangbu-mark-tile.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">'
        '<rect width="48" height="48" rx="10.56" fill="#1f2328"/>'
        f'<path fill="#fff" d="{tile_path}"/></svg>\n'
    )
    (svg / "jipjangbu-mark.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">'
        f'<path fill="#1f2328" d="{svg_path(glyph(0.5))}"/></svg>\n'
    )


if __name__ == "__main__":
    main()
