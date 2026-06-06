"""
Reporte de metricas del pipeline de procesamiento.

Lee los datos de todas las carpetas del pipeline (00-05) y genera:
  - Reporte por consola
  - data/metrics/metricas_por_archivo.csv
  - data/metrics/distribucion_tipos.csv
  - data/metrics/metricas_globales.csv
  - data/metrics/reporte_completo.json

Niveles de verificacion:
  N1 - Verificado por codigo     : fragmento hallado literalmente en los IDs indicados
  N2 - IDs corregidos por codigo : fragmento hallado en IDs distintos a los indicados
  N3 - Verificado por LLM        : LLM encontro y corrigio el fragmento real
  Pendiente                      : no verificado (requiere revision manual)

Uso:
  python reporte_metricas.py
"""

import csv
import json
import os
from pathlib import Path


# Carpetas del pipeline
PDF_DIR        = Path("data/pdfs")
MD_DIR         = Path("data/00_simplified")
EXTRACTED_DIR  = Path("data/01_extracted")
STRUCTURED_DIR = Path("data/02_structured")
VERIFIED_DIR   = Path("data/04_verified")
CALCULATED_DIR = Path("data/05_calculated")
METRICS_DIR    = Path("data/metrics")

METRICS_DIR.mkdir(exist_ok=True, parents=True)

# Archivos excluidos (no forman parte del corpus de analisis)
EXCLUIDOS = {"Arequipa0", "Arequipa1", "Arequipa14", "Arequipa15", "Arequipa20"}

TIPO_LABELS = {
    "A": "Seguimiento de situaciones adversas",
    "B": "Progreso y presupuesto (valores numericos)",
    "C": "Estado y condicion (categorico)",
    "D": "Actores y roles relacionales",
    "E": "Narrativo (conclusiones y recomendaciones)",
    "F": "Verificacion documental (booleano)",
}


def contar_lineas(path):
    with open(path, encoding="utf-8") as f:
        return sum(1 for _ in f)


def tamano_kb(path):
    return os.path.getsize(path) / 1024


def tamano_mb(path):
    return os.path.getsize(path) / (1024 * 1024)


def contar_palabras(path):
    with open(path, encoding="utf-8") as f:
        return len(f.read().split())


def _construir_json_seccion6(calc_stats):
    """Convierte los stats de seccion 6 al formato del reporte_completo.json."""
    if not calc_stats:
        return {"disponible": False}
    b  = calc_stats["tipo_b"]
    a  = calc_stats["tipo_a"]
    f  = calc_stats["tipo_f"]
    t  = calc_stats["temporal"]
    total_a = a["nuevas"] + a["arrastradas"]
    return {
        "disponible": True,
        "tipo_b_con_pct_avance": b["con_pct"],
        "tipo_b_sin_datos": b["sin_datos"],
        "tipo_b_total": b["total"],
        "tipo_a_nuevas": a["nuevas"],
        "tipo_a_arrastradas": a["arrastradas"],
        "tipo_a_tasa_arrastre_pct": round(100 * a["arrastradas"] / total_a, 1) if total_a else 0,
        "tipo_f_tasa_cumplimiento_promedio_pct": round(sum(f["tasas"]) / len(f["tasas"]), 1) if f["tasas"] else None,
        "duracion_evaluacion_promedio_dias": round(sum(t["duraciones"]) / len(t["duraciones"]), 1) if t["duraciones"] else None,
        "duracion_evaluacion_min_dias": min(t["duraciones"]) if t["duraciones"] else None,
        "duracion_evaluacion_max_dias": max(t["duraciones"]) if t["duraciones"] else None,
        "dias_hasta_emision_promedio": round(sum(t["emisiones"]) / len(t["emisiones"]), 1) if t["emisiones"] else None,
        "dias_hasta_emision_min": min(t["emisiones"]) if t["emisiones"] else None,
        "dias_hasta_emision_max": max(t["emisiones"]) if t["emisiones"] else None,
    }


