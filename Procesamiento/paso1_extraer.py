"""
Paso 1: Extracción de variables.
Procesa archivos MD para identificar variables estructuradas.
"""

import anthropic
import os
from pathlib import Path
import time

INPUT_DIR = Path('data/simplified')
OUTPUT_DIR = Path('data/extracted')
OUTPUT_DIR.mkdir(exist_ok=True, parents=True)

CONFIG_SISTEMA = """Eres un procesador de información estructurada de documentos gubernamentales.
Tu tarea es identificar variables extraíbles según esta taxonomía de 7 tipos semánticos:

1. variable_general: metadata identificadora del documento (números de informe, títulos, identificadores oficiales)
2. variable_temporal: fechas, períodos, plazos, rangos de tiempo
3. variable_actor: personas con nombre propio, cargos, instituciones involucradas
4. variable_geografica: ubicaciones, jurisdicciones, direcciones, departamentos, provincias
5. variable_booleana: cumplimientos sí/no, presencia/ausencia de condiciones, estados verificables
6. variable_numerica: montos de dinero, cantidades, porcentajes, medidas físicas
7. variable_narrativa: descripciones de situaciones, conclusiones, justificaciones, recomendaciones

INSTRUCCIONES:
- El documento tiene elementos numerados con [id]. Cada [id] es un fragmento del documento original.
- Analiza cada sección del documento.
- Para cada variable que identifiques, indica:
  a) El valor extraído
  b) Los [ids] donde aparece esa información
  c) El tipo semántico y por qué lo clasificas así
  d) Si hay ambigüedad o información incompleta, menciónalo
- No inventes información que no esté en el documento.
- Genera el reporte en texto estructurado organizado por secciones."""

TEXTO_ENTRADA = """Analiza el documento y extrae todas las variables identificables según la taxonomía.

DOCUMENTO:
{contenido}"""


def procesar_documento(client, md_path):
    contenido = md_path.read_text(encoding='utf-8')

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=8000,
        messages=[
            {
                "role": "user",
                "content": TEXTO_ENTRADA.format(contenido=contenido)
            }
        ],
        system=CONFIG_SISTEMA
    )

    return response.content[0].text


def main():
    client = anthropic.Anthropic()

    archivos = sorted(INPUT_DIR.glob('*.md'))

    if not archivos:
        print(f"No se encontraron MD en {INPUT_DIR.absolute()}")
        return

    print(f"Procesando {len(archivos)} documentos\n")

    for i, archivo in enumerate(archivos, 1):
        salida = OUTPUT_DIR / archivo.name.replace('.md', '.txt')

        if salida.exists():
            print(f"[{i}/{len(archivos)}] SKIP {archivo.name} (ya procesado)")
            continue

        print(f"[{i}/{len(archivos)}] {archivo.name} ...", end=' ', flush=True)
        inicio = time.time()

        try:
            resultado = procesar_documento(client, archivo)

            with open(salida, 'w', encoding='utf-8') as f:
                f.write(resultado)

            duracion = time.time() - inicio
            print(f"OK ({duracion:.0f}s)")

        except Exception as e:
            duracion = time.time() - inicio
            print(f"ERROR ({duracion:.0f}s): {e}")

    print(f"\nResultados en {OUTPUT_DIR.absolute()}")


if __name__ == '__main__':
    main()