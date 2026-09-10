from fontTools.ttLib import TTFont

jobs = [
    ("SpaceGrotesk-Regular.ttf", "Space Grotesk", "Regular", 400, False),
    ("SpaceGrotesk-Medium.ttf", "Space Grotesk Medium", "Regular", 500, False),
    ("SpaceGrotesk-SemiBold.ttf", "Space Grotesk SemiBold", "Regular", 600, False),
    ("SpaceGrotesk-Bold.ttf", "Space Grotesk", "Bold", 700, True),
    ("Inter-Regular.ttf", "Inter", "Regular", 400, False),
    ("Inter-Medium.ttf", "Inter Medium", "Regular", 500, False),
    ("Inter-SemiBold.ttf", "Inter SemiBold", "Regular", 600, False),
    ("Inter-Bold.ttf", "Inter", "Bold", 700, True),
    ("JetBrainsMono-Medium.ttf", "JetBrains Mono Medium", "Regular", 500, False),
]


def setname(font, nid, val):
    for plat, enc, lang in [(3, 1, 0x409), (1, 0, 0)]:
        font["name"].setName(val, nid, plat, enc, lang)


for fn, fam, sub, wght, bold in jobs:
    f = TTFont("/tmp/" + fn)
    full = f"{fam} Bold" if bold else (fam if sub == "Regular" else f"{fam} {sub}")
    setname(f, 1, fam)
    setname(f, 2, sub)
    setname(f, 4, full)
    setname(f, 6, (fam + "-" + sub).replace(" ", ""))
    setname(f, 16, fam)
    setname(f, 17, sub)
    f["OS/2"].usWeightClass = wght
    ms = f["head"].macStyle
    f["head"].macStyle = (ms | 0x01) if bold else (ms & ~0x01)
    fs = f["OS/2"].fsSelection
    f["OS/2"].fsSelection = ((fs | 0x20) & ~0x40) if bold else ((fs | 0x40) & ~0x20)
    f.save("/tmp/clean_" + fn)
    print("normalized", fam, "/", sub)
print("done")
