"""
04_calculadas.py - Crea variables calculadas sobre los datos ya verificados.

Lee los JSON de data/04_verified/ y les agrega un bloque 'calculado' a cada
variable y al momento. No verifica contra el documento: deriva por formula a
partir de campos ya verificados.

Cada metrica guarda su _formula con los valores reales sustituidos:
  "observado(48) / meta(149) * 100 = 32.3%"
Trazabilidad total: el JSON mismo responde de donde sale cada numero.

  Tipo A  - Seguimiento : nuevos, arrastrados, distribucion por estado (Sankey)
  Tipo B  - Progreso    : pct_avance, brecha, diferencia_estimado, diffs subgrupos
  Tipo C  - Estado      : presencia de categoria y nota
  Tipo D  - Relacional  : total de actores
  Tipo E  - Narrativo   : longitud del cuerpo en palabras y caracteres
  Tipo F  - Verificacion: tasa de cumplimiento de criterios

A nivel de momento:
  duracion_periodo_dias  : periodo_fin - periodo_inicio
  dias_hasta_emision     : fecha_emision - periodo_fin

Flujo:
  04_verified/ -> 04_calculadas.py -> 05_calculated/

Uso:
  python 04_calculadas.py               # procesa todos los archivos
  python 04_calculadas.py Arequipa2     # procesa solo uno
"""

import json
import sys
from datetime import date
from pathlib import Path

INPUT_DIR  = Path("data/04_verified")
OUTPUT_DIR = Path("data/05_calculated")

OUTPUT_DIR.mkdir(exist_ok=True, parents=True)


# ============================================================
# UTILIDADES
# ============================================================

def _v(x):
    """Formatea un valor para mostrarlo en una formula."""
    if x is None:
        return "null"
    if isinstance(x, float):
        return f"{x:.4g}"
    return str(x)


def _parse_fecha(s):
    try:
        return date.fromisoformat(s) if s else None
    except (ValueError, TypeError):
        return None


def _metrica(valor, formula):
    """Estructura estandar de metrica calculada."""
    return {"valor": valor, "_formula": formula}


# ============================================================
# CALCULOS POR TIPO
# ============================================================

def calcular_tipo_a(var):
    """
    Tipo A — Seguimiento de situaciones adversas.
    Calcula nuevos, arrastrados y distribucion por estado (base del Sankey).
    """
    detalle    = var.get("detalle") or []
    total      = len(detalle)
    nuevos     = sum(1 for it in detalle if it.get("desde_momento") is None)
    arrastrados = total - nuevos

    por_estado = {}
    for it in detalle:
        est = (it.get("estado") or "sin_estado").strip()
        por_estado[est] = por_estado.get(est, 0) + 1

    return {
        "total_items": _metrica(
            total,
            f"len(detalle) = {total}"
        ),
        "nuevos": _metrica(
            nuevos,
            f"count(desde_momento == null) = {nuevos} de {total}"
        ),
        "arrastrados": _metrica(
            arrastrados,
            f"count(desde_momento != null) = {arrastrados} de {total}"
        ),
        "distribucion_por_estado": _metrica(
            por_estado,
            "group_by(estado) sobre detalle — base del diagrama Sankey"
        ),
    }


def calcular_tipo_b(var):
    """
    Tipo B — Progreso (valores numericos hacia una meta).
    Calcula pct_avance, brecha, diferencia vs estimado y diffs por subgrupo.
    """
    valor   = var.get("valor") or {}
    detalle = var.get("detalle") or []

    obs      = valor.get("observado")
    meta     = valor.get("meta")
    estimado = valor.get("estimado")
    unidad   = valor.get("unidad") or ""
    u        = f" {unidad}" if unidad else ""

    resultado = {}

    if obs is not None and meta and meta != 0:
        pct = round(obs / meta * 100, 2)
        resultado["pct_avance"] = _metrica(
            pct,
            f"observado({_v(obs)}) / meta({_v(meta)}) * 100 = {pct}%"
        )

    if obs is not None and meta is not None:
        brecha = round(meta - obs, 4)
        resultado["brecha"] = _metrica(
            brecha,
            f"meta({_v(meta)}) - observado({_v(obs)}) = {_v(brecha)}{u}"
        )

    if obs is not None and estimado is not None:
        diff_est = round(obs - estimado, 4)
        resultado["diferencia_vs_estimado"] = _metrica(
            diff_est,
            f"observado({_v(obs)}) - estimado({_v(estimado)}) = {_v(diff_est)}{u}"
        )

    if detalle:
        diffs = []
        for it in detalle:
            prev = it.get("previsto")
            real = it.get("real")
            sg   = it.get("subgrupo") or "subgrupo"
            if prev is not None and real is not None:
                diff = round(real - prev, 4)
                diffs.append({
                    "subgrupo": sg,
                    "diferencia": diff,
                    "_formula": f"real({_v(real)}) - previsto({_v(prev)}) = {_v(diff)}{u}",
                })
        if diffs:
            resultado["diffs_subgrupos"] = _metrica(
                diffs,
                "real - previsto por cada subgrupo del detalle"
            )

    if not resultado:
        resultado["sin_datos"] = _metrica(
            None,
            "valor.observado o meta ausentes en este documento"
        )

    return resultado


