# HANDOFF — Estado del proyecto VIZ (tesis)

> Documento de traspaso para continuar en un chat nuevo. Resume **qué se hizo**,
> **dónde está cada cosa** y **qué sigue**. Fecha: 2026-06-07.

---

## 1. Qué es este proyecto (en una frase)

Pipeline que toma **informes de hito de control** (PDF, Contraloría / Elecciones
Generales 2026) y los convierte en datos estructurados, verificados y
consolidados por **caso**, para alimentar una **visualización** (Gantt de
trayectorias + Sankey de estados + vista de similitud por UMAP) que Gina quiere
probar.

**Modelo de caso** (ground truth declarado en `Procesamiento/config_casos.json`):
- Un **CASO** = una ODPE + un **tema/trayectoria** (proceso electoral supervisado).
- Hay **7 casos** agrupados manualmente sobre 17 documentos.
- El **orden** dentro de cada trayectoria NO se declara: se deriva por
  `periodo_inicio` (coincide con el número de hito ascendente).
- Escalar a clasificación automática del proceso por LLM = trabajo futuro (PFC3).

---

## 2. El pipeline (orden de ejecución)

Todos los scripts viven en `Procesamiento/`. Cada uno lee de una carpeta
`data/NN_*` y escribe en la siguiente.

| Paso | Script | Entrada → Salida | Qué hace |
|------|--------|------------------|----------|
| 00 | `00_run_ocr_batch.py` | `data/pdfs/` → `data/jsons/` | OCR batch de los PDFs |
| 01 | `01_simplificar_jsons.py` | `data/jsons/` → `data/00_simplified/` + `data/01_extracted/` | Simplifica/limpia el OCR |
| 02 | `02_paso1_completo.py` | `01_extracted/` → `data/02_structured/` + `data/03_pre_verified/` | Extracción estructurada (LLM) de variables |
| 03 | `03_paso2_verificacion.py` | `03_pre_verified/` → `data/04_verified/` | Verificación 3 niveles (código, ids, LLM) |
| 04 | `04_calculadas.py` | `04_verified/` → `data/05_calculated/` | Variables calculadas (ej. `pct_avance`) |
| 05 | `05_consolidar.py` | `05_calculated/` + `config_casos.json` → `data/06_consolidated/` | Consolida por caso, **emparejamiento de hilos** |
| 07 | `07_vector_y_umap.py` | `06_consolidated/` → `data/08_projection/` | Vector de características + **UMAP** |
| — | `reporte_metricas.py` | `04_verified/` → `data/metrics/` | Métricas globales del corpus |
| util | `util_reprocesar_tipoA.py` | — | Utilidad para reprocesar solo variables tipo A |

> Nota: no hay paso `06_*.py` (se renombró a `util_reprocesar_tipoA.py`).

---

## 3. Estado actual: TODO el procesamiento está COMPLETO ✅

- **Extracción verificada al 100%** (17/17 docs, 0 pendientes). 169 variables,
  tasa de verificación 100%. Costo estimado ~$8.5. Ver `data/metrics/`.
- **Distribución de tipos de variable** (`data/metrics/distribucion_tipos.csv`):
  - A — Seguimiento de situaciones adversas (20)
  - B — Progreso/presupuesto numérico (13)
  - C — Estado/condición categórico (35)
  - D — Actores y roles (41)
  - E — Narrativo, conclusiones/recomendaciones (21)
  - F — Verificación documental booleana (39)
- **Consolidación por caso lista** (`data/06_consolidated/`, 7 casos + `_index.json`).
  Cada caso trae: `eje_temporal`, `momentos` (con sus `variables`),
  `situaciones_adversas` (los **hilos** emparejados), `sankey`, `evolucion` (actores).
- **Vector + UMAP listos** (`data/08_projection/proyeccion_umap.json`) con
  **Sentence-BERT real** (`paraphrase-multilingual-MiniLM-L12-v2`).

### El vector de características (lo que define la vista de similitud)
Dos bloques concatenados, **balanceados por √(nº columnas)** para que ninguno
domine (decisión metodológica clave, defendible ante jurado — documentar en tesis):
- **Componente numérico** (4 dims, en `componente_numerico` del JSON de proyección):
  1. `prop_a` — proporción de situaciones adversas **cerradas** (estado canónico
     "Corregida" = cerrada; contado sobre estados normalizados, no sobre crudo)
  2. `prom_b` — promedio de `pct_avance` (escala 0..1)
  3. `prop_f` — proporción de criterios documentales cumplidos
  4. `actores` — nº de actores
