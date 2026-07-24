// Extractor de certificados "SEGURO DE AUTOMOTORES / CERTIFICADO DE COBERTURA"
// VersiÃ³n v3 (2025-10) â€” con extracciÃ³n precisa y estructura de carpetas extendida
// Uso: node src/extract_certificates_v3.js <archivo.pdf> [--out ./salidas] [--plate=AG552FA]

import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import fsExtra from "fs-extra";
import { promises as fs } from "node:fs";

const args = process.argv.slice(2);
if (args.length < 1) {
    console.error("Uso: node src/extract_certificates.js <archivo.pdf|carpeta> [--out ./salidas] [--plate=AG552FA]");
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
    if (!/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(P)) return new RegExp(plate, "i"); // fallback genÃ©rico
    const A = P.slice(0, 2), N = P.slice(2, 5), B = P.slice(5, 7);
    return new RegExp(`${A[0]}\\s*${A[1]}\\s*${N[0]}\\s*${N[1]}\\s*${N[2]}\\s*${B[0]}\\s*${B[1]}`, "i");
};

// =====================
// BUSCAR ARCHIVOS PDF
// =====================
async function findPdfFiles(inputPath) {
    const stats = await fs.stat(inputPath);
    if (stats.isFile()) {
        return [inputPath];
    } else if (stats.isDirectory()) {
        const files = await fs.readdir(inputPath, { recursive: true });
        return files
            .filter(file => file.toLowerCase().endsWith('.pdf'))
            .map(file => path.join(inputPath, file));
    } else {
        throw new Error(`La ruta ${inputPath} no es un archivo ni carpeta vÃ¡lida`);
    }
}

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
// DETECCIÃ“N DE BLOQUES
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
// NUEVA EXTRACCIÃ“N DE CAMPOS (v3)
// =====================
function extractFieldsFromText(txt, plateHint) {
    // ðŸ”§ Preprocesado mejorado
    txt = txt.replace(/(TOMADOR|POLIZA|P[Ã“O]LIZA|MARCA|TIPO|AÃ‘O|PATENTE|MOTOR|CHASIS|VIGENCIA|DESDE|HASTA)/gi, "\n$1");

    const out = {
        tomador: null, marca: null, tipo: null, anio: null, patente: null,
        vigencia_desde: null, vigencia_hasta: null,
        vigencia_desde_iso: null, vigencia_hasta_iso: null,
        poliza_numero: null, poliza_numero_sin_guiones: null,
        motor: null, chasis: null,
    };
    let m;

    // ðŸ§ Tomador - VERSIÃ“N CORREGIDA
    // Busca despuÃ©s de "hasta" + fecha, capturando solo el nombre antes de RUTA
    if ((m = txt.match(/hasta\s+(?:\d+\s*hs?\.\s*del\s+)?[0-3]?\d[\-\/][01]?\d[\-\/]\d{4}\s+([A-ZÃÃ‰ÃÃ“ÃšÃœÃ‘][A-ZÃÃ‰ÃÃ“ÃšÃœÃ‘0-9 .,&\-\/]{2,60}?)\s+(?:RUTA|DOMICILIO|CUIT|CT\s)/i))) {
        console.log("âœ… Tomador detectado vÃ­a 'hasta <fecha> <nombre> RUTA'");
        console.log("   Cadena capturada:", m[1]);
        out.tomador = norm(m[1]);

    }
    // Fallback: busca texto que termina en SRL/SA/S.A. antes de RUTA
    else if ((m = txt.match(/\d{4}\s+([A-ZÃÃ‰ÃÃ“ÃšÃœÃ‘][A-ZÃÃ‰ÃÃ“ÃšÃœÃ‘0-9 .,&\-\/]{2,60}?\s+(?:SRL|S\.?R\.?L\.?|SA|S\.?A\.?))\s+RUTA/i))) {
        console.log("âœ… Tomador detectado vÃ­a 'XXXX <nombre SRL/SA> RUTA'");
        console.log("   Cadena capturada:", m[1]);
        out.tomador = norm(m[1]);
    }
    // Ãšltimo fallback genÃ©rico
    else if ((m = txt.match(/([A-Z][A-Z0-9 .,&\-\/]{3,50}?)\s+RUTA\s+NAC/i))) {
        console.log("âœ… Tomador detectado vÃ­a '<nombre> RUTA NAC'");
        console.log("   Cadena capturada:", m[1]);
        const candidate = norm(m[1]);
        if (!candidate.includes('CAJA') && !candidate.includes('SEGUROS') && !candidate.includes('hasta')) {
            console.log("   Tomador asignado:", candidate);
            console.log("   (descartadas coincidencias con CAJA, SEGUROS o 'hasta')");
            out.tomador = candidate;
        }
    }

    // ðŸš— Marca
    if ((m = txt.match(/MARCA\s*[:\-]?\s*([A-ZÃÃ‰ÃÃ“ÃšÃœÃ‘0-9 .,&\-\/]+?)(?=\s+(?:TIPO|AÃ‘O|PATENTE)\b)/i)))
        out.marca = norm(m[1]);

    // ðŸš™ Tipo
    if ((m = txt.match(/TIPO\s*[:\-]?\s*([A-Z0-9ÁÉÍÓÚÜÑÃ .,&\-\/]+?)(?=\s+(?:A\S*O\s+DE\s+FABRICACI\S*N|PATENTE)\b)/i)))
        out.tipo = norm(m[1]);

    // ðŸ— AÃ±o de fabricaciÃ³n
    if ((m = txt.match(/A\S*O\s*(?:DE\s*)?FABRICACI\S*N\s*[:\-]?\s*(\d{4})/i)))
        out.anio = m[1];

    // ðŸ”¢ Poliza nÃºmero
    if ((m = txt.match(/(?:POLIZA|P[Ã“O]LIZA)\s*(?:N[ÂºÂ°]|NUM|NUMERO|#|NÂº)?\s*[:\-]?\s*([0-9\-]{7,})/i))) {
        out.poliza_numero = norm(m[1]);
    } else if ((m = txt.match(/\b(\d{4,}-\d{6,}-\d{2,})\b/))) {
        out.poliza_numero = norm(m[1]);
    }
    if (out.poliza_numero) {
        out.poliza_numero_sin_guiones = out.poliza_numero.replace(/[\s\-]/g, "");
    }

    // ðŸ“† Vigencia
    if ((m = txt.match(/desde\s+(?:\d+\s*hs?\.\s*del\s+)?([0-3]?\d[\-\/][01]?\d[\-\/]\d{4})[\s\S]{0,100}?hasta\s+(?:\d+\s*hs?\.\s*del\s+)?([0-3]?\d[\-\/][01]?\d[\-\/]\d{4})/is))) {
        out.vigencia_desde = m[1].replace(/\//g, "-");
        out.vigencia_hasta = m[2].replace(/\//g, "-");
        out.vigencia_desde_iso = toISO(out.vigencia_desde);
        out.vigencia_hasta_iso = toISO(out.vigencia_hasta);
    }

    // ðŸ§© Patente
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

    // âš™ï¸ Motor
    if ((m = txt.match(/MOTOR\s*[:\-]?\s*([A-Z0-9\-]+)(?=\s+(?:CHASIS|USO|SUMA|$))/i)))
        out.motor = m[1].toUpperCase();

    // ðŸ§± Chasis
    if ((m = txt.match(/CHASIS\s*[:\-]?\s*([A-Z0-9\-]+)/i)))
        out.chasis = m[1].toUpperCase();

    // ðŸŽ¯ Modelo y nivel de equipamiento (para el nombre de carpeta)
    out.modelo_completo = extractModeloCompleto(txt, out.tipo, out.marca);

    return out;
}

// =====================
// EXTRACCIÃ“N DE MODELO COMPLETO
// =====================
function extractModeloCompleto(txt, tipo, marca) {
    if (!tipo) return null;

    let modeloBase = tipo;
    let nivelEquipamiento = null;
    let m;

    // Buscar nivel de equipamiento (SR, CD, XLS, etc.)
    const equipamientoPatterns = [
        /\b(SR|CD|XLS|DX|GLS|GLX|SE|LE|XLT|FX4|Raptor|Platinum|Limited|King Ranch|Lariat|XLT Sport)\b/i,
        /\b(2\.\d{1,2}\s*(TDI|TDCi|VVT-i|ECO|Turbo))\b/i,
        /\b(4\s*x\s*4|4WD|AWD|FWD|RWD)\b/i
    ];

    for (const pattern of equipamientoPatterns) {
        if ((m = txt.match(pattern))) {
            nivelEquipamiento = m[1].toUpperCase();
            break;
        }
    }

    // Limpiar el tipo para obtener solo el modelo
    modeloBase = modeloBase.replace(/\b(2\.\d{1,2}\s*(TDI|TDCi|VVT-i|ECO|Turbo))\b.*$/i, '');
    modeloBase = modeloBase.replace(/\s+/g, ' ').trim();

    // Construir nombre completo
    let modeloCompleto = modeloBase;
    if (nivelEquipamiento) {
        modeloCompleto += ` ${nivelEquipamiento}`;
    }

    // Si hay marca, asegurar que estÃ© incluida
    if (marca && !modeloCompleto.toUpperCase().includes(marca.toUpperCase())) {
        modeloCompleto = `${marca} ${modeloCompleto}`;
    }

    return modeloCompleto.trim();
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

function printable(value) {
    return norm(String(value ?? "")).replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}

function wrapCellText(text, font, size, maxWidth, maxLines = 2) {
    const words = printable(text || "-").split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";

    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
            current = candidate;
            continue;
        }

        if (current) lines.push(current);
        current = word;

        while (font.widthOfTextAtSize(current, size) > maxWidth && current.length > 1) {
            let cut = current.length - 1;
            while (cut > 1 && font.widthOfTextAtSize(`${current.slice(0, cut)}...`, size) > maxWidth) cut--;
            lines.push(`${current.slice(0, cut)}...`);
            current = current.slice(cut);
        }

        if (lines.length >= maxLines) break;
    }

    if (current && lines.length < maxLines) lines.push(current);
    if (!lines.length) lines.push("-");

    if (lines.length > maxLines) return lines.slice(0, maxLines);
    const last = lines[lines.length - 1];
    if (font.widthOfTextAtSize(last, size) > maxWidth) {
        let cut = last.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(`${last.slice(0, cut)}...`, size) > maxWidth) cut--;
        lines[lines.length - 1] = `${last.slice(0, cut)}...`;
    }
    return lines;
}

async function createVehiclesSummaryPdf(results, outDir) {
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const pageSize = [841.89, 595.28]; // A4 landscape
    const margin = 40;
    const rowHeight = 36;
    const headerHeight = 24;
    const columns = [
        { label: "Marca", key: "marca", width: 95 },
        { label: "Modelo", key: "tipo", width: 170 },
        { label: "Patente", key: "patente", width: 80 },
        { label: "Anio Fab.", key: "anio_fabricacion", width: 70 },
        { label: "Chasis", key: "chasis", width: 180 },
        { label: "Motor", key: "motor", width: 166 },
    ];

    let page;
    let y;
    let pageNumber = 0;

    const drawPageHeader = () => {
        page = pdf.addPage(pageSize);
        pageNumber++;
        const { width, height } = page.getSize();
        y = height - margin;

        page.drawText("Resumen general de vehiculos", {
            x: margin,
            y,
            size: 16,
            font: bold,
            color: rgb(0.08, 0.08, 0.08),
        });
        page.drawText(`Total: ${results.length}`, {
            x: width - margin - 90,
            y: y + 2,
            size: 10,
            font: regular,
            color: rgb(0.25, 0.25, 0.25),
        });
        y -= 28;

        let x = margin;
        page.drawRectangle({
            x: margin,
            y: y - headerHeight + 7,
            width: width - margin * 2,
            height: headerHeight,
            color: rgb(0.88, 0.90, 0.93),
        });
        for (const column of columns) {
            page.drawText(column.label, {
                x: x + 4,
                y: y - 8,
                size: 9,
                font: bold,
                color: rgb(0.08, 0.08, 0.08),
            });
            x += column.width;
        }
        y -= headerHeight;

        page.drawText(`Pagina ${pageNumber}`, {
            x: width - margin - 55,
            y: 20,
            size: 8,
            font: regular,
            color: rgb(0.45, 0.45, 0.45),
        });
    };

    drawPageHeader();

    const rows = results
        .map((result) => result.meta)
        .sort((a, b) => printable(a.patente).localeCompare(printable(b.patente)));

    for (const row of rows) {
        if (y - rowHeight < margin) drawPageHeader();

        let x = margin;
        const rowTop = y;
        page.drawLine({
            start: { x: margin, y: rowTop + 6 },
            end: { x: page.getWidth() - margin, y: rowTop + 6 },
            thickness: 0.4,
            color: rgb(0.82, 0.82, 0.82),
        });

        for (const column of columns) {
            const lines = wrapCellText(row[column.key], regular, 8, column.width - 8, 2);
            lines.forEach((line, index) => {
                page.drawText(line, {
                    x: x + 4,
                    y: rowTop - 8 - index * 10,
                    size: 8,
                    font: regular,
                    color: rgb(0.08, 0.08, 0.08),
                });
            });
            x += column.width;
        }
        y -= rowHeight;
    }

    await fsExtra.ensureDir(outDir);
    const bytes = await pdf.save();
    const outPath = path.join(outDir, "resumen_vehiculos.pdf");
    try {
        await fsExtra.writeFile(outPath, bytes);
        return outPath;
    } catch (error) {
        if (error.code !== "EBUSY" && error.code !== "EPERM") throw error;
        const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
        const fallbackPath = path.join(outDir, `resumen_vehiculos_${stamp}.pdf`);
        await fsExtra.writeFile(fallbackPath, bytes);
        return fallbackPath;
    }
}

async function slicePagesToPdf(bufferOrUint8, startIdx, endIdx, outPath) {
    try {
        // Asegurar que tenemos un Uint8Array vÃ¡lido
        let srcBytes;
        if (bufferOrUint8 instanceof Uint8Array) {
            srcBytes = bufferOrUint8;
        } else if (Buffer.isBuffer(bufferOrUint8)) {
            srcBytes = new Uint8Array(bufferOrUint8);
        } else {
            throw new Error("Input debe ser Buffer o Uint8Array");
        }

        // Verificar que el PDF tiene header vÃ¡lido
        const headerStr = String.fromCharCode(...srcBytes.slice(0, 5));
        if (!headerStr.startsWith('%PDF')) {
            console.error("âŒ Datos no son un PDF vÃ¡lido. Header:", headerStr);
            throw new Error("El buffer no contiene un PDF vÃ¡lido");
        }

        console.log(`ðŸ“„ Cargando PDF (${srcBytes.length} bytes)...`);
        const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });

        const totalPages = src.getPageCount();
        console.log(`ðŸ“‘ PDF tiene ${totalPages} pÃ¡ginas`);

        const out = await PDFDocument.create();

        // Validar Ã­ndices
        startIdx = Math.max(0, startIdx);
        endIdx = Math.min(endIdx, totalPages - 1);

        console.log(`âœ‚ï¸ Extrayendo pÃ¡ginas ${startIdx + 1} a ${endIdx + 1}...`);

        const idxs = Array.from({ length: endIdx - startIdx + 1 }, (_, i) => startIdx + i);
        const pages = await out.copyPages(src, idxs);

        for (const p of pages) {
            out.addPage(p);
        }

        await fsExtra.ensureDir(path.dirname(outPath));
        const bytes = await out.save();
        await fsExtra.writeFile(outPath, bytes);

        console.log(`âœ… PDF guardado: ${outPath}`);
    } catch (error) {
        console.error(`âŒ Error al procesar PDF:`, error.message);
        console.error(`   Archivo destino: ${outPath}`);
        console.error(`   PÃ¡ginas: ${startIdx}-${endIdx}`);
        throw error;
    }
}
// =====================
// PROCESAR TODO
// =====================
async function processAll(bufferOrUint8, pagesText, plateFilter) {
    const blocks = findCertificateBlocks(pagesText);
    if (!blocks.length) console.warn("âš ï¸ No se encontraron certificados de cobertura en el PDF.");
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

        console.log("Datos extraÃ­dos:", data);
        const tomadorSafe = sanitize(data.tomador || "Tomador_Desconocido");
        const patente = (data.patente || "PATENTE_DESC").toUpperCase();

        // Construir nombre del modelo: patente + modelo completo
        const modeloParaCarpeta = data.modelo_completo ? sanitize(data.modelo_completo) : sanitize(`${data.marca || "Marca"} ${data.tipo || "Tipo"}`);
        const nombreCarpeta = `${patente}_${modeloParaCarpeta}`;

        const targetDir = path.join(OUT_DIR, tomadorSafe, nombreCarpeta);
        const pdfOut = path.join(targetDir, `poliza_${patente}.pdf`);
        const jsonOut = path.join(targetDir, `poliza_${patente}.json`);

        await fsExtra.ensureDir(targetDir);
        await slicePagesToPdf(bufferOrUint8, blk.start, blk.end, pdfOut);

        const payload = {
            tomador: data.tomador || null,
            marca: data.marca || null,
            tipo: data.tipo || null,
            modelo_completo: data.modelo_completo || null,
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
            paginas: `${blk.end - blk.start + 1} pÃ¡ginas`,
            rango_paginas_1based: `${blk.start + 1}-${blk.end + 1}`,
        };
        await fsExtra.writeJSON(jsonOut, payload, { spaces: 2 });

        results.push({ dir: targetDir, pdf: pdfOut, json: jsonOut, meta: payload });
    }

    return results;
}