def calcular_tipo_c(var):
    """
    Tipo C — Estado / categoria.
    Calcula presencia de categoria y de nota explicativa.
    """
    valor = var.get("valor") or {}
    cat   = valor.get("categoria")
    nota  = valor.get("nota")

    return {
        "tiene_categoria": _metrica(
            bool(cat),
            f"bool(valor.categoria) — {'presente: ' + repr(str(cat)[:50]) if cat else 'ausente'}"
        ),
        "tiene_nota_explicativa": _metrica(
            bool(nota),
            f"bool(valor.nota) — {'presente (' + str(len(nota)) + ' chars)' if nota else 'ausente'}"
        ),
    }


def calcular_tipo_d(var):
    """
    Tipo D — Actores relacionales.
    Calcula el total de actores listados en el detalle.
    """
    detalle = var.get("detalle") or []
    total   = len(detalle)

    return {
        "total_actores": _metrica(
            total,
            f"len(detalle) = {total} actores"
        ),
    }


def calcular_tipo_e(var):
    """
    Tipo E — Narrativo.
    Calcula longitud del cuerpo en palabras y en caracteres.
    """
    valor   = var.get("valor") or {}
    cuerpo  = valor.get("cuerpo") or ""
    palabras = len(cuerpo.split())
    chars    = len(cuerpo)

    return {
        "longitud_palabras": _metrica(
            palabras,
            f"len(valor.cuerpo.split()) = {palabras} palabras"
        ),
        "longitud_chars": _metrica(
            chars,
            f"len(valor.cuerpo) = {chars} caracteres"
        ),
    }


def calcular_tipo_f(var):
    """
    Tipo F — Verificacion documental (booleano + criterios).
    Calcula tasa de cumplimiento sobre los criterios del detalle.
    """
    valor   = var.get("valor") or {}
    detalle = var.get("detalle") or []

    cumple_global     = valor.get("booleano")
    total_criterios   = len(detalle)
    criterios_ok      = sum(1 for it in detalle if it.get("cumple") is True)
    criterios_no      = sum(1 for it in detalle if it.get("cumple") is False)

    resultado = {
        "cumple_global": _metrica(
            cumple_global,
            "valor.booleano — asignado por LLM a partir del fragmento verificado"
        ),
    }

    if total_criterios > 0:
        tasa = round(criterios_ok / total_criterios * 100, 2)
        resultado["total_criterios"]     = _metrica(total_criterios, f"len(detalle) = {total_criterios}")
        resultado["criterios_cumplidos"] = _metrica(criterios_ok,    f"count(detalle[i].cumple == true) = {criterios_ok}")
        resultado["criterios_no_cumplidos"] = _metrica(criterios_no, f"count(detalle[i].cumple == false) = {criterios_no}")
        resultado["tasa_cumplimiento"]   = _metrica(
            tasa,
            f"criterios_cumplidos({criterios_ok}) / total_criterios({total_criterios}) * 100 = {tasa}%"
        )

    return resultado


CALCULADORES = {
    "A": calcular_tipo_a,
    "B": calcular_tipo_b,
    "C": calcular_tipo_c,
    "D": calcular_tipo_d,
    "E": calcular_tipo_e,
    "F": calcular_tipo_f,
}


# ============================================================
# CALCULOS A NIVEL DE MOMENTO
# ============================================================