def _calcular_seccion6(archivos):
    """Lee data/05_calculated/ y devuelve estadisticas de variables calculadas."""
    if not CALCULATED_DIR.exists():
        return None

    b_total = b_con_pct = b_sin = 0
    a_nuevas = a_arrastradas = 0
    f_tasas = []
    duraciones = []
    emisiones = []

    for nombre in archivos:
        path = CALCULATED_DIR / ("%s.json" % nombre)
        if not path.exists():
            continue
        data = json.load(open(path, encoding="utf-8"))
        cal_momento = data.get("momento", {}).get("calculado", {})

        dur = (cal_momento.get("duracion_periodo_dias") or {}).get("valor")
        emi = (cal_momento.get("dias_hasta_emision") or {}).get("valor")
        if dur is not None:
            duraciones.append(dur)
        if emi is not None:
            emisiones.append(emi)

        for var in data.get("momento", {}).get("variables", []):
            tipo = var.get("tipo")
            cal  = var.get("calculado", {})
            if tipo == "B":
                b_total += 1
                if "pct_avance" in cal:
                    b_con_pct += 1
                elif "sin_datos" in cal:
                    b_sin += 1
            if tipo == "A":
                a_nuevas      += (cal.get("nuevos") or {}).get("valor", 0)
                a_arrastradas += (cal.get("arrastrados") or {}).get("valor", 0)
            if tipo == "F":
                tasa = (cal.get("tasa_cumplimiento") or {}).get("valor")
                if tasa is not None:
                    f_tasas.append(tasa)

    return {
        "tipo_b": {"total": b_total, "con_pct": b_con_pct, "sin_datos": b_sin},
        "tipo_a": {"nuevas": a_nuevas, "arrastradas": a_arrastradas},
        "tipo_f": {"tasas": f_tasas},
        "temporal": {"duraciones": duraciones, "emisiones": emisiones},
    }


