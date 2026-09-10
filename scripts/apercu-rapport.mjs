// Ouvre output/rapport/index.html dans Chromium headless, vérifie qu'il n'y a pas d'erreur JS et fait une capture.
import { chromium } from "playwright";
import path from "node:path";
import { pathToFileURL } from "node:url";
const out = process.argv[2] || "output";
const shot = process.argv[3] || "rapport.png";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(pathToFileURL(path.resolve(out, "rapport/index.html")).href);
console.log("erreurs JS :", errors.length ? errors : "aucune");
console.log((await page.locator("#diff").innerText()).slice(0, 1500));
await page.screenshot({ path: shot, fullPage: true });
await browser.close();
