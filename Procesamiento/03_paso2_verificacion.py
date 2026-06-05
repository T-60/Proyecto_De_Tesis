"""
Paso 3 - Verificacion de fragmentos de evidencia (Niveles 1, 2 y 3).

Compara el fragmento_evidencia de cada variable contra el documento original
simplificado. Aplica tres niveles en orden:

  N1 - Verificacion por codigo
       El fragmento se encuentra literalmente en los IDs indicados.
       Estado resultado: verificado

  N2 - Correccion de IDs por codigo
       El fragmento se encuentra en el documento pero en IDs distintos.
       Estado resultado: id_corregido

  N3 - Verificacion por LLM (Claude Sonnet)
       Para variables que no pasaron N1 ni N2, el LLM busca el fragmento
       real en el documento y lo corrige.
       Estado resultado: verificado_n3  /  alucinacion_n3

Al terminar cada archivo:
  - Guarda el JSON con estados en data/03_pre_verified/
  - Si el archivo queda al 100% verificado, lo copia a data/04_verified/
    (carpeta limpia de entrada para el siguiente paso del pipeline)

Requisitos para N3:
  - pip install anthropic
  - Variable de entorno ANTHROPIC_API_KEY configurada

Si anthropic no esta instalado o falta la API key, las variables que no
pasen N1/N2 quedan marcadas como 'requiere_verificacion_llm' y el archivo
NO se copia a 04_verified.

Uso:
  python 03_paso2_verificacion.py                  # procesa todos los archivos
  python 03_paso2_verificacion.py Arequipa2        # procesa solo uno
"""

import json
import re
import shutil
import sys
import unicodedata
from pathlib import Path

# --- Parametros de verificacion por codigo ---
UMBRAL_PEDAZOS  = 0.7   # proporcion de pedazos del fragmento que deben hallarse
UMBRAL_PALABRAS = 0.9   # proporcion de palabras de 5+ letras que deben hallarse

# --- Directorios ---
INPUT_JSON_DIR  = Path("data/02_structured")
INPUT_MD_DIR    = Path("data/00_simplified")
PRE_VERIFIED_DIR = Path("data/03_pre_verified")
VERIFIED_DIR    = Path("data/04_verified")
PROMPT_PATH     = Path("prompts/prompt_2_verificacion.txt")

# --- Modelo LLM para N3 ---
MODEL_N3 = "claude-sonnet-4-6"

PRE_VERIFIED_DIR.mkdir(exist_ok=True, parents=True)
VERIFIED_DIR.mkdir(exist_ok=True, parents=True)


# ============================================================
# UTILIDADES DE TEXTO
# ============================================================

def normalizar(texto):
    """Minusculas, sin tildes, sin puntuacion ni espacios.

    El separador decimal entre digitos se conserva como 'punto' para que
    '2.5' no colapse a '25' y se confunda con una cifra distinta.
    """
    if not texto:
        return ""
    texto = texto.lower()
    texto = ''.join(c for c in unicodedata.normalize('NFD', texto)
                    if unicodedata.category(c) != 'Mn')
    texto = re.sub(r'(?<=\d)[.,](?=\d)', 'punto', texto)
    texto = re.sub(r'[\W_]+', '', texto)
    return texto


def partir_fragmento(fragmento):
    """Divide el fragmento por separadores que el LLM usa para resumir o unir."""
    pedazos = re.split(r'\[\.\.\.\]|\.\.\.|…|[—–/|]|\n', fragmento)
    return [p.replace(']', '').replace('[', '').strip()
            for p in pedazos if len(p.strip()) >= 6]


def construir_indice_por_id(contenido_md):
    """Devuelve {id: texto} y el texto global del documento."""
    indice = {}
    global_parts = []
    for linea in contenido_md.split('\n'):
        m = re.match(r'^\[(\d+)\]\s*(.*)', linea)
        if m:
            id_num = int(m.group(1))
            contenido = m.group(2).strip()
            indice[id_num] = contenido
            global_parts.append("[%d] %s" % (id_num, contenido))
    return indice, " ".join(global_parts)


