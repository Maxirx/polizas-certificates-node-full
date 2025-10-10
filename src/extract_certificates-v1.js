
// Extractor de certificados "SEGURO DE AUTOMOTORES / CERTIFICADO DE COBERTURA"
// ESM + pdfjs-dist v5.4.296 (legacy) + fs-extra v11.3.2 + pdf-lib
// Uso: node src/extract_certificates.js <archivo.pdf> [--out ./salidas] [--plate=AG552FA]

import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import fsExtra from "fs-extra";

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("Uso: node src/extract_certificates.js <archivo.pdf> [--out ./salidas] [--plate=AG552FA]");
  process.exit(1);
}
const INPUT = args[0];
const outFlagIdx = args.indexOf("--out");
const OUT_DIR = outFlagIdx !== -1 ? args[outFlagIdx + 1] : "./salidas";
const plateArg = (args.find(a => a.startsWith("--plate=")) || "").split("=")[1] || null;

const HDR1 = "SEGURO DE AUTOMOTORES";
const HDR2 = "CERTIFICADO DE COBERTURA";
const NM_MAX = 20;

// Helpers
const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
const sanitize = (s) => norm(s).replace(/[\/\\:*?"<>|]+/g, "-");
const toISO = (ddmmyyyy) => {
  const m = /^([0-3]\d)-([01]\d)-(\d{4})$/.exec(ddmmyyyy || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const normalizePlate = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
const plateFlexRegExp = (plate) => {
  const P = normalizePlate(plate);
  if (!/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(P)) return new RegExp(plate, "i"); // fallback genérico
  const A = P.slice(0, 2), N = P.slice(2, 5), B = P.slice(5, 7);
  return new RegExp(`${A[0]}\\s*${A[1]}\\s*${N[0]}\\s*${N[1]}\\s*${N[2]}\\s*${B[0]}\\s*${B[1]}`, "i");
};

// Regex
const RX = {
  tomador: /(?:TOMADOR)\s*[:\-]?\s*([A-ZÁÉÍÓÚÜÑ0-9 .,&\-\/]+)(?:\n|$)/i,
  tipo: /TIPO\s*[:\-]?\s*([^\n\r]+)/i,
  marca: /MARCA\s*[:\-]?\s*([A-ZÁÉÍÓÚÜÑ0-9 .,&\-\/]+)/i,
  anio: /AÑO\s*DE\s*FABRICACI[ÓO]N\s*[:\-]?\s*(\d{4})/i,
  patenteLabel: /PATENTE\s*[:\-]?\s*([A-Z0-9\-\s]{5,15})/i,
  vigencia: /(?:Desde|DESDE)\s*(?:\d{1,2}\s*hs\.?\s*del\s*)?([0-3]\d-[01]\d-\d{4}).*?(?:Hasta|HASTA)\s*(?:\d{1,2}\s*hs\.?\s*del\s*)?([0-3]\d-[01]\d-\d{4})/is,
  poliza: /P[ÓO]LIZA\s*[:#NºNo\. ]*\s*([0-9-]{5,})/i,
  motor: /MOTOR\s*[:\-]?\s*([A-Z0-9\-]+)/i,
  chasis: /CHASIS\s*[:\-]?\s*([A-Z0-9\-]+)/i,
  oneOfN: /\b(\d{1,3})\s+de\s+(\d{1,3})\b/ig,
};

async function getAllPagesText(bufferOrUint8) {
  // PDF.js requiere Uint8Array
  const data = bufferOrUint8 instanceof Uint8Array ? bufferOrUint8 : new Uint8Array(bufferOrUint8);
  const task = getDocument({ data });
  const doc = await task.promise;
  const texts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    /* const page = await doc.getPage(i);
    const content = await page.getTextContent();*/
    const pages = await Promise.all(
      Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1))
    );
    const text = content.items.map(it => it.str).join(" ");

    const texts = await Promise.all(pages.map(async (page) => {
      const content = await page.getTextContent();
      return content.items.map(it => it.str).join(" ");
    }));

    texts.push(text);
  }
  return texts;
}

function findCertificateBlocks(pagesText) {
  const blocks = [];
  const visited = new Set();
  for (let i = 0; i < pagesText.length; i++) {
    if (visited.has(i)) continue;
    const U = (pagesText[i] || "").toUpperCase();
    if (U.includes(HDR1) && U.includes(HDR2)) {
      const matches = [...(pagesText[i] || "").matchAll(RX.oneOfN)]
        .map(m => ({ cur: parseInt(m[1], 10), tot: parseInt(m[2], 10) }))
        .filter(x => Number.isFinite(x.cur) && Number.isFinite(x.tot) && x.tot <= NM_MAX && x.cur >= 1 && x.cur <= x.tot);

      let start = i, end = i;
      if (matches.length) {
        matches.sort((a, b) => (a.cur === 1 ? 0 : 1) - (b.cur === 1 ? 0 : 1) || b.tot - a.tot);
        const best = matches[0];
        start = i - (best.cur - 1);
        end = start + best.tot - 1;
      } else {
        end = i;
        for (let j = i + 1; j < Math.min(pagesText.length, i + 10); j++) {
          const Uj = (pagesText[j] || "").toUpperCase();
          if (Uj.includes(HDR1) && Uj.includes(HDR2)) end = j;
          else break;
        }
      }
      start = Math.max(0, start);
      end = Math.min(pagesText.length - 1, end);
      for (let k = start; k <= end; k++) visited.add(k);
      blocks.push({ start, end });
    }
  }
  return blocks;
}

function extractFieldsFromText(txt, plateHint) {
  const out = {
    tomador: null, tipo: null, anio: null, patente: null,
    vigencia_desde: null, vigencia_hasta: null,
    vigencia_desde_iso: null, vigencia_hasta_iso: null,
    poliza_numero: null, poliza_numero_sin_guiones: null,
    motor: null, chasis: null,
  };
  let m;
  if ((m = txt.match(RX.tomador))) out.tomador = norm(m[1]);
  if ((m = txt.match(RX.tipo))) out.tipo = norm(m[1]);
  if ((m = txt.match(RX.marca))) out.marca = norm(m[1]);
  if ((m = txt.match(RX.anio))) out.anio = norm(m[1]);
  if ((m = txt.match(RX.vigencia))) {
    out.vigencia_desde = norm(m[1]);
    out.vigencia_hasta = norm(m[2]);
    out.vigencia_desde_iso = toISO(out.vigencia_desde);
    out.vigencia_hasta_iso = toISO(out.vigencia_hasta);
  }
  if ((m = txt.match(RX.poliza))) {
    out.poliza_numero = norm(m[1]);
    out.poliza_numero_sin_guiones = out.poliza_numero.replace(/-/g, "");
  }
  if ((m = txt.match(RX.motor))) out.motor = m[1].toUpperCase();
  if ((m = txt.match(RX.chasis))) out.chasis = m[1].toUpperCase();

  if ((m = txt.match(RX.patenteLabel))) {
    out.patente = normalizePlate(m[1]);
  } else {
    const patAA999AA = /([A-Z]{2})[\s\-]*([0-9]{3})[\s\-]*([A-Z]{2})/ig;
    let mm;
    while ((mm = patAA999AA.exec(txt)) !== null) {
      const cand = `${mm[1]}${mm[2]}${mm[3]}`.toUpperCase();
      if (plateHint && normalizePlate(plateHint) === cand) { out.patente = cand; break; }
      if (!out.patente) out.patente = cand;
    }
  }
  return out;
}

async function slicePagesToPdf(bufferOrUint8, startIdx, endIdx, outPath) {

  endIdx = Math.min(endIdx, src.getPageCount() - 1);


  //const srcBytes = bufferOrUint8 instanceof Uint8Array ? bufferOrUint8 : bufferOrUint8;

  const srcBytes = bufferOrUint8 instanceof Uint8Array ? bufferOrUint8 : new Uint8Array(bufferOrUint8);
  const src = await PDFDocument.load(srcBytes);
  const out = await PDFDocument.create();
  const idxs = [];
  for (let i = startIdx; i <= endIdx; i++) idxs.push(i);
  const pages = await out.copyPages(src, idxs);
  for (const p of pages) out.addPage(p);
  await fsExtra.ensureDir(path.dirname(outPath));
  const bytes = await out.save();
  await fsExtra.writeFile(outPath, bytes);
}

function merge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) {
    if (!out[k] && b[k]) out[k] = b[k];
  }
  return out;
}

