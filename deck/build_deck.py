"""
Zeus Consulting — Platform Modernization Executive Deck (v2, ship-ready)
Advanced typography (Space Grotesk / Inter / JetBrains Mono), gradients,
letter-spacing, refined enterprise composition.
Run:  python deck/build_deck.py
Out:  deck/Zeus_Platform_Modernization.pptx
"""

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
from lxml import etree
import itertools
import os

# ---------------------------------------------------------------- palette ----
INK        = RGBColor(0x0B, 0x0F, 0x1E)
INK_2      = RGBColor(0x12, 0x18, 0x2E)
INK_3      = RGBColor(0x1B, 0x22, 0x3C)
SLATE      = RGBColor(0x3C, 0x44, 0x5C)
MUTE       = RGBColor(0x6A, 0x72, 0x88)
FAINT      = RGBColor(0x97, 0x9F, 0xB3)
BLUE       = RGBColor(0x02, 0x2E, 0xEB)
BLUE_HI    = RGBColor(0x3B, 0x63, 0xFF)
BLUE_DEEP  = RGBColor(0x03, 0x14, 0x6E)
BLUE_TINT  = RGBColor(0xEC, 0xEF, 0xFF)
GREEN      = RGBColor(0x7A, 0xC4, 0x3D)
GREEN_HI   = RGBColor(0x9A, 0xDC, 0x5E)
GREEN_DEEP = RGBColor(0x4F, 0x8A, 0x1F)
GREEN_TINT = RGBColor(0xEE, 0xF7, 0xE2)
AMBER      = RGBColor(0xF2, 0xA8, 0x2E)
AMBER_TINT = RGBColor(0xFD, 0xF1, 0xDC)
RED        = RGBColor(0xE2, 0x53, 0x53)
RED_TINT   = RGBColor(0xFB, 0xEA, 0xEA)
WHITE      = RGBColor(0xFF, 0xFF, 0xFF)
PAPER      = RGBColor(0xF4, 0xF6, 0xFB)
CARD       = RGBColor(0xFF, 0xFF, 0xFF)
LINE       = RGBColor(0xE1, 0xE6, 0xF0)
LINE_2     = RGBColor(0xCE, 0xD5, 0xE4)
CLOUD      = RGBColor(0xEA, 0xEE, 0xF6)

DISPLAY  = "Space Grotesk"
DISP_MED = "Space Grotesk Medium"
DISP_SB  = "Space Grotesk SemiBold"
BODY     = "Inter"
BODY_MED = "Inter Medium"
BODY_SB  = "Inter SemiBold"
MONO     = "JetBrains Mono Medium"

EMU_W = Inches(13.333)
EMU_H = Inches(7.5)


# ---------------------------------------------------------------- helpers ----
def _spPr(shape):
    return shape._element.spPr


def solid(shape, color):
    shape.fill.solid(); shape.fill.fore_color.rgb = color
    shape.line.fill.background()


def no_line(shape):
    shape.line.fill.background()


def kill_shadow(shape):
    sp = _spPr(shape)
    for e in sp.findall(qn("a:effectLst")):
        sp.remove(e)
    etree.SubElement(sp, qn("a:effectLst"))


def soft_shadow(shape, blur=12, dist=6, alpha=78, direction=5400000):
    sp = _spPr(shape)
    for e in sp.findall(qn("a:effectLst")):
        sp.remove(e)
    lst = etree.SubElement(sp, qn("a:effectLst"))
    sh = etree.SubElement(lst, qn("a:outerShdw"))
    sh.set("blurRad", str(Pt(blur))); sh.set("dist", str(Pt(dist)))
    sh.set("dir", str(direction)); sh.set("rotWithShape", "0")
    c = etree.SubElement(sh, qn("a:srgbClr")); c.set("val", "0B0F1E")
    a = etree.SubElement(c, qn("a:alpha")); a.set("val", str(int((100 - alpha) * 1000)))


def grad(shape, c1, c2, angle=90):
    sp = _spPr(shape)
    for t in ("a:noFill", "a:solidFill", "a:gradFill", "a:blipFill", "a:pattFill"):
        for e in sp.findall(qn(t)):
            sp.remove(e)
    g = etree.SubElement(sp, qn("a:gradFill"))
    lst = etree.SubElement(g, qn("a:gsLst"))
    for pos, col in [(0, c1), (100000, c2)]:
        gs = etree.SubElement(lst, qn("a:gs")); gs.set("pos", str(pos))
        cc = etree.SubElement(gs, qn("a:srgbClr"))
        cc.set("val", "%02X%02X%02X" % (col[0], col[1], col[2]))
    lin = etree.SubElement(g, qn("a:lin"))
    lin.set("ang", str(int(angle * 60000))); lin.set("scaled", "1")
    ln = sp.find(qn("a:ln"))
    if ln is not None:
        sp.remove(g); ln.addprevious(g)


def rrect(s, x, y, w, h, fill=None, line=None, lw=1.0, rad=0.08, grad_to=None, gangle=90):
    shp = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
    if grad_to is not None and fill is not None:
        grad(shp, fill, grad_to, gangle)
    elif fill is not None:
        solid(shp, fill)
    else:
        shp.fill.background()
    if line is not None:
        shp.line.color.rgb = line; shp.line.width = Pt(lw)
    else:
        shp.line.fill.background()
    kill_shadow(shp)
    try:
        shp.adjustments[0] = rad
    except Exception:
        pass
    return shp


def rect(s, x, y, w, h, fill=None, line=None, lw=1.0, grad_to=None, gangle=90):
    shp = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
    if grad_to is not None and fill is not None:
        grad(shp, fill, grad_to, gangle)
    elif fill is not None:
        solid(shp, fill)
    else:
        shp.fill.background()
    if line is not None:
        shp.line.color.rgb = line; shp.line.width = Pt(lw)
    else:
        shp.line.fill.background()
    kill_shadow(shp)
    return shp