def proporcion_presente(pedazos_norm, texto_norm):
    if not pedazos_norm:
        return 0.0
    return sum(1 for p in pedazos_norm if p in texto_norm) / len(pedazos_norm)


def ids_con_pedazos(pedazos_norm, indice):
    """Devuelve los IDs donde aparece al menos un pedazo del fragmento."""
    encontrados = []
    for id_num, texto in indice.items():
        tn = normalizar(texto)
        if any(p in tn for p in pedazos_norm):
            encontrados.append(id_num)
    return sorted(set(encontrados))


# ============================================================
# NIVEL 3 — LLM
# ============================================================

def _cliente_llm():
    """Devuelve un cliente Anthropic o None si no esta disponible."""
    try:
        import anthropic
        import os
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            print("  [AVISO] ANTHROPIC_API_KEY no esta configurada. Las variables "
                  "pendientes quedaran sin verificar hasta que se configure la clave.")
            return None
        return anthropic.Anthropic(api_key=api_key)
    except ImportError:
        print("  [AVISO] El paquete 'anthropic' no esta instalado. "
              "Instala con: pip install anthropic")
        return None


def verificar_con_llm(cliente, sistema_prompt, doc_texto, variable):
    """Llama al LLM para encontrar el fragmento real. Devuelve (resultado_dict, uso)."""
    mensaje = (
        "TEXTO COMPLETO DEL DOCUMENTO:\n%s\n\n"
        "---\n"
        "VARIABLE A CORREGIR:\n"
        "id: %s\n"
        "tipo: %s\n"
        "fragmento_evidencia (incorrecto): %s\n"
        "fuente_ids originales: %s\n"
    ) % (
        doc_texto,
        variable["id"],
        variable["tipo"],
        variable["fragmento_evidencia"],
        variable["fuente_ids"],
    )

    respuesta = cliente.messages.create(
        model=MODEL_N3,
        max_tokens=512,
        system=sistema_prompt,
        messages=[{"role": "user", "content": mensaje}],
    )

    texto = respuesta.content[0].text.strip()
    # Limpiar posibles bloques de codigo markdown
    m = re.search(r'```(?:json)?\s*(.*?)```', texto, re.DOTALL)
    if m:
        texto = m.group(1).strip()

    return json.loads(texto), respuesta.usage


# ============================================================
# VERIFICACION DE UN ARCHIVO
# ============================================================

def ids_ventana_fallback(fids, idx, radio=2):
    """IDs vecinos (±radio) alrededor de cada ID declarado, excluye los propios fids."""
    base = set(fids)
    extra = set()
    for fid in fids:
        for d in range(-radio, radio+1):
            if d != 0:
                extra.add(fid + d)
    return [i for i in sorted(extra - base) if i in idx]


