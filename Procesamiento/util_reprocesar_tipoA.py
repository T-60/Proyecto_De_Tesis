"""
util_reprocesar_tipoA.py - UTILIDAD (no es una etapa del pipeline 00-05).

Re-extrae SOLO las variables tipo A marcadas como fragmentadas, rearmandolas
como situaciones completas (1 item = 1 situacion). Es un paso de reparacion
puntual que ya se aplico al corpus; se conserva por reproducibilidad y por si
entra un documento nuevo fragmentado.

Es BARATO: al modelo solo se le pasan los fragmentos (fuente_ids) de la variable,
no el documento completo (~7x menos tokens de entrada).

Es AISLADO y NO rompe nada:
  Lee    : data/04_verified/<doc>.json  +  data/00_simplified/<doc>.md
  Escribe: data/07_tipoA_fix/<doc>.json  (copia con SOLO las tipo A marcadas rearmadas)
  El humano revisa. Si esta bien, se reemplaza en 04_verified y se RE-CORRE el
  pipeline (04_calculadas -> 05_consolidar) para refrescar 'calculado'.

Que variables se reprocesan: se declara en config_reproceso_tipoA.json
(doc -> lista de ids de variables tipo A). Las demas variables NO se tocan.

Mejoras frente a la version inicial (revision de agente):
  - Parser JSON robusto de 3 pasos (reutiliza la logica de 02_paso1).
  - MAX_TOKENS 16000 (evita truncamiento).
  - Estados pedidos en el vocabulario canonico (alineado a NORMALIZAR_ESTADO).
  - desde_momento reforzado con pistas textuales de continuidad.
  - Avisa de fuente_ids que no existen en el MD (antes se descartaban en silencio).
  - Reprocesa SOLO las variables del config, no todas las tipo A.
  - Reporta tokens y costo.

Requisitos: pip install anthropic ; ANTHROPIC_API_KEY en el entorno.

Uso:
  python util_reprocesar_tipoA.py            # todos los del config
  python util_reprocesar_tipoA.py Arequipa18 # solo uno del config
"""

import anthropic
import json
import re
import sys
from pathlib import Path

MODELO = "claude-sonnet-4-6"
MAX_TOKENS = 16000

INPUT_JSON  = Path("data/04_verified")
INPUT_MD    = Path("data/00_simplified")
OUTPUT_DIR  = Path("data/07_tipoA_fix")
CONFIG_PATH = Path("config_reproceso_tipoA.json")
OUTPUT_DIR.mkdir(exist_ok=True, parents=True)

PROMPT = """Eres un extractor de situaciones adversas de informes de control
gubernamental. Recibiras los FRAGMENTOS del documento (cada uno con su [id])
donde aparece UNA variable de seguimiento, y los items que un sistema anterior
extrajo, que pueden haber FRAGMENTADO una sola situacion en secciones.

Tu tarea: devolver las situaciones adversas REALES, una por item.

REGLA CRITICA (anti-fragmentacion):
- Cada situacion adversa es UN item completo. Si una situacion se describe en
  secciones (denominacion, condicion, criterio normativo vulnerado, consecuencia,
  reporte de avance, referencia a hito anterior, contexto, rutas, desviaciones),
  INTEGRA todas esas secciones en el campo "texto" de UN SOLO item.
- Situaciones DISTINTAS (problemas diferentes: un formato distinto, un equipo
  distinto, una ruta distinta) = items separados.
- Preguntate: "cuantos PROBLEMAS distintos hay aqui?". Ese es el numero de
  items, NO el numero de secciones.

Para cada situacion real devuelve:
- "texto": la situacion completa, integrando sus secciones, en redaccion continua.
- "estado": USA EXACTAMENTE UNO de estos valores canonicos:
    "Abierta"      (identificada en este hito, sin resolver)
    "Con acciones" (la entidad tomo acciones / en proceso)
    "Persiste"     (sigue abierta en un hito posterior, sin correccion)
    "Corregida"    (subsanada / cerrada)
    "Incumplido"   (incumplimiento documental o contractual)
    "No aplica"
- "desde_momento": si la situacion VIENE de un hito anterior (el texto dice
  "hito anterior", "informe anterior", "subsiste", "persiste", "ya identificada",
  "no subsanada"), pon el id del hito de origen (ej. "hito_1"). Si es NUEVA en
  este momento, pon null.
- "fuente_ids": los [id] de los fragmentos donde aparece esa situacion (lista).

Responde SOLO con un JSON valido, sin texto antes ni despues:
{
  "situaciones": [
    { "texto": "...", "estado": "Abierta", "desde_momento": null, "fuente_ids": [1,2] }
  ]
}
"""


# ============================================================
# PARSER JSON ROBUSTO (3 pasos, igual que 02_paso1_completo.py)
# ============================================================

def extraer_json(texto):
    texto = texto.strip()
    a, b = texto.find("{"), texto.rfind("}")
    if a != -1 and b != -1:
        texto = texto[a:b + 1]

    # Intento 1: directo
    try:
        return json.loads(texto)
    except json.JSONDecodeError:
        pass

    # Intento 2: escapar comillas internas en valores string
    def fix_quotes(text):
        out = []
        for line in text.split('\n'):
            if '": "' not in line:
                out.append(line)
                continue
            idx_val = line.index('": "') + 4
            prefix, rest = line[:idx_val], line[idx_val:]
            close = len(rest) - 1
            while close >= 0:
                if rest[close] == '"':
                    after = rest[close + 1:].strip()
                    if after in ('', ',') or after[0] in ('}', ']', ','):
                        break
                close -= 1
            if close < 0:
                out.append(line)
                continue
            content, suffix = rest[:close], rest[close:]
            out.append(prefix + re.sub(r'(?<!\\)"', r'\\"', content) + suffix)
        return '\n'.join(out)

    fixed = fix_quotes(texto)
    try:
        return json.loads(fixed)
    except json.JSONDecodeError:
        pass

    # Intento 3: quitar backslashes invalidos
    VALID = set('"\\/ bfnrtu')
    chars = list(fixed)
    i = 0
    while i < len(chars) - 1:
        if chars[i] == '\\' and chars[i + 1] not in VALID:
            chars[i] = ' '
        i += 1
    return json.loads(''.join(chars))