def calcular_momento(metadata):
    """Metricas temporales derivadas de la metadata del momento.

    Devuelve (resultado, advertencias). Las advertencias capturan fechas que
    no se pudieron parsear (no-ISO) o periodos invertidos (fin antes que
    inicio), para que no queden cálculos en null sin dejar rastro.
    """
    raw = {
        "periodo_inicio": metadata.get("periodo_inicio"),
        "periodo_fin":    metadata.get("periodo_fin"),
        "fecha_emision":  metadata.get("fecha_emision"),
    }
    f_inicio  = _parse_fecha(raw["periodo_inicio"])
    f_fin     = _parse_fecha(raw["periodo_fin"])
    f_emision = _parse_fecha(raw["fecha_emision"])

    advertencias = []
    for campo, (valor, parsed) in {
        "periodo_inicio": (raw["periodo_inicio"], f_inicio),
        "periodo_fin":    (raw["periodo_fin"],    f_fin),
        "fecha_emision":  (raw["fecha_emision"],  f_emision),
    }.items():
        if valor and parsed is None:
            advertencias.append(f"fecha no-ISO en {campo}: {valor!r} (cálculo omitido)")

    resultado = {}

    if f_inicio and f_fin:
        if f_fin < f_inicio:
            advertencias.append(
                f"periodo invertido: periodo_fin({f_fin}) anterior a periodo_inicio({f_inicio}) "
                "— duracion_periodo_dias no calculada"
            )
        else:
            duracion = (f_fin - f_inicio).days + 1  # inclusivo: ambos extremos cuentan
            resultado["duracion_periodo_dias"] = _metrica(
                duracion,
                f"(periodo_fin({f_fin}) - periodo_inicio({f_inicio})).days + 1 = {duracion} dias (inclusivo)"
            )

    if f_fin and f_emision:
        dias = (f_emision - f_fin).days
        resultado["dias_hasta_emision"] = _metrica(
            dias,
            f"fecha_emision({f_emision}) - periodo_fin({f_fin}) = {dias} dias"
        )
    elif f_inicio and f_emision:
        dias = (f_emision - f_inicio).days
        resultado["dias_hasta_emision"] = _metrica(
            dias,
            f"fecha_emision({f_emision}) - periodo_inicio({f_inicio}) = {dias} dias (sin periodo_fin)"
        )

    return resultado, advertencias


# ============================================================
# PROCESAMIENTO DE ARCHIVO
# ============================================================

def procesar_archivo(nombre_archivo):
    input_path  = INPUT_DIR  / f"{nombre_archivo}.json"
    output_path = OUTPUT_DIR / f"{nombre_archivo}.json"

    if not input_path.exists():
        print(f"  No encontrado: {input_path}")
        return

    data      = json.loads(input_path.read_text("utf-8"))
    variables = data.get("momento", {}).get("variables", [])
    metadata  = data.get("momento", {}).get("metadata", {})

    c_calc = c_skip = 0
    for var in variables:
        tipo = var.get("tipo")
        fn   = CALCULADORES.get(tipo)
        if fn:
            var["calculado"] = fn(var)
            c_calc += 1
        else:
            c_skip += 1

    cal, advertencias = calcular_momento(metadata)
    data["momento"]["calculado"] = cal

    output_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")

    dur = cal.get("duracion_periodo_dias", {}).get("valor", "?")
    emi = cal.get("dias_hasta_emision", {}).get("valor", "?")
    print(f"  {nombre_archivo:<14} {c_calc} vars calculadas | duracion={dur} dias | emision={emi} dias")
    for a in advertencias:
        print(f"    [!] {nombre_archivo}: {a}")


# ============================================================
# MAIN
# ============================================================

def main():
    if len(sys.argv) >= 2:
        archivos = sys.argv[1:]
    else:
        archivos = sorted(p.stem for p in INPUT_DIR.glob("*.json"))

    if not archivos:
        print(f"No hay archivos en {INPUT_DIR}")
        sys.exit(1)

    print(f"Calculando sobre {len(archivos)} archivo(s) en {INPUT_DIR}/\n")
    for nombre in archivos:
        procesar_archivo(nombre)
    print(f"\nResultados guardados en: {OUTPUT_DIR}/")


if __name__ == "__main__":
    main()