def oval(s, x, y, w, h, fill=None, line=None, lw=1.0):
    shp = s.shapes.add_shape(MSO_SHAPE.OVAL, x, y, w, h)
    if fill is not None:
        solid(shp, fill)
    else:
        shp.fill.background()
    if line is not None:
        shp.line.color.rgb = line; shp.line.width = Pt(lw)
    else:
        shp.line.fill.background()
    kill_shadow(shp)
    return shp


def tbox(s, x, y, w, h):
    tb = s.shapes.add_textbox(x, y, w, h)
    tb.text_frame.word_wrap = True
    return tb


def write(container, text, size=14, color=INK, font=BODY, align=PP_ALIGN.LEFT,
          anchor=MSO_ANCHOR.TOP, spacing=1.0, tracking=None, space_after=0):
    tf = container.text_frame if hasattr(container, "text_frame") else container
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = Pt(4); tf.margin_right = Pt(4)
    tf.margin_top = Pt(2); tf.margin_bottom = Pt(2)
    for i, ln in enumerate(text.split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align; p.line_spacing = spacing
        if space_after:
            p.space_after = Pt(space_after)
        r = p.add_run(); r.text = ln
        r.font.size = Pt(size); r.font.color.rgb = color; r.font.name = font
        if tracking is not None:
            r.font._rPr.set("spc", str(int(tracking)))
    return tf


def line(s, x1, y1, x2, y2, color=LINE_2, w=1.25, dash=None):
    c = s.shapes.add_connector(2, x1, y1, x2, y2)
    c.line.color.rgb = color; c.line.width = Pt(w)
    if dash:
        ln = c.line._get_or_add_ln()
        d = etree.SubElement(ln, qn("a:prstDash")); d.set("val", dash)
    return c


def arrow(s, x1, y1, x2, y2, color=SLATE, w=1.75):
    c = line(s, x1, y1, x2, y2, color, w)
    ln = c.line._get_or_add_ln()
    te = etree.SubElement(ln, qn("a:tailEnd"))
    te.set("type", "triangle"); te.set("w", "med"); te.set("len", "med")
    return c


prs = Presentation(); prs.slide_width = EMU_W; prs.slide_height = EMU_H
BLANK = prs.slide_layouts[6]


def slide(bgc=PAPER):
    s = prs.slides.add_slide(BLANK)
    r = rect(s, 0, 0, EMU_W, EMU_H, fill=bgc)
    s.shapes._spTree.remove(r._element); s.shapes._spTree.insert(2, r._element)
    return s


def kicker(s, text, y=Inches(0.62), color=BLUE, on_dark=False):
    x = Inches(0.75)
    rect(s, x, y + Inches(0.02), Inches(0.22), Inches(0.14), fill=GREEN)
    write(tbox(s, x + Inches(0.36), y - Inches(0.02), Inches(9), Inches(0.32)),
          text.upper(), size=11, color=(GREEN if on_dark else color), font=MONO, tracking=260)


def h1(s, text, y=Inches(0.98), color=INK, size=32, w=Inches(11.8)):
    write(tbox(s, Inches(0.75), y, w, Inches(1.1)), text, size=size, color=color,
          font=DISPLAY, spacing=1.02)


def pageno(s, n, on_dark=False):
    write(tbox(s, Inches(12.35), Inches(7.02), Inches(0.85), Inches(0.35)),
          f"{n:02d} / 13", size=9.5, color=(FAINT if on_dark else MUTE), font=MONO,
          align=PP_ALIGN.RIGHT, tracking=120)


def foot(s, on_dark=False):
    write(tbox(s, Inches(0.75), Inches(7.02), Inches(9), Inches(0.35)),
          "ZEUS CONSULTING", size=9.5, color=(FAINT if on_dark else MUTE), font=MONO, tracking=200)


def chip(s, x, y, text, fill, tc, w=Inches(1.5), sz=10.5):
    b = rrect(s, x, y, w, Inches(0.36), fill=fill, rad=0.5)
    write(b, text, size=sz, color=tc, font=BODY_MED, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    return b


def glyph_lock(s, x, y, c):
    rrect(s, x + Inches(0.06), y + Inches(0.16), Inches(0.30), Inches(0.22), fill=c, rad=0.25)
    oval(s, x + Inches(0.12), y + Inches(0.02), Inches(0.18), Inches(0.22), line=c, lw=2.2)


# ============================================================ 01 COVER =======
s = slide(INK)
rect(s, 0, 0, Inches(5.6), EMU_H, fill=BLUE_DEEP, grad_to=INK, gangle=120)
tri = s.shapes.add_shape(MSO_SHAPE.RIGHT_TRIANGLE, Inches(3.7), 0, Inches(2.2), EMU_H)
grad(tri, BLUE, BLUE_DEEP, 90); no_line(tri); kill_shadow(tri)
rect(s, 0, 0, EMU_W, Inches(0.14), fill=GREEN)
pts = [(0.9, 5.3), (1.7, 5.9), (2.6, 5.4), (1.3, 6.4), (2.3, 6.5)]
for a, b in itertools.combinations(pts, 2):
    line(s, Inches(a[0]), Inches(a[1]), Inches(b[0]), Inches(b[1]), color=RGBColor(0x2A, 0x37, 0x66), w=0.75)
for px, py in pts:
    oval(s, Inches(px) - Inches(0.05), Inches(py) - Inches(0.05), Inches(0.1), Inches(0.1), fill=GREEN)
m = rrect(s, Inches(0.75), Inches(0.62), Inches(0.52), Inches(0.52), fill=GREEN, rad=0.22)
write(m, "Z", size=24, color=INK, font=DISPLAY, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
write(tbox(s, Inches(1.4), Inches(0.66), Inches(4), Inches(0.45)),
      "ZEUS CONSULTING", size=13, color=WHITE, font=DISP_SB, tracking=180, anchor=MSO_ANCHOR.MIDDLE)
write(tbox(s, Inches(6.0), Inches(1.95), Inches(7), Inches(0.4)),
      "PLATFORM MODERNIZATION", size=12, color=GREEN, font=MONO, tracking=300)
write(tbox(s, Inches(5.95), Inches(2.45), Inches(7.1), Inches(2.1)),
      "From one product\ninto a platform.", size=46, color=WHITE, font=DISPLAY, spacing=1.0)
write(tbox(s, Inches(6.0), Inches(4.55), Inches(6.7), Inches(1.3)),
      "A modular, multi-tenant SaaS platform where every service is sold, billed and "
      "scaled on its own. Enterprise architecture, engineered to run at zero fixed "
      "infrastructure cost.", size=14.5, color=RGBColor(0xC2, 0xC9, 0xDD), font=BODY, spacing=1.28)
line(s, Inches(6.0), Inches(6.35), Inches(12.5), Inches(6.35), color=RGBColor(0x2A, 0x33, 0x52), w=1)
write(tbox(s, Inches(6.0), Inches(6.5), Inches(7), Inches(0.4)),
      "PREPARED FOR THE BOARD", size=10, color=FAINT, font=MONO, tracking=220)
write(tbox(s, Inches(10.6), Inches(6.5), Inches(2), Inches(0.4)),
      "CONFIDENTIAL", size=10, color=FAINT, font=MONO, tracking=220, align=PP_ALIGN.RIGHT)

# ============================================================ 02 INDEX =======
s = slide(PAPER)
kicker(s, "Contents")
h1(s, "What this proposal covers")
items = [
    ("01", "Executive summary", "The decision in one page"),
    ("02", "Where we are today", "The product and its limits"),
    ("03", "The vision", "Platform plus independent services"),
    ("04", "Target architecture", "How the system fits together"),
    ("05", "Revenue model", "Selling each service on its own"),
    ("06", "Tenancy and security", "Isolation customers can trust"),
    ("07", "Technology and cost", "Enterprise grade, zero fixed cost"),
    ("08", "Control plane", "One dashboard to run it all"),
    ("09", "Delivery plan", "A phased, low-risk rollout"),
    ("10", "Go to market", "Ready for paid acquisition"),
]
cw, ch = Inches(5.82), Inches(0.86)
x0, y0 = Inches(0.75), Inches(1.95)
for i, (n, t, d) in enumerate(items):
    x = x0 + (i % 2) * (cw + Inches(0.26)); y = y0 + (i // 2) * (ch + Inches(0.16))
    c = rrect(s, x, y, cw, ch, fill=CARD, line=LINE, lw=1, rad=0.09); soft_shadow(c, blur=10, dist=3, alpha=94)
    write(tbox(s, x + Inches(0.25), y + Inches(0.12), Inches(0.9), Inches(0.62)),
          n, size=22, color=BLUE, font=MONO, anchor=MSO_ANCHOR.MIDDLE)
    line(s, x + Inches(1.15), y + Inches(0.2), x + Inches(1.15), y + Inches(0.66), color=LINE_2, w=1)
    write(tbox(s, x + Inches(1.32), y + Inches(0.13), cw - Inches(1.4), Inches(0.36)),
          t, size=14.5, color=INK, font=BODY_SB)
    write(tbox(s, x + Inches(1.32), y + Inches(0.47), cw - Inches(1.4), Inches(0.32)),
          d, size=11, color=MUTE, font=BODY)
foot(s); pageno(s, 2)

# ======================================================= 03 EXEC SUMMARY =====
s = slide(PAPER)
kicker(s, "Executive summary")
h1(s, "The decision, in one page")
narr = [
    ("The product works. The foundation does not scale.", DISP_SB, INK, 16, 3),
    ("Our grant and compliance product runs on a single, tightly coupled codebase tied "
     "to one vendor. It is hard to extend, hard to price flexibly, and it carries a "
     "dependency we do not control.", BODY, SLATE, 13, 12),
    ("We propose rebuilding it as a platform.", DISP_SB, BLUE, 16, 3),
    ("A shared core owns identity, billing and tenants. Each capability becomes an "
     "independent service a customer can buy alone. Someone who wants only grant "
     "intelligence pays for that, and never touches the rest.", BODY, SLATE, 13, 12),
    ("The economics are the headline.", DISP_SB, GREEN_DEEP, 16, 3),
    ("The whole platform runs on managed free tiers. The only variable cost is the AI "
     "usage itself. No servers to babysit, and it scales cleanly past our first hundred "
     "customers.", BODY, SLATE, 13, 0),
]
tf = tbox(s, Inches(0.75), Inches(1.9), Inches(6.5), Inches(4.7)).text_frame
first = True
for t, f, c, sz, sa in narr:
    p = tf.paragraphs[0] if first else tf.add_paragraph(); first = False
    p.space_after = Pt(sa); p.line_spacing = 1.2
    r = p.add_run(); r.text = t; r.font.size = Pt(sz); r.font.color.rgb = c; r.font.name = f
metrics = [("$0", "fixed infrastructure cost", GREEN, GREEN_DEEP),
           ("3", "services, each sold separately", BLUE, BLUE),
           ("100+", "customers supported at launch", INK, INK),
           ("0", "hard vendor lock-ins left", AMBER, RGBColor(0x9A, 0x6A, 0x00))]
mx, my = Inches(7.55), Inches(1.9)
for v, l, ac, vc in metrics:
    card = rrect(s, mx, my, Inches(5.05), Inches(1.06), fill=CARD, line=LINE, lw=1, rad=0.12)
    soft_shadow(card, blur=12, dist=4, alpha=93)
    rect(s, mx, my + Inches(0.14), Inches(0.11), Inches(0.78), fill=ac)
    write(tbox(s, mx + Inches(0.32), my + Inches(0.08), Inches(1.9), Inches(0.9)),
          v, size=32, color=vc, font=DISPLAY, anchor=MSO_ANCHOR.MIDDLE)
    write(tbox(s, mx + Inches(2.05), my + Inches(0.08), Inches(2.9), Inches(0.9)),
          l, size=12.5, color=SLATE, font=BODY_MED, anchor=MSO_ANCHOR.MIDDLE, spacing=1.1)
    my += Inches(1.18)
foot(s); pageno(s, 3)

# ======================================================= 04 CURRENT STATE ====
s = slide(PAPER)
kicker(s, "Current state")
h1(s, "One product, one codebase, one dependency")
mono = rrect(s, Inches(0.85), Inches(2.15), Inches(4.3), Inches(4.05), fill=INK, grad_to=INK_2, gangle=110, rad=0.05)
soft_shadow(mono, blur=18, dist=8, alpha=82)
write(tbox(s, Inches(1.05), Inches(2.34), Inches(3.9), Inches(0.4)),
      "SINGLE MONOLITH", size=11.5, color=GREEN, font=MONO, tracking=220, align=PP_ALIGN.CENTER)
tags = ["Grant Intelligence", "Contract Compliance", "Audit Vault", "Billing", "Auth", "AI calls", "Frontend"]
ty = Inches(2.9)
for t in tags:
    b = rrect(s, Inches(1.15), ty, Inches(3.7), Inches(0.38), fill=INK_3, rad=0.25)
    write(b, t, size=11.5, color=RGBColor(0xD5, 0xDA, 0xE8), font=BODY_MED, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    ty += Inches(0.42)
lk = rrect(s, Inches(1.15), ty + Inches(0.04), Inches(3.7), Inches(0.5), fill=AMBER, rad=0.2)
glyph_lock(s, Inches(1.28), ty + Inches(0.08), INK)
write(tbox(s, Inches(1.72), ty + Inches(0.04), Inches(3.05), Inches(0.5)),
      "Bound to a vendor we don't own", size=11.5, color=INK, font=BODY_SB, anchor=MSO_ANCHOR.MIDDLE)
lim = [("Cannot sell the parts", "Everything ships as one. No single capability can be priced alone."),
       ("Cannot scale a hotspot", "One busy feature slows the whole product. Nothing scales in isolation."),
       ("Vendor dependency", "Core pieces run on a platform we neither own nor control."),
       ("Every change is risky", "Edits touch shared code, so small changes carry outsized blast radius.")]
lx, ly = Inches(5.55), Inches(2.15)
for h, d in lim:
    c = rrect(s, lx, ly, Inches(7.0), Inches(0.92), fill=CARD, line=LINE, lw=1, rad=0.1)
    soft_shadow(c, blur=10, dist=3, alpha=94)
    ic = rrect(s, lx + Inches(0.2), ly + Inches(0.21), Inches(0.5), Inches(0.5), fill=RED_TINT, rad=0.25)
    write(ic, "!", size=20, color=RED, font=DISPLAY, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    write(tbox(s, lx + Inches(0.85), ly + Inches(0.11), Inches(6.0), Inches(0.36)),
          h, size=14, color=INK, font=BODY_SB)
    write(tbox(s, lx + Inches(0.85), ly + Inches(0.45), Inches(6.0), Inches(0.42)),
          d, size=11.5, color=MUTE, font=BODY)
    ly += Inches(1.0)
foot(s); pageno(s, 4)

# ============================================================ 05 VISION ======
s = slide(INK)
rect(s, 0, 0, EMU_W, Inches(0.14), fill=GREEN)
kicker(s, "The vision", on_dark=True)
h1(s, "A platform underneath, services on top", color=WHITE, size=30)
svcs = [("Grant Intelligence", "Find and win funding"),
        ("Contract Compliance", "Track obligations"),
        ("Audit Vault", "Evidence and readiness")]
sx, sw = Inches(0.9), Inches(3.72)
for i, (name, sub) in enumerate(svcs):
    x = sx + i * (sw + Inches(0.2))
    rrect(s, x, Inches(2.0), sw, Inches(2.35), fill=INK_2, line=RGBColor(0x2A, 0x37, 0x66), lw=1.25, rad=0.08)
    rect(s, x, Inches(2.0), sw, Inches(0.1), fill=GREEN)
    oval(s, x + Inches(0.28), Inches(2.32), Inches(0.34), Inches(0.34), fill=GREEN)
    write(tbox(s, x + Inches(0.75), Inches(2.3), sw - Inches(0.85), Inches(0.4)),
          name, size=15.5, color=WHITE, font=DISP_SB, anchor=MSO_ANCHOR.MIDDLE)
    write(tbox(s, x + Inches(0.3), Inches(2.78), sw - Inches(0.55), Inches(0.3)),
          sub, size=11.5, color=GREEN_HI, font=MONO, tracking=40)
    for j, feat in enumerate(["Sold on its own", "Billed on its own", "Scaled on its own", "Data isolated"]):
        yy = Inches(3.2) + j * Inches(0.28)
        oval(s, x + Inches(0.32), yy + Inches(0.05), Inches(0.08), Inches(0.08), fill=GREEN)
        write(tbox(s, x + Inches(0.52), yy - Inches(0.03), sw - Inches(0.7), Inches(0.3)),
              feat, size=12, color=RGBColor(0xC2, 0xC9, 0xDD), font=BODY)
    arrow(s, x + sw / 2, Inches(4.35), x + sw / 2, Inches(4.68), color=GREEN, w=2)
rrect(s, Inches(0.9), Inches(4.72), Inches(11.52), Inches(1.42), fill=BLUE, grad_to=BLUE_DEEP, gangle=90, rad=0.06)
write(tbox(s, Inches(1.12), Inches(4.84), Inches(5), Inches(0.34)),
      "PLATFORM CORE", size=11.5, color=WHITE, font=MONO, tracking=240)
cx = Inches(1.12)
for ci in ["Identity", "Tenancy", "Billing & Entitlements", "Admin Control", "Eventing"]:
    w = Inches(2.15)
    b = rrect(s, cx, Inches(5.26), w, Inches(0.66), fill=RGBColor(0x03, 0x1E, 0xA6), rad=0.14)
    write(b, ci, size=11.5, color=WHITE, font=BODY_MED, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    cx += w + Inches(0.13)
write(tbox(s, Inches(0.9), Inches(6.35), Inches(11.5), Inches(0.5)),
      "Buy one, buy two, or buy all three — each customer sees only what they pay for.",
      size=13.5, color=GREEN_HI, font=BODY_MED)
pageno(s, 5, on_dark=True); foot(s, on_dark=True)

# ====================================================== 06 ARCHITECTURE ======
s = slide(PAPER)
kicker(s, "Target architecture")
h1(s, "How the system fits together")


def band(y, h, fill, label):
    rrect(s, Inches(0.75), y, Inches(11.85), h, fill=fill, line=LINE, lw=1, rad=0.04)
    write(tbox(s, Inches(0.9), y + Inches(0.05), Inches(6), Inches(0.3)),
          label, size=9.5, color=MUTE, font=MONO, tracking=180)


def node(x, y, w, h, t, fill, tc=WHITE, sz=12, gto=None):
    b = rrect(s, x, y, w, h, fill=fill, grad_to=gto, gangle=110, rad=0.14)
    soft_shadow(b, blur=8, dist=3, alpha=92)
    write(b, t, size=sz, color=tc, font=BODY_SB, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, spacing=1.02)


band(Inches(1.72), Inches(0.98), CARD, "USER LAYER · VERCEL (FREE)")
node(Inches(1.05), Inches(2.04), Inches(3.2), Inches(0.56), "Marketing + Ads funnel", GREEN, INK)
node(Inches(4.45), Inches(2.04), Inches(3.2), Inches(0.56), "React application", BLUE, WHITE, gto=BLUE_DEEP)
node(Inches(7.85), Inches(2.04), Inches(3.0), Inches(0.56), "Admin dashboard", INK, WHITE, gto=INK_2)
band(Inches(2.92), Inches(0.92), BLUE_TINT, "GATEWAY · BACKEND FOR FRONTEND (PYTHON)")
node(Inches(3.4), Inches(3.18), Inches(6.5), Inches(0.5),
     "Authenticate  ·  resolve tenant  ·  check entitlements  ·  route", BLUE, WHITE, 11, gto=BLUE_DEEP)
band(Inches(4.06), Inches(1.34), CARD, "SERVICES · PYTHON, INDEPENDENT")
node(Inches(1.05), Inches(4.46), Inches(2.55), Inches(0.76), "Grant\nIntelligence", GREEN, INK, 12)
node(Inches(3.72), Inches(4.46), Inches(2.55), Inches(0.76), "Contract\nCompliance", GREEN, INK, 12)
node(Inches(6.39), Inches(4.46), Inches(2.55), Inches(0.76), "Audit\nVault", GREEN, INK, 12)
node(Inches(9.06), Inches(4.46), Inches(2.5), Inches(0.76), "AI Worker\nasync", AMBER, INK, 12)
band(Inches(5.66), Inches(1.4), CLOUD, "MANAGED BACKBONE · FREE TIERS")
bb = [("Postgres\n+ Auth", INK, INK_2), ("Redis\ncache", RED, RGBColor(0xB5, 0x3B, 0x3B)),
      ("Queue\neventing", AMBER, RGBColor(0xC9, 0x86, 0x1E)), ("Stripe\nbilling", BLUE, BLUE_DEEP),
      ("Object\nstorage", SLATE, INK), ("Observability", GREEN, GREEN_DEEP)]
bx = Inches(1.05)
for t, c, g in bb:
    node(bx, Inches(6.06), Inches(1.78), Inches(0.78), t, c, WHITE, 10.5, gto=g); bx += Inches(1.92)
for cx in [Inches(2.65), Inches(6.05), Inches(9.35)]:
    arrow(s, cx, Inches(2.6), cx, Inches(2.92), BLUE_HI, 1.75)
arrow(s, Inches(6.05), Inches(3.68), Inches(6.05), Inches(4.06), BLUE_HI, 1.75)
foot(s); pageno(s, 6)

# ====================================================== 07 REVENUE ===========
s = slide(PAPER)
kicker(s, "Revenue model")
h1(s, "Every service earns on its own")
steps = [("Customer picks a service", "They choose only what they need on the pricing page.", BLUE),
         ("Pays for that one", "A separate subscription and trial per service.", GREEN),
         ("Access is granted", "A signed permission is issued for that service only.", INK),
         ("The rest stays locked", "Other services are invisible and unreachable.", AMBER)]
x = Inches(0.75)
for i, (h, d, c) in enumerate(steps):
    w = Inches(2.86)
    card = rrect(s, x, Inches(2.0), w, Inches(2.25), fill=CARD, line=LINE, lw=1, rad=0.1)
    soft_shadow(card, blur=12, dist=4, alpha=93)
    rrect(s, x, Inches(2.0), w, Inches(0.62), fill=c, rad=0.1)
    rect(s, x, Inches(2.28), w, Inches(0.34), fill=c)
    write(tbox(s, x, Inches(2.06), w, Inches(0.5)),
          f"STEP {i + 1}", size=11, color=WHITE, font=MONO, tracking=200, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    write(tbox(s, x + Inches(0.2), Inches(2.78), w - Inches(0.4), Inches(0.7)),
          h, size=14, color=INK, font=BODY_SB, spacing=1.05)
    write(tbox(s, x + Inches(0.2), Inches(3.5), w - Inches(0.4), Inches(0.7)),
          d, size=11.5, color=MUTE, font=BODY, spacing=1.12)
    if i < 3:
        arrow(s, x + w + Inches(0.02), Inches(3.12), x + w + Inches(0.24), Inches(3.12), SLATE, 2)
    x += w + Inches(0.3)
rrect(s, Inches(0.75), Inches(4.68), Inches(11.85), Inches(1.92), fill=INK, grad_to=INK_2, gangle=100, rad=0.06)
write(tbox(s, Inches(1.0), Inches(4.84), Inches(7), Inches(0.34)),
      "PACKAGING BUILT FOR GROWTH", size=11.5, color=GREEN, font=MONO, tracking=240)
packs = [("Single service", "Land on one clear need"), ("Two services", "Automatic bundle discount"),
         ("Full platform", "Best value, deepest retention"), ("Add-ons", "Extra usage sold on top")]
px = Inches(1.0)
for h, d in packs:
    rrect(s, px, Inches(5.34), Inches(2.78), Inches(1.02), fill=INK_3, rad=0.1)
    write(tbox(s, px + Inches(0.18), Inches(5.45), Inches(2.5), Inches(0.4)),
          h, size=13.5, color=WHITE, font=BODY_SB)
    write(tbox(s, px + Inches(0.18), Inches(5.82), Inches(2.5), Inches(0.5)),
          d, size=11, color=RGBColor(0xAE, 0xB6, 0xCB), font=BODY)
    px += Inches(2.92)
foot(s); pageno(s, 7)

# ====================================================== 08 TENANCY ===========
s = slide(PAPER)
kicker(s, "Tenancy and security")
h1(s, "Isolation customers can trust")
for i, name in enumerate(["Customer A", "Customer B", "Customer C"]):
    y = Inches(2.1) + i * Inches(1.42)
    t = rrect(s, Inches(0.85), y, Inches(4.55), Inches(1.22), fill=CARD, line=BLUE, lw=1.25, rad=0.1)
    soft_shadow(t, blur=10, dist=3, alpha=94)
    rrect(s, Inches(0.85), y, Inches(4.55), Inches(0.42), fill=BLUE_TINT, rad=0.1)
    rect(s, Inches(0.85), y + Inches(0.2), Inches(4.55), Inches(0.22), fill=BLUE_TINT)
    write(tbox(s, Inches(1.08), y + Inches(0.02), Inches(4.2), Inches(0.4)),
          f"{name}  ·  own tenant", size=12.5, color=BLUE, font=BODY_SB, anchor=MSO_ANCHOR.MIDDLE)
    write(tbox(s, Inches(1.08), y + Inches(0.5), Inches(4.2), Inches(0.66)),
          "Own users, roles and data. Cannot see or reach any other tenant.",
          size=11.5, color=MUTE, font=BODY, spacing=1.12)
write(tbox(s, Inches(6.0), Inches(1.95), Inches(6.5), Inches(0.4)),
      "Four independent checks on every request", size=15, color=INK, font=DISP_SB)
dfn = [("Gateway", "Rejects unpaid or wrong-tenant calls first", BLUE),
       ("Service", "Re-verifies permission before doing work", GREEN),
       ("Database", "Row-level rules block foreign data", INK),
       ("Audit trail", "Every sensitive action logged, append only", AMBER)]
dy = Inches(2.52)
for i, (h, d, c) in enumerate(dfn):
    b = rrect(s, Inches(6.0), dy, Inches(6.6), Inches(0.92), fill=CARD, line=LINE, lw=1, rad=0.1)
    soft_shadow(b, blur=9, dist=3, alpha=94)
    nb = rrect(s, Inches(6.2), dy + Inches(0.2), Inches(0.52), Inches(0.52), fill=c, rad=0.22)
    write(nb, str(i + 1), size=17, color=WHITE, font=DISPLAY, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    write(tbox(s, Inches(6.88), dy + Inches(0.11), Inches(5.5), Inches(0.36)),
          h, size=14, color=INK, font=BODY_SB)
    write(tbox(s, Inches(6.88), dy + Inches(0.45), Inches(5.5), Inches(0.4)),
          d, size=11.5, color=MUTE, font=BODY)
    dy += Inches(1.0)
foot(s); pageno(s, 8)

# ====================================================== 09 TECH & COST =======
s = slide(PAPER)
kicker(s, "Technology and cost")
h1(s, "Enterprise grade, zero fixed cost")
rows = [("Frontend and gateway", "Vercel", "Free", "Comfortable for our first hundred users"),
        ("Database, auth, storage", "Managed Postgres", "Free", "Open source, portable, no lock-in"),
        ("Caching", "Redis", "Free", "Fast sessions and permission checks"),
        ("Queue and eventing", "Managed queue", "Free", "Async work with no servers to run"),
        ("Billing", "Stripe", "Per txn", "No monthly platform fee at all"),
        ("Observability", "Grafana Cloud", "Free", "Logs, metrics and traces in one place"),
        ("AI", "Pluggable provider", "Usage", "The only variable cost we carry")]
hx = [Inches(0.75), Inches(4.05), Inches(6.95), Inches(8.85)]
hw = [Inches(3.2), Inches(2.8), Inches(1.8), Inches(3.7)]
rrect(s, Inches(0.75), Inches(1.9), Inches(11.85), Inches(0.5), fill=INK, grad_to=INK_2, gangle=0, rad=0.06)
for i, l in enumerate(["CAPABILITY", "CHOICE", "COST", "WHY IT WINS"]):
    write(tbox(s, hx[i] + Inches(0.12), Inches(1.95), hw[i], Inches(0.4)),
          l, size=10.5, color=WHITE, font=MONO, tracking=120, anchor=MSO_ANCHOR.MIDDLE)
ry = Inches(2.46)
for r, (cap, ch, co, why) in enumerate(rows):
    fill = CARD if r % 2 == 0 else RGBColor(0xEF, 0xF2, 0xF9)
    rect(s, Inches(0.75), ry, Inches(11.85), Inches(0.585), fill=fill)
    write(tbox(s, hx[0] + Inches(0.12), ry + Inches(0.07), hw[0], Inches(0.45)),
          cap, size=12, color=INK, font=BODY_SB, anchor=MSO_ANCHOR.MIDDLE)
    write(tbox(s, hx[1] + Inches(0.12), ry + Inches(0.07), hw[1], Inches(0.45)),
          ch, size=12, color=SLATE, font=BODY_MED, anchor=MSO_ANCHOR.MIDDLE)
    free = co not in ("Usage", "Per txn")
    chip(s, hx[2] + Inches(0.02), ry + Inches(0.13), co,
         GREEN_TINT if free else AMBER_TINT,
         GREEN_DEEP if free else RGBColor(0x9A, 0x6A, 0x00), w=Inches(1.3))
    write(tbox(s, hx[3] + Inches(0.12), ry + Inches(0.07), hw[3], Inches(0.45)),
          why, size=11.5, color=MUTE, font=BODY, anchor=MSO_ANCHOR.MIDDLE)
    ry += Inches(0.585)
line(s, Inches(0.75), ry, Inches(12.6), ry, color=LINE_2, w=1)
foot(s); pageno(s, 9)

# ====================================================== 10 CONTROL PLANE =====
s = slide(INK)
rect(s, 0, 0, EMU_W, Inches(0.14), fill=GREEN)
kicker(s, "Control plane", on_dark=True)
h1(s, "One dashboard to run the platform", color=WHITE, size=30)
caps = [("AI keys and models", "Swap providers or keys with no code change."),
        ("Prompt library", "Edit and version the AI instructions live."),
        ("Plans and pricing", "Change what each service costs and includes."),
        ("Tenant management", "See customers, adjust access, resolve issues."),
        ("Feature switches", "Turn capabilities on or off instantly."),
        ("Health and usage", "Cost, activity and errors at a glance.")]
x0, y0 = Inches(0.9), Inches(2.15); cw, ch = Inches(3.75), Inches(1.78)
for i, (h, d) in enumerate(caps):
    x = x0 + (i % 3) * (cw + Inches(0.19)); y = y0 + (i // 3) * (ch + Inches(0.24))
    rrect(s, x, y, cw, ch, fill=INK_2, line=RGBColor(0x28, 0x33, 0x54), lw=1, rad=0.09)
    nb = rrect(s, x + Inches(0.26), y + Inches(0.26), Inches(0.5), Inches(0.5), fill=GREEN, rad=0.22)
    write(nb, f"{i + 1:02d}", size=13, color=INK, font=MONO, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    write(tbox(s, x + Inches(0.9), y + Inches(0.26), cw - Inches(1.0), Inches(0.5)),
          h, size=14.5, color=WHITE, font=DISP_SB, anchor=MSO_ANCHOR.MIDDLE)
    write(tbox(s, x + Inches(0.3), y + Inches(0.96), cw - Inches(0.55), Inches(0.7)),
          d, size=12, color=RGBColor(0xB2, 0xBA, 0xCF), font=BODY, spacing=1.15)
write(tbox(s, Inches(0.9), Inches(6.38), Inches(11.5), Inches(0.5)),
      "This is where the weak AI gets fixed — prompts and models tuned live, no release needed.",
      size=13, color=GREEN_HI, font=BODY_MED)
pageno(s, 10, on_dark=True); foot(s, on_dark=True)

# ====================================================== 11 DELIVERY ==========
s = slide(PAPER)
kicker(s, "Delivery plan")
h1(s, "A phased rollout, no big bang")
phases = [("PHASE 0", "Weeks 1–2", "Foundations", "Stand up the monorepo, remove the vendor lock-ins, provision the free tiers.", GREEN),
          ("PHASE 1", "Weeks 3–5", "Platform core", "Tenants, billing, permissions, gateway, caching and the queue.", BLUE),
          ("PHASE 2", "Weeks 6–10", "Move the services", "Migrate the three services one at a time. Rebuild the AI properly.", INK),
          ("PHASE 3", "Weeks 11–12", "Launch ready", "Marketing funnel, ads tracking, dashboards, load test, sign-off.", AMBER)]
base_y = Inches(2.55)
line(s, Inches(1.05), base_y, Inches(12.4), base_y, LINE_2, 2.5)
x, w = Inches(1.05), Inches(2.78)
for i, (p, wk, h, d, c) in enumerate(phases):
    cx = x + w / 2
    oval(s, cx - Inches(0.14), base_y - Inches(0.14), Inches(0.28), Inches(0.28), fill=c)
    oval(s, cx - Inches(0.05), base_y - Inches(0.05), Inches(0.1), Inches(0.1), fill=WHITE)
    card = rrect(s, x, Inches(2.98), w, Inches(2.7), fill=CARD, line=LINE, lw=1, rad=0.08)
    soft_shadow(card, blur=12, dist=4, alpha=93)
    rrect(s, x, Inches(2.98), w, Inches(0.88), fill=c, rad=0.08)
    rect(s, x, Inches(3.5), w, Inches(0.36), fill=c)
    write(tbox(s, x + Inches(0.2), Inches(3.06), w - Inches(0.4), Inches(0.34)),
          p, size=12.5, color=WHITE, font=MONO, tracking=160)
    write(tbox(s, x + Inches(0.2), Inches(3.42), w - Inches(0.4), Inches(0.34)),
          wk, size=13, color=WHITE, font=DISP_SB)
    write(tbox(s, x + Inches(0.2), Inches(3.98), w - Inches(0.4), Inches(0.5)),
          h, size=14.5, color=INK, font=BODY_SB)
    write(tbox(s, x + Inches(0.2), Inches(4.5), w - Inches(0.4), Inches(1.1)),
          d, size=11.5, color=MUTE, font=BODY, spacing=1.15)
    x += w + Inches(0.13)
write(tbox(s, Inches(1.05), Inches(6.05), Inches(11), Inches(0.5)),
      "Each phase ships something usable. We can pause or reprioritize at any boundary.",
      size=13, color=SLATE, font=BODY_MED)
foot(s); pageno(s, 11)

# ====================================================== 12 GTM ===============
s = slide(PAPER)
kicker(s, "Go to market")
h1(s, "Built to run paid acquisition")
funnel = [("Ad click", 6.6, BLUE, BLUE_DEEP), ("Landing page", 5.6, BLUE, BLUE_DEEP),
          ("Sign up", 4.6, GREEN, GREEN_DEEP), ("Checkout", 3.6, GREEN, GREEN_DEEP),
          ("Active customer", 2.6, INK, INK_2)]
fy = Inches(2.2)
for name, w, c, g in funnel:
    x = Inches(0.9) + (Inches(6.6) - Inches(w)) / 2
    b = rrect(s, x, fy, Inches(w), Inches(0.72), fill=c, grad_to=g, gangle=0, rad=0.14)
    soft_shadow(b, blur=8, dist=3, alpha=92)
    write(b, name, size=13.5, color=WHITE, font=BODY_SB, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    fy += Inches(0.86)
write(tbox(s, Inches(8.1), Inches(1.95), Inches(4.6), Inches(0.4)),
      "Everything ads need, in place", size=15, color=INK, font=DISP_SB)
ready = ["Fast landing pages tuned per service", "Clear pricing and a frictionless trial",
         "Self-serve signup with instant access", "Accurate conversion tracking for Google",
         "Search-friendly pages for organic reach", "Analytics to see what each ad returns"]
ry = Inches(2.5)
for r in ready:
    chk = rrect(s, Inches(8.1), ry, Inches(0.42), Inches(0.42), fill=GREEN_TINT, rad=0.25)
    write(chk, "✓", size=15, color=GREEN_DEEP, font=DISPLAY, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    write(tbox(s, Inches(8.62), ry + Inches(0.02), Inches(4.1), Inches(0.42)),
          r, size=13, color=SLATE, font=BODY_MED, anchor=MSO_ANCHOR.MIDDLE)
    ry += Inches(0.62)
foot(s); pageno(s, 12)

# ====================================================== 13 CLOSING ===========
s = slide(INK)
rect(s, 0, 0, EMU_W, Inches(0.14), fill=GREEN)
rect(s, 0, 0, Inches(5.6), EMU_H, fill=BLUE_DEEP, grad_to=INK, gangle=120)
m = rrect(s, Inches(0.75), Inches(0.7), Inches(0.52), Inches(0.52), fill=GREEN, rad=0.22)
write(m, "Z", size=24, color=INK, font=DISPLAY, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
write(tbox(s, Inches(1.4), Inches(0.74), Inches(5), Inches(0.45)),
      "ZEUS CONSULTING", size=13, color=WHITE, font=DISP_SB, tracking=180, anchor=MSO_ANCHOR.MIDDLE)
write(tbox(s, Inches(0.75), Inches(2.45), Inches(12), Inches(0.4)),
      "THE ASK", size=12, color=GREEN, font=MONO, tracking=300)
write(tbox(s, Inches(0.7), Inches(2.9), Inches(12), Inches(1.3)),
      "Approve the platform rebuild.", size=42, color=WHITE, font=DISPLAY)
write(tbox(s, Inches(0.75), Inches(4.15), Inches(11.6), Inches(1.2)),
      "We turn one fragile product into a platform of services we can sell, price and scale "
      "independently — removing the dependency we don't control, and running at zero fixed "
      "cost while we grow.", size=15.5, color=RGBColor(0xC2, 0xC9, 0xDD), font=BODY, spacing=1.28)
chips = [("Start with Phase 0", GREEN), ("A twelve-week path", BLUE_HI), ("Zero fixed cost", WHITE)]
cx = Inches(0.75)
for t, c in chips:
    b = rrect(s, cx, Inches(5.75), Inches(3.72), Inches(0.86), fill=INK_2, line=c, lw=1.5, rad=0.16)
    write(b, t, size=14.5, color=c, font=BODY_SB, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    cx += Inches(3.96)
pageno(s, 13, on_dark=True)

# ------------------------------------------------------------------- save ----
out = os.path.join(os.path.dirname(__file__), "Zeus_Platform_Modernization.pptx")
prs.save(out)
print("Saved:", out, "| slides:", len(prs.slides._sldIdLst))
