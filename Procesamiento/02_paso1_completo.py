"""
Paso 1 completo: extraccion (1A) + estructuracion a JSON (1C).

Por cada documento MD en data/simplified/:
  1A) Llama al LLM con el prompt de extraccion -> razonamiento en prosa
  1C) Llama al LLM con el prompt de estructuracion -> JSON parcial
  Inyecta el filename real y guarda el JSON.

Guarda tambien el razonamiento intermedio (1A) para poder auditar.

Requiere:
  - ANTHROPIC_API_KEY en el entorno
  - prompts/prompt_1A_extraccion.txt
  - prompts/prompt_1C_estructuracion.txt
  - data/simplified/*.md

Salidas:
  - data/extracted/<nombre>.txt   (razonamiento del 1A)
  - data/structured/<nombre>.json (JSON parcial del 1C)
"""

import anthropic
import json
import time
from pathlib import Path



MODELO = "claude-sonnet-4-6"
MAX_TOKENS_1A = 16000
MAX_TOKENS_1C = 16000

INPUT_DIR = Path("data/simplified")
RAZONAMIENTO_DIR = Path("data/extracted")
JSON_DIR = Path("data/structured")

PROMPT_1A_PATH = Path("prompts/prompt_1A_extraccion.txt")
PROMPT_1C_PATH = Path("prompts/prompt_1C_estructuracion.txt")

RAZONAMIENTO_DIR.mkdir(exist_ok=True, parents=True)
JSON_DIR.mkdir(exist_ok=True, parents=True)




def cargar_prompt(path):
    if not path.exists():
        raise FileNotFoundError(
            f"No se encontro el prompt en {path.absolute()}. "
        )
    return path.read_text(encoding="utf-8")


def extraer_json(texto):
   
    texto = texto.strip()

    if texto.startswith("```"):
        primera_llave = texto.find("{")
        ultima_llave = texto.rfind("}")
        if primera_llave != -1 and ultima_llave != -1:
            texto = texto[primera_llave:ultima_llave + 1]
    else:
        primera_llave = texto.find("{")
        ultima_llave = texto.rfind("}")
        if primera_llave != -1 and ultima_llave != -1:
            texto = texto[primera_llave:ultima_llave + 1]

    return json.loads(texto)




def paso_1a(client, prompt_sistema, contenido_md):
   
    mensaje_usuario = (
        "DOCUMENTO:\n\n"
        f"{contenido_md}\n\n"
        "Analiza el documento siguiendo las tres categorias: metadata del "
        "momento, marco general del proceso y variables del momento. "
        "Razona paso a paso."
    )
    respuesta = client.messages.create(
        model=MODELO,
        max_tokens=MAX_TOKENS_1A,
        system=prompt_sistema,
        messages=[{"role": "user", "content": mensaje_usuario}],
    )
    return respuesta.content[0].text, respuesta.usage


def paso_1c(client, prompt_sistema, razonamiento):
    mensaje_usuario = (
        "RAZONAMIENTO PREVIO:\n\n"
        f"{razonamiento}\n\n"
        "Convierte este razonamiento en el JSON estructurado segun el esquema."
    )
    respuesta = client.messages.create(
        model=MODELO,
        max_tokens=MAX_TOKENS_1C,
        system=prompt_sistema,
        messages=[{"role": "user", "content": mensaje_usuario}],
    )
    return respuesta.content[0].text, respuesta.usage


def procesar_documento(client, prompt_1a, prompt_1c, md_path):
    nombre = md_path.stem
    razonamiento_path = RAZONAMIENTO_DIR / f"{nombre}.txt"
    json_path = JSON_DIR / f"{nombre}.json"


    if json_path.exists():
        print(f"  SKIP (ya existe {json_path.name})")
        return "skip", 0.0

    contenido_md = md_path.read_text(encoding="utf-8")
    costo = 0.0

    # ----- Paso 1A -----
    if razonamiento_path.exists():
        razonamiento = razonamiento_path.read_text(encoding="utf-8")
        print("  1A reusado de disco")
    else:
        razonamiento, uso_1a = paso_1a(client, prompt_1a, contenido_md)
        razonamiento_path.write_text(razonamiento, encoding="utf-8")
        costo += (uso_1a.input_tokens * 3 + uso_1a.output_tokens * 15) / 1_000_000
        print(f"  1A ok ({uso_1a.input_tokens} in / {uso_1a.output_tokens} out)")

    # ----- Paso 1C -----
    json_texto, uso_1c = paso_1c(client, prompt_1c, razonamiento)
    costo += (uso_1c.input_tokens * 3 + uso_1c.output_tokens * 15) / 1_000_000
    print(f"  1C ok ({uso_1c.input_tokens} in / {uso_1c.output_tokens} out)")

    try:
        data = extraer_json(json_texto)
    except json.JSONDecodeError as e:
        crudo_path = JSON_DIR / f"{nombre}.RAW.txt"
        crudo_path.write_text(json_texto, encoding="utf-8")
        print(f"  ERROR: JSON invalido. Texto crudo en {crudo_path.name}")
        print(f"         {e}")
        return "error_json", costo

    try:
        data["momento"]["filename"] = f"{nombre}.pdf"
    except (KeyError, TypeError):
        print("  ADVERTENCIA: no se pudo inyectar filename (estructura inesperada)")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    n_vars = len(data.get("momento", {}).get("variables", []))
    print(f"  guardado {json_path.name} ({n_vars} variables)")
    return "ok", costo


def main():
    client = anthropic.Anthropic()

    prompt_1a = cargar_prompt(PROMPT_1A_PATH)
    prompt_1c = cargar_prompt(PROMPT_1C_PATH)

    import sys
    if len(sys.argv) > 1:
        nombre_archivo = sys.argv[1]
        archivo_especifico = INPUT_DIR / nombre_archivo
        if archivo_especifico.exists():
            documentos = [archivo_especifico]
        else:
            print(f"Error: No se encontró el archivo {archivo_especifico}")
            return
    else:
        documentos = sorted(INPUT_DIR.glob("*.md"))
    if not documentos:
        print(f"No se encontraron MD en {INPUT_DIR.absolute()}")
        return

    print(f"Procesando {len(documentos)} documentos\n")

    inicio = time.time()
    resultados = {"ok": 0, "skip": 0, "error_json": 0}
    costo_total = 0.0

    for i, md_path in enumerate(documentos, 1):
        print(f"[{i}/{len(documentos)}] {md_path.name}")
        estado, costo = procesar_documento(client, prompt_1a, prompt_1c, md_path)
        resultados[estado] = resultados.get(estado, 0) + 1
        costo_total += costo
        print()

    duracion = time.time() - inicio
    print("=" * 55)
    print(f"Completado en {duracion/60:.1f} minutos")
    print(f"OK: {resultados['ok']}")
    print(f"Saltados: {resultados['skip']}")
    print(f"Errores de JSON: {resultados['error_json']}")
    print(f"Costo total aproximado: ${costo_total:.2f}")


if __name__ == "__main__":
    main()
