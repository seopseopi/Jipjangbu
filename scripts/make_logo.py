"""Build the 집장부 symbol from one set of polygons so SVG and PNG outputs match.

The symbol is ㅈ drawn as a house: a ridge bar over a pitched roof, on a 48-unit
grid. It sits beside the "집장부" wordmark (IBM Plex Sans KR Bold, -0.045em) in
the app, and alone on a navy tile for the favicon and touch icon.

    python3 scripts/make_logo.py

Writes the app images to public/ (file names are allowlisted in worker/security.ts)
and editable SVG sources to docs/assets/. Requires Pillow.
"""
from pathlib import Path
from PIL import Image, ImageDraw

NAVY = "#13254a"
TILE_RADIUS = 0.22   # corner radius as a share of the tile size
TILE_SYMBOL = 0.64   # symbol size as a share of the tile size

# Ridge bar, then the roof as one concave outline hanging from the bar's centre.
SYMBOL = [
    [(5, 7), (43, 7), (43, 12.5), (5, 12.5)],
    [(24, 12.5), (41.5, 41), (35, 41), (24, 22.8), (13, 41), (6.5, 41)],
]


def rgba(hex_color):
    value = hex_color.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def placed(scale, offset):
    return [[(x * scale + offset, y * scale + offset) for x, y in poly] for poly in SYMBOL]


def render(size, tile, out):
    ss = 8  # supersample so the roof diagonals stay smooth after downscaling
    canvas = size * ss
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if tile:
        draw.rounded_rectangle([0, 0, canvas - 1, canvas - 1], radius=round(canvas * TILE_RADIUS), fill=rgba(NAVY))
        scale = canvas * TILE_SYMBOL / 48
        polys, color = placed(scale, (canvas - 48 * scale) / 2), (255, 255, 255, 255)
    else:
        polys, color = placed(canvas / 48, 0), rgba(NAVY)
    for poly in polys:
        draw.polygon(poly, fill=color)
    img.resize((size, size), Image.LANCZOS).save(out)


def svg_path(polys):
    return "".join("M" + "L".join(f"{x:g} {y:g}" for x, y in poly) + "Z" for poly in polys)


def main():
    root = Path(__file__).resolve().parent.parent
    public, docs = root / "public", root / "docs" / "assets"
    render(512, False, public / "jipjangbu-logo.png")        # sidebar and login, beside the wordmark
    render(192, True, public / "jipjangbu-icon-bright.png")  # favicon and touch icon
    render(96, True, public / "jipjangbu-icon.png")
    (docs / "jipjangbu-mark.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="{NAVY}" d="{svg_path(SYMBOL)}"/></svg>\n'
    )
    offset = (48 - 48 * TILE_SYMBOL) / 2
    tile = [[(round(x, 2), round(y, 2)) for x, y in poly] for poly in placed(TILE_SYMBOL, offset)]
    (docs / "jipjangbu-mark-tile.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">'
        f'<rect width="48" height="48" rx="{48 * TILE_RADIUS:g}" fill="{NAVY}"/>'
        f'<path fill="#fff" d="{svg_path(tile)}"/></svg>\n'
    )


if __name__ == "__main__":
    main()
