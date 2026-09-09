import { extractPdfText, terminateOcr } from "../src/pdf.js";
const files = process.argv.slice(2);
for (const f of files) {
  const t0 = Date.now();
  const r = await extractPdfText(f);
  console.log(`\n===== ${f} | pages ${r.pages} | ocr ${r.ocr} | ${r.text.length} car. | ${Date.now()-t0} ms`);
  console.log(r.text.slice(0, 2500));
}
await terminateOcr();