// =====================
// PROCESAR ARCHIVO INDIVIDUAL
// =====================
async function processSinglePdf(pdfPath, plateFilter, outDir) {
    console.log(`\nðŸ“„ Procesando: ${path.basename(pdfPath)}`);

    const buffer = await fsExtra.readFile(pdfPath);
    console.log(`âœ… Archivo leÃ­do: ${buffer.length} bytes`);

    // Verificar que es un PDF vÃ¡lido
    const headerCheck = buffer.toString('utf-8', 0, 5);
    if (!headerCheck.startsWith('%PDF')) {
        console.error("âŒ El archivo no parece ser un PDF vÃ¡lido");
        console.error("   Header encontrado:", headerCheck);
        return [];
    }
    console.log(`âœ… Header PDF vÃ¡lido: ${headerCheck}`);

    // Crear copias independientes para evitar detached buffer
    const dataBytesForPdfjs = new Uint8Array(buffer);
    const dataBytesForPdflib = new Uint8Array(buffer);

    console.log(`ðŸ”„ Extrayendo texto con pdfjs...`);
    const pagesText = await getAllPagesText(dataBytesForPdfjs);
    console.log(`âœ… ${pagesText.length} pÃ¡ginas procesadas`);

    console.log(`ðŸ” Procesando certificados...`);
    const results = await processAll(dataBytesForPdflib, pagesText, plateFilter);

    return results;
}

