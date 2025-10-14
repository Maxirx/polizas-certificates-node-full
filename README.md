# 📄🚗 Extractor de Certificados de Cobertura de Automotores


Herramienta automatizada para extraer certificados individuales de pólizas de seguro vehicular desde archivos PDF consolidados, organizándolos en una estructura jerárquica de carpetas con metadata en JSON.

![JS Version](https://img.shields.io/badge/js-16%2B-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-beta-yellow)


## 📋 Descripción

Este script procesa PDFs que contienen múltiples certificados de cobertura de seguros automotores (formato argentino), detecta automáticamente los bloques correspondientes a cada certificado, extrae información estructurada (tomador, vehículo, póliza, vigencia) y genera:

- **PDFs individuales** por cada certificado detectado
- **Archivos JSON** con metadata completa
- **Organización automática** en carpetas: `Tomador/Marca/Tipo-Año/Patente/`

Ideal para aseguradoras, brokers, gestion documental y empresas que necesitan organizar grandes volúmenes de documentación vehicular.

---

## ⚙️ Requisitos

### Software necesario:
- **Node.js** ≥ 16.x
- **npm** o **yarn**

### Dependencias del proyecto:
```json
{
  "pdf-lib": "^1.17.1",
  "pdfjs-dist": "^3.x.x",
  "fs-extra": "^11.x.x"
}
```

---

## 🚀 Instalación

1. **Clonar el repositorio:**
```bash
git clone https://github.com/maxirx/extractor-certificados-automotores.git
cd extractor-certificados-automotores
```

2. **Instalar dependencias:**
```bash
npm install
```

3. **Verificar instalación:**
```bash
node src/extract_certificates_v3.js --help
```

---

## 💻 Uso

### Sintaxis básica:
```bash
node src/extract_certificates_v3.js <archivo.pdf> [opciones]
```

### Opciones disponibles:
- `--out <directorio>`: Carpeta de salida (por defecto: `./salidas`)
- `--plate=<PATENTE>`: Filtrar por patente específica (formato: `AB123CD`)

### Ejemplos:

**1. Procesar todas las pólizas del PDF:**
```bash
node src/extract_certificates_v3.js ./polizas_completas.pdf
```

**2. Especificar carpeta de salida:**
```bash
node src/extract_certificates_v3.js ./polizas.pdf --out ./certificados_2025
```

**3. Extraer solo una patente específica:**
```bash
node src/extract_certificates_v3.js ./polizas.pdf --plate=ABC000LK
```

---

## 🖱️ Uso Interactivo

Si no especificás la opción `--plate`, el script preguntará interactivamente:

```bash
$ node src/extract_certificates_v3.js ./polizas.pdf

📂 Leyendo: ./polizas.pdf
✅ Archivo leído: 2443945 bytes
✅ Header PDF válido: %PDF-
🔄 Extrayendo texto con pdfjs...
✅ 238 páginas procesadas

Ingresá una patente (ENTER para procesar todas): ABC000LK

🔍 Procesando certificados...
Datos extraídos: { tomador: 'KOMPAS SRL', patente: 'ABC000LK', ... }
📄 Cargando PDF (2443945 bytes)...
📑 PDF tiene 238 páginas, extrayendo 141-144
✅ PDF guardado: salidas/EMPRESA_SRL/.../poliza_ABC000LK.pdf

✅ Procesamiento finalizado:
— ABC000LK → salidas/EMPRESA_SRL/TOYOTA/.../poliza_ABC000LK.pdf
Total certificados exportados: 1
```

---

## 📦 Salida Esperada

### Estructura de carpetas generada:
```
salidas/
└── EMPRESA_SRL/
    └── TOYOTA/
        └── HILUX_L-16_2.8_TDI_CD_4_X4_SR_2019/
            └── ABC000LK/
                ├── poliza_ABC000LK.pdf    (certificado extraído)
                └── poliza_ABC000LK.json   (metadata estructurada)
```

### Ejemplo de archivo JSON generado:
```json
{
  "tomador": "EMPRESA SRL",
  "marca": "TOYOTA",
  "tipo": "HILUX L/16 2.8 TDI CD 4 X4 SR",
  "anio_fabricacion": "2019",
  "patente": "ABC000LK",
  "vigencia_desde": "31-08-2025",
  "vigencia_hasta": "28-02-2026",
  "vigencia_desde_iso": "2025-08-31",
  "vigencia_hasta_iso": "2026-02-28",
  "poliza_numero": "5160-0273376-03",
  "poliza_numero_sin_guiones": "5160027337603",
  "motor": "1GD-46570SA",
  "chasis": "8AHLA8CD6K9187182",
  "archivo_pdf": "salidas/.../poliza_ABC000LK.pdf",
  "paginas": "4 páginas",
  "rango_paginas_1based": "141-144"
}
```

---

## 🔧 Notas Técnicas

### Detección de bloques:
- Busca páginas con los encabezados: `"SEGURO DE AUTOMOTORES"` + `"CERTIFICADO DE COBERTURA"`
- Detecta patrones "X de N" para determinar el rango de páginas del certificado
- Si no encuentra el patrón, asume bloques contiguos

### Extracción de datos:
- Usa **regex robustos** con preprocesamiento de texto (inserta saltos de línea antes de etiquetas clave)
- **Normalización de patentes**: Soporta formatos con espacios/guiones (`AB 123 CD` → `AB123CD`)
- **Fallbacks inteligentes**: Si falta información, intenta extraer solo de la primera página del bloque
- **Conversión de fechas**: De formato DD-MM-YYYY a ISO 8601 (YYYY-MM-DD)

### Manejo de PDFs grandes:
- Crea **dos copias independientes** del buffer para evitar `detached ArrayBuffer` errors
- Una copia para `pdfjs` (extracción de texto)
- Otra copia para `pdf-lib` (generación de PDFs individuales)

---

## OCR (si el PDF es escaneado -NO DISPONIBLE ACTUALMENTE-)
```bash
pip install ocrmypdf
ocrmypdf entrada.pdf salida_ocr.pdf
node src/extract_certificates.js ./salida_ocr.pdf --out ./salidas
```

## ⚠️ Problemas Conocidos

### Críticos:
1. **Límite de páginas arbitrario (`NM_MAX = 20`)**: Si un certificado indica "1 de 25", solo procesará hasta la página 20. Solución temporal: modificar la constante en el código.

2. **Detección de bloques frágil**: Si dos certificados están muy juntos sin saltos de página claros, podrían fusionarse incorrectamente.

### Mejorables:
3. **Regex acoplados al formato**: Cambios en el diseño del certificado (nueva plantilla de la aseguradora) romperían la extracción. Requiere mantenimiento manual.

4. **Sin validación de integridad**: No verifica si los datos extraídos son coherentes (ej: fecha de inicio > fecha de fin).

5. **Manejo de errores limitado**: Si `extractFieldsFromText` falla parcialmente, el JSON contendrá valores `null` sin advertencias detalladas.

6. **Performance con archivos muy grandes**: Lee todo el PDF en memoria. Archivos de más de 500 MB pueden causar problemas de RAM.

7. **Sin soporte para OCR**: Solo funciona con PDFs que tienen texto seleccionable. PDFs escaneados (imágenes) no se procesan.

---

## 🎯 Casos de Uso Ideales

✅ **Aseguradoras** que emiten PDFs consolidados con múltiples pólizas (solo probado en La Caja Seguros automotor)
✅ **Brokers de seguros** que necesitan organizar documentación para auditorías  
✅ **Empresas de flotillas** con cientos de vehículos asegurados  
✅ **Automatización de backoffice** para sistemas de gestión documental  
✅ **Migración de datos** desde sistemas legacy a nuevas plataformas  
✅ **Procesamiento en lote**: Ideal para automatizar extracciones de múltiples PDFs en paralelo

---

## 🚫 Limitaciones Conocidas

❌ **Solo formato argentino**: Patentes AA999AA (nuevo formato mercosur). No soporta formatos antiguos (999999 o AAA999).

❌ **Certificados específicos**: Diseñado para el formato "CAJA DE SEGUROS S.A." y similares. Otras aseguradoras pueden requerir ajustes en las regex.

❌ **Sin OCR**: No procesa PDFs escaneados (requeriría integración con Tesseract u otro motor OCR).

❌ **Texto consolidado**: Asume que el texto extraído por `pdfjs` es coherente. Algunos PDFs con layouts complejos pueden dar resultados impredecibles.

❌ **Sin paralelización**: Procesa certificados secuencialmente. Para grandes volúmenes, considerar implementar procesamiento concurrente.

---

## 🤝 Contribuciones

¡Contribuciones son bienvenidas! Si encontrás bugs o querés agregar features:

1. Fork el repositorio
2. Creá una rama para tu feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -am 'Agrega soporte para formato XYZ'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abrí un Pull Request

---

## 📄 Licencia

MIT License - Ver archivo `LICENSE` para más detalles.

---

## 👨‍💻 Autor

Desarrollado con ☕ por [Maximiliano Salas](https://github.com/maxirx)

**Versión:** v1 (2025-10)  
**Repositorio:** https://github.com/maxirx/extractor-certificados-automotores