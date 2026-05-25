"""
Script para procesar todos los PDFs de data/pdfs/ en batch.
"""

import opendataloader_pdf
from pathlib import Path
import time
import sys

INPUT_DIR = Path('data/pdfs')
OUTPUT_DIR = Path('data/jsons')
OUTPUT_DIR.mkdir(exist_ok=True, parents=True)


def procesar_pdf(pdf_path, indice, total):
    nombre = pdf_path.name
    salida = OUTPUT_DIR / f"{pdf_path.stem}.json"

    # Omitir archivo si ya existe
    if salida.exists():
        print(f"[{indice}/{total}] SKIP {nombre} (ya procesado)")
        return 'skip', 0

    inicio = time.time()
    print(f"[{indice}/{total}] {nombre} ...", flush=True)

    try:
        opendataloader_pdf.convert(
            input_path=[str(pdf_path)],
            output_dir=str(OUTPUT_DIR),
            format='json',
            hybrid='docling-fast',
            hybrid_mode='full'
        )
        duracion = time.time() - inicio
        print(f"           OK ({duracion:.0f}s)")
        return 'ok', duracion
    except Exception as e:
        duracion = time.time() - inicio
        print(f"           ERROR ({duracion:.0f}s): {e}")
        return 'error', duracion


def main():
    pdfs = sorted(INPUT_DIR.glob('*.pdf'))
    total = len(pdfs)

    if total == 0:
        print(f"No se encontraron PDFs en {INPUT_DIR.absolute()}")
        sys.exit(1)

    print(f"Procesando {total} PDFs desde {INPUT_DIR.absolute()}")
    print(f"Salida en {OUTPUT_DIR.absolute()}\n")

    inicio_total = time.time()
    resultados = {'ok': 0, 'error': 0, 'skip': 0}
    duraciones = []

    for i, pdf in enumerate(pdfs, 1):
        estado, duracion = procesar_pdf(pdf, i, total)
        resultados[estado] += 1
        if estado == 'ok':
            duraciones.append(duracion)

    duracion_total = time.time() - inicio_total

    print(f"\n{'='*50}")
    print(f"Completado en {duracion_total/60:.1f} minutos")
    print(f"Exitosos: {resultados['ok']}")
    print(f"Saltados (ya existían): {resultados['skip']}")
    print(f"Errores: {resultados['error']}")
    if duraciones:
        promedio = sum(duraciones) / len(duraciones)
        print(f"Tiempo promedio por PDF: {promedio:.0f}s")


if __name__ == '__main__':
    main()