async function processAll(bufferOrUint8, pagesText, plateFilter /* string | null */) {
  const blocks = findCertificateBlocks(pagesText);
  const results = [];

  for (const blk of blocks) {
    const textSlice = pagesText.slice(blk.start, blk.end + 1).join("\n");
    let data = extractFieldsFromText(textSlice, plateFilter);

    if (!data.tomador || !data.tipo || !data.anio || !data.patente || !data.poliza_numero || !data.vigencia_desde || !data.motor || !data.chasis) {
      data = merge(data, extractFieldsFromText(pagesText[blk.start] || "", plateFilter));
    }

    if (plateFilter) {
      const flex = plateFlexRegExp(plateFilter);
      const matchesFilter =
        (data.patente && normalizePlate(data.patente) === normalizePlate(plateFilter)) ||
        flex.test(textSlice) ||
        flex.test(pagesText[blk.start] || "");
      if (!matchesFilter) continue;
      if (!data.patente) data.patente = normalizePlate(plateFilter);
    }

    console.log("Datos extraídos:", data);
    const tomadorSafe = sanitize(data.tomador || "Tomador_Desconocido");

    const marcaSafe = sanitize(data.marca || "Marca_Desconocida");
    const tipoAnioSafe = sanitize(`${data.tipo || "Tipo"} ${data.anio || "Año"}`);
    console.log(`Procesando certificado: ${data.tipo || "Tipo"} ${data.anio || "Año"} (${data.patente || "PATENTE_DESC"})`);
    const patente = (data.patente || "PATENTE_DESC").toUpperCase();
    const targetDir = path.join(OUT_DIR, tomadorSafe, marcaSafe, tipoAnioSafe, patente);
    const pdfOut = path.join(targetDir, `poliza_${patente}.pdf`);
    const jsonOut = path.join(targetDir, `poliza_${patente}.json`);



    await fsExtra.ensureDir(targetDir);

    await slicePagesToPdf(bufferOrUint8, blk.start, blk.end, pdfOut);


    const payload = {
      tomador: data.tomador || null,
      tipo: data.tipo || null,
      anio_fabricacion: data.anio || null,
      patente,
      marca: data.marca || null,
      vigencia_desde: data.vigencia_desde || null,
      vigencia_hasta: data.vigencia_hasta || null,
      vigencia_desde_iso: data.vigencia_desde_iso || toISO(data.vigencia_desde || ""),
      vigencia_hasta_iso: data.vigencia_hasta_iso || toISO(data.vigencia_hasta || ""),
      poliza_numero: data.poliza_numero || null,
      poliza_numero_sin_guiones: data.poliza_numero ? data.poliza_numero.replace(/-/g, "") : null,
      motor: data.motor || null,
      chasis: data.chasis || null,
      archivo_pdf: pdfOut,
      paginas: `${blk.end - blk.start + 1} páginas`,
      rango_paginas_1based: `${blk.start + 1}-${blk.end + 1}`
    };
    await fsExtra.writeJSON(jsonOut, payload, { spaces: 2 });

    results.push({ dir: targetDir, pdf: pdfOut, json: jsonOut, meta: payload });
  }

  return results;
}

(async () => {
  if (!(await fsExtra.pathExists(INPUT))) {
    console.error("No existe el archivo:", INPUT);
    process.exit(1);
  }

  // Buffer -> Uint8Array para PDF.js
  const buffer = await fsExtra.readFile(INPUT);
  const dataBytes = new Uint8Array(buffer);

  const pagesText = await getAllPagesText(dataBytes);

  let plateFilter = plateArg ? normalizePlate(plateArg) : null;

  // Interactivo si no se pasó --plate
  if (!plateFilter) {
    const rl = readline.createInterface({ input, output });
    const answer = await rl.question("Ingresá una patente (ENTER para procesar todas): ");
    rl.close();
    plateFilter = norm(answer) ? normalizePlate(answer) : null;
  }

  const results = await processAll(dataBytes, pagesText, plateFilter);

  if (!results.length) {
    console.log(plateFilter
      ? `No se encontró certificado de cobertura para la patente ${plateFilter}.`
      : "No se detectaron certificados de cobertura en el PDF.");
    process.exit(0);
  }

  console.log("✅ Procesamiento finalizado:");
  for (const r of results) {
    console.log("—", r.meta.patente, "→", r.pdf);
  }
  console.log(`Total certificados exportados: ${results.length}`);
})().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
