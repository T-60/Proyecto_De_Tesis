"""
05_consolidar.py - Consolidacion de momentos en trayectorias (casos).

Toma los JSON ya verificados y calculados (data/05_calculated/) y los junta en
TRAYECTORIAS segun la agrupacion manual de dominio. Para cada trayectoria:

  1. Junta sus momentos ordenados por fecha (periodo_inicio).
  2. Empareja las situaciones adversas (tipo A) entre momentos por similitud
     de texto, armando "hilos": una misma situacion seguida hito a hito.
  3. Normaliza los estados de esas situaciones a un vocabulario canonico
     (insumo del diagrama Sankey).
  4. Genera la estructura Sankey (nodos + enlaces) de como evolucionan las
     situaciones entre momentos.

NO usa LLM ni API: es 100% codigo local, sin costo.

Decisiones de dominio (editables abajo):
  - CASOS                : la agrupacion manual ODPE x tema (7 trayectorias).
  - NORMALIZAR_ESTADO    : mapa de los ~33 estados crudos a ~6 canonicos.
                           REVISAR con la asesora — es un criterio, no un hecho.

Flujo:
  data/05_calculated/ -> 05_consolidar.py -> data/06_consolidated/

Salida:
  data/06_consolidated/<caso_id>.json   (una trayectoria por archivo)
  data/06_consolidated/_index.json      (indice de todas las trayectorias)

Uso:
  python 05_consolidar.py
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

INPUT_DIR   = Path("data/05_calculated")
OUTPUT_DIR  = Path("data/06_consolidated")
CONFIG_PATH = Path("config_casos.json")
OUTPUT_DIR.mkdir(exist_ok=True, parents=True)

# Emparejamiento de situaciones adversas entre momentos:
#
#   Senal primaria  -> el campo 'desde_momento' que el modelo ya extrajo.
#                      Si esta poblado, la situacion CONTINUA de un hito previo.
#                      Si es null, es una situacion NUEVA en este momento.
#   Senal secundaria -> similitud de texto, usada solo para RESOLVER con cual
#                      predecesor enlaza (el texto se reescribe entre informes,
#                      asi que coincidencias reales rondan 0.4-0.55, no mas).
#
# Por eso el umbral de texto es bajo: no decide SI continua (eso lo dice
# desde_momento), solo desempata a que hilo previo pertenece.
UMBRAL_CONT = 0.30


# ============================================================
# DECISION DE DOMINIO 1 — agrupacion declarada en trayectorias
# Caso = ODPE.  Trayectoria = proceso electoral dentro de la ODPE.
#
# El mapeo (que informe va con que ODPE y proceso) se declara fuera del
# codigo, en config_casos.json: es el "ground truth" del caso de estudio,
# basado en conocimiento del dominio (el proceso NO es inferible de forma
# confiable del id ni del label). El orden NO se declara: se deriva por
# periodo_inicio en procesar_caso().
# ============================================================

def cargar_casos():
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(
            f"No se encontro el mapeo de casos en {CONFIG_PATH.absolute()}. "
            "Es el agrupamiento declarado del caso de estudio.")
    cfg = json.loads(CONFIG_PATH.read_text("utf-8"))
    return cfg.get("casos", [])


# ============================================================
# DECISION DE DOMINIO 2 — normalizacion de estados (Sankey)
# Vocabulario canonico: Abierta, Con acciones, Persiste, Corregida,
#                       Incumplido, No aplica.
# REVISAR con la asesora. Si aparece un estado no mapeado, el script avisa.
# ============================================================

NORMALIZAR_ESTADO = {
    # --- Abierta: identificada, aun sin resolver ---
    "Abierta": "Abierta",
    "Abierta / Identificada": "Abierta",
    "Abierta / activa al momento del informe": "Abierta",
    "Abierta / comunicada": "Abierta",
    "Abierta / en curso": "Abierta",
    "Activa": "Abierta",
    "Aplicable": "Abierta",
    "Potencial": "Abierta",
    "Riesgo identificado": "Abierta",
    "Identificado": "Abierta",
    "Confirmada": "Abierta",
    "Abierto — no subsanado al 30 de enero de 2026": "Abierta",
    "Abierta - identificada en este hito, sin reporte de acciones correctivas adoptadas al momento de emisión": "Abierta",

    # --- Con acciones: la entidad reacciono / en proceso ---
    "Con Acciones": "Con acciones",
    "Con acciones": "Con acciones",   # auto-mapeo del valor canonico (reproceso tipo A)
    "Con Acciones (parcial en lo referente al enlace web)": "Con acciones",
    "Con Acciones (subsanación aún pendiente de completarse según lo declarado por el propio locador)": "Con acciones",
    "Abierto — en proceso de ejecución al 30 de enero de 2026": "Con acciones",
    "Abierto — proceso de contratación en curso al 30 de enero de 2026": "Con acciones",
    "Pendiente de respuesta de la entidad": "Con acciones",

    # --- Persiste: sigue abierta en un hito posterior, sin correccion ---
    "Persiste": "Persiste",
    "Abierto — no se reporta corrección al 30 de enero de 2026": "Persiste",
    "Abierto — rótulos sin instalar al 30 de enero de 2026": "Persiste",
    "Sin reporte de avance emitido": "Persiste",
    "Observado, sin corrección registrada": "Persiste",
    "Posición contraria de la entidad, no resuelta": "Persiste",

    # --- Corregida: subsanada / cerrada ---
    "Corregida": "Corregida",
    "Cerrada en hito anterior con acciones adoptadas": "Corregida",

    # --- Incumplido: incumplimiento documental o contractual ---
    "Incumplido": "Incumplido",
    "Incumplido parcialmente": "Incumplido",
    "Incumplimiento identificado — ODPE no autorizó formalmente los reemplazos": "Incumplido",
    "Incumplimiento identificado — conductor ejecutó servicio sin ningún tipo de comunicación ni autorización": "Incumplido",
    "Incumplimiento contractual — consecuencia: afectaría el otorgamiento de conformidad a los servicios contratados": "Incumplido",

    # --- No aplica: se excluye del flujo ---
    "No aplica": "No aplica",
}


# ============================================================
# UTILIDADES
# ============================================================

def normalizar_texto(t):
    """Minusculas, sin tildes, espacios colapsados — para comparar textos."""
    if not t:
        return ""
    t = t.lower()
    t = ''.join(c for c in unicodedata.normalize('NFD', t)
                if unicodedata.category(c) != 'Mn')
    t = re.sub(r'\s+', ' ', t).strip()
    return t


# Palabras vacias y "ruido" de dominio que aparecen en casi todos los textos.
# Si se incluyen, el emparejamiento se domina por el boilerplate
# ("La ODPE Cerro Colorado no...") y no por el sustantivo distintivo.
_STOPWORDS = {
    "de", "la", "el", "los", "las", "del", "al", "un", "una", "unos", "unas",
    "y", "o", "en", "con", "para", "por", "que", "no", "se", "su", "sus", "es",
    "son", "fue", "como", "ha", "han", "fueron", "este", "esta", "estos", "estas",
    "lo", "le", "ni", "mas", "muy", "ya", "sin", "sobre", "entre", "hasta",
}
_RUIDO_DOMINIO = {
    "odpe", "arequipa", "cerro", "colorado", "hito", "control", "informe",
    "situacion", "situaciones", "adversa", "adversas", "electoral", "electorales",
    "eg2026", "momento", "comision",
}


def _tokens(texto, quitar_ruido=True):
    """Conjunto de palabras significativas (>=4 letras, sin stopwords).

    quitar_ruido=True (para emparejar SITUACIONES): elimina tambien el ruido de
    dominio (odpe, comision, control...) para enfocarse en el sustantivo
    distintivo (almacen, ductos, computo...).
    quitar_ruido=False (para agrupar ETIQUETAS de actores/metricas): conserva
    ese vocabulario, porque ahi 'Comision de Control' u 'ODPE' SON la identidad
    del grupo.
    """
    norm = normalizar_texto(texto)
    toks = {w for w in re.findall(r'[a-z0-9]{4,}', norm) if w not in _STOPWORDS}
    if quitar_ruido:
        toks = {w for w in toks if w not in _RUIDO_DOMINIO}
    return toks


def similitud(a, b, quitar_ruido=True):
    """
    Similitud 0..1 por solapamiento de tokens significativos (coeficiente de
    solapamiento = interseccion / menor conjunto). Para situaciones ignora el
    boilerplate; para etiquetas (quitar_ruido=False) conserva el vocabulario
    que identifica al grupo.
    """
    ta, tb = _tokens(a, quitar_ruido), _tokens(b, quitar_ruido)
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    if inter < 2:            # al menos 2 tokens en comun para evitar falsos
        return 0.0
    return inter / min(len(ta), len(tb))


def estado_canonico(estado_crudo, sin_mapear):
    """Devuelve el estado canonico; registra los no mapeados para avisar."""
    if estado_crudo is None:
        return "Sin estado"
    if estado_crudo in NORMALIZAR_ESTADO:
        return NORMALIZAR_ESTADO[estado_crudo]
    sin_mapear.add(estado_crudo)
    return estado_crudo  # se deja crudo para que sea visible que falta mapearlo


# --- Pistas textuales de continuidad (enfoque hibrido) ---
# El campo desde_momento a veces queda en None aunque el texto diga que la
# situacion viene de un hito anterior. Se usa desde_momento y, ademas, estas
# pistas para inferir continuidad.
#
# Nota: la fragmentacion de situaciones (una situacion partida en facetas) se
# resuelve en la FUENTE (re-extraccion de las variables tipo A afectadas con la
# regla anti-fragmentacion del prompt), no aqui con heuristicas de post-proceso.
# Por eso aqui cada item del detalle se trata directamente como una situacion.
_CONTINUIDAD_CUES = (
    "hito anterior", "informe anterior", "informe de hito anterior",
    "situacion adversa del informe", "subsiste", "persiste", "reiterativ",
    "ya identificad", "no subsanad", "se mantiene la situacion",
    "situacion que se mantiene", "informe de hito n",
)


def _pistas_continuidad(texto):
    """Cues de continuidad presentes en el texto de la situacion."""
    blob = normalizar_texto(texto or "")
    return [c for c in _CONTINUIDAD_CUES if c in blob]


def situaciones_tipo_a(data):
    """Situaciones adversas de un momento. Cada item del detalle es una situacion
    (1 item = 1 situacion); se detecta la pista de continuidad textual."""
    items = []
    for v in data.get("momento", {}).get("variables", []):
        if v.get("tipo") != "A":
            continue
        for it in (v.get("detalle") or []):
            items.append({
                "texto":             it.get("texto") or "",
                "estado_raw":        it.get("estado"),
                "desde_momento":     it.get("desde_momento"),
                "fuente_ids":        it.get("fuente_ids") or [],
                "variable_id":       v.get("id"),
                "pista_continuidad": _pistas_continuidad(it.get("texto")),
            })
    return items


# ============================================================
# EMPAREJAMIENTO DE SITUACIONES ENTRE MOMENTOS (hilos)
# ============================================================

def construir_hilos(momentos, sin_mapear):
    """
    Recorre los momentos en orden y arma 'hilos': cada hilo es una misma
    situacion adversa seguida a traves de los momentos donde reaparece.

    Senal primaria = 'desde_momento' (lo extrajo el modelo):
      - poblado y no es el primer momento -> CONTINUACION: se enlaza al hilo
        previo mas parecido por texto (>= UMBRAL_CONT). Si ninguno alcanza el
        umbral, se abre hilo nuevo con nota (continua segun el modelo pero sin
        predecesor textual claro — posible pista de agrupacion a revisar).
      - poblado en el primer momento -> heredada de antes de la trayectoria.
      - null -> situacion NUEVA en este momento.
    """
    hilos = []  # cada hilo: {"apariciones":[...], "_ultimo_texto":str}

    for orden, mom in enumerate(momentos, start=1):
        sits = situaciones_tipo_a(mom["data"])

        # Construir las apariciones de este momento
        apariciones = []
        for sit in sits:
            pistas = sit.get("pista_continuidad") or []
            tiene_dm = sit["desde_momento"] not in (None, "", [])
            apariciones.append({
                "orden":             orden,
                "doc":               mom["doc"],
                "estado_raw":        sit["estado_raw"],
                "estado":            estado_canonico(sit["estado_raw"], sin_mapear),
                "texto":             sit["texto"],
                "fuente_ids":        sit["fuente_ids"],
                "desde_momento":     sit["desde_momento"],
                "pista_continuidad": pistas,
                "score_match":       None,
                # continuidad por senal del modelo (desde_momento) O pista textual
                "_continua":         tiene_dm or bool(pistas),
            })

        # 1) Continuaciones -> asignacion GLOBAL: se calculan todos los pares
        #    (aparicion, hilo previo) con score >= umbral y se asignan en orden
        #    de mejor score, uno-a-uno. Asi un enlace fuerte no queda bloqueado
        #    por uno debil procesado antes (problema del matching greedy simple).
        if orden > 1:
            candidatos = []
            for i, ap in enumerate(apariciones):
                if not ap["_continua"]:
                    continue
                for h in hilos:
                    s = similitud(ap["texto"], h["_ultimo_texto"])
                    if s >= UMBRAL_CONT:
                        candidatos.append((s, i, h))
            candidatos.sort(key=lambda c: c[0], reverse=True)
            ap_usadas, hilos_usados = set(), set()
            for s, i, h in candidatos:
                if i in ap_usadas or id(h) in hilos_usados:
                    continue
                ap = apariciones[i]
                ap["score_match"] = round(s, 3)
                h["apariciones"].append(ap)
                h["_ultimo_texto"] = ap["texto"]
                ap_usadas.add(i)
                hilos_usados.add(id(h))

        # 2) Las apariciones no enlazadas abren hilo nuevo (en orden original)
        for ap in apariciones:
            if ap["score_match"] is not None:
                continue  # ya enlazada a un hilo previo
            if ap["_continua"] and orden > 1:
                ap["nota"] = "continua_segun_modelo_sin_predecesor_textual"
            elif ap["_continua"] and orden == 1:
                ap["nota"] = "heredada_de_antes_de_la_trayectoria"
            hilos.append({"apariciones": [ap], "_ultimo_texto": ap["texto"]})

    # Limpiar campo interno temporal
    for h in hilos:
        for ap in h["apariciones"]:
            ap.pop("_continua", None)

    # Numerar
    salida = []
    for i, h in enumerate(hilos, start=1):
        salida.append({
            "hilo_id": i,
            "texto_representativo": h["apariciones"][0]["texto"],
            "n_apariciones": len(h["apariciones"]),
            "continua": len(h["apariciones"]) > 1,
            "apariciones": h["apariciones"],
        })
    return salida


# ============================================================
# SANKEY
# ============================================================

def construir_sankey(hilos):
    """
    Nodos = (orden de momento, estado canonico) que realmente ocurren.
    Enlaces = transiciones de un hilo entre apariciones consecutivas.
    Una situacion que aparece por primera vez en el momento k>1 nace de un
    nodo virtual "Nueva@Mk".
    """
    nodos = {}   # clave -> indice
    def nodo(clave, etiqueta, orden, estado):
        if clave not in nodos:
            nodos[clave] = {"index": len(nodos), "id": clave, "label": etiqueta,
                            "momento": orden, "estado": estado}
        return nodos[clave]["index"]

    enlaces = {}  # (src,dst) -> {"value":n, "hilos":[...]}
    def enlace(src, dst, hilo_id):
        k = (src, dst)
        if k not in enlaces:
            enlaces[k] = {"source": src, "target": dst, "value": 0, "hilos": []}
        enlaces[k]["value"] += 1
        enlaces[k]["hilos"].append(hilo_id)

    for h in hilos:
        aps = h["apariciones"]
        # nodo de nacimiento si la primera aparicion no es el momento 1
        primera = aps[0]
        if primera["orden"] > 1:
            src = nodo(f"Nueva@M{primera['orden']}", f"Nueva (M{primera['orden']})",
                       primera["orden"], "Nueva")
            dst = nodo(f"M{primera['orden']}:{primera['estado']}",
                       f"M{primera['orden']}: {primera['estado']}",
                       primera["orden"], primera["estado"])
            enlace(src, dst, h["hilo_id"])
        # transiciones entre apariciones consecutivas
        for a, b in zip(aps, aps[1:]):
            src = nodo(f"M{a['orden']}:{a['estado']}", f"M{a['orden']}: {a['estado']}",
                       a["orden"], a["estado"])
            dst = nodo(f"M{b['orden']}:{b['estado']}", f"M{b['orden']}: {b['estado']}",
                       b["orden"], b["estado"])
            enlace(src, dst, h["hilo_id"])

    nodos_lista = sorted(nodos.values(), key=lambda n: n["index"])
    return {"nodes": nodos_lista, "links": list(enlaces.values())}


# ============================================================
# EVOLUCION DE LOS TIPOS B-F ENTRE MOMENTOS
# Misma idea que los hilos de A: seguir un mismo concepto hito a hito.
# El concepto se identifica por similitud de LABEL entre momentos
# (el LLM reescribe los labels, asi que no sirve la igualdad exacta).
# ============================================================

def _vars_por_tipo(momentos, tipo):
    """[(orden, variable), ...] de un tipo, en orden de momento."""
    out = []
    for orden, m in enumerate(momentos, start=1):
        for v in m["data"].get("momento", {}).get("variables", []):
            if v.get("tipo") == tipo:
                out.append((orden, v))
    return out


def _clusters_por_label(items, umbral=0.5):
    """Agrupa [(orden, var)] por similitud de label (conservando el vocabulario
    de dominio, que identifica al grupo). Un cluster no toma dos variables del
    mismo momento."""
    clusters = []
    for orden, var in items:
        lab = var.get("label") or ""
        mejor, best = None, 0.0
        for c in clusters:
            if any(o == orden for o, _ in c["items"]):
                continue
            s = similitud(lab, c["_rep"], quitar_ruido=False)
            if s > best:
                best, mejor = s, c
        if mejor is not None and best >= umbral:
            mejor["items"].append((orden, var))
        else:
            clusters.append({"label": lab, "_rep": lab, "items": [(orden, var)]})
    return clusters


def evolucion_actores(momentos):
    """Tipo D: por grupo de rol, las personas en cada momento con entra/sale/persiste."""
    grupos = []
    for c in _clusters_por_label(_vars_por_tipo(momentos, "D")):
        evol, prev = [], None
        for orden, var in sorted(c["items"]):
            personas = [{"nombre": it.get("nombre"), "rol": it.get("rol")}
                        for it in (var.get("detalle") or [])]
            actuales = {normalizar_texto(p["nombre"] or ""): p for p in personas}
            entran, persisten, salen = [], [], []
            if prev is not None:
                for k, p in actuales.items():
                    (persisten if k in prev else entran).append(p["nombre"])
                salen = [p["nombre"] for k, p in prev.items() if k not in actuales]
            evol.append({"orden": orden, "n_personas": len(personas),
                         "personas": personas,
                         "entran": entran, "persisten": persisten, "salen": salen})
            prev = actuales
        grupos.append({"grupo": c["label"],
                       "momentos_presente": sorted({o for o, _ in c["items"]}),
                       "evolucion": evol})
    return grupos


def series_progreso(momentos):
    """Tipo B: por metrica, serie de avance hito a hito. Marca si el
    denominador (meta/unidad) cambia — en ese caso una linea unica enganaria."""
    series = []
    for c in _clusters_por_label(_vars_por_tipo(momentos, "B")):
        puntos, unidades, metas = [], set(), set()
        for orden, var in sorted(c["items"]):
            valor = var.get("valor") or {}
            pct = ((var.get("calculado") or {}).get("pct_avance") or {}).get("valor")
            puntos.append({"orden": orden,
                           "observado": valor.get("observado"),
                           "meta": valor.get("meta"),
                           "unidad": valor.get("unidad"),
                           "pct_avance": pct})
            if valor.get("unidad") is not None:
                unidades.add(valor.get("unidad"))
            if valor.get("meta") is not None:
                metas.add(valor.get("meta"))
        series.append({"metrica": c["label"],
                       "n_puntos": len(puntos),
                       "denominador_estable": len(metas) <= 1 and len(unidades) <= 1,
                       "puntos": puntos})
    return series


def series_cumplimiento(momentos):
    """Tipo F: tasa de cumplimiento agregada por momento + criterios recurrentes."""
    por_momento = []
    for orden, m in enumerate(momentos, start=1):
        tasas, cumplen, total = [], 0, 0
        for v in m["data"].get("momento", {}).get("variables", []):
            if v.get("tipo") != "F":
                continue
            calc = v.get("calculado") or {}
            t = (calc.get("tasa_cumplimiento") or {}).get("valor")
            if t is not None:
                tasas.append(t)
            cg = (calc.get("cumple_global") or {}).get("valor")
            if cg is not None:
                total += 1
                cumplen += 1 if cg else 0
        por_momento.append({
            "orden": orden, "doc": m["doc"],
            "tasa_cumplimiento_promedio": round(sum(tasas) / len(tasas), 2) if tasas else None,
            "criterios_cumple_global": f"{cumplen}/{total}" if total else None,
        })

    recurrentes = []
    for c in _clusters_por_label(_vars_por_tipo(momentos, "F")):
        if len({o for o, _ in c["items"]}) < 2:
            continue
        puntos = [{"orden": orden,
                   "cumple_global": ((var.get("calculado") or {}).get("cumple_global") or {}).get("valor"),
                   "tasa": ((var.get("calculado") or {}).get("tasa_cumplimiento") or {}).get("valor")}
                  for orden, var in sorted(c["items"])]
        recurrentes.append({"criterio": c["label"], "puntos": puntos})
    return {"por_momento": por_momento, "criterios_recurrentes": recurrentes}


def constantes_y_cambios(momentos):
    """Tipo C: conceptos que recurren entre momentos; marca si el valor se
    mantiene constante o cambia (p.ej. el presupuesto)."""
    out = []
    for c in _clusters_por_label(_vars_por_tipo(momentos, "C")):
        if len({o for o, _ in c["items"]}) < 2:
            continue
        valores = [{"orden": orden, "categoria": (var.get("valor") or {}).get("categoria")}
                   for orden, var in sorted(c["items"])]
        distintos = {v["categoria"] for v in valores}
        out.append({"concepto": c["label"],
                    "constante": len(distintos) == 1,
                    "valores": valores})
    return out


def eje_temporal(momentos):
    """Eje X temporal compartido por todas las series de la trayectoria."""
    eje = []
    for orden, m in enumerate(momentos, start=1):
        mom = m["data"]["momento"]
        calc = mom.get("calculado", {})
        eje.append({
            "orden": orden, "doc": m["doc"],
            "periodo_inicio": m["inicio"], "periodo_fin": m["fin"],
            "fecha_emision": mom.get("metadata", {}).get("fecha_emision"),
            "duracion_dias": (calc.get("duracion_periodo_dias") or {}).get("valor"),
            "dias_hasta_emision": (calc.get("dias_hasta_emision") or {}).get("valor"),
        })
    return eje


# ============================================================
# PROCESAMIENTO DE UN CASO
# ============================================================

def procesar_caso(caso, sin_mapear):
    momentos = []
    for doc in caso["docs"]:
        p = INPUT_DIR / f"{doc}.json"
        if not p.exists():
            print(f"  [!] No encontrado: {p}")
            continue
        data = json.loads(p.read_text("utf-8"))
        md = data.get("momento", {}).get("metadata", {})
        momentos.append({
            "doc": doc,
            "inicio": md.get("periodo_inicio") or "",
            "fin": md.get("periodo_fin") or "",
            "data": data,
        })

    # Ordenar por fecha de inicio (numero de hito NO es confiable)
    momentos.sort(key=lambda m: m["inicio"] or "9999")

    hilos = construir_hilos(momentos, sin_mapear)
    sankey = construir_sankey(hilos)

    # Momentos en forma compacta para la salida (conserva variables y calculado)
    momentos_out = []
    for orden, m in enumerate(momentos, start=1):
        mom = m["data"]["momento"]
        md = mom.get("metadata", {})
        momentos_out.append({
            "orden": orden,
            "doc": m["doc"],
            "label": mom.get("label"),
            "hito_id": mom.get("id"),
            "numero_declarado": mom.get("numero"),
            "instancia_id": m["data"].get("instancia", {}).get("id"),
            "identificador": md.get("identificador"),
            "estado_notificacion": md.get("estado_notificacion"),
            "periodo_inicio": m["inicio"],
            "periodo_fin": m["fin"],
            "fecha_emision": md.get("fecha_emision"),
            "marco_general": mom.get("marco_general", []),
            "calculado": mom.get("calculado", {}),
            "variables": mom.get("variables", []),
        })

    n_sit = len(hilos)
    n_cont = sum(1 for h in hilos if h["continua"])
    # Continuidad inferida por pista textual (cuando desde_momento estaba en None)
    n_por_pista = sum(1 for h in hilos for a in h["apariciones"]
                      if a.get("pista_continuidad") and a.get("desde_momento") in (None, "", []))
    return {
        "caso_id": caso["caso_id"],
        "odpe": caso["odpe"],
        "tema": caso["tema"],
        "n_momentos": len(momentos_out),
        "eje_temporal": eje_temporal(momentos),
        "momentos": momentos_out,
        "resumen_situaciones": {
            "total_hilos": n_sit,
            "con_continuidad": n_cont,
            "solo_un_momento": n_sit - n_cont,
            "continuidad_inferida_por_texto": n_por_pista,
        },
        "situaciones_adversas": hilos,
        "sankey": sankey,
        "evolucion": {
            "actores": evolucion_actores(momentos),          # tipo D
            "progreso": series_progreso(momentos),           # tipo B
            "cumplimiento": series_cumplimiento(momentos),   # tipo F
            "constantes_y_cambios": constantes_y_cambios(momentos),  # tipo C
        },
    }


# ============================================================
# MAIN
# ============================================================

def main():
    casos = cargar_casos()
    print(f"Consolidando {len(casos)} trayectorias desde {INPUT_DIR}/")
    print(f"  (mapeo declarado: {CONFIG_PATH})\n")
    sin_mapear = set()
    indice = []

    for caso in casos:
        resultado = procesar_caso(caso, sin_mapear)
        out = OUTPUT_DIR / f"{caso['caso_id']}.json"
        out.write_text(json.dumps(resultado, ensure_ascii=False, indent=2), "utf-8")

        rs = resultado["resumen_situaciones"]
        print(f"  {caso['caso_id']:<40} {resultado['n_momentos']} momentos | "
              f"{rs['total_hilos']} situaciones ({rs['con_continuidad']} con continuidad)")
        if rs["continuidad_inferida_por_texto"]:
            print(f"      [hibrido]  {rs['continuidad_inferida_por_texto']} continuidad(es) "
                  f"inferida(s) por pista textual (desde_momento estaba en None)")
        indice.append({
            "caso_id": caso["caso_id"],
            "odpe": caso["odpe"],
            "tema": caso["tema"],
            "n_momentos": resultado["n_momentos"],
            "docs": [m["doc"] for m in resultado["momentos"]],
            "total_situaciones": rs["total_hilos"],
            "situaciones_con_continuidad": rs["con_continuidad"],
        })

    (OUTPUT_DIR / "_index.json").write_text(
        json.dumps({"n_casos": len(indice), "casos": indice}, ensure_ascii=False, indent=2), "utf-8")

    print(f"\nConsolidacion completada. {len(indice)} trayectorias en {OUTPUT_DIR}/")
    if sin_mapear:
        print("\n  [!] ESTADOS SIN MAPEAR (agregalos a NORMALIZAR_ESTADO):")
        for e in sorted(sin_mapear):
            print(f"        - {e!r}")


if __name__ == "__main__":
    main()
