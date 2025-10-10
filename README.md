
# Polizas Certificates Node (ESM, pdfjs-dist v5.4.296, fs-extra v11.3.2)

Extractor en **Node.js (ESM)** para individualizar documentos **"SEGURO DE AUTOMOTORES / CERTIFICADO DE COBERTURA"** dentro de un PDF.
Permite:
- Filtrar por **patente** (o procesar **todas**).
- Recortar **todas las páginas** del certificado (detecta **"N de M"**).
- Organizar salida como **`Tomador / tipo + año de fabricacion / patente`**.
- Guardar `poliza_<PATENTE>.pdf` y `poliza_<PATENTE>.json` con: tomador, tipo, año, patente, vigencia (desde/hasta en formato original + ISO), **n° póliza** (y **sin guiones**), motor y chasis.

> Compatible con **pdfjs-dist 5.4.296** usando la **build legacy** para Node (evita el error `DOMMatrix is not defined`).  
> Se corrige el error `Please provide binary data as Uint8Array` convirtiendo `Buffer` → **`Uint8Array`** antes de `getDocument()`.

## Requisitos
- Node.js **18+**
- PDF con **capa de texto** (si es escaneado, usar OCR antes, p.ej. `ocrmypdf`).

## Instalación
```bash
npm install
```

## Uso (interactivo)
```bash
node src/extract_certificates.js <archivo.pdf> [--out ./salidas]
```
Al iniciar, pide **patente**:
- Ingresá una (p.ej. `AG552FA`) para **solo ese** certificado.
- Presioná **ENTER** vacío para **procesar todos**.

## Uso (no-interactivo)
```bash
node src/extract_certificates.js <archivo.pdf> --out ./salidas --plate=AG552FA
```

## Salida esperada
```
salidas/
└── <Tomador>/
    └── <Tipo> <Año>/
        └── <PATENTE>/
            ├── poliza_<PATENTE>.pdf
            └── poliza_<PATENTE>.json
```

## Notas técnicas
- Import ESM: `import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"`
- **Uint8Array** requerido por PDF.js: se convierte el Buffer del archivo antes de `getDocument`.
- Detección de páginas del certificado:
  1) Busca encabezados `SEGURO DE AUTOMOTORES` + `CERTIFICADO DE COBERTURA`.
  2) Si encuentra `N de M` (p.ej. `1 de 3` y `M ≤ 20`), usa ese total.
  3) Fallback: agrupa páginas contiguas con el mismo encabezado (máx. 10).

## OCR (si el PDF es escaneado)
```bash
pip install ocrmypdf
ocrmypdf entrada.pdf salida_ocr.pdf
node src/extract_certificates.js ./salida_ocr.pdf --out ./salidas
```
