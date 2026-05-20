import opendataloader_pdf
from pathlib import Path

pdf = list(Path('data/pdfs').glob('*.pdf'))[0]
print(f"Procesando: {pdf.name}")

opendataloader_pdf.convert(
    input_path=[str(pdf)],
    output_dir='data/jsons',
    format='json',
    hybrid='docling-fast',
    hybrid_mode='full'
)

print("Listo")