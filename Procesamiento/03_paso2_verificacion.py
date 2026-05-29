"""
Paso 2 - Verificacion por codigo (SIN nivel 3 / sin LLM).

Etiqueta cada variable comparando su fragmento de evidencia contra el
documento original. Llega hasta marcar el estado de cada variable y guarda
los JSON pre-verificados en data/03_pre_verified/.

Estados posibles:
  verificado                 -> fragmento hallado en los IDs senalados (N1)
  id_corregido               -> hallado en otros IDs del documento (N2)
  requiere_verificacion_llm  -> no hallado por codigo (pendiente de N3)
  omitido_sin_evidencia      -> la variable no tiene fragmento o ids

El nivel 3 (reconsulta al modelo) NO esta implementado aqui a proposito.
Se ejecutara como un paso posterior y separado.

Uso:
  python 03_paso2_verificacion.py <nombre_archivo_sin_extension>
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

# Proporcion de pedazos del fragmento que deben encontrarse para dar por
# verificada una variable. 0.7 = 70%. No bajar de 0.6.
UMBRAL_PEDAZOS = 0.7

# Proporcion de palabras significativas (5+ letras) que deben existir en
# los IDs para verificar texto reordenado (ej: tablas con columnas separadas
# por OCR). 0.9 = 90%. No bajar de 0.85.
UMBRAL_PALABRAS = 0.9

INPUT_JSON_DIR = Path("data/02_structured")
INPUT_MD_DIR = Path("data/00_simplified")
OUTPUT_DIR = Path("data/03_pre_verified")

OUTPUT_DIR.mkdir(exist_ok=True, parents=True)


def normalizar_texto(texto):
    """Minusculas, sin tildes, sin puntuacion ni espacios. Tolera ruido de OCR."""
    if not texto:
        return ""
    texto = texto.lower()
    texto = ''.join(c for c in unicodedata.normalize('NFD', texto)
                    if unicodedata.category(c) != 'Mn')
    texto = re.sub(r'[\W_]+', '', texto)
    return texto


def partir_fragmento(fragmento):
    """
    Parte el fragmento por los separadores que el modelo usa para unir o
    resumir texto: [...] ... guiones largos, barras, saltos de linea.
    Limpia corchetes sueltos. Devuelve los pedazos de largo razonable.
    """
    pedazos = re.split(r'\[\.\.\.\]|\.\.\.|\u2026|[\u2014\u2013/|]|\n', fragmento)
    limpios = []
    for p in pedazos:
        p = p.replace(']', '').replace('[', '').strip()
        if len(p) >= 6:
            limpios.append(p)
    return limpios


def construir_texto_por_id(contenido_md):
    """Devuelve {id: texto} y el texto global del documento."""
    texto_por_id = {}
    texto_global = []
    for linea in contenido_md.split('\n'):
        match = re.match(r'^\[(\d+)\]\s*(.*)', linea)
        if match:
            id_num = int(match.group(1))
            contenido = match.group(2).strip()
            texto_por_id[id_num] = contenido
            texto_global.append("[%d] %s" % (id_num, contenido))
    return texto_por_id, " ".join(texto_global)


def proporcion_presente(pedazos_norm, texto_norm):
    if not pedazos_norm:
        return 0.0
    presentes = sum(1 for p in pedazos_norm if p in texto_norm)
    return presentes / len(pedazos_norm)


def buscar_ids_de_pedazos(pedazos_norm, texto_por_id):
    """Devuelve los ids donde aparece algun pedazo del fragmento."""
    ids_encontrados = []
    for id_num, texto in texto_por_id.items():
        tn = normalizar_texto(texto)
        for p in pedazos_norm:
            if p in tn:
                ids_encontrados.append(id_num)
                break
    return sorted(set(ids_encontrados))


def procesar_archivo(nombre_archivo):
    json_path = INPUT_JSON_DIR / ("%s.json" % nombre_archivo)
    md_path = INPUT_MD_DIR / ("%s.md" % nombre_archivo)
    out_path = OUTPUT_DIR / ("%s.json" % nombre_archivo)

    if not json_path.exists() or not md_path.exists():
        print("Archivos no encontrados para %s" % nombre_archivo)
        return

    print("=== Verificando %s ===" % nombre_archivo)

    data = json.load(open(json_path, encoding='utf-8'))
    contenido_md = md_path.read_text(encoding='utf-8')
    texto_por_id, texto_global = construir_texto_por_id(contenido_md)
    texto_global_norm = normalizar_texto(texto_global)

    variables = data.get("momento", {}).get("variables", [])
    c_verif = c_idcorr = c_pendiente = c_omit = 0

    for var in variables:
        fragmento = var.get("fragmento_evidencia")
        ids_senalados = var.get("fuente_ids", [])

        if not fragmento or not ids_senalados:
            var["estado_verificacion"] = "omitido_sin_evidencia"
            c_omit += 1
            continue

        frag_norm = normalizar_texto(fragmento)
        texto_senalado_norm = normalizar_texto(
            " ".join([texto_por_id.get(i, "") for i in ids_senalados]))

        # NIVEL 1a: fragmento completo en los ids senalados
        if frag_norm in texto_senalado_norm:
            var["estado_verificacion"] = "verificado"
            c_verif += 1
            print("  [OK N1] '%s' completo en sus IDs." % var['id'])
            continue

        # Partir en pedazos (maneja [...], ..., guiones, barras)
        pedazos = partir_fragmento(fragmento)
        pedazos_norm = [normalizar_texto(p) for p in pedazos if normalizar_texto(p)]

        # NIVEL 1b: la mayoria de pedazos en los ids senalados
        if pedazos_norm and proporcion_presente(pedazos_norm, texto_senalado_norm) >= UMBRAL_PEDAZOS:
            var["estado_verificacion"] = "verificado"
            c_verif += 1
            print("  [OK N1 pedazos] '%s' verificado en sus IDs." % var['id'])
            continue

        # NIVEL 1c: palabras significativas (para texto reordenado, ej: tablas)
        # Extrae palabras de 5+ letras del fragmento y verifica que >=90%
        # existan en el texto de los IDs (sin importar el orden).
        palabras_frag = re.findall(r'[a-zA-Z\u00e0-\u00ff]{5,}', fragmento.lower())
        if len(palabras_frag) >= 3:
            palabras_en_ids = sum(1 for p in palabras_frag
                                 if normalizar_texto(p) in texto_senalado_norm)
            ratio = palabras_en_ids / len(palabras_frag)
            if ratio >= UMBRAL_PALABRAS:
                var["estado_verificacion"] = "verificado"
                c_verif += 1
                print("  [OK N1 palabras] '%s' verificado por palabras (%d/%d=%.0f%%)."
                      % (var['id'], palabras_en_ids, len(palabras_frag), ratio * 100))
                continue

        # NIVEL 2: la mayoria de pedazos en todo el documento
        if pedazos_norm and proporcion_presente(pedazos_norm, texto_global_norm) >= UMBRAL_PEDAZOS:
            ids_encontrados = buscar_ids_de_pedazos(pedazos_norm, texto_por_id)
            var["estado_verificacion"] = "id_corregido"
            var["fuente_ids_original"] = ids_senalados
            if ids_encontrados:
                var["fuente_ids"] = ids_encontrados
            c_idcorr += 1
            print("  [WARN N2] '%s' encontrado en otros IDs." % var['id'])
            continue

        # NIVEL 3 (reconsulta al modelo): NO implementado todavia.
        var["estado_verificacion"] = "requiere_verificacion_llm"
        c_pendiente += 1
        print("  [ALERTA] '%s' marcada para verificacion LLM posterior." % var['id'])

    data["momento"]["resumen_verificacion"] = {
        "verificado": c_verif,
        "id_corregido": c_idcorr,
        "requiere_verificacion_llm": c_pendiente,
        "omitido_sin_evidencia": c_omit,
    }

    json.dump(data, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    print("\nArchivo guardado en %s" % out_path)
    print("\n" + "=" * 50)
    print(" RESUMEN DE METRICAS: %s" % nombre_archivo)
    print("=" * 50)
    print(" Total de variables procesadas : %d" % len(variables))
    print(" [OK] Verificadas (Nivel 1)    : %d" % c_verif)
    print(" [OK] IDs Corregidos (Nivel 2) : %d" % c_idcorr)
    print(" [!]  Requieren LLM (Nivel 3)  : %d" % c_pendiente)
    if c_omit:
        print(" [-]  Omitidas (sin evidencia) : %d" % c_omit)
    print("=" * 50 + "\n")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python 03_paso2_verificacion.py <nombre_archivo_sin_extension>")
        sys.exit(1)
    procesar_archivo(sys.argv[1])