def generar_metricas():
    archivos_verificados = sorted([
        p.stem for p in VERIFIED_DIR.glob("*.json")
        if p.stem not in EXCLUIDOS
    ])

    if not archivos_verificados:
        print("No hay archivos verificados en %s" % VERIFIED_DIR)
        return

    total_docs = len(archivos_verificados)
    total_pdf_mb = 0
    total_lineas_md = 0
    total_palabras_ext = 0
    total_variables = 0

    filas_csv = []
    dist_tipos = {}
    total_n1 = total_n2 = total_n3 = total_pendiente = total_omit = 0
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

        # Markdown simplificado (00_simplified)
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

        # Razonamiento LLM (01_extracted)
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

        # JSON verificado (03_pre_verified) — metricas de calidad
        verif_path = VERIFIED_DIR / ("%s.json" % nombre)
        data = json.load(open(verif_path, encoding="utf-8"))
        variables = data.get("momento", {}).get("variables", [])
        n_total = len(variables)
        total_variables += n_total

        n1 = n2 = n3 = pendiente = omit = 0
        for var in variables:
            estado = var.get("estado_verificacion", "")
            tipo = var.get("tipo", "?")
            dist_tipos[tipo] = dist_tipos.get(tipo, 0) + 1

            if estado == "verificado":
                n1 += 1
            elif estado == "id_corregido":
                n2 += 1
            elif estado == "verificado_n3":
                n3 += 1
            elif estado == "requiere_verificacion_llm":
                pendiente += 1
            elif estado == "omitido_sin_evidencia":
                omit += 1

            if "detalle" in var and isinstance(var["detalle"], list):
                detalles_vars += 1
                items_detalle += len(var["detalle"])

        total_n1       += n1
        total_n2       += n2
        total_n3       += n3
        total_pendiente += pendiente
        total_omit     += omit

        verificadas_total = n1 + n2 + n3
        pct_ok = verificadas_total / n_total * 100 if n_total else 0

        fila["variables_total"]              = n_total
        fila["verificadas_n1_codigo"]        = n1
        fila["corregidas_n2_ids"]            = n2
        fila["verificadas_n3_llm"]           = n3
        fila["pendientes_sin_verificar"]     = pendiente
        fila["omitidas_sin_evidencia"]       = omit
        fila["porcentaje_verificacion"]      = round(pct_ok, 1)

        if fila["pdf_mb"] > 0 and fila["json_kb"] > 0:
            fila["ratio_compresion_pdf_json"] = round((fila["pdf_mb"] * 1024) / fila["json_kb"], 0)
        else:
            fila["ratio_compresion_pdf_json"] = 0

        filas_csv.append(fila)

    # ============================================================
    # IMPRIMIR EN CONSOLA
    # ============================================================
    SEP = "=" * 100
    sep = "-" * 100

    print()
    print(SEP)
    print("  REPORTE DE METRICAS DEL PIPELINE DE PROCESAMIENTO")
    print(SEP)

    # --- 1. Volumen ---
    print("\n--- 1. VOLUMEN DEL CORPUS ---")
    print("  Documentos procesados                  : %d" % total_docs)
    print("  Tamano total del corpus (PDFs)          : %.1f MB" % total_pdf_mb)
    print("  Tamano promedio por documento           : %.1f MB" % (total_pdf_mb / total_docs))
    print("  Lineas OCR totales                      : %d" % total_lineas_md)
    print("  Lineas OCR promedio por documento       : %d" % (total_lineas_md // total_docs))
    print("  Total de variables extraidas            : %d" % total_variables)
    print("  Variables promedio por documento        : %.1f" % (total_variables / total_docs))

    # --- 2. Fidelidad ---
    total_verificadas = total_n1 + total_n2 + total_n3
    pct_total = total_verificadas / total_variables * 100 if total_variables else 0
    archivos_100 = sum(1 for f in filas_csv if f["pendientes_sin_verificar"] == 0)

    print("\n--- 2. FIDELIDAD Y ANTI-ALUCINACION ---")
    print("  Verificadas por codigo - Nivel 1        : %d (%.1f%%)" % (
        total_n1, total_n1 / total_variables * 100))
    print("  Corregidas por IDs - Nivel 2            : %d (%.1f%%)" % (
        total_n2, total_n2 / total_variables * 100))
    print("  Verificadas por LLM - Nivel 3           : %d (%.1f%%)" % (
        total_n3, total_n3 / total_variables * 100))
    if total_pendiente:
        print("  Pendientes de verificacion              : %d (%.1f%%)" % (
            total_pendiente, total_pendiente / total_variables * 100))
    if total_omit:
        print("  Omitidas (sin fragmento de evidencia)   : %d" % total_omit)
    print("  -----------------------------------------------")
    print("  Tasa de verificacion total              : %.1f%%" % pct_total)
    print("  Documentos al 100%% verificado           : %d de %d" % (archivos_100, total_docs))

    # --- 3. Distribucion de tipos ---
    print("\n--- 3. DISTRIBUCION DE TIPOS DE VARIABLES ---")
    for tipo in sorted(dist_tipos.keys()):
        n = dist_tipos[tipo]
        label = TIPO_LABELS.get(tipo, "Otro")
        print("  Tipo %s — %-45s : %d variables (%.0f%%)" % (
            tipo, label, n, n / total_variables * 100))
    if detalles_vars:
        print("  Variables con sub-items (detalle interno) : %d" % detalles_vars)
        print("  Promedio de sub-items por variable        : %.1f" % (items_detalle / detalles_vars))

    # --- 4. Compresion ---
    ratios = [f["ratio_compresion_pdf_json"] for f in filas_csv if f["ratio_compresion_pdf_json"] > 0]
    print("\n--- 4. COMPRESION PDF -> JSON ESTRUCTURADO ---")
    if ratios:
        print("  Ratio de compresion promedio            : %.0f:1" % (sum(ratios) / len(ratios)))
        print("  Ratio de compresion maximo              : %.0f:1" % max(ratios))
        print("  Ratio de compresion minimo              : %.0f:1" % min(ratios))

    # --- 5. Tabla por archivo ---
    print("\n--- 5. DETALLE POR DOCUMENTO ---")
    col = "%-14s | %7s | %9s | %12s | %11s | %11s | %11s | %15s"
    print(col % (
        "Documento",
        "PDF (MB)",
        "Variables",
        "Verif. N1",
        "Correg. N2",
        "Verif. N3",
        "% Verif.",
        "Compresion (ratio)",
    ))
    print(sep)
    col_datos = "%-14s | %7.1f | %9d | %12d | %11d | %11d | %10.0f%% | %13.0f:1%s"
    for f in filas_csv:
        marca = " *" if f["pendientes_sin_verificar"] == 0 else ""
        print(col_datos % (
            f["archivo"],
            f["pdf_mb"],
            f["variables_total"],
            f["verificadas_n1_codigo"],
            f["corregidas_n2_ids"],
            f["verificadas_n3_llm"],
            f["porcentaje_verificacion"],
            f["ratio_compresion_pdf_json"],
            marca,
        ))
    print(sep)
    print("  (*) Documento 100%% verificado")
    print("  N1 = Verificado por codigo (fragmento exacto en IDs indicados)")
    print("  N2 = IDs corregidos por codigo (fragmento hallado en otros IDs)")
    print("  N3 = Verificado por LLM (fragmento corregido por modelo de lenguaje)")
    print()

    # --- 6. Variables calculadas (04_calculadas.py -> 05_calculated/) ---
    calc_stats = _calcular_seccion6(archivos_verificados)
    print("\n--- 6. VARIABLES CALCULADAS (04_calculadas.py) ---")
    if calc_stats:
        b = calc_stats["tipo_b"]
        a = calc_stats["tipo_a"]
        f = calc_stats["tipo_f"]
        t = calc_stats["temporal"]
        print("  Tipo B — variables con pct_avance calculado    : %d de %d (%.0f%%)" % (
            b["con_pct"], b["total"], 100 * b["con_pct"] / b["total"] if b["total"] else 0))
        print("  Tipo B — sin datos suficientes (obs o meta null): %d de %d (%.0f%%)" % (
            b["sin_datos"], b["total"], 100 * b["sin_datos"] / b["total"] if b["total"] else 0))
        print("  Tipo A — situaciones adversas nuevas (este hito): %d" % a["nuevas"])
        print("  Tipo A — situaciones arrastradas de hitos previos: %d" % a["arrastradas"])
        print("  Tipo A — tasa de arrastre entre hitos           : %.1f%%  (base del Sankey)" % (
            100 * a["arrastradas"] / (a["nuevas"] + a["arrastradas"]) if (a["nuevas"] + a["arrastradas"]) else 0))
        if f["tasas"]:
            print("  Tipo F — tasa de cumplimiento documental promedio: %.1f%%  (sobre %d vars)" % (
                sum(f["tasas"]) / len(f["tasas"]), len(f["tasas"])))
        if t["duraciones"]:
            print("  Duracion promedio de evaluacion por hito        : %.1f dias  (min %d / max %d)" % (
                sum(t["duraciones"]) / len(t["duraciones"]), min(t["duraciones"]), max(t["duraciones"])))
        if t["emisiones"]:
            print("  Dias promedio hasta emision del informe         : %.1f dias  (min %d / max %d)" % (
                sum(t["emisiones"]) / len(t["emisiones"]), min(t["emisiones"]), max(t["emisiones"])))
    else:
        print("  (datos de 05_calculated/ no disponibles — ejecuta 04_calculadas.py primero)")
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
        writer.writerow(["tipo", "descripcion_completa", "cantidad", "porcentaje"])
        for tipo in sorted(dist_tipos.keys()):
            n = dist_tipos[tipo]
            writer.writerow([
                tipo, TIPO_LABELS.get(tipo, "Otro"),
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
        writer.writerow(["verificadas_n1_codigo", total_n1])
        writer.writerow(["corregidas_n2_ids", total_n2])
        writer.writerow(["verificadas_n3_llm", total_n3])
        writer.writerow(["pendientes_sin_verificar", total_pendiente])
        writer.writerow(["tasa_verificacion_pct", round(pct_total, 1)])
        writer.writerow(["documentos_100pct_verificados", archivos_100])
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
            "verificadas_n1_codigo": total_n1,
            "corregidas_n2_ids": total_n2,
            "verificadas_n3_llm": total_n3,
            "pendientes_sin_verificar": total_pendiente,
            "omitidas_sin_evidencia": total_omit,
            "tasa_verificacion_pct": round(pct_total, 1),
            "documentos_100pct": archivos_100,
            "total_documentos": total_docs,
        },
        "distribucion_tipos": {
            tipo: {
                "descripcion": TIPO_LABELS.get(tipo, "Otro"),
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
        "calculadas": _construir_json_seccion6(calc_stats),
        "por_archivo": filas_csv,
    }

    reporte_path = METRICS_DIR / "reporte_completo.json"
    with open(reporte_path, "w", encoding="utf-8") as f:
        json.dump(reporte, f, ensure_ascii=False, indent=2)
    print("Guardado: %s" % reporte_path)

    print("\nTodos los archivos de metricas guardados en %s/" % METRICS_DIR)


if __name__ == "__main__":
    generar_metricas()
