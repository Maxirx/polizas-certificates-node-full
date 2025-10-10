// Extractor de certificados "SEGURO DE AUTOMOTORES / CERTIFICADO DE COBERTURA"
// Versión v3 (2025-10) — con extracción precisa y estructura de carpetas extendida
// Uso: node src/extract_certificates_v3.js <archivo.pdf> [--out ./salidas] [--plate=AG552FA]

import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import fsExtra from "fs-extra";

const args = process.argv.slice(2);
if (args.length < 1) {
    console.error("Uso: node src/extract_certificates_v3.js <archivo.pdf> [--out ./salidas] [--plate=AG552FA]");
    process.exit(1);
}
const INPUT = args[0];
const outFlagIdx = args.indexOf("--out");
const OUT_DIR = outFlagIdx !== -1 ? args[outFlagIdx + 1] : "./salidas";
const plateArg = (args.find(a => a.startsWith("--plate=")) || "").split("=")[1] || null;

const HDR1 = "SEGURO DE AUTOMOTORES";
const HDR2 = "CERTIFICADO DE COBERTURA";
const NM_MAX = 20;

// =====================
// HELPERS
// =====================
const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
const sanitize = (s) => norm(s).replace(/[\/\\:*?"<>|]+/g, "-");
const toISO = (ddmmyyyy) => {
    const m = /^([0-3]?\d)[\-\/]([01]?\d)[\-\/](\d{4})$/.exec(ddmmyyyy || "");
    return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};
const normalizePlate = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
const plateFlexRegExp = (plate) => {
    const P = normalizePlate(plate);
    if (!/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(P)) return new RegExp(plate, "i"); // fallback genérico
    const A = P.slice(0, 2), N = P.slice(2, 5), B = P.slice(5, 7);
    return new RegExp(`${A[0]}\\s*${A[1]}\\s*${N[0]}\\s*${N[1]}\\s*${N[2]}\\s*${B[0]}\\s*${B[1]}`, "i");
};

// =====================
// REGEX BASE
// =====================
const RX = {
    oneOfN: /\b(\d{1,3})\s*(?:de|\/)\s*(\d{1,3})\b/ig,
};

// =====================
// LECTURA DE PDF
// =====================
async function getAllPagesText(bufferOrUint8) {
    const data = bufferOrUint8 instanceof Uint8Array ? bufferOrUint8 : new Uint8Array(bufferOrUint8);
    const task = getDocument({ data });
    const doc = await task.promise;
    const pages = await Promise.all(
        Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1))
    );
    const texts = await Promise.all(pages.map(async (page) => {
        const content = await page.getTextContent();
        return content.items.map(it => it.str).join(" ");
    }));
    return texts;
}

// =====================
// DETECCIÓN DE BLOQUES
// =====================
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

