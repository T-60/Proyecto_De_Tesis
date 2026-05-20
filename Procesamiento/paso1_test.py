"""
Prueba de extracción de un solo documento.
"""

import anthropic
from pathlib import Path
import sys

DOCUMENTO_TEST = 'Arequipa3.md'

INPUT_PATH = Path('data/simplified') / DOCUMENTO_TEST
OUTPUT_PATH = Path('data/extracted') / DOCUMENTO_TEST.replace('.md', '.txt')
OUTPUT_PATH.parent.mkdir(exist_ok=True, parents=True)

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


def main():
    if not INPUT_PATH.exists():
        print(f"No existe el archivo: {INPUT_PATH.absolute()}")
        print(f"\nArchivos disponibles en data/simplified/:")
        for f in sorted(Path('data/simplified').glob('*.md')):
            print(f"  - {f.name}")
        sys.exit(1)

    print(f"Procesando: {DOCUMENTO_TEST}")
    print(f"Tamaño: {INPUT_PATH.stat().st_size} bytes\n")

    contenido = INPUT_PATH.read_text(encoding='utf-8')
    client = anthropic.Anthropic()

    print("Iniciando procesamiento...")
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=16000,
        messages=[{"role": "user", "content": TEXTO_ENTRADA.format(contenido=contenido)}],
        system=CONFIG_SISTEMA
    )

    resultado = response.content[0].text

    # Estadísticas de procesamiento
    print(f"\nTokens entrada: {response.usage.input_tokens}")
    print(f"Tokens salida: {response.usage.output_tokens}")
    costo = (response.usage.input_tokens * 3 + response.usage.output_tokens * 15) / 1_000_000
    print(f"Costo aprox: ${costo:.4f}")

    OUTPUT_PATH.write_text(resultado, encoding='utf-8')
    print(f"\nGuardado en: {OUTPUT_PATH.absolute()}")
    print(f"\n{'='*60}")
    print("RESULTADO COMPLETO:")
    print('='*60)
    print(resultado)


if __name__ == '__main__':
    main()
