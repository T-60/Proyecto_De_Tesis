"""
Paso 4 - Generador de metricas del pipeline de procesamiento.

Lee los datos de todas las carpetas del pipeline (00-03) y genera:
  - Reporte por consola
  - data/04_metrics/metricas_por_archivo.csv
  - data/04_metrics/distribucion_tipos.csv
  - data/04_metrics/metricas_globales.csv
  - data/04_metrics/reporte_completo.json

Uso:
  python 04_reporte_metricas.py
"""

import csv
import json
import os
from pathlib import Path


# Carpetas del pipeline
PDF_DIR = Path("data/pdfs")
MD_DIR = Path("data/00_simplified")
EXTRACTED_DIR = Path("data/01_extracted")
STRUCTURED_DIR = Path("data/02_structured")
VERIFIED_DIR = Path("data/03_pre_verified")
METRICS_DIR = Path("data/04_metrics")

METRICS_DIR.mkdir(exist_ok=True, parents=True)

# Archivos excluidos (no forman parte del corpus de analisis)
EXCLUIDOS = {"Arequipa0", "Arequipa1", "Arequipa14", "Arequipa15", "Arequipa20"}


def contar_lineas(path):
    """Cuenta lineas de un archivo de texto."""
    with open(path, encoding="utf-8") as f:
        return sum(1 for _ in f)


def tamano_kb(path):
    """Tamano en KB de un archivo."""
    return os.path.getsize(path) / 1024


def tamano_mb(path):
    """Tamano en MB de un archivo."""
    return os.path.getsize(path) / (1024 * 1024)


def contar_palabras(path):
    """Cuenta palabras de un archivo de texto."""
    with open(path, encoding="utf-8") as f:
        return len(f.read().split())


