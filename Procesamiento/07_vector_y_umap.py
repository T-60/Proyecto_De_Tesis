"""
07_vector_y_umap.py - Construye el vector de caracteristicas de cada caso y lo
proyecta a 2D con UMAP para la vista de similitud.

Vector por caso (segun tesis):
  Componente numerico (4 dimensiones):
    1. proporcion de situaciones de seguimiento (tipo A) cerradas/corregidas
    2. promedio de pct_avance de las variables de progreso (tipo B)
    3. proporcion de criterios de verificacion (tipo F) cumplidos
    4. numero total de actores (tipo D)
  Componente semantico:
    embedding de las conclusiones (tipo E) con Sentence Transformers.

  Se normalizan (z-score) ambos componentes y se concatenan.
  El vector combinado se proyecta a 2D con UMAP.

Entrada: data/06_consolidated/*.json
Salida:  data/08_projection/proyeccion_umap.json  (coordenadas 2D por caso)

Uso:
  python 07_vector_y_umap.py
"""

import json
import numpy as np
from pathlib import Path

INPUT_DIR = Path("data/06_consolidated")
OUTPUT_DIR = Path("data/08_projection")
OUTPUT_DIR.mkdir(exist_ok=True, parents=True)

# Estado CANONICO que cuenta como hallazgo cerrado/resuelto.
# (Se compara contra el estado ya normalizado en 'situaciones_adversas', no
#  contra el detalle crudo, que trae textos como "no subsanado" que con un
#  match por substring darian falsos positivos.)
ESTADOS_CERRADOS = {"corregida"}


def componente_numerico(data):
    """Las 4 metricas numericas del caso.

    Tipo A (cerradas): proporcion de apariciones en estado CANONICO cerrado,
      contadas sobre 'situaciones_adversas' (estados ya normalizados), no sobre
      el detalle crudo. 'Corregida' = cerrada.
    Tipo B (avance): pct_avance es SIEMPRE un porcentaje 0-100 (la formula hace
      *100). Por eso se divide /100 para llevarlo a 0..1. Valores como 0.8 son
      avances reales bajos (0.8%), no un error de escala.
    Tipo F: proporcion de criterios cumplidos. Tipo D: numero de actores.
    """
    # --- Tipo A: cerradas sobre estados canonicos ---
    apariciones = [a for h in data.get("situaciones_adversas", [])
                   for a in h.get("apariciones", [])]
    total_a = len(apariciones)
    cerrados_a = sum(1 for a in apariciones
                     if (a.get("estado") or "").strip().lower() in ESTADOS_CERRADOS)

    # --- Tipos B, D, F desde las variables de cada momento ---
    avances = []
    total_f = ok_f = 0
    actores = 0
    for mom in data.get("momentos", []):
        for v in mom.get("variables", []):
            t = v.get("tipo")
            if t == "B":
                val = ((v.get("calculado") or {}).get("pct_avance") or {}).get("valor")
                if val is not None:
                    avances.append(val)
            elif t == "F":
                for it in (v.get("detalle") or []):
                    total_f += 1
                    if it.get("cumple") is True:
                        ok_f += 1
            elif t == "D":
                actores += len(v.get("detalle") or [])

    prop_a = cerrados_a / total_a if total_a else 0.0
    prom_b = (sum(avances) / len(avances) / 100) if avances else 0.0  # pct 0-100 -> 0..1
    prop_f = ok_f / total_f if total_f else 0.0
    return [prop_a, prom_b, prop_f, actores]


def texto_conclusiones(data):
    """Concatena los cuerpos narrativos (tipo E) del caso."""
    partes = []
    for mom in data.get("momentos", []):
        for v in mom.get("variables", []):
            if v.get("tipo") == "E":
                cuerpo = (v.get("valor") or {}).get("cuerpo", "")
                if cuerpo:
                    partes.append(cuerpo)
    return " ".join(partes)


def main():
    # Excluir archivos auxiliares (p.ej. _index.json) que NO son casos.
    archivos = sorted(p for p in INPUT_DIR.glob("*.json") if not p.name.startswith("_"))
    casos, num, textos = [], [], []
    for p in archivos:
        d = json.load(open(p, encoding="utf-8"))
        casos.append(d.get("caso_id", p.stem))
        num.append(componente_numerico(d))
        textos.append(texto_conclusiones(d))

    print(f"Casos: {len(casos)}")

    # --- Embedding semantico ---
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
    emb = np.array(model.encode(textos))

    # --- Normalizar (z-score) y concatenar ---
    from sklearn.preprocessing import StandardScaler
    Xnum = StandardScaler().fit_transform(np.array(num, dtype=float))
    Xemb = StandardScaler().fit_transform(emb)
    # Balance de bloques: tras el z-score cada columna tiene varianza 1, asi que
    # un bloque de k columnas aporta varianza total k. Sin esto, el embedding
    # (~384 dims) ahogaria las 4 metricas numericas (~96x mas peso). Dividir cada
    # bloque por sqrt(k) iguala su varianza total a ~1 -> ninguno domina (tesis).
    Xnum = Xnum / np.sqrt(Xnum.shape[1])
    Xemb = Xemb / np.sqrt(Xemb.shape[1])
    vector = np.hstack([Xnum, Xemb])
    print(f"Vector combinado: {vector.shape}  (numerico {Xnum.shape[1]} + semantico {Xemb.shape[1]})")

    # --- UMAP a 2D ---
    import umap
    # n_neighbors pequeno por pocos casos; min_dist moderado
    reducer = umap.UMAP(n_neighbors=min(5, len(casos)-1), min_dist=0.3,
                        n_components=2, random_state=42, metric="cosine")
    coords = reducer.fit_transform(vector)

    salida = {
        "casos": [
            {"caso_id": casos[i],
             "x": float(coords[i][0]), "y": float(coords[i][1]),
             "componente_numerico": num[i]}
            for i in range(len(casos))
        ]
    }
    out = OUTPUT_DIR / "proyeccion_umap.json"
    json.dump(salida, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"Guardado en {out}")
    for c in salida["casos"]:
        print(f"  ({c['x']:+.2f}, {c['y']:+.2f})  {c['caso_id']}")


if __name__ == "__main__":
    main()
