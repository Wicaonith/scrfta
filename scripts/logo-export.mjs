// Exporte les logos SVG de docs/logo/ en PNG carrés, et produit une planche de comparaison.
//   node scripts/logo-export.mjs [taille]        (défaut : 256, la taille conseillée pour GitLab)
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const dir = "docs/logo";
const taille = Number(process.argv[2]) || 256;
const svgs = (await fs.readdir(dir)).filter((f) => f.endsWith(".svg")).sort();

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

for (const f of svgs) {
  const svg = await fs.readFile(path.join(dir, f), "utf8");
  await page.setViewportSize({ width: taille, height: taille });
  await page.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block;width:${taille}px;height:${taille}px}</style>${svg}`
  );
  const png = path.join(dir, f.replace(/\.svg$/, ".png"));
  await page.locator("svg").screenshot({ path: png, omitBackground: true });
  console.log(`${png} (${taille}×${taille})`);
}

// Planche de comparaison : chaque logo en grand et à la taille réelle d'un avatar GitLab
const cases = await Promise.all(
  svgs.map(async (f) => ({ nom: f.replace(/\.svg$/, ""), svg: await fs.readFile(path.join(dir, f), "utf8") }))
);
const cellule = (c) => `
  <div class="col">
    <div class="nom">${c.nom}</div>
    <div class="grand">${c.svg}</div>
    <div class="petits">
      <span class="p64">${c.svg}</span>
      <span class="p40">${c.svg}</span>
      <span class="p24">${c.svg}</span>
    </div>
    <div class="legende">64 px · 40 px · 24 px</div>
  </div>`;

await page.setViewportSize({ width: 1000, height: 560 });
await page.setContent(`<style>
  body { margin:0; background:#ffffff; font:14px system-ui, sans-serif; color:#1d1d1b }
  .planche { display:flex; gap:28px; padding:28px }
  .col { flex:1; text-align:center }
  .nom { font-weight:600; margin-bottom:12px }
  .grand svg { width:230px; height:230px }
  .petits { display:flex; gap:16px; align-items:center; justify-content:center; margin-top:18px }
  .p64 svg { width:64px; height:64px } .p40 svg { width:40px; height:40px } .p24 svg { width:24px; height:24px }
  .legende { color:#6b6b66; font-size:12px; margin-top:8px }
</style><div class="planche">${cases.map(cellule).join("")}</div>`);
const planche = path.join(dir, "comparaison.png");
await page.locator(".planche").screenshot({ path: planche });
console.log(`${planche}`);

await browser.close();
