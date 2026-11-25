"""Generate the market icon: 180x180 PNG, a note card with a bookmark ribbon."""
from PIL import Image, ImageDraw

S = 180
SCALE = 4
W = S * SCALE

bg = (31, 36, 48, 255)        # deep slate
card = (245, 246, 250, 255)   # paper
line = (120, 130, 150, 255)   # muted ink
accent = (79, 140, 255, 255)  # ribbon blue

img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# rounded-square app tile
d.rounded_rectangle([0, 0, W - 1, W - 1], radius=int(40 * SCALE), fill=bg)

# note card
x0, y0, x1, y1 = 42 * SCALE, 34 * SCALE, 138 * SCALE, 146 * SCALE
d.rounded_rectangle([x0, y0, x1, y1], radius=int(10 * SCALE), fill=card)

# text lines on the card
top = y0 + 18 * SCALE
for i, width in enumerate((44, 36, 40, 26)):
    ly = top + i * 18 * SCALE
    d.rounded_rectangle(
        [x0 + 12 * SCALE, ly, x0 + (12 + width) * SCALE, ly + 7 * SCALE],
        radius=int(3.5 * SCALE),
        fill=line,
    )

# bookmark ribbon hanging over the card's top edge
bx0, bx1 = 96 * SCALE, 124 * SCALE
by0, by1 = 34 * SCALE, 92 * SCALE
notch = 10 * SCALE
d.polygon(
    [(bx0, by0), (bx1, by0), (bx1, by1), ((bx0 + bx1) // 2, by1 - notch), (bx0, by1)],
    fill=accent,
)

img = img.resize((S, S), Image.LANCZOS)
img.save("F:/DeepSeekHarness/workspace/plugins/dsh-knowledge-vault/assets/icon-180.png")
print("written")
