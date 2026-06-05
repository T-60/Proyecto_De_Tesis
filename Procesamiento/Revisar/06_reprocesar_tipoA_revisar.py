"""
06_reprocesar_tipoA.py - Re-extrae SOLO las variables tipo A de documentos
con situaciones fragmentadas, rearmandolas como situaciones completas.

Es barato: al modelo solo se le pasan los fragmentos (fuente_ids) de las
variables tipo A, no el documento completo. No toca el resto del JSON.

Flujo seguro (no rompe nada):
  Lee   : data/05_calculated/<doc>.json  +  data/00_simplified/<doc>.md
  Escribe: data/07_tipoA_fix/<doc>.json   (copia con SOLO las tipo A rearmadas)
  El humano revisa y, si esta bien, reemplaza manualmente.

Uso:
  python 06_reprocesar_tipoA.py Arequipa18 Arequipa17 Arequipa12
"""

import anthropic
import json
import re
import sys
import unicodedata
from pathlib import Path

MODELO = "claude-sonnet-4-6"
MAX_TOKENS = 4000

INPUT_JSON = Path("data/05_calculated")
INPUT_MD   = Path("data/00_simplified")
OUTPUT_DIR = Path("data/07_tipoA_fix")
OUTPUT_DIR.mkdir(exist_ok=True, parents=True)

PROMPT = """Eres un extractor de situaciones de seguimiento. Recibiras fragmentos
de un documento de control (cada uno con su [id]) que contienen una o varias
situaciones adversas, y una lista de situaciones que un sistema anterior
extrajo MAL: las fragmento en secciones (condicion, criterio, consecuencia)
como si fueran situaciones distintas.

Tu tarea: rearmar las situaciones adversas REALES.

REGLA CRITICA:
- Cada situacion adversa es UN item completo. Si una situacion se describe en
  varias secciones (denominacion, condicion, criterio, consecuencia, reporte,
  referencia a hito anterior), INTEGRA todas esas secciones en el campo texto
  de UN SOLO item.
- Situaciones DISTINTAS (problemas diferentes) = items separados.
- Semanticamente: pregunta "cuantos PROBLEMAS distintos hay aqui". Ese es el
  numero de items, no el numero de secciones.

Para cada situacion real devuelve:
- texto: la situacion completa, integrando sus secciones, en redaccion continua.
- estado: el estado de esa situacion (abierta, persiste, corregida, etc.).
- desde_momento: si la situacion se refiere a un hito anterior, pon su id
  (ej: "hito_1"). Si es nueva en este momento, pon null.
- fuente_ids: los [id] de los fragmentos donde aparece esa situacion (lista).

Responde SOLO con un JSON valido, sin texto antes ni despues:
{
  "situaciones": [
    { "texto": "...", "estado": "...", "desde_momento": null, "fuente_ids": [1,2] }
  ]
}
"""


def construir_texto_por_id(md):
    d = {}
    for linea in md.split('\n'):
        m = re.match(r'^\[(\d+)\]\s*(.*)', linea)
        if m:
            d[int(m.group(1))] = m.group(2).strip()
    return d


def extraer_json(texto):
    texto = texto.strip()
    a, b = texto.find("{"), texto.rfind("}")
    return json.loads(texto[a:b+1])


def reprocesar(nombre, client):
    jpath = INPUT_JSON / f"{nombre}.json"
    mpath = INPUT_MD / f"{nombre}.md"
    if not jpath.exists() or not mpath.exists():
        print(f"  Falta {nombre}"); return

    data = json.load(open(jpath, encoding='utf-8'))
    tpi = construir_texto_por_id(mpath.read_text(encoding='utf-8'))

    print(f"=== {nombre} ===")
    cambios = 0
    for var in data.get("momento", {}).get("variables", []):
        if var.get("tipo") != "A":
            continue
        # juntar todos los ids de la variable y sus items
        ids = set(var.get("fuente_ids", []))
        for it in (var.get("detalle") or []):
            ids.update(it.get("fuente_ids", []))
        ids = sorted(ids)
        if not ids:
            continue

        # texto SOLO de esos ids (barato)
        fragmentos = "\n".join(f"[{i}] {tpi.get(i,'')}" for i in ids if i in tpi)
        items_malos = json.dumps(
            [{"texto": it.get("texto",""), "estado": it.get("estado","")}
             for it in (var.get("detalle") or [])],
            ensure_ascii=False, indent=2)

        msg = (f"FRAGMENTOS DEL DOCUMENTO:\n{fragmentos}\n\n"
               f"SITUACIONES MAL EXTRAIDAS (rearmalas):\n{items_malos}")

        resp = client.messages.create(
            model=MODELO, max_tokens=MAX_TOKENS, system=PROMPT,
            messages=[{"role": "user", "content": msg}])
        try:
            nuevo = extraer_json(resp.content[0].text)
            antes = len(var.get("detalle") or [])
            var["detalle"] = nuevo["situaciones"]
            var["_reprocesado_tipoA"] = True
            despues = len(nuevo["situaciones"])
            print(f"  {var['id']}: {antes} items -> {despues} situaciones")
            cambios += 1
        except Exception as e:
            print(f"  {var['id']}: ERROR {e}")

    out = OUTPUT_DIR / f"{nombre}.json"
    json.dump(data, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f"  guardado en {out} ({cambios} variables tipo A rearmadas)\n")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python 06_reprocesar_tipoA.py Arequipa18 Arequipa17 ...")
        sys.exit(1)
    client = anthropic.Anthropic()
    for nombre in sys.argv[1:]:
        reprocesar(nombre, client)