def generar_metricas():
    """Genera todas las metricas del pipeline y las guarda en disco."""

    # Obtener lista de archivos validos (los que estan en 03_pre_verified)
    archivos_verificados = sorted([
        p.stem for p in VERIFIED_DIR.glob("*.json")
        if p.stem not in EXCLUIDOS
    ])

    if not archivos_verificados:
        print("No hay archivos verificados en %s" % VERIFIED_DIR)
        return

    # ============================================================
    # CATEGORIA 1: METRICAS DE VOLUMEN
    # ============================================================
    total_docs = len(archivos_verificados)
    total_pdf_mb = 0
    total_lineas_md = 0
    total_palabras_ext = 0
    total_variables = 0

    filas_csv = []
    dist_tipos = {}
    total_v = total_ic = total_llm = total_omit = 0
    detalles_vars = 0
    items_detalle = 0

    for nombre in archivos_verificados:
        fila = {"archivo": nombre}

        # PDF
        pdf_path = PDF_DIR / ("%s.pdf" % nombre)
        if pdf_path.exists():
            mb = tamano_mb(pdf_path)
            fila["pdf_mb"] = round(mb, 2)
            total_pdf_mb += mb
        else:
            fila["pdf_mb"] = 0

        # Markdown (00_simplified)
        md_path = MD_DIR / ("%s.md" % nombre)
        if md_path.exists():
            lineas = contar_lineas(md_path)
            kb = tamano_kb(md_path)
            fila["md_lineas"] = lineas
            fila["md_kb"] = round(kb, 1)
            total_lineas_md += lineas
        else:
            fila["md_lineas"] = 0
            fila["md_kb"] = 0

        # Razonamiento (01_extracted)
        ext_path = EXTRACTED_DIR / ("%s.txt" % nombre)
        if ext_path.exists():
            palabras = contar_palabras(ext_path)
            kb = tamano_kb(ext_path)
            fila["razonamiento_palabras"] = palabras
            fila["razonamiento_kb"] = round(kb, 1)
            total_palabras_ext += palabras
        else:
            fila["razonamiento_palabras"] = 0
            fila["razonamiento_kb"] = 0

        # JSON estructurado (02_structured)
        struct_path = STRUCTURED_DIR / ("%s.json" % nombre)
        if struct_path.exists():
            fila["json_kb"] = round(tamano_kb(struct_path), 1)
        else:
            fila["json_kb"] = 0

        # JSON verificado (03_pre_verified) - METRICAS DE CALIDAD
        verif_path = VERIFIED_DIR / ("%s.json" % nombre)
        data = json.load(open(verif_path, encoding="utf-8"))
        variables = data.get("momento", {}).get("variables", [])
        n_total = len(variables)
        total_variables += n_total

        v = ic = llm = omit = 0
        for var in variables:
            estado = var.get("estado_verificacion", "")
            tipo = var.get("tipo", "?")
            dist_tipos[tipo] = dist_tipos.get(tipo, 0) + 1

            if estado == "verificado":
                v += 1
            elif estado == "id_corregido":
                ic += 1
            elif estado == "requiere_verificacion_llm":
                llm += 1
            elif estado == "omitido_sin_evidencia":
                omit += 1

            # Contar variables con detalle (agrupadas)
            if "detalle" in var and isinstance(var["detalle"], list):
                detalles_vars += 1
                items_detalle += len(var["detalle"])

        total_v += v
        total_ic += ic
        total_llm += llm
        total_omit += omit

        pct_ok = (v + ic) / n_total * 100 if n_total else 0

        fila["variables_total"] = n_total
        fila["verificadas_n1"] = v
        fila["id_corregido_n2"] = ic
        fila["requiere_llm_n3"] = llm
        fila["omitidas"] = omit
        fila["pct_verificacion"] = round(pct_ok, 1)

        # Compresion
        if fila["pdf_mb"] > 0 and fila["json_kb"] > 0:
            ratio = (fila["pdf_mb"] * 1024) / fila["json_kb"]
            fila["ratio_compresion"] = round(ratio, 0)
        else:
            fila["ratio_compresion"] = 0

        filas_csv.append(fila)

    # ============================================================
    # IMPRIMIR EN CONSOLA
    # ============================================================
    print()
    print("=" * 90)
    print("  REPORTE DE METRICAS DEL PIPELINE DE PROCESAMIENTO")
    print("=" * 90)

    # Volumen
    print("\n--- 1. METRICAS DE VOLUMEN ---")
    print("  Documentos procesados      : %d" % total_docs)
    print("  Tamano total del corpus     : %.1f MB" % total_pdf_mb)
    print("  Tamano promedio por PDF     : %.1f MB" % (total_pdf_mb / total_docs))
    print("  Lineas OCR totales          : %d" % total_lineas_md)
    print("  Lineas OCR promedio por doc : %d" % (total_lineas_md // total_docs))
    print("  Total de variables extraidas: %d" % total_variables)
    print("  Variables promedio por doc  : %.1f" % (total_variables / total_docs))

    # Calidad / Fidelidad
    pct_total = (total_v + total_ic) / total_variables * 100 if total_variables else 0
    archivos_100 = sum(1 for f in filas_csv if f["requiere_llm_n3"] == 0)
    print("\n--- 2. METRICAS DE FIDELIDAD (ANTI-ALUCINACION) ---")
    print("  Verificadas (Nivel 1)       : %d (%.1f%%)" % (total_v, total_v / total_variables * 100))
    print("  IDs Corregidos (Nivel 2)    : %d (%.1f%%)" % (total_ic, total_ic / total_variables * 100))
    print("  Requieren LLM (Nivel 3)     : %d (%.1f%%)" % (total_llm, total_llm / total_variables * 100))
    if total_omit:
        print("  Omitidas (sin evidencia)    : %d" % total_omit)
    print("  Tasa de verificacion total  : %.1f%%" % pct_total)
    print("  Archivos al 100%%            : %d de %d (%.0f%%)" % (
        archivos_100, total_docs, archivos_100 / total_docs * 100))

    # Distribucion de tipos
    print("\n--- 3. DISTRIBUCION DE TIPOS DE VARIABLES ---")
    tipo_labels = {
        "A": "Situaciones adversas",
        "B": "Presupuesto/tablas",
        "C": "Checklists/estado",
        "D": "Actores relacionales",
        "E": "Conclusiones/recomendaciones",
        "F": "Documentos/notificaciones",
    }
    for tipo in sorted(dist_tipos.keys()):
        n = dist_tipos[tipo]
        label = tipo_labels.get(tipo, "Otro")
        print("  Tipo %s (%s): %d (%.0f%%)" % (
            tipo, label, n, n / total_variables * 100))
    if detalles_vars:
        print("  Variables con sub-items     : %d" % detalles_vars)
        print("  Promedio items por detalle  : %.1f" % (items_detalle / detalles_vars))

    # Compresion
    print("\n--- 4. METRICAS DE COMPRESION ---")
    ratios = [f["ratio_compresion"] for f in filas_csv if f["ratio_compresion"] > 0]
    if ratios:
        print("  Ratio compresion promedio   : %.0f:1 (PDF -> JSON final)" % (sum(ratios) / len(ratios)))
        print("  Ratio compresion maximo     : %.0f:1" % max(ratios))
        print("  Ratio compresion minimo     : %.0f:1" % min(ratios))

    # Tabla por archivo
    print("\n--- 5. DETALLE POR ARCHIVO ---")
    print("%18s | %6s | %5s | %5s | %3s | %3s | %5s | %8s" % (
        "Archivo", "PDF MB", "Vars", "Verif", "IC", "LLM", "%OK", "Compres."))
    print("-" * 75)
    for f in filas_csv:
        marca = " *" if f["requiere_llm_n3"] == 0 else ""
        print("%18s | %6.1f | %5d | %5d | %3d | %3d | %4.0f%% | %6.0f:1%s" % (
            f["archivo"], f["pdf_mb"], f["variables_total"],
            f["verificadas_n1"], f["id_corregido_n2"], f["requiere_llm_n3"],
            f["pct_verificacion"], f["ratio_compresion"], marca))
    print("-" * 75)
    print("  * = 100%% verificado sin necesidad de LLM")
    print()

    # ============================================================
    # GUARDAR EN ARCHIVOS
    # ============================================================

    # 1. CSV por archivo
    csv_path = METRICS_DIR / "metricas_por_archivo.csv"
    campos = list(filas_csv[0].keys())
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=campos)
        writer.writeheader()
        writer.writerows(filas_csv)
    print("Guardado: %s" % csv_path)

    # 2. CSV distribucion de tipos
    tipos_path = METRICS_DIR / "distribucion_tipos.csv"
    with open(tipos_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["tipo", "descripcion", "cantidad", "porcentaje"])
        for tipo in sorted(dist_tipos.keys()):
            n = dist_tipos[tipo]
            writer.writerow([
                tipo, tipo_labels.get(tipo, "Otro"),
                n, round(n / total_variables * 100, 1)
            ])
    print("Guardado: %s" % tipos_path)

    # 3. CSV metricas globales
    globales_path = METRICS_DIR / "metricas_globales.csv"
    with open(globales_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["metrica", "valor"])
        writer.writerow(["total_documentos", total_docs])
        writer.writerow(["corpus_total_mb", round(total_pdf_mb, 1)])
        writer.writerow(["corpus_promedio_mb", round(total_pdf_mb / total_docs, 1)])
        writer.writerow(["lineas_ocr_total", total_lineas_md])
        writer.writerow(["total_variables", total_variables])
        writer.writerow(["variables_promedio_doc", round(total_variables / total_docs, 1)])
        writer.writerow(["verificadas_n1", total_v])
        writer.writerow(["id_corregido_n2", total_ic])
        writer.writerow(["requiere_llm_n3", total_llm])
        writer.writerow(["tasa_verificacion_pct", round(pct_total, 1)])
        writer.writerow(["archivos_100pct", archivos_100])
        writer.writerow(["ratio_compresion_promedio", round(sum(ratios) / len(ratios), 0) if ratios else 0])
        writer.writerow(["costo_estimado_total_usd", round(total_docs * 0.50, 2)])
        writer.writerow(["costo_estimado_por_variable_usd", round((total_docs * 0.50) / total_variables, 3)])
    print("Guardado: %s" % globales_path)

    # 4. JSON reporte completo
    reporte = {
        "volumen": {
            "total_documentos": total_docs,
            "corpus_total_mb": round(total_pdf_mb, 1),
            "corpus_promedio_mb": round(total_pdf_mb / total_docs, 1),
            "lineas_ocr_total": total_lineas_md,
            "lineas_ocr_promedio": total_lineas_md // total_docs,
            "total_variables": total_variables,
            "variables_promedio_doc": round(total_variables / total_docs, 1),
        },
        "fidelidad": {
            "verificadas_n1": total_v,
            "id_corregido_n2": total_ic,
            "requiere_llm_n3": total_llm,
            "omitidas": total_omit,
            "tasa_verificacion_pct": round(pct_total, 1),
            "archivos_100pct": archivos_100,
            "archivos_total": total_docs,
        },
        "distribucion_tipos": {
            tipo: {
                "descripcion": tipo_labels.get(tipo, "Otro"),
                "cantidad": dist_tipos[tipo],
                "porcentaje": round(dist_tipos[tipo] / total_variables * 100, 1),
            }
            for tipo in sorted(dist_tipos.keys())
        },
        "compresion": {
            "ratio_promedio": round(sum(ratios) / len(ratios), 0) if ratios else 0,
            "ratio_maximo": max(ratios) if ratios else 0,
            "ratio_minimo": min(ratios) if ratios else 0,
        },
        "costo_estimado": {
            "total_usd": round(total_docs * 0.50, 2),
            "por_variable_usd": round((total_docs * 0.50) / total_variables, 3),
        },
        "por_archivo": filas_csv,
    }

    reporte_path = METRICS_DIR / "reporte_completo.json"
    with open(reporte_path, "w", encoding="utf-8") as f:
        json.dump(reporte, f, ensure_ascii=False, indent=2)
    print("Guardado: %s" % reporte_path)

    print("\nTodos los archivos de metricas guardados en %s/" % METRICS_DIR)


if __name__ == "__main__":
    generar_metricas()