// =====================
// NUEVA EXTRACCIÓN DE CAMPOS (v3)
// =====================
function extractFieldsFromText(txt, plateHint) {
    // 🔧 Preprocesado mejorado
    txt = txt.replace(/(TOMADOR|POLIZA|P[ÓO]LIZA|MARCA|TIPO|AÑO|PATENTE|MOTOR|CHASIS|VIGENCIA|DESDE|HASTA)/gi, "\n$1");

    const out = {
        tomador: null, marca: null, tipo: null, anio: null, patente: null,
        vigencia_desde: null, vigencia_hasta: null,
        vigencia_desde_iso: null, vigencia_hasta_iso: null,
        poliza_numero: null, poliza_numero_sin_guiones: null,
        motor: null, chasis: null,
    };
    let m;

    // 🧍 Tomador - VERSIÓN CORREGIDA
    // Busca después de "hasta" + fecha, capturando solo el nombre antes de RUTA
    if ((m = txt.match(/hasta\s+(?:\d+\s*hs?\.\s*del\s+)?[0-3]?\d[\-\/][01]?\d[\-\/]\d{4}\s+([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ0-9 .,&\-\/]{2,60}?)\s+(?:RUTA|DOMICILIO|CUIT|CT\s)/i))) {
        out.tomador = norm(m[1]);
    }
    // Fallback: busca texto que termina en SRL/SA/S.A. antes de RUTA
    else if ((m = txt.match(/\d{4}\s+([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ0-9 .,&\-\/]{2,60}?\s+(?:SRL|S\.?R\.?L\.?|SA|S\.?A\.?))\s+RUTA/i))) {
        out.tomador = norm(m[1]);
    }
    // Último fallback genérico
    else if ((m = txt.match(/([A-Z][A-Z0-9 .,&\-\/]{3,50}?)\s+RUTA\s+NAC/i))) {
        const candidate = norm(m[1]);
        if (!candidate.includes('CAJA') && !candidate.includes('SEGUROS') && !candidate.includes('hasta')) {
            out.tomador = candidate;
        }
    }

    // 🚗 Marca
    if ((m = txt.match(/MARCA\s*[:\-]?\s*([A-ZÁÉÍÓÚÜÑ0-9 .,&\-\/]+?)(?=\s+(?:TIPO|AÑO|PATENTE)\b)/i)))
        out.marca = norm(m[1]);

    // 🚙 Tipo
    if ((m = txt.match(/TIPO\s*[:\-]?\s*([A-ZÁÉÍÓÚÜÑ0-9 .,&\-\/]+?)(?=\s+(?:AÑO|PATENTE)\b)/i)))
        out.tipo = norm(m[1]);

    // 🏗 Año de fabricación
    if ((m = txt.match(/AÑO\s*(?:DE\s*)?FABRICACI[ÓO]N\s*[:\-]?\s*(\d{4})/i)))
        out.anio = m[1];

    // 🔢 Poliza número
    if ((m = txt.match(/(?:POLIZA|P[ÓO]LIZA)\s*(?:N[º°]|NUM|NUMERO|#|Nº)?\s*[:\-]?\s*([0-9\-]{7,})/i))) {
        out.poliza_numero = norm(m[1]);
    } else if ((m = txt.match(/\b(\d{4,}-\d{6,}-\d{2,})\b/))) {
        out.poliza_numero = norm(m[1]);
    }
    if (out.poliza_numero) {
        out.poliza_numero_sin_guiones = out.poliza_numero.replace(/[\s\-]/g, "");
    }

    // 📆 Vigencia
    if ((m = txt.match(/desde\s+(?:\d+\s*hs?\.\s*del\s+)?([0-3]?\d[\-\/][01]?\d[\-\/]\d{4})[\s\S]{0,100}?hasta\s+(?:\d+\s*hs?\.\s*del\s+)?([0-3]?\d[\-\/][01]?\d[\-\/]\d{4})/is))) {
        out.vigencia_desde = m[1].replace(/\//g, "-");
        out.vigencia_hasta = m[2].replace(/\//g, "-");
        out.vigencia_desde_iso = toISO(out.vigencia_desde);
        out.vigencia_hasta_iso = toISO(out.vigencia_hasta);
    }

    // 🧩 Patente
    if ((m = txt.match(/PATENTE\s*[:\-]?\s*([A-Z0-9\-\s]{5,15}?)(?=\s+(?:MOTOR|CHASIS|USO)\b)/i))) {
        out.patente = normalizePlate(m[1]);
    } else {
        const patAA999AA = /([A-Z]{2})[\s\-]*([0-9]{3})[\s\-]*([A-Z]{2})/ig;
        let mm;
        while ((mm = patAA999AA.exec(txt)) !== null) {
            const cand = `${mm[1]}${mm[2]}${mm[3]}`.toUpperCase();
            if (plateHint && normalizePlate(plateHint) === cand) {
                out.patente = cand;
                break;
            }
            if (!out.patente) out.patente = cand;
        }
    }

    // ⚙️ Motor
    if ((m = txt.match(/MOTOR\s*[:\-]?\s*([A-Z0-9\-]+)(?=\s+(?:CHASIS|USO|SUMA|$))/i)))
        out.motor = m[1].toUpperCase();

    // 🧱 Chasis
    if ((m = txt.match(/CHASIS\s*[:\-]?\s*([A-Z0-9\-]+)/i)))
        out.chasis = m[1].toUpperCase();

    return out;
}

// =====================
// FUNCIONES AUXILIARES
// =====================
function merge(a, b) {
    const out = { ...a };
    for (const k of Object.keys(b)) {
        if (!out[k] && b[k]) out[k] = b[k];
    }
    return out;
}

async function slicePagesToPdf(bufferOrUint8, startIdx, endIdx, outPath) {
    try {
        // Asegurar que tenemos un Uint8Array válido
        let srcBytes;
        if (bufferOrUint8 instanceof Uint8Array) {
            srcBytes = bufferOrUint8;
        } else if (Buffer.isBuffer(bufferOrUint8)) {
            srcBytes = new Uint8Array(bufferOrUint8);
        } else {
            throw new Error("Input debe ser Buffer o Uint8Array");
        }

        // Verificar que el PDF tiene header válido
        const headerStr = String.fromCharCode(...srcBytes.slice(0, 5));
        if (!headerStr.startsWith('%PDF')) {
            console.error("❌ Datos no son un PDF válido. Header:", headerStr);
            throw new Error("El buffer no contiene un PDF válido");
        }

        console.log(`📄 Cargando PDF (${srcBytes.length} bytes)...`);
        const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });

        const totalPages = src.getPageCount();
        console.log(`📑 PDF tiene ${totalPages} páginas`);

        const out = await PDFDocument.create();

        // Validar índices
        startIdx = Math.max(0, startIdx);
        endIdx = Math.min(endIdx, totalPages - 1);

        console.log(`✂️ Extrayendo páginas ${startIdx + 1} a ${endIdx + 1}...`);

        const idxs = Array.from({ length: endIdx - startIdx + 1 }, (_, i) => startIdx + i);
        const pages = await out.copyPages(src, idxs);

        for (const p of pages) {
            out.addPage(p);
        }

        await fsExtra.ensureDir(path.dirname(outPath));
        const bytes = await out.save();
        await fsExtra.writeFile(outPath, bytes);

        console.log(`✅ PDF guardado: ${outPath}`);
    } catch (error) {
        console.error(`❌ Error al procesar PDF:`, error.message);
        console.error(`   Archivo destino: ${outPath}`);
        console.error(`   Páginas: ${startIdx}-${endIdx}`);
        throw error;
    }
}
// =====================
// PROCESAR TODO
// =====================
async function processAll(bufferOrUint8, pagesText, plateFilter) {
    const blocks = findCertificateBlocks(pagesText);
    if (!blocks.length) console.warn("⚠️ No se encontraron certificados de cobertura en el PDF.");
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
        const patente = (data.patente || "PATENTE_DESC").toUpperCase();

        const targetDir = path.join(OUT_DIR, tomadorSafe, marcaSafe, tipoAnioSafe, patente);
        const pdfOut = path.join(targetDir, `poliza_${patente}.pdf`);
        const jsonOut = path.join(targetDir, `poliza_${patente}.json`);

        await fsExtra.ensureDir(targetDir);
        await slicePagesToPdf(bufferOrUint8, blk.start, blk.end, pdfOut);

        const payload = {
            tomador: data.tomador || null,
            marca: data.marca || null,
            tipo: data.tipo || null,
            anio_fabricacion: data.anio || null,
            patente,
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
            rango_paginas_1based: `${blk.start + 1}-${blk.end + 1}`,
        };
        await fsExtra.writeJSON(jsonOut, payload, { spaces: 2 });

        results.push({ dir: targetDir, pdf: pdfOut, json: jsonOut, meta: payload });
    }

    return results;
}

// =====================
// MAIN
// =====================
(async () => {
    if (!(await fsExtra.pathExists(INPUT))) {
        console.error("No existe el archivo:", INPUT);
        process.exit(1);
    }

    console.log(`📂 Leyendo: ${INPUT}`);
    const buffer = await fsExtra.readFile(INPUT);
    console.log(`✅ Archivo leído: ${buffer.length} bytes`);

    // Verificar que es un PDF válido
    const headerCheck = buffer.toString('utf-8', 0, 5);
    if (!headerCheck.startsWith('%PDF')) {
        console.error("❌ El archivo no parece ser un PDF válido");
        console.error("   Header encontrado:", headerCheck);
        process.exit(1);
    }
    console.log(`✅ Header PDF válido: ${headerCheck}`);

    // ⚠️ CRÍTICO: Crear DOS copias independientes para evitar detached buffer
    const dataBytesForPdfjs = new Uint8Array(buffer);  // Para pdfjs (lectura de texto)
    const dataBytesForPdflib = new Uint8Array(buffer); // Para pdf-lib (crear PDFs)

    console.log(`🔄 Extrayendo texto con pdfjs...`);
    const pagesText = await getAllPagesText(dataBytesForPdfjs);
    console.log(`✅ ${pagesText.length} páginas procesadas`);

    let plateFilter = plateArg ? normalizePlate(plateArg) : null;
    if (!plateFilter) {
        const rl = readline.createInterface({ input, output });
        const answer = await rl.question("Ingresá una patente (ENTER para procesar todas): ");
        rl.close();
        plateFilter = norm(answer) ? normalizePlate(answer) : null;
    }

    console.log(`\n🔍 Procesando certificados...`);
    // ⚠️ PASAR EL BUFFER FRESCO, NO EL QUE USÓ PDFJS
    const results = await processAll(dataBytesForPdflib, pagesText, plateFilter);

    if (!results.length) {
        console.log(plateFilter
            ? `⚠️ No se encontró certificado de cobertura para la patente ${plateFilter}.`
            : "⚠️ No se detectaron certificados de cobertura en el PDF.");
        process.exit(0);
    }

    console.log("\n✅ Procesamiento finalizado:");
    for (const r of results) {
        console.log("—", r.meta.patente, "→", r.pdf);
    }
    console.log(`Total certificados exportados: ${results.length}`);
})().catch(err => {
    console.error("❌ Error fatal:", err);
    process.exit(1);
});
