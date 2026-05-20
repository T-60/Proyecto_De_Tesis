"""
Transforma archivos JSON estructurados a formato de texto plano.
Conserva el identificador y el texto de cada elemento.
"""

import json
from pathlib import Path

INPUT_DIR = Path('data/jsons')
OUTPUT_DIR = Path('data/simplified')
OUTPUT_DIR.mkdir(exist_ok=True, parents=True)


def extraer_elementos(nodo, resultado):
    if isinstance(nodo, dict):
        if 'id' in nodo and 'content' in nodo:
            contenido = nodo.get('content', '').strip()
            if contenido:
                resultado.append({
                    'id': nodo['id'],
                    'content': contenido
                })

        if 'kids' in nodo and isinstance(nodo['kids'], list):
            for hijo in nodo['kids']:
                extraer_elementos(hijo, resultado)

        if 'rows' in nodo and isinstance(nodo['rows'], list):
            for fila in nodo['rows']:
                extraer_elementos(fila, resultado)

        if 'cells' in nodo and isinstance(nodo['cells'], list):
            for celda in nodo['cells']:
                extraer_elementos(celda, resultado)

        if 'list items' in nodo and isinstance(nodo['list items'], list):
            for item in nodo['list items']:
                extraer_elementos(item, resultado)


def simplificar_a_md(json_path):
    with open(json_path) as f:
        data = json.load(f)

    elementos = []
    for kid in data.get('kids', []):
        extraer_elementos(kid, elementos)

    lineas = [f"# {data.get('file name')}", ""]
    for el in elementos:
        lineas.append(f"[{el['id']}] {el['content']}")

    return "\n".join(lineas)


def main():
    archivos = sorted(INPUT_DIR.glob('*.json'))

    if not archivos:
        print(f"No se encontraron JSONs en {INPUT_DIR.absolute()}")
        return

    print(f"Simplificando {len(archivos)} archivos a Markdown\n")

    for archivo in archivos:
        salida = OUTPUT_DIR / archivo.name.replace('.json', '.md')
        contenido_md = simplificar_a_md(archivo)

        with open(salida, 'w', encoding='utf-8') as f:
            f.write(contenido_md)

        n_lineas = contenido_md.count('\n')
        print(f"{archivo.name} -> {salida.name} ({n_lineas} líneas)")

    print(f"\nGuardado en {OUTPUT_DIR.absolute()}")


if __name__ == '__main__':
    main()