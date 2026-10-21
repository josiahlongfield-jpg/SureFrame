# A drawn, generic person (no real face) as a short camera clip for the store screenshots: a y4m file.
import sys
from PIL import Image, ImageDraw

W, H = 640, 480
img = Image.new("RGB", (W, H), (233, 226, 214))
d = ImageDraw.Draw(img)
d.rectangle([0, 0, W, 150], fill=(222, 214, 200))
d.ellipse([W / 2 - 170, 300, W / 2 + 170, 640], fill=(15, 39, 71))  # shoulders
d.rectangle([W / 2 - 34, 250, W / 2 + 34, 330], fill=(214, 168, 136))  # neck
d.ellipse([W / 2 - 88, 90, W / 2 + 88, 290], fill=(224, 180, 148))  # head
d.pieslice([W / 2 - 96, 70, W / 2 + 96, 230], 180, 360, fill=(74, 52, 40))  # hair
yuv = img.convert("YCbCr")
y, cb, cr = yuv.split()
cb = cb.resize((W // 2, H // 2))
cr = cr.resize((W // 2, H // 2))
frame = y.tobytes() + cb.tobytes() + cr.tobytes()
with open(sys.argv[1], "wb") as f:
    f.write(f"YUV4MPEG2 W{W} H{H} F30:1 Ip A1:1 C420jpeg\n".encode())
    for _ in range(30):
        f.write(b"FRAME\n" + frame)
