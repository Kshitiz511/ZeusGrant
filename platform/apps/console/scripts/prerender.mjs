// Post-build prerender for public routes (DEC-8).
//
// The console is a SPA: one empty index.html. Crawlers and the Google Ads
// landing-page reviewer see nothing. This writes a real HTML file per public
// route, each with its own <title>, description, canonical, Open Graph,
// Twitter card and JSON-LD, and the page's actual text inside #root.
// React's createRoot replaces that markup on mount, so visitors see the app
// exactly as before; the static text exists for whoever does not run JS.
//
// Content comes from the same modules the app renders (src/content/*), so the
// prerendered copy cannot drift from what visitors see.

import { build } from "esbuild";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const SITE = (process.env.ZEUS_SITE_URL ?? "https://zeus-platform-dun.vercel.app").replace(/\/$/, "");
const NAME = "Zeus";

async function loadContent() {
  const out = join(ROOT, "node_modules", ".prerender", "content.mjs");
  await build({
    stdin: {
      contents: 'export * from "./src/content/legal.ts"; export * from "./src/content/pricing.ts";',
      resolveDir: ROOT,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    logLevel: "error",
  });
  const mod = await import(pathToFileURL(out).href + `?t=${Date.now()}`);
  rmSync(dirname(out), { recursive: true, force: true });
  return mod;
}

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ORG = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Zeus Consulting",
  url: SITE,
  sameAs: ["https://zeusconsultingservices.com"],
};

function head({ path, title, description, jsonld = [], noindex = false }) {
  const url = SITE + (path === "/" ? "/" : path);
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    noindex ? `<meta name="robots" content="noindex" />` : "",
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${NAME}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${SITE}/og.jpg" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    ...jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`),
  ];
  return tags.filter(Boolean).join("\n    ");
}

function landingBody(PRICING) {
  const tiers = Object.entries(PRICING)
    .map(
      ([mod, list]) =>
        `<h3>${mod === "grant_intelligence" ? "Grant Intelligence" : "Contract Compliance"}</h3><ul>` +
        list
          .map((t) => `<li><strong>${esc(t.name)} — $${t.price}/month.</strong> ${esc(t.tagline)} ${t.features.map(esc).join(", ")}.</li>`)
          .join("") +
        "</ul>",
    )
    .join("");
  return `<main>
<h1>Win the funding. Then prove you delivered.</h1>
<p>Zeus is two services on one platform. Grant Intelligence scores every open opportunity against your profile. Contract Compliance reads the agreement you signed and tracks every obligation in it. Buy either one on its own.</p>
<h2>How it works</h2>
<ol>
<li>Describe your organisation once — eligibility type, where you operate, what you fund, the award sizes you can absorb.</li>
<li>Get matches with the reasoning attached: every score is shown with what produced it.</li>
<li>Upload the agreement you win, as PDF or Word.</li>
<li>Work the obligations it contains — what is owed, by whom, by when — each carrying the exact clause it came from.</li>
</ol>
<h2>Security</h2>
<ul>
<li>Tenant isolation enforced by row-level security in Postgres.</li>
<li>Access tokens in memory only; rotating, httpOnly refresh cookies with reuse detection.</li>
<li>An append-only audit trail the application cannot edit.</li>
<li>Uploaded documents treated as data, never as instructions.</li>
</ul>
<h2 id="pricing">Pricing</h2>
<p>Priced per service, billed monthly. Start on a free trial; no card needed.</p>
${tiers}
<p><a href="/signup">Create your account</a> · <a href="/login">Sign in</a> · <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a></p>
</main>`;
}

function legalBody(doc) {
  return `<main><h1>${esc(doc.title)}</h1><p>Last updated ${esc(doc.updated)}</p>${doc.sections
    .map((s) => `<h2>${esc(s.heading)}</h2>${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}`)
    .join("")}<p><a href="/">Home</a></p></main>`;
}

async function main() {
  const { PRIVACY, TERMS, PRICING } = await loadContent();
  const template = readFileSync(join(DIST, "index.html"), "utf8");
  if (!template.includes('<div id="root"></div>') || !template.includes("<title>")) {
    throw new Error("prerender: dist/index.html does not have the expected shape");
  }
  // The untouched shell is what deep links into the signed-in console get
  // (api/index.py falls back to it), so they never flash marketing copy.
  writeFileSync(join(DIST, "_spa.html"), template);
  const base = template.replace(/\s*<meta name="description"[^>]*>/, "");

  const prices = Object.values(PRICING).flat().map((t) => t.price);
  const software = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: SITE,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "USD",
      lowPrice: Math.min(...prices),
      highPrice: Math.max(...prices),
    },
  };

  const landing = {
    title: "Zeus — Grant matching and contract compliance for funded organisations",
    description:
      "Score every open federal grant against your organisation with the reasoning shown, then track every obligation in the agreement you win, each cited to its clause.",
    jsonld: [ORG, software],
    body: landingBody(PRICING),
  };

  const routes = [
    { path: "/", ...landing },
    {
      ...landing,
      path: "/pricing",
      title: "Pricing — Zeus",
      description:
        "Grant Intelligence from $49/month and Contract Compliance from $39/month. Each service billed separately, monthly, with a free trial and no card required.",
    },
    ...[PRIVACY, TERMS].map((d) => ({
      path: d.path,
      title: `${d.title} — Zeus`,
      description: d.description,
      jsonld: [ORG],
      body: legalBody(d),
    })),
    { path: "/login", title: "Sign in — Zeus", description: "Sign in to your Zeus workspace.", noindex: true, body: "" },
    { path: "/signup", title: "Create your account — Zeus", description: "Start a free Zeus trial. No card required.", noindex: true, body: "" },
  ];

  for (const r of routes) {
    const html = base
      .replace(/<title>[\s\S]*?<\/title>/, head(r))
      .replace('<div id="root"></div>', `<div id="root">${r.body ?? ""}</div>`);
    const file = r.path === "/" ? join(DIST, "index.html") : join(DIST, r.path.slice(1), "index.html");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
  }

  const indexable = routes.filter((r) => !r.noindex);
  writeFileSync(
    join(DIST, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable
      .map((r) => `  <url><loc>${SITE}${r.path === "/" ? "/" : r.path}</loc></url>`)
      .join("\n")}\n</urlset>\n`,
  );
  writeFileSync(
    join(DIST, "robots.txt"),
    `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app\nDisallow: /admin\n\nSitemap: ${SITE}/sitemap.xml\n`,
  );
  console.log(`prerender: ${routes.length} routes, ${indexable.length} in sitemap (${SITE})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