// =====================
// MAIN
// =====================
(async () => {
    try {
        // Verificar si la entrada existe
        if (!(await fsExtra.pathExists(INPUT))) {
            console.error("âŒ No existe la ruta:", INPUT);
            process.exit(1);
        }

        // Buscar todos los archivos PDF
        const pdfFiles = await findPdfFiles(INPUT);
        if (pdfFiles.length === 0) {
            console.error("âŒ No se encontraron archivos PDF en la ruta especificada");
            process.exit(1);
        }

        console.log(`ðŸ“‚ Encontrados ${pdfFiles.length} archivo(s) PDF para procesar`);

        let plateFilter = plateArg ? normalizePlate(plateArg) : null;
        if (!plateFilter && pdfFiles.length === 1) {
            const rl = readline.createInterface({ input, output });
            const answer = await rl.question("IngresÃ¡ una patente (ENTER para procesar todas): ");
            rl.close();
            plateFilter = norm(answer) ? normalizePlate(answer) : null;
        }

        let totalResults = [];

        // Procesar cada archivo PDF
        for (const pdfFile of pdfFiles) {
            try {
                const results = await processSinglePdf(pdfFile, plateFilter, OUT_DIR);
                totalResults.push(...results);
            } catch (error) {
                console.error(`âŒ Error procesando ${path.basename(pdfFile)}:`, error.message);
                continue;
            }
        }

        if (totalResults.length === 0) {
            console.log(plateFilter
                ? `âš ï¸ No se encontrÃ³ certificado de cobertura para la patente ${plateFilter}.`
                : "âš ï¸ No se detectaron certificados de cobertura en los PDFs.");
            process.exit(0);
        }

        console.log("\nâœ… Procesamiento finalizado:");
        for (const r of totalResults) {
            console.log("â€”", r.meta.patente, "â†’", r.pdf);
        }
        const summaryPdf = await createVehiclesSummaryPdf(totalResults, OUT_DIR);
        console.log("PDF general:", summaryPdf);
        console.log(`ðŸ“Š Total certificados exportados: ${totalResults.length} de ${pdfFiles.length} archivo(s) procesado(s)`);

    } catch (error) {
        console.error("âŒ Error fatal:", error);
        process.exit(1);
    }
})().catch(err => {
    console.error("âŒ Error fatal:", err);
    process.exit(1);
});