def construir_texto_por_id(md):
    d = {}
    for linea in md.split('\n'):
        m = re.match(r'^\[(\d+)\]\s*(.*)', linea)
        if m:
            d[int(m.group(1))] = m.group(2).strip()
    return d


# ============================================================
# REPROCESO DE UN DOCUMENTO
# ============================================================

def reprocesar(nombre, ids_objetivo, client):
    jpath = INPUT_JSON / f"{nombre}.json"
    mpath = INPUT_MD / f"{nombre}.md"
    if not jpath.exists() or not mpath.exists():
        print(f"  [!] Falta {nombre} (json o md)"); return 0.0

    data = json.load(open(jpath, encoding='utf-8'))
    tpi = construir_texto_por_id(mpath.read_text(encoding='utf-8'))

    print(f"=== {nombre} ===")
    costo = 0.0
    encontradas = set()

    for var in data.get("momento", {}).get("variables", []):
        if var.get("tipo") != "A" or var.get("id") not in ids_objetivo:
            continue
        encontradas.add(var.get("id"))

        # juntar ids de la variable + sus items
        ids = set(var.get("fuente_ids", []))
        for it in (var.get("detalle") or []):
            ids.update(it.get("fuente_ids", []))
        ids = sorted(ids)

        faltantes = [i for i in ids if i not in tpi]
        if faltantes:
            print(f"  [!] {var['id']}: ids sin texto en el MD (ignorados): {faltantes}")
        presentes = [i for i in ids if i in tpi]
        if not presentes:
            print(f"  [!] {var['id']}: ningun id con texto, se omite")
            continue

        fragmentos = "\n".join(f"[{i}] {tpi[i]}" for i in presentes)
        items_malos = json.dumps(
            [{"texto": it.get("texto", ""), "estado": it.get("estado", "")}
             for it in (var.get("detalle") or [])],
            ensure_ascii=False, indent=2)

        msg = (f"FRAGMENTOS DEL DOCUMENTO:\n{fragmentos}\n\n"
               f"ITEMS EXTRAIDOS ANTES (posiblemente fragmentados, rearmalos):\n{items_malos}")

        resp = client.messages.create(
            model=MODELO, max_tokens=MAX_TOKENS, system=PROMPT,
            messages=[{"role": "user", "content": msg}])
        uso = resp.usage
        costo += (uso.input_tokens * 3 + uso.output_tokens * 15) / 1_000_000

        try:
            nuevo = extraer_json(resp.content[0].text)
            antes = len(var.get("detalle") or [])
            sits = nuevo["situaciones"]
            var["detalle"] = sits
            var["_reprocesado_tipoA"] = True
            estados = [s.get("estado") for s in sits]
            print(f"  {var['id']}: {antes} items -> {len(sits)} situaciones "
                  f"({uso.input_tokens} in / {uso.output_tokens} out)")
            for s in sits:
                print(f"       [{s.get('estado')}] desde={s.get('desde_momento')} "
                      f"{(s.get('texto') or '')[:70]}")
        except Exception as e:
            print(f"  [ERROR] {var['id']}: JSON invalido -> {e}")
            crudo = OUTPUT_DIR / f"{nombre}.{var['id']}.RAW.txt"
            crudo.write_text(resp.content[0].text, encoding='utf-8')
            print(f"          crudo guardado en {crudo.name}")

    no_encontradas = set(ids_objetivo) - encontradas
    if no_encontradas:
        print(f"  [!] variables del config NO halladas en {nombre}: {sorted(no_encontradas)}")

    out = OUTPUT_DIR / f"{nombre}.json"
    json.dump(data, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f"  guardado en {out}  (~${costo:.4f})\n")
    return costo


# ============================================================
# MAIN
# ============================================================

def main():
    if not CONFIG_PATH.exists():
        print(f"Falta {CONFIG_PATH}"); sys.exit(1)
    cfg = json.loads(CONFIG_PATH.read_text("utf-8"))
    objetivo = cfg.get("documentos", {})

    # filtrar por args si se pasan
    if len(sys.argv) > 1:
        objetivo = {k: v for k, v in objetivo.items() if k in sys.argv[1:]}
        if not objetivo:
            print(f"Ninguno de {sys.argv[1:]} esta en el config"); sys.exit(1)

    import os
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY no esta configurada."); sys.exit(1)

    print(f"Reprocesando tipo A de {len(objetivo)} documento(s): {list(objetivo)}")
    print(f"Salida aislada en: {OUTPUT_DIR}/  (no toca los originales)\n")

    client = anthropic.Anthropic()
    costo_total = 0.0
    for nombre, ids in objetivo.items():
        costo_total += reprocesar(nombre, ids, client)

    print("=" * 55)
    print(f"Reproceso completado. Costo total aproximado: ${costo_total:.4f}")
    print(f"Revisa los JSON en {OUTPUT_DIR}/ antes de reemplazar nada.")


if __name__ == "__main__":
    main()