def procesar_archivo(nombre_archivo):
    json_path = INPUT_JSON_DIR   / ("%s.json" % nombre_archivo)
    md_path   = INPUT_MD_DIR     / ("%s.md"   % nombre_archivo)
    out_path  = PRE_VERIFIED_DIR / ("%s.json" % nombre_archivo)

    if not json_path.exists() or not md_path.exists():
        print("Archivos no encontrados para '%s'" % nombre_archivo)
        return

    print("\n" + "=" * 60)
    print("  Verificando: %s" % nombre_archivo)
    print("=" * 60)

    data          = json.load(open(json_path, encoding='utf-8'))
    contenido_md  = md_path.read_text(encoding='utf-8')
    indice, texto_global = construir_indice_por_id(contenido_md)
    texto_global_norm    = normalizar(texto_global)

    variables = data.get("momento", {}).get("variables", [])
    n1 = n2 = n3 = pendiente = omit = 0
    tokens_in = tokens_out = 0

    for var in variables:
        fragmento    = var.get("fragmento_evidencia")
        ids_senalados = var.get("fuente_ids", [])

        # Sin datos: omitir
        if not fragmento or not ids_senalados:
            var["estado_verificacion"] = "omitido_sin_evidencia"
            omit += 1
            continue

        frag_norm = normalizar(fragmento)
        texto_ids_norm = normalizar(" ".join([indice.get(i, "") for i in ids_senalados]))

        # --- N1a: fragmento completo en los IDs indicados ---
        if frag_norm in texto_ids_norm:
            var["estado_verificacion"] = "verificado"
            n1 += 1
            print("  [N1] %-40s fragmento exacto en IDs indicados." % var['id'])
            continue

        pedazos      = partir_fragmento(fragmento)
        pedazos_norm = [normalizar(p) for p in pedazos if normalizar(p)]

        # --- N1b: mayoria de pedazos en los IDs indicados ---
        if pedazos_norm and proporcion_presente(pedazos_norm, texto_ids_norm) >= UMBRAL_PEDAZOS:
            var["estado_verificacion"] = "verificado"
            n1 += 1
            print("  [N1] %-40s pedazos verificados en IDs indicados." % var['id'])
            continue

        # --- N1c: palabras significativas en los IDs indicados (texto reordenado) ---
        palabras = re.findall(r'[a-zA-Zà-ÿ]{5,}', fragmento.lower())
        if len(palabras) >= 3:
            presentes = sum(1 for p in palabras if normalizar(p) in texto_ids_norm)
            if presentes / len(palabras) >= UMBRAL_PALABRAS:
                var["estado_verificacion"] = "verificado"
                n1 += 1
                print("  [N1] %-40s palabras clave verificadas en IDs indicados." % var['id'])
                continue

        # --- N2: fragmento hallado en otros IDs del documento ---
        if pedazos_norm and proporcion_presente(pedazos_norm, texto_global_norm) >= UMBRAL_PEDAZOS:
            ids_corregidos = ids_con_pedazos(pedazos_norm, indice)
            var["estado_verificacion"] = "id_corregido"
            var["fuente_ids_original"] = ids_senalados
            if ids_corregidos:
                var["fuente_ids"] = ids_corregidos
            n2 += 1
            print("  [N2] %-40s fragmento hallado en IDs distintos." % var['id'])
            continue

        # --- N1-ventana: IDs vecinos (±2) como fallback antes de N3 ---
        # Endurecido: al ampliar el texto de busqueda (mas IDs) es mas facil
        # que un fragmento "pase", asi que aqui solo se aceptan los chequeos
        # estrictos: fragmento completo, o el 100% de los pedazos presentes.
        # Se elimina el match por palabras sueltas (sin orden ni adyacencia),
        # que sobre texto ampliado puede ensamblar un fragmento alucinado a
        # partir de IDs dispersos.
        extra_ids = ids_ventana_fallback(ids_senalados, indice)
        if extra_ids:
            ids_amp = sorted(set(ids_senalados) | set(extra_ids))
            texto_amp_norm = normalizar(" ".join(indice.get(i, "") for i in ids_amp))

            if frag_norm in texto_amp_norm:
                var["estado_verificacion"] = "verificado"
                n1 += 1
                print("  [N1v] %-38s fragmento completo en ventana ±2 IDs." % var['id'])
                continue

            if pedazos_norm and proporcion_presente(pedazos_norm, texto_amp_norm) >= 1.0:
                var["estado_verificacion"] = "verificado"
                n1 += 1
                print("  [N1v] %-38s todos los pedazos en ventana ±2 IDs." % var['id'])
                continue

        # Marcar como pendiente para N3
        var["estado_verificacion"] = "requiere_verificacion_llm"
        pendiente += 1
        print("  [N3?] %-39s sin verificar por codigo, pasa a LLM." % var['id'])

    # --- N3: verificacion por LLM para los que quedan pendientes ---
    pendientes_vars = [v for v in variables
                       if v.get("estado_verificacion") == "requiere_verificacion_llm"]

    if pendientes_vars:
        sistema_prompt = PROMPT_PATH.read_text(encoding='utf-8')
        cliente = _cliente_llm()

        if cliente:
            doc_texto = md_path.read_text(encoding='utf-8')
            for var in pendientes_vars:
                print("  [N3] %-40s llamando al LLM ..." % var['id'])
                try:
                    resultado, uso = verificar_con_llm(cliente, sistema_prompt, doc_texto, var)
                    tokens_in  += uso.input_tokens
                    tokens_out += uso.output_tokens

                    if resultado.get("encontrado"):
                        var["fragmento_evidencia_original"] = var["fragmento_evidencia"]
                        var["fuente_ids_original"]          = var["fuente_ids"]
                        var["fragmento_evidencia"]          = resultado["fragmento_corregido"]
                        var["fuente_ids"]                   = resultado.get("ids_corregidos", var["fuente_ids"])
                        var["estado_verificacion"]          = "verificado_n3"
                        n3       += 1
                        pendiente -= 1
                        print("        Corregido: %s" % repr(resultado["fragmento_corregido"][:70]))
                    else:
                        var["estado_verificacion"] = "alucinacion_n3"
                        pendiente -= 1
                        print("        LLM confirma: fragmento inventado.")
                except Exception as e:
                    print("        ERROR en llamada LLM: %s" % e)

    # Resumen de verificacion en el JSON
    data["momento"]["resumen_verificacion"] = {
        "verificado_n1_codigo":    n1,
        "corregido_n2_ids":        n2,
        "verificado_n3_llm":       n3,
        "pendientes_sin_verificar": pendiente,
        "omitido_sin_evidencia":   omit,
    }

    # Guardar en 03_pre_verified/
    json.dump(data, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    # Resumen en consola
    total = len(variables)
    verificadas = n1 + n2 + n3
    pct = verificadas / total * 100 if total else 0
    print()
    print("  Resultado: %d/%d variables verificadas (%.0f%%)" % (verificadas, total, pct))
    print("    N1 codigo    : %d" % n1)
    print("    N2 IDs       : %d" % n2)
    print("    N3 LLM       : %d" % n3)
    if pendiente:
        print("    Sin verificar: %d  <-- requiere revision manual" % pendiente)
    if omit:
        print("    Omitidas     : %d" % omit)
    if tokens_in:
        costo = (tokens_in * 3 + tokens_out * 15) / 1_000_000
        print("    Tokens LLM   : %d entrada / %d salida (~$%.4f)" % (tokens_in, tokens_out, costo))
    print("  Guardado en: %s" % out_path)

    # Copiar a 04_verified/ solo si TODAS las variables quedaron en un estado
    # valido. Se basa en los estados reales (no en contadores) para que una
    # 'alucinacion_n3' nunca pase: aunque reduzca 'pendiente', la variable no
    # esta verificada y el archivo no debe avanzar al siguiente paso.
    ESTADOS_OK = {"verificado", "id_corregido", "verificado_n3"}
    no_validas = [v.get("id") for v in variables
                  if v.get("estado_verificacion") not in ESTADOS_OK]
    if not no_validas:
        dest = VERIFIED_DIR / ("%s.json" % nombre_archivo)
        shutil.copy2(out_path, dest)
        print("  Copiado a  : %s  [listo para siguiente paso]" % dest)
    else:
        print("  [!] No copiado a 04_verified/ — %d variable(s) sin estado valido: %s"
              % (len(no_validas), no_validas))


# ============================================================
# MAIN
# ============================================================

def main():
    if len(sys.argv) >= 2:
        archivos = sys.argv[1:]
    else:
        # Procesar todos los que tienen JSON en 02_structured
        archivos = sorted(p.stem for p in INPUT_JSON_DIR.glob("*.json"))

    if not archivos:
        print("No se encontraron archivos en %s" % INPUT_JSON_DIR)
        sys.exit(1)

    print("Archivos a verificar: %s" % archivos)
    for nombre in archivos:
        procesar_archivo(nombre)

    print("\nVerificacion completada.")
    print("  Resultados detallados : %s/" % PRE_VERIFIED_DIR)
    print("  Listos para siguiente paso : %s/" % VERIFIED_DIR)


if __name__ == "__main__":
    main()