- **Componente semántico**: embedding SBERT del texto narrativo (tipo E).

UMAP: `n_neighbors=min(5, n-1)`, `min_dist=0.3` (ajustable; ver §5).

---

## 4. Emparejamiento de hilos: qué funciona y su límite (honesto)

El emparejamiento conecta una misma situación adversa entre hitos. Usa **dos
señales**: el campo `desde_momento` (pista del modelo) + **similitud de texto**
(umbral 0.30). Resultado por caso (ver `06_consolidated/_index.json`):

| Caso | hilos | con continuidad |
|------|-------|-----------------|
| cerro_colorado__instalacion_personal | 11 | 7 |
| arequipa__computo | 3 | 3 |
| cerro_colorado__computo | 6 | 3 |
| arequipa__instalacion_personal | 7 | 2 |
| arequipa__capacitacion | 3 | 1 |
| cerro_colorado__capacitacion | 3 | 0 |
| cerro_colorado__despliegue | 2 | 0 |

**Límite conocido (documentar como limitación, no como bug):** cuando la
redacción de una situación cambia mucho entre hitos, o la referencia al hito
anterior es genérica ("respecto al hito anterior" sin decir cuál), el texto no
pasa el umbral y queda como hilo nuevo. El código **marca** ese caso en vez de
inventar conexión falsa → metodológicamente correcto. **No vale la pena
reprocesar otra vez por esto en PFC2.**

---

## 5. Decisiones técnicas pendientes (acordadas, sin implementar)

Tres dudas resueltas en conversación; falta decidir/implementar la #1:

1. **Definición de "cerrada"** (la más importante, conceptual). Hoy: solo
   "Corregida" cuenta como cerrada; "Con acciones" NO cuenta. Recomendación:
   mantener estricto (cerrada = resuelta del todo) PERO **añadir una métrica
   aparte de "en progreso"** para las "Con acciones" → distinguir 3 estados
   (resueltas / en progreso / abiertas) en vez del binario actual. Enriquece el
   Sankey y el vector. **← DECISIÓN PENDIENTE DE ITALO: ¿3 estados o binario?**
2. **Balance por √dimensiones** → ✅ correcto, ya implementado. Solo documentarlo.
3. **UMAP amontonado con 7 casos** → cosmético. Bajar `n_neighbors` a 3-4 y subir
   `min_dist` a 0.5 mejora legibilidad, pero con 7 puntos no hay milagros. No
   gastar horas. La estructura mejora con el corpus ampliado del sur.

---

## 6. Lo que SIGUE (próximo paso real)

**El procesamiento está cerrado. Lo que falta es la VISUALIZACIÓN.**

Próximo paso concreto: **preparar/definir la estructura de datos que necesita el
Gantt** para dibujar las trayectorias y que el detalle cambie por tipo de
situación. Eso es lo que desbloquea a Gina para probar. Los datos ya existen en
`06_consolidated/` (`situaciones_adversas`, `sankey`, `evolucion`); falta el
puente a la vista.

Antes (o en paralelo), decidir el punto §5.1 (3 estados vs binario), porque
afecta al Sankey y al vector.

### Pendientes de Gina (NO olvidar — blindan la tesis)
- Procesar **más documentos del sur** para robustecer UMAP.
- **Accuracy contra ground truth** sobre los 17 anotados a mano (estilo Ribbons).
- **Segundo caso de estudio** en PFC3.
- **Prueba de usuarios**: Gina la pensaba con datos sintéticos; se le advirtió que
  eso le quita validez y que mejor sobre datos reales. **Quedó sin respuesta por
  qué pensaba en sintéticos** → cerrar esto con ella (es la métrica que más
  blinda el trabajo ante Erick y Edward).

---

## 7. Notas de navegación del repo

- Grafo de conocimiento en `graphify-out/`. Para preguntas de código:
  `graphify query "<pregunta>"` (subgrafo acotado). Tras tocar código:
  `graphify update .`.
- `Procesamiento/Revisa.txt` = bitácora de conversación/notas (no es código).
- `Procesamiento/TESISISIS/` = LaTeX de la tesis + papers de referencia.
- Pipeline de tesis corre con **Sonnet 4.6**; Claude Code usa **Opus 4.8**.
