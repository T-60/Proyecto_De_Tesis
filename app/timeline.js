
let _proceso       = null;
let _hitoActivo    = null;
let _cajasAbiertas = new Set();

function initTimeline(proceso) {
  _proceso          = proceso;
  _hitoActivo       = null;
  _cajasAbiertas    = new Set();
  _gruposColapsados = {};
}

function renderTimeline(contenedor, seleccionados, varId, rango, agrupar, ordenY, nivelA, agruparB, ordenB, agruparC, ordenC, nivelD) {
  if (!_proceso || seleccionados.length === 0) {
    contenedor.innerHTML = `<div class="hint">Selecciona nodos en el mapa para visualizar</div>`;
    return;
  }

  const campoAgrupar = (!agrupar || agrupar === "__ninguno__") ? null : agrupar;
  const ordenados    = campoAgrupar
    ? [...seleccionados]
    : _ordenarNodos([...seleccionados], ordenY || "alfabetico");

  if (varId === "__momentos__") {
    _renderGantt(contenedor, ordenados, rango, campoAgrupar, ordenY);
  } else {
    _renderTimelineVariables(contenedor, seleccionados, varId, rango, nivelA, agruparB, ordenB, agruparC, ordenC, nivelD);
  }
}

let _gruposColapsados = {};

function _renderGantt(contenedor, seleccionados, rango, campoAgrupar, ordenY) {
  const { dMin, dMax } = _rangoFechas(_proceso.nodos);
  const dFiltMin = new Date(dMin.getTime() + (rango[0] / 100) * (dMax - dMin));
  const dFiltMax = new Date(dMin.getTime() + (rango[1] / 100) * (dMax - dMin));
  const totalMs  = dFiltMax - dFiltMin || 1;
  const labelMomento = _proceso.meta?.vocabulario?.momento || "Momento";

  _actualizarEjeX(dFiltMin, dFiltMax);

  const grupos = campoAgrupar
    ? _agruparPorCampo(seleccionados, campoAgrupar, ordenY)
    : [{ grupo: null, items: seleccionados }];

  let html = `<div class="gantt-wrap">`;

  grupos.forEach(({ grupo, items }) => {
    
    if (grupo === null) {
      const ordenados = _ordenarNodos(items, ordenY || "alfabetico");
      ordenados.forEach(({ nodo, color }) => {
        const momentos = (nodo.momentos || nodo.hitos || []).filter(m =>
          Object.values(m.fechas || {}).some(obj => {
            if (!obj?.valor) return false;
            const f = new Date(obj.valor);
            return f >= dFiltMin && f <= dFiltMax;
          })
        );
        if (momentos.length) html += _ganttFila(nodo, momentos, color, dFiltMin, totalMs, labelMomento);
      });
      return;
    }

    const depto      = grupo;
    const colapsado  = !!_gruposColapsados[depto];
    const colorDepto = items[0]?.color || "#888";

    const sedesValidas = items.filter(({ nodo }) => {
      let ms = (nodo.momentos || nodo.hitos || []).filter(m =>
        Object.values(m.fechas || {}).some(obj => {
          if (!obj?.valor) return false;
          const f = new Date(obj.valor);
          return f >= dFiltMin && f <= dFiltMax;
        })
      );
      return ms.length > 0;
    });
    if (sedesValidas.length === 0) return;

    html += `<div class="gantt-grupo ${colapsado ? "colapsado" : ""}" data-depto="${_esc(depto)}">`;

    html += `<div class="gantt-depto-side" data-depto="${_esc(depto)}" title="${depto}">
      <span class="gantt-depto-chevron ${colapsado ? "" : "open"}">▼</span>
      <span class="gantt-depto-name" style="color:${colorDepto}">${depto}</span>
      <span class="gantt-depto-count">${sedesValidas.length}</span>
    </div>`;

    html += `<div class="gantt-grupo-body" style="display:${colapsado ? "none" : "flex"};flex-direction:column;flex:1;min-width:0;justify-content:center">`;
    sedesValidas.forEach(({ nodo, color }) => {
      let momentos = (nodo.momentos || nodo.hitos || []).filter(m =>
        Object.values(m.fechas || {}).some(obj => {
          if (!obj?.valor) return false;
          const f = new Date(obj.valor);
          return f >= dFiltMin && f <= dFiltMax;
        })
      );

      html += _ganttFila(nodo, momentos, color, dFiltMin, totalMs, labelMomento);
    });
    html += `</div></div>`;
  });

  html += `</div>`;
  contenedor.innerHTML = html;

  _pintarColGrid(contenedor, dFiltMin, dFiltMax);

  contenedor.querySelectorAll(".gantt-depto-side").forEach(side => {
    side.addEventListener("click", e => {
      e.stopPropagation();
      const depto = side.dataset.depto;
      const grupo = side.closest(".gantt-grupo");

      if (grupo.classList.contains("colapsado")) {
        
        _gruposColapsados[depto] = false;
        const body = grupo.querySelector(".gantt-grupo-body");
        const chev = grupo.querySelector(".gantt-depto-chevron");
        if (body) { body.style.display = "flex"; body.style.justifyContent = "center"; }
        if (chev) { chev.classList.add("open"); }
        grupo.classList.remove("colapsado");
        return;
      }

      const items = _agruparPorDepartamento(seleccionados)
                      .find(g => g.depto === depto)?.items || [];
      _mostrarMenuDepto(e, depto, items, grupo, contenedor);
    });
  });

  contenedor.querySelectorAll(".gantt-label-sede-btn").forEach(label => {
    label.addEventListener("click", e => {
      e.stopPropagation();
      _mostrarMenuSede(e, label.dataset.nodoId, contenedor);
    });
  });

  contenedor.querySelectorAll(".gantt-seg-line, .gantt-dot").forEach(el => {
    el.addEventListener("click", e => {
      e.stopPropagation();
      _toggleDetalle(el.dataset.nodoId, el.dataset.momentoId, "__momentos__", contenedor);
    });
    el.addEventListener("mouseenter", e => {
      e.stopPropagation();
      _mostrarTooltipMomento(e, el.dataset.tt);
    });
    el.addEventListener("mousemove",  e => { e.stopPropagation(); _moverTooltip(e); });
    el.addEventListener("mouseleave", e => { e.stopPropagation(); _ocultarTooltip(); });
  });
}

function _pintarColGrid(contenedor, dFiltMin, dFiltMax) {
  const totalMs  = dFiltMax - dFiltMin || 1;
  const totalDias = totalMs / 86400000;
  const paso = totalDias <= 30 ? 7 : totalDias <= 90 ? 14 : totalDias <= 180 ? 30 : 60;

  const pcts = [];
  let d = new Date(dFiltMin);
  d.setHours(0, 0, 0, 0);
  while (d <= dFiltMax) {
    const p = ((d - dFiltMin) / totalMs) * 100;
    if (p > 0 && p < 100) pcts.push(p);
    d = new Date(d.getTime() + paso * 86400000);
  }

  const gridHtml = pcts.map(p =>
    `<div class="gantt-vcol" style="left:${p}%"></div>`
  ).join("");

  contenedor.querySelectorAll(".gantt-col-grid").forEach(el => {
    el.innerHTML = gridHtml;
  });
}

function _agruparPorCampo(seleccionados, campo, ordenY) {
  const map = new Map();
  seleccionados.forEach(item => {
    const val = item.nodo.ubicacion?.[campo] || `Sin ${campo}`;
    if (!map.has(val)) map.set(val, []);
    map.get(val).push(item);
  });
  
  const grupos = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b, "es"))
    .map(([grupo, items]) => ({
      grupo,
      items: _ordenarNodos(items, ordenY || "alfabetico")
    }));
  return grupos;
}

function _agruparPorDepartamento(seleccionados) {
  return _agruparPorCampo(seleccionados, "departamento", "alfabetico")
    .map(({ grupo, items }) => ({ depto: grupo, items }));
}

function _ganttFila(nodo, momentos, color, dFiltMin, totalMs, labelMomento) {
  const FECHA_LABELS = {
    inspeccion:      "Inspección",
    emision_informe: "Emisión",
    plazo_respuesta: "Plazo resp.",
    fecha_respuesta: "Resp. real",
    fecha_inicio:    "Inicio",
    fecha_fin:       "Fin"
  };

  let innerHtml = `<div class="gantt-col-grid"></div>`;

  momentos.forEach((m, i) => {
    const fechasEntries = Object.entries(m.fechas || {}).filter(([, obj]) => obj?.valor);
    if (!fechasEntries.length) return;

    const pcts = fechasEntries.map(([, obj]) =>
      Math.max(0, Math.min(100, ((new Date(obj.valor) - dFiltMin) / totalMs) * 100))
    );
    const pMin = Math.min(...pcts);
    const pMax = Math.max(...pcts);
    const pCx  = (pMin + pMax) / 2;
    const activo = _hitoActivo?.nodoId === nodo.id && _hitoActivo?.momentoId === m.id;

    const ttPayload = JSON.stringify({
      titulo: `${labelMomento} ${i + 1}${m.label ? " · " + m.label : ""}`,
      fechas: fechasEntries.map(([k, obj]) => ({
        label: FECHA_LABELS[k] || k.replace(/_/g, " "),
        valor: obj.valor
      }))
    });
    const ttEsc = ttPayload.replace(/'/g, "&#39;");
    const dataAttrs = `data-nodo-id="${nodo.id}" data-momento-id="${m.id}" data-tt='${ttEsc}'`;

    // Línea entre primera y última fecha del momento
    innerHtml += `<div class="gantt-seg-line ${activo ? "activo" : ""}"
      style="left:${pMin}%;width:${Math.max(pMax - pMin, 0.5)}%;background:${color}"
      ${dataAttrs}></div>`;

    // Label del momento sobre la línea
    innerHtml += `<span class="gantt-seg-label" style="left:${pCx}%">${labelMomento.charAt(0)}${i + 1}</span>`;

    // Círculo por cada fecha
    fechasEntries.forEach(([, obj]) => {
      const p = Math.max(0, Math.min(100, ((new Date(obj.valor) - dFiltMin) / totalMs) * 100));
      innerHtml += `<span class="gantt-dot ${activo ? "activo" : ""}"
        style="left:${p}%;background:${color}"
        ${dataAttrs}></span>`;
    });
  });

  // Label de sede indentado — click abre detalle de sede completa
  const nombreSede = nodo.label?.valor || nodo.id;
  return `
    <div class="gantt-fila">
      <div class="gantt-label gantt-label-sede gantt-label-sede-btn"
           style="color:${color}"
           data-nodo-id="${nodo.id}"
           title="Ver detalle de ${nombreSede}">${nombreSede}</div>
      <div class="gantt-track">${innerHtml}</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

let _tooltipEl = null;

function _mostrarTooltipMomento(e, ttRaw) {
  if (!ttRaw) return;
  const data = JSON.parse(ttRaw.replace(/&#39;/g, "'"));
  if (!_tooltipEl) {
    _tooltipEl = document.createElement("div");
    _tooltipEl.className = "gantt-tooltip";
    document.body.appendChild(_tooltipEl);
  }
  let html = `<div class="gtt-titulo">${data.titulo}</div>`;
  (data.fechas || []).forEach(f => {
    html += `<div class="gtt-fecha"><span>${f.label}</span><span>${_formatFecha(f.valor)}</span></div>`;
  });
  _tooltipEl.innerHTML = html;
  _tooltipEl.style.display = "block";
  _moverTooltip(e);
}

function _moverTooltip(e) {
  if (!_tooltipEl) return;
  const x = e.clientX + 12, y = e.clientY - 8;
  const rect = _tooltipEl.getBoundingClientRect();
  _tooltipEl.style.left = (x + rect.width  > window.innerWidth  ? x - rect.width  - 20 : x) + "px";
  _tooltipEl.style.top  = (y + rect.height > window.innerHeight ? y - rect.height      : y) + "px";
}

function _ocultarTooltip() {
  if (_tooltipEl) _tooltipEl.style.display = "none";
}

function _actualizarEjeX(dMin, dMax) {
  const track = document.getElementById("eje-x-track");
  if (!track) return;

  const totalDias = (dMax - dMin) / 86400000;
  const paso = totalDias <= 30 ? 7 : totalDias <= 90 ? 14 : totalDias <= 180 ? 30 : 60;

  const marcas = [];
  let d = new Date(dMin);
  d.setHours(0, 0, 0, 0);
  while (d <= dMax) {
    const pct = ((d - dMin) / (dMax - dMin)) * 100;
    if (pct >= 0 && pct <= 100) {
      marcas.push({ pct, label: _formatFecha(d.toISOString().split("T")[0]) });
    }
    d = new Date(d.getTime() + paso * 86400000);
  }

  track.innerHTML = marcas.map(m => `
    <div class="eje-x-marca" style="left:${m.pct}%">
      <div class="eje-x-marca-tick"></div>
      <span class="eje-x-marca-label">${m.label}</span>
    </div>`).join("");
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function _esc(str) {
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ===========================================================================
// VISTA B — Diagrama de líneas: valor real vs estimado por hito
// ===========================================================================

function _renderVistaB(contenedor, seleccionados, variable, labelMomento, agruparB, ordenB) {
  const labelC = _proceso.meta?.vocabulario?.caso || "caso";

  const hitosSet = new Map();
  seleccionados.forEach(({ nodo }) => {
    (nodo.momentos || nodo.hitos || []).forEach((m, i) => {
      const key = m.hito ?? i;
      if (!hitosSet.has(key)) hitosSet.set(key, m.label || `${labelMomento} ${i+1}`);
    });
  });
  const hitosOrden = [...hitosSet.keys()].sort((a, b) => a - b);
  if (!hitosOrden.length) {
    contenedor.innerHTML = `<div class="hint">Sin datos</div>`;
    return;
  }

  // Abreviar label de hito
  const hitoLabel = (hi) => {
    const raw = hitosSet.get(hi) || `H${hi}`;
    const s = raw.replace(/^.*[—\-]\s*/, "").trim();
    return s.length > 10 ? s.slice(0,9)+"…" : s;
  };

  const meta = 100; // normalizado a 100%

  // Ordenar seleccionados según criterio B
  const _ordenarB = (sels) => {
    if (ordenB === "avance") {
      return [...sels].sort((a, b) => {
        const lastVal = (s) => {
          const ms = s.nodo.momentos || s.nodo.hitos || [];
          const last = ms[ms.length - 1];
          return last?.valores?.[variable.id]?.valor ?? -1;
        };
        return lastVal(b) - lastVal(a);
      });
    }
    if (ordenB === "desviacion") {
      return [...sels].sort((a, b) => {
        const desv = (s) => {
          const ms = s.nodo.momentos || s.nodo.hitos || [];
          const last = ms[ms.length - 1];
          const v = last?.valores?.[variable.id];
          return v ? (v.valor ?? 0) - (v.estimado_a_este_hito ?? 0) : -999;
        };
        return desv(b) - desv(a);
      });
    }
    // alfabetico
    return [...sels].sort((a, b) =>
      (a.nodo.label?.valor || "").localeCompare(b.nodo.label?.valor || "", "es")
    );
  };

  // Agrupar o lista plana
  const grupos = (agruparB && agruparB !== "__ninguno__")
    ? _agruparPorCampo(seleccionados, agruparB, null).map(({ grupo, items }) => ({ grupo, items: _ordenarB(items) }))
    : [{ grupo: null, items: _ordenarB(seleccionados) }];

  let rows = "";
  grupos.forEach(({ grupo, items }) => {
    // Header de grupo si hay agrupación
    if (grupo) {
      rows += `<div class="vb-grupo-header">${grupo} <span class="vb-grupo-count">${items.length}</span></div>`;
    }
    items.forEach(({ nodo, color }) => {
    // Una barra por sede con un segmento por hito
    // Cada segmento ocupa (valor_hito - valor_hito_anterior)% del ancho total
    let prevVal = 0;
    let segments = "";
    let markers  = "";

    hitosOrden.forEach((hi, idx) => {
      const m   = (nodo.momentos || nodo.hitos || []).find((m, i) => (m.hito ?? i) === hi);
      const val = m?.valores?.[variable.id];
      const real = val ? Math.min(Math.max(val.valor ?? 0, 0), meta) : prevVal;
      const est  = val?.estimado_a_este_hito ?? null;
      const dudoso = val?.fuente?.alucinacion_sospechosa;

      const segW = Math.max(real - prevVal, 0); // ancho del segmento en %
      const opacity = 0.5 + (idx / Math.max(hitosOrden.length - 1, 1)) * 0.5; // más opaco en hitos recientes

      const fData = val?.fuente ? JSON.stringify({
        doc: val.fuente.doc, pagina: val.fuente.pagina,
        frag: val.fuente.fragmento_evidencia || "",
        just: val.fuente.justificacion || "",
        aluc: !!val.fuente.alucinacion_sospechosa,
        nodoLabel: nodo.label?.valor || "",
        hi, real, est
      }).replace(/'/g,"&#39;") : "";

      if (segW > 0) {
        segments += `<div class="vb-seg vb-dot"
          style="width:${segW}%;background:${color};opacity:${opacity}${dudoso?";outline:1px solid #EF9F27":""}"
          data-val="${real}" data-est="${est ?? ""}" data-hi="${hi}"
          data-fuente='${fData}'
          title="${hitoLabel(hi)}: ${real}%${est !== null ? ' / est. '+est+'%' : ''}">
          ${segW > 8 ? `<span class="vb-seg-label">${hitoLabel(hi)}</span>` : ""}
        </div>`;
      }

      if (est !== null) {
        markers += `<div class="vb-est-mark" style="left:${est}%" title="Estimado ${hitoLabel(hi)}: ${est}%"></div>`;
      }

      prevVal = real;
    });

    const pending = Math.max(meta - prevVal, 0);
    if (pending > 0) {
      segments += `<div class="vb-seg-pend" style="width:${pending}%"></div>`;
    }

    const lastVal = prevVal;
    rows += `<div class="vb-row">
      <div class="vb-sede-label" style="color:${color}" title="${nodo.label?.valor}">${nodo.label?.valor || nodo.id}</div>
      <div class="vb-bar-outer">
        ${segments}
        ${markers}
      </div>
      <div class="vb-bar-pct">${lastVal}%</div>
    </div>`;
    }); 
  }); 

  contenedor.innerHTML = `<div class="tl-b-wrap">
    <div class="tl-a-header">
      <span class="tl-a-titulo">${variable.label}</span>
      <span class="tl-a-sub">${seleccionados.length} ${labelC}s · ${hitosOrden.length} ${labelMomento.toLowerCase()}s</span>
    </div>
    <div class="vb-leyenda">
      <span class="vb-ley-item">
        ${hitosOrden.map((hi, i) => {
          const op = 0.5 + (i / Math.max(hitosOrden.length-1, 1)) * 0.5;
          return `<span class="vb-ley-seg" style="opacity:${op}"></span> ${hitoLabel(hi)}`;
        }).join('<span style="color:#ccc;margin:0 4px">·</span>')}
      </span>
      <span class="vb-ley-item" style="margin-left:12px"><span class="vb-ley-tick"></span> Estimado</span>
    </div>
    <div class="vb-grid-body">${rows}</div>
    <div class="tl-hint">Click en un segmento para ver fuente</div>
  </div>`;

  let ttEl = null;
  contenedor.querySelectorAll(".vb-dot").forEach(seg => {
    seg.addEventListener("mouseenter", e => {
      if (!ttEl) { ttEl = document.createElement("div"); ttEl.className = "gantt-tooltip"; document.body.appendChild(ttEl); }
      let f = {}; try { f = JSON.parse(seg.dataset.fuente.replace(/&#39;/g,"'")); } catch(ex) {}
      ttEl.innerHTML = `<div class="gtt-titulo">${f.nodoLabel || ""} · ${hitoLabel(parseInt(seg.dataset.hi))}</div>
        <div class="gtt-fecha"><span>Real</span><span>${seg.dataset.val}%</span></div>
        ${seg.dataset.est ? `<div class="gtt-fecha"><span>Estimado</span><span>${seg.dataset.est}%</span></div>` : ""}`;
      ttEl.style.display = "block";
      ttEl.style.left = (e.clientX + 12) + "px";
      ttEl.style.top  = (e.clientY - 8)  + "px";
    });
    seg.addEventListener("mousemove", e => {
      if (ttEl) { ttEl.style.left=(e.clientX+12)+"px"; ttEl.style.top=(e.clientY-8)+"px"; }
    });
    seg.addEventListener("mouseleave", () => { if (ttEl) ttEl.style.display = "none"; });
    seg.addEventListener("click", ev => {
      ev.stopPropagation();
      let f = {}; try { f = JSON.parse(seg.dataset.fuente.replace(/&#39;/g,"'")); } catch(ex) {}
      if (!f.doc) return;
      const panelEx = document.getElementById("col-detail")?.querySelector(".detalle-panel")
      || document.body.querySelector(".detalle-panel");
      if (panelEx) panelEx.remove();
      const panel = document.createElement("div");
      panel.className = "detalle-panel det-sede-panel";
      panel.innerHTML = `
        <div class="det-sede-head">
          <div class="det-dot" style="background:#378ADD"></div>
          <div>
            <div class="det-sede-titulo">${variable.label} · ${hitoLabel(parseInt(seg.dataset.hi))}</div>
            <div class="det-sede-sub">${f.nodoLabel} · Real: ${seg.dataset.val}%${seg.dataset.est ? " · Est: "+seg.dataset.est+"%" : ""}</div>
          </div>
          <button class="det-sede-cerrar det-action-btn det-btn-x">✕</button>
        </div>
        <div class="det-sec">
          ${_filaConfianza("Fuente del dato", {
            doc:f.doc, pagina:f.pagina,
            fragmento_evidencia:f.frag,
            justificacion:f.just,
            alucinacion_sospechosa:f.aluc
          }, "vbp-0")}
        </div>`;
      (function() {
      const col = document.getElementById("col-detail");
      const layout = document.querySelector(".layout");
      if (col) {
        col.innerHTML = "";
        col.appendChild(panel);
        if (layout) layout.classList.add("con-detalle");
      } else {
        document.body.appendChild(panel);
      }
    })();
      panel.querySelector(".det-sede-cerrar")?.addEventListener("click", () => {
      panel.remove();
      const col = document.getElementById("col-detail");
      const layout = document.querySelector(".layout");
      if (col && !col.querySelector(".detalle-panel")) {
        if (layout) layout.classList.remove("con-detalle");
      }
    });
      _conectarPopoversPanel(panel);
    });
  });
}

function _renderVistaC(contenedor, seleccionados, variable, labelMomento, agruparC, ordenC) {
  const labelC = _proceso.meta?.vocabulario?.caso || "caso";

  const hitosSet = new Map();
  seleccionados.forEach(({ nodo }) => {
    (nodo.momentos || nodo.hitos || []).forEach((m, i) => {
      const key = m.hito ?? i;
      if (!hitosSet.has(key)) hitosSet.set(key, m.label || `${labelMomento} ${i+1}`);
    });
  });
  const hitosOrden = [...hitosSet.keys()].sort((a, b) => a - b);
  if (!hitosOrden.length) { contenedor.innerHTML = `<div class="hint">Sin datos</div>`; return; }

  const hitoLabel = (hi) => {
    const raw = hitosSet.get(hi) || `H${hi}`;
    const s = raw.replace(/^.*[—\-]\s*/, "").trim();
    return s.length > 12 ? s.slice(0,11)+"…" : s;
  };

  const todosBool = seleccionados.every(({ nodo }) =>
    (nodo.momentos || nodo.hitos || []).every(m => {
      const v = m.valores?.[variable.id]?.valor;
      if (v === null || v === undefined) return true;
      const vs = String(v).toLowerCase();
      return ["true","false","si","no","1","0","cumplido","no_cumplido","yes","y","n"].includes(vs);
    })
  );

  const esBool = (v) => {
    if (v === null || v === undefined) return null;
    const vs = String(v).toLowerCase();
    if (["true","si","1","cumplido","yes","y"].includes(vs)) return true;
    if (["false","no","0","no_cumplido","n"].includes(vs)) return false;
    return null;
  };

  const estadoColor = (v) => {
    if (!v && v !== false) return "#e0e0d8";
    
    const b = esBool(v);
    if (b === true)  return "#5A9E7A";
    if (b === false) return "#C0693A";
    const map = {
      en_plazo:   "#5A9E7A", a_tiempo:    "#5A9E7A", completado: "#5A9E7A",
      en_riesgo:  "#A08030", riesgo:       "#A08030", pendiente:  "#A08030",
      atrasado:   "#C0693A", critico:      "#C0693A", rechazado:  "#C0693A",
      cancelado:  "#8A6FAE",
    };
    return map[String(v).toLowerCase()] || "#888780";
  };
  const estadoLabel = (v) => {
    if (v === null || v === undefined) return "—";
    const b = esBool(v);
    if (b === true)  return "✓";
    if (b === false) return "✗";
    return String(v).replace(/_/g, " ");
  };

  const estadosUsados = new Set();
  seleccionados.forEach(({ nodo }) => {
    (nodo.momentos || nodo.hitos || []).forEach((m, i) => {
      const val = m.valores?.[variable.id]?.valor;
      if (val) estadosUsados.add(val);
    });
  });

  const _ordenarC = (sels) => {
    if (ordenC === "estado") {
      
      return [...sels].sort((a, b) => {
        const lastEstado = (s) => {
          const ms = s.nodo.momentos || s.nodo.hitos || [];
          return ms[ms.length-1]?.valores?.[variable.id]?.valor || "";
        };
        return lastEstado(a).localeCompare(lastEstado(b));
      });
    }
    return [...sels].sort((a, b) =>
      (a.nodo.label?.valor || "").localeCompare(b.nodo.label?.valor || "", "es")
    );
  };

  const grupos = (agruparC && agruparC !== "__ninguno__")
    ? _agruparPorCampo(seleccionados, agruparC, null).map(({ grupo, items }) => ({ grupo, items: _ordenarC(items) }))
    : [{ grupo: null, items: _ordenarC(seleccionados) }];

  const leyendaItems = todosBool
    ? [
        `<span class="vc-ley-item"><span class="vc-ley-dot" style="background:#5A9E7A"></span>✓ Cumplido</span>`,
        `<span class="vc-ley-item"><span class="vc-ley-dot" style="background:#C0693A"></span>✗ No cumplido</span>`
      ]
    : [...estadosUsados].map(e =>
        `<span class="vc-ley-item"><span class="vc-ley-dot" style="background:${estadoColor(e)}"></span>${estadoLabel(e)}</span>`
      );
  leyendaItems.push(`<span class="vc-ley-item"><span class="vc-ley-dot" style="background:#e0e0d8"></span>sin dato</span>`);
  const leyendaHTML = `<div class="vc-leyenda">${leyendaItems.join("")}</div>`;

  const colsStyle = `grid-template-columns: 130px repeat(${hitosOrden.length}, 1fr)`;
  const headerCols = hitosOrden.map(hi =>
    `<div class="vc-col-label">${hitoLabel(hi)}</div>`
  ).join("");

  let rowsHTML = "";
  grupos.forEach(({ grupo, items }) => {
    if (grupo) {
      rowsHTML += `<div class="vc-grupo-header" style="grid-column:1/-1">${grupo} <span class="vb-grupo-count">${items.length}</span></div>`;
    }
    items.forEach(({ nodo, color }) => {
      rowsHTML += `<div class="vc-sede-label" style="color:${color}" title="${nodo.label?.valor}">${nodo.label?.valor || nodo.id}</div>`;
      hitosOrden.forEach(hi => {
        const m   = (nodo.momentos || nodo.hitos || []).find((m, i) => (m.hito ?? i) === hi);
        const val = m?.valores?.[variable.id];
        const estado = val?.valor || null;
        const nota   = val?.nota  || "";
        const dudoso = val?.fuente?.alucinacion_sospechosa;
        const fData  = val?.fuente ? JSON.stringify({
          doc: val.fuente.doc, pagina: val.fuente.pagina,
          frag: val.fuente.fragmento_evidencia || "",
          just: val.fuente.justificacion || "",
          aluc: !!val.fuente.alucinacion_sospechosa,
          nodoLabel: nodo.label?.valor || "", estado, nota, hi
        }).replace(/'/g,"&#39;") : "";

        rowsHTML += `<div class="vc-cell vc-dot"
          style="background:${estadoColor(estado)};opacity:${estado?0.85:0.3}${dudoso?";outline:2px solid #EF9F27":""}"
          data-estado="${estado||""}" data-hi="${hi}"
          data-fuente='${fData}'
          title="${estadoLabel(estado)}${nota ? ' — '+nota.slice(0,60) : ''}">
          <span class="vc-cell-label">${estadoLabel(estado)}</span>
          ${dudoso ? `<span class="vc-cell-aluc">⚠</span>` : ""}
        </div>`;
      });
    });
  });

  contenedor.innerHTML = `<div class="tl-c-wrap">
    <div class="tl-a-header">
      <span class="tl-a-titulo">${variable.label}</span>
      <span class="tl-a-sub">${seleccionados.length} ${labelC}s · ${hitosOrden.length} ${labelMomento.toLowerCase()}s</span>
    </div>
    ${leyendaHTML}
    <div class="vc-grid" style="${colsStyle}">
      <div class="vc-corner"></div>
      ${headerCols}
      ${rowsHTML}
    </div>
    <div class="tl-hint">Click en una celda para ver fuente</div>
  </div>`;

  // Tooltip + click
  let ttEl = null;
  contenedor.querySelectorAll(".vc-dot").forEach(cell => {
    cell.addEventListener("mouseenter", e => {
      if (!ttEl) { ttEl = document.createElement("div"); ttEl.className = "gantt-tooltip"; document.body.appendChild(ttEl); }
      let f = {}; try { f = JSON.parse(cell.dataset.fuente.replace(/&#39;/g,"'")); } catch(ex) {}
      ttEl.innerHTML = `<div class="gtt-titulo">${f.nodoLabel || ""} · ${hitoLabel(parseInt(cell.dataset.hi))}</div>
        <div class="gtt-fecha"><span>Estado</span><span>${estadoLabel(cell.dataset.estado)}</span></div>
        ${f.nota ? `<div class="gtt-fecha"><span>Nota</span><span style="max-width:140px;word-wrap:break-word">${f.nota.slice(0,80)}</span></div>` : ""}`;
      ttEl.style.display = "block";
      ttEl.style.left = (e.clientX + 12) + "px";
      ttEl.style.top  = (e.clientY - 8)  + "px";
    });
    cell.addEventListener("mousemove", e => {
      if (ttEl) { ttEl.style.left=(e.clientX+12)+"px"; ttEl.style.top=(e.clientY-8)+"px"; }
    });
    cell.addEventListener("mouseleave", () => { if (ttEl) ttEl.style.display = "none"; });
    cell.addEventListener("click", ev => {
      ev.stopPropagation();
      if (!cell.dataset.fuente) return;
      let f = {}; try { f = JSON.parse(cell.dataset.fuente.replace(/&#39;/g,"'")); } catch(ex) {}
      if (!f.doc) return;
      const panelEx = document.getElementById("col-detail")?.querySelector(".detalle-panel")
      || document.body.querySelector(".detalle-panel");
      if (panelEx) panelEx.remove();
      const panel = document.createElement("div");
      panel.className = "detalle-panel det-sede-panel";
      panel.innerHTML = `
        <div class="det-sede-head">
          <div class="det-dot" style="background:${estadoColor(f.estado)}"></div>
          <div>
            <div class="det-sede-titulo">${variable.label} · ${hitoLabel(parseInt(cell.dataset.hi))}</div>
            <div class="det-sede-sub">${f.nodoLabel} · ${estadoLabel(f.estado)}</div>
          </div>
          <button class="det-sede-cerrar det-action-btn det-btn-x">✕</button>
        </div>
        ${f.nota ? `<div class="det-sec" style="font-size:11px;color:#555">${f.nota}</div>` : ""}
        <div class="det-sec">
          ${_filaConfianza("Fuente del dato", {
            doc:f.doc, pagina:f.pagina,
            fragmento_evidencia:f.frag,
            justificacion:f.just,
            alucinacion_sospechosa:f.aluc
          }, "vcp-0")}
        </div>`;
      (function() {
      const col = document.getElementById("col-detail");
      const layout = document.querySelector(".layout");
      if (col) {
        col.innerHTML = "";
        col.appendChild(panel);
        if (layout) layout.classList.add("con-detalle");
      } else {
        document.body.appendChild(panel);
      }
    })();
      panel.querySelector(".det-sede-cerrar")?.addEventListener("click", () => {
      panel.remove();
      const col = document.getElementById("col-detail");
      const layout = document.querySelector(".layout");
      if (col && !col.querySelector(".detalle-panel")) {
        if (layout) layout.classList.remove("con-detalle");
      }
    });
      _conectarPopoversPanel(panel);
    });
  });
}

function _renderVistaD(contenedor, seleccionados, variable, labelMomento, nivelD) {
  const labelC = _proceso.meta?.vocabulario?.caso || "caso";

  const hitosSet = new Map();
  seleccionados.forEach(({ nodo }) => {
    (nodo.momentos || nodo.hitos || []).forEach((m, i) => {
      const key = m.hito ?? i;
      if (!hitosSet.has(key)) hitosSet.set(key, m.label || `${labelMomento} ${i+1}`);
    });
  });
  const hitosOrden = [...hitosSet.keys()].sort((a, b) => a - b);
  if (!hitosOrden.length) { contenedor.innerHTML = `<div class="hint">Sin datos</div>`; return; }

  const hitoLabel = (hi) => {
    const raw = hitosSet.get(hi) || `H${hi}`;
    const s = raw.replace(/^.*[—\-]\s*/, "").trim();
    return s.length > 12 ? s.slice(0,11)+"…" : s;
  };

  // Paleta de colores para actores
  const ACTOR_COLORS = ["#4A90D9","#E8894A","#5A9E7A","#A06BB0","#D4875A","#6BB8C4","#C4796A","#7AAA6B","#9B7AC4","#C4A76A"];

  function buildData(subset) {
    
    const actoresMap = new Map();
    subset.forEach(({ nodo }) => {
      (nodo.momentos || nodo.hitos || []).forEach((m, i) => {
        const hi = m.hito ?? i;
        const val = m.valores?.[variable.id];
        (val?.actores || []).forEach(a => {
          const key = a.nombre.trim();
          if (!actoresMap.has(key)) actoresMap.set(key, { nombre: key, rol: a.rol || "", total: 0, porHito: {} });
          const entry = actoresMap.get(key);
          entry.total++;
          if (!entry.porHito[hi]) entry.porHito[hi] = { count: 0, sedes: [], fuente: null };
          entry.porHito[hi].count++;
          entry.porHito[hi].sedes.push(nodo.label?.valor || nodo.id);
          if (!entry.porHito[hi].fuente && a.fuente) entry.porHito[hi].fuente = { ...a.fuente };
        });
      });
    });

    // Ordenar por total desc
    const actores = [...actoresMap.values()].sort((a, b) => b.total - a.total);

    // Aristas de co-aparición
    const edgeMap = new Map();
    subset.forEach(({ nodo }) => {
      (nodo.momentos || nodo.hitos || []).forEach((m, i) => {
        const val = m.valores?.[variable.id];
        const acs = (val?.actores || []).map(a => a.nombre.trim());
        for (let x = 0; x < acs.length; x++) {
          for (let y = x+1; y < acs.length; y++) {
            const ekey = [acs[x], acs[y]].sort().join("|||");
            edgeMap.set(ekey, (edgeMap.get(ekey) || 0) + 1);
          }
        }
      });
    });
    const edges = [...edgeMap.entries()].map(([k, w]) => {
      const [s, t] = k.split("|||");
      return { source: s, target: t, weight: w };
    });

    return { actores, edges, nSedes: subset.length };
  }

  // Render de un bloque (ribbons + grafo)
  function renderBloque(titulo, subset, colorSede) {
    if (!subset.length) return "";
    const { actores, edges, nSedes } = buildData(subset);
    if (!actores.length) return "";

    const colorMap = new Map(actores.map((a, i) => [a.nombre, ACTOR_COLORS[i % ACTOR_COLORS.length]]));

    // ── RIBBONS ──
    const RW = 320, RH = Math.max(120, actores.length * 28 + 40);
    const mL = 10, mR = 10, mT = 28, mB = 10;
    const iW = RW - mL - mR, iH = RH - mT - mB;
    const nH = hitosOrden.length;
    const colX = hitosOrden.map((_, i) =>
      nH === 1 ? mL + iW/2 : mL + i * iW / (nH - 1)
    );
    const RIBBON_H = 14, GAP = 6;
    const rowY = actores.map((_, i) => mT + i * (RIBBON_H + GAP));
    const maxCount = Math.max(...actores.flatMap(a => Object.values(a.porHito).map(h => h.count)), 1);

    // Grid vertical por hito
    let ribbonSVG = colX.map((x, i) =>
      `<line x1="${x}" y1="${mT-18}" x2="${x}" y2="${RH-mB}" stroke="#f0f0ec" stroke-width="1"/>
       <text x="${x}" y="${mT-6}" text-anchor="middle" font-size="9" fill="#aaa" font-family="system-ui">${hitoLabel(hitosOrden[i])}</text>`
    ).join("");

    // Cintas por actor
    actores.forEach((actor, ai) => {
      const color = colorMap.get(actor.nombre);
      const y = rowY[ai];
      const label = actor.nombre.length > 18 ? actor.nombre.slice(0,17)+"…" : actor.nombre;

      // Label a la izquierda
      ribbonSVG += `<text x="${mL-4}" y="${y + RIBBON_H/2 + 3}" text-anchor="end"
        font-size="8.5" fill="${color}" font-family="system-ui" font-weight="500"
        style="pointer-events:none">${label}</text>`;

      // Cinta: un rectángulo por hito, conectado con paths bezier
      hitosOrden.forEach((hi, ci) => {
        const d = actor.porHito[hi];
        if (!d) return;
        const pct = d.count / maxCount;
        const h   = Math.max(4, pct * RIBBON_H);
        const yc  = y + (RIBBON_H - h) / 2;
        const bW  = 10;
        const fData = d.fuente ? JSON.stringify({
          doc: d.fuente.doc, pagina: d.fuente.pagina,
          frag: d.fuente.fragmento_evidencia || "",
          just: d.fuente.justificacion || "",
          aluc: !!d.fuente.alucinacion_sospechosa,
          actor: actor.nombre, rol: actor.rol,
          sedes: d.sedes.slice(0,5).join(", "), count: d.count
        }).replace(/'/g,"&#39;") : "";

        ribbonSVG += `<rect class="vd-ribbon-bar vd-dot"
          x="${colX[ci]-bW/2}" y="${yc}" width="${bW}" height="${h}" rx="2"
          fill="${color}" fill-opacity="0.85" style="cursor:pointer"
          data-actor="${actor.nombre}" data-hi="${hi}" data-count="${d.count}"
          data-fuente='${fData}'/>`;

        if (ci < hitosOrden.length - 1) {
          const d2 = actor.porHito[hitosOrden[ci+1]];
          if (d2) {
            const pct2 = d2.count / maxCount;
            const h2   = Math.max(4, pct2 * RIBBON_H);
            const yc2  = y + (RIBBON_H - h2) / 2;
            const x1   = colX[ci] + bW/2, x2 = colX[ci+1] - bW/2;
            const mx   = (x1 + x2) / 2;
            ribbonSVG += `<path d="M${x1},${yc} C${mx},${yc} ${mx},${yc2} ${x2},${yc2}
              L${x2},${yc2+h2} C${mx},${yc2+h2} ${mx},${yc+h} ${x1},${yc+h} Z"
              fill="${color}" fill-opacity="0.18" style="pointer-events:none"/>`;
          } else {
            
            const x1 = colX[ci] + bW/2, x2 = colX[ci+1];
            const mx = (x1 + x2) / 2;
            ribbonSVG += `<path d="M${x1},${yc+h/2} C${mx},${yc+h/2} ${mx},${y+RIBBON_H/2} ${x2},${y+RIBBON_H/2} Z"
              fill="${color}" fill-opacity="0.1" style="pointer-events:none"/>`;
          }
        }
      });
    });

    const GW = 200, GH = RH;
    const GCX = GW/2, GCY = GH/2;
    const gRadius = Math.min(GW, GH)/2 - 30;
    const maxTotal = Math.max(...actores.map(a => a.total), 1);
    const maxEdge  = Math.max(...edges.map(e => e.weight), 1);

    actores.forEach((a, i) => {
      const angle = (2*Math.PI*i/actores.length) - Math.PI/2;
      a.gx = GCX + gRadius * Math.cos(angle);
      a.gy = GCY + gRadius * Math.sin(angle);
    });
    const gPos = new Map(actores.map(a => [a.nombre, { x: a.gx, y: a.gy }]));

    let grafoSVG = edges.map(e => {
      const s = gPos.get(e.source), t = gPos.get(e.target);
      if (!s || !t) return "";
      const w  = 1 + (e.weight / maxEdge) * 5;
      const op = 0.1 + (e.weight / maxEdge) * 0.5;
      return `<line x1="${s.x}" y1="${s.y}" x2="${t.x}" y2="${t.y}"
        stroke="#aaa" stroke-width="${w.toFixed(1)}" stroke-opacity="${op.toFixed(2)}"/>`;
    }).join("");

    grafoSVG += actores.map(a => {
      const r = 5 + (a.total / maxTotal) * 7;
      const color = colorMap.get(a.nombre);
      const lbl = a.nombre.length > 12 ? a.nombre.slice(0,11)+"…" : a.nombre;
      const dx = a.gx - GCX, dy = a.gy - GCY;
      const dist = Math.sqrt(dx*dx+dy*dy) || 1;
      const lx = a.gx + (dx/dist)*(r+4);
      const ly = a.gy + (dy/dist)*(r+4);
      const anchor = dx > 5 ? "start" : dx < -5 ? "end" : "middle";
      const labelY = dy < 0 ? ly - 2 : ly + 10;
      const fData = "";
      return `<g class="vd-node vd-dot" style="cursor:pointer"
        data-actor="${a.nombre}" data-rol="${a.rol}" data-count="${a.total}" data-fuente='${fData}'>
        <circle cx="${a.gx}" cy="${a.gy}" r="${r.toFixed(1)}"
          fill="${color}" fill-opacity="0.85" stroke="white" stroke-width="1.5"/>
        <text x="${lx}" y="${labelY}" text-anchor="${anchor}"
          font-size="8" fill="#555" font-family="system-ui"
          style="pointer-events:none">${lbl}</text>
      </g>`;
    }).join("");

    const tituloHTML = titulo
      ? `<div class="vd-bloque-label"${colorSede ? ` style="color:${colorSede}"` : ""}>${titulo}</div>`
      : "";

    return `<div class="vd-bloque">
      ${tituloHTML}
      <div class="vd-panels">
        <div class="vd-panel-ribbons">
          <div class="vd-panel-titulo">Presencia por hito</div>
          <svg viewBox="-80 0 ${RW+80} ${RH}" width="100%" height="${RH}"
            style="display:block;overflow:visible">
            ${ribbonSVG}
          </svg>
        </div>
        <div class="vd-panel-grafo">
          <div class="vd-panel-titulo">Co-aparición</div>
          <svg viewBox="0 0 ${GW} ${GH}" width="100%" height="${GH}"
            style="display:block;overflow:visible">
            ${grafoSVG}
          </svg>
        </div>
      </div>
    </div>`;
  }

  let bodyHTML = "";
  if (nivelD === "sede") {
    seleccionados.forEach(({ nodo, color }) => {
      bodyHTML += renderBloque(nodo.label?.valor || nodo.id, [{ nodo, color }], color);
    });
  } else if (nivelD === "departamento") {
    const grupos = _agruparPorCampo(seleccionados, "departamento", "alfabetico");
    grupos.forEach(({ grupo, items }) => {
      bodyHTML += renderBloque(grupo, items, null);
    });
  } else {
    bodyHTML = renderBloque("", seleccionados, null);
  }

  contenedor.innerHTML = `<div class="tl-d-wrap">
    <div class="tl-a-header">
      <span class="tl-a-titulo">${variable.label}</span>
      <span class="tl-a-sub">${seleccionados.length} ${labelC}s · ${hitosOrden.length} ${labelMomento.toLowerCase()}s</span>
    </div>
    ${bodyHTML}
    <div class="tl-hint">Click en una barra para ver fuente · grosor de arista = frecuencia de co-aparición</div>
  </div>`;

  let ttEl = null;
  contenedor.querySelectorAll(".vd-ribbon-bar, .vd-node").forEach(el => {
    el.addEventListener("mouseenter", e => {
      if (!ttEl) { ttEl = document.createElement("div"); ttEl.className = "gantt-tooltip"; document.body.appendChild(ttEl); }
      ttEl.innerHTML = `<div class="gtt-titulo">${el.dataset.actor}</div>
        ${el.dataset.rol ? `<div class="gtt-fecha"><span>Rol</span><span>${el.dataset.rol.slice(0,50)}</span></div>` : ""}
        <div class="gtt-fecha"><span>Apariciones</span><span>${el.dataset.count}</span></div>`;
      ttEl.style.display = "block";
      ttEl.style.left = (e.clientX+12)+"px"; ttEl.style.top = (e.clientY-8)+"px";
    });
    el.addEventListener("mousemove", e => {
      if (ttEl) { ttEl.style.left=(e.clientX+12)+"px"; ttEl.style.top=(e.clientY-8)+"px"; }
    });
    el.addEventListener("mouseleave", () => { if (ttEl) ttEl.style.display = "none"; });
    el.addEventListener("click", ev => {
      ev.stopPropagation();
      if (!el.dataset.fuente) return;
      let f = {}; try { f = JSON.parse(el.dataset.fuente.replace(/&#39;/g,"'")); } catch(ex) {}
      if (!f.doc) return;
      const panelEx = document.getElementById("col-detail")?.querySelector(".detalle-panel")
      || document.body.querySelector(".detalle-panel");
      if (panelEx) panelEx.remove();
      const panel = document.createElement("div");
      panel.className = "detalle-panel det-sede-panel";
      panel.innerHTML = `
        <div class="det-sede-head">
          <div class="det-dot" style="background:#378ADD"></div>
          <div>
            <div class="det-sede-titulo">${f.actor || ""}</div>
            <div class="det-sede-sub">${f.rol || ""}${f.sedes ? " · "+f.sedes : ""}</div>
          </div>
          <button class="det-sede-cerrar det-action-btn det-btn-x">✕</button>
        </div>
        <div class="det-sec">
          ${_filaConfianza("Fuente del dato", {
            doc:f.doc, pagina:f.pagina,
            fragmento_evidencia:f.frag,
            justificacion:f.just,
            alucinacion_sospechosa:f.aluc
          }, "vdp-0")}
        </div>`;
      (function() {
      const col = document.getElementById("col-detail");
      const layout = document.querySelector(".layout");
      if (col) {
        col.innerHTML = "";
        col.appendChild(panel);
        if (layout) layout.classList.add("con-detalle");
      } else {
        document.body.appendChild(panel);
      }
    })();
      panel.querySelector(".det-sede-cerrar")?.addEventListener("click", () => {
      panel.remove();
      const col = document.getElementById("col-detail");
      const layout = document.querySelector(".layout");
      if (col && !col.querySelector(".detalle-panel")) {
        if (layout) layout.classList.remove("con-detalle");
      }
    });
      _conectarPopoversPanel(panel);
    });
  });
}

function _renderVistaE(contenedor, seleccionados, variable, labelMomento) {
  const labelC = _proceso.meta?.vocabulario?.caso || "caso";

  const hitosSet = new Map();
  seleccionados.forEach(({ nodo }) => {
    (nodo.momentos || nodo.hitos || []).forEach((m, i) => {
      const key = m.hito ?? i;
      if (!hitosSet.has(key)) hitosSet.set(key, m.label || `${labelMomento} ${i+1}`);
    });
  });
  const hitosOrden = [...hitosSet.keys()].sort((a, b) => a - b);
  if (!hitosOrden.length) { contenedor.innerHTML = `<div class="hint">Sin datos</div>`; return; }

  const hitoLabel = (hi) => {
    const raw = hitosSet.get(hi) || `H${hi}`;
    const s = raw.replace(/^.*[—\-]\s*/, "").trim();
    return s.length > 20 ? s.slice(0,19)+"…" : s;
  };

  let html = `<div class="tl-e-wrap">
    <div class="tl-a-header">
      <span class="tl-a-titulo">${variable.label}</span>
      <span class="tl-a-sub">${seleccionados.length} ${labelC}s · ${hitosOrden.length} ${labelMomento.toLowerCase()}s</span>
    </div>`;

  html += `<div class="ve-cols" style="grid-template-columns:repeat(${hitosOrden.length},1fr)">`;

  hitosOrden.forEach(hi => {
    html += `<div class="ve-col-header">${hitoLabel(hi)}</div>`;
  });

  seleccionados.forEach(({ nodo, color }) => {
    hitosOrden.forEach(hi => {
      const m   = (nodo.momentos || nodo.hitos || []).find((m, i) => (m.hito ?? i) === hi);
      const val = m?.valores?.[variable.id];

      if (!val?.texto) {
        html += `<div class="ve-card ve-card-empty"></div>`;
        return;
      }

      const titulo  = val.titulo || "";
      const texto   = val.texto  || "";
      const dudoso  = val.fuente?.alucinacion_sospechosa;
      const extracto = texto.length > 120 ? texto.slice(0,118)+"…" : texto;
      const fData = val.fuente ? JSON.stringify({
        doc: val.fuente.doc, pagina: val.fuente.pagina,
        frag: val.fuente.fragmento_evidencia || "",
        just: val.fuente.justificacion || "",
        aluc: dudoso,
        nodoLabel: nodo.label?.valor || "",
        titulo, texto: texto.slice(0,300)
      }).replace(/'/g,"&#39;") : "";

      html += `<div class="ve-card ve-dot" style="border-left:3px solid ${color}"
        data-fuente='${fData}'>
        <div class="ve-card-sede" style="color:${color}">${nodo.label?.valor || nodo.id}</div>
        ${titulo ? `<div class="ve-card-titulo">${titulo}</div>` : ""}
        <div class="ve-card-texto">${extracto}</div>
        ${dudoso ? `<div class="ve-card-aluc">⚠ extracción dudosa</div>` : ""}
      </div>`;
    });
  });

  html += `</div>`;
  html += `<div class="tl-hint">Click en una tarjeta para ver texto completo y fuente</div>`;
  html += `</div>`;

  contenedor.innerHTML = html;

  // Click → panel detalle
  contenedor.querySelectorAll(".ve-dot").forEach(card => {
    card.addEventListener("click", ev => {
      ev.stopPropagation();
      if (!card.dataset.fuente) return;
      let f = {}; try { f = JSON.parse(card.dataset.fuente.replace(/&#39;/g,"'")); } catch(ex) {}
      const panelEx = document.getElementById("col-detail")?.querySelector(".detalle-panel")
      || document.body.querySelector(".detalle-panel");
      if (panelEx) panelEx.remove();
      const panel = document.createElement("div");
      panel.className = "detalle-panel det-sede-panel";
      panel.innerHTML = `
        <div class="det-sede-head">
          <div class="det-dot" style="background:#8A6FAE"></div>
          <div>
            <div class="det-sede-titulo">${f.titulo || variable.label}</div>
            <div class="det-sede-sub">${f.nodoLabel}</div>
          </div>
          <button class="det-sede-cerrar det-action-btn det-btn-x">✕</button>
        </div>
        <div class="det-sec" style="font-size:11px;color:#444;line-height:1.6">${f.texto || ""}</div>
        <div class="det-sec">
          ${_filaConfianza("Fuente del texto", {
            doc:f.doc, pagina:f.pagina,
            fragmento_evidencia:f.frag,
            justificacion:f.just,
            alucinacion_sospechosa:f.aluc
          }, "vep-0")}
        </div>`;
      (function() {
      const col = document.getElementById("col-detail");
      const layout = document.querySelector(".layout");
      if (col) {
        col.innerHTML = "";
        col.appendChild(panel);
        if (layout) layout.classList.add("con-detalle");
      } else {
        document.body.appendChild(panel);
      }
    })();
      panel.querySelector(".det-sede-cerrar")?.addEventListener("click", () => {
      panel.remove();
      const col = document.getElementById("col-detail");
      const layout = document.querySelector(".layout");
      if (col && !col.querySelector(".detalle-panel")) {
        if (layout) layout.classList.remove("con-detalle");
      }
    });
      _conectarPopoversPanel(panel);
    });
  });
}

// TIMELINE CON VARIABLES
// ===========================================================================

function _renderTimelineVariables(contenedor, seleccionados, varId, rango, nivelA, agruparB, ordenB, agruparC, ordenC, nivelD) {
  const { dMin, dMax } = _rangoFechas(_proceso.nodos);
  const dFiltMin = new Date(dMin.getTime() + (rango[0] / 100) * (dMax - dMin));
  const dFiltMax = new Date(dMin.getTime() + (rango[1] / 100) * (dMax - dMin));

  const variables    = _proceso.variables || _proceso.ejes_y || [];
  const variable     = variables.find(v => v.id === varId);
  const labelMomento = _proceso.meta?.vocabulario?.momento || "Momento";

  _actualizarEjeX(dFiltMin, dFiltMax);

  // Dispatch por tipo de variable
  if (variable?.tipo === "A") {
    _renderVistaA(contenedor, seleccionados, variable, dFiltMin, dFiltMax, labelMomento, nivelA || "global");
    return;
  }
  if (variable?.tipo === "B") {
    _renderVistaB(contenedor, seleccionados, variable, labelMomento, agruparB || "departamento", ordenB || "avance");
    return;
  }
  if (variable?.tipo === "C" || variable?.tipo === "F") {
    _renderVistaC(contenedor, seleccionados, variable, labelMomento, agruparC || "departamento", ordenC || "alfabetico");
    return;
  }
  if (variable?.tipo === "D") {
    _renderVistaD(contenedor, seleccionados, variable, labelMomento, nivelD || "global");
    return;
  }

  // Resto de tipos: cajitas colapsables (comportamiento original)
  let html = `<div class="tl-wrap">`;
  seleccionados.forEach(({ nodo, color }) => {
    let momentos = (nodo.momentos || nodo.hitos || []).filter(m =>
      Object.values(m.fechas || {}).some(obj => {
        if (!obj?.valor) return false;
        const f = new Date(obj.valor);
        return f >= dFiltMin && f <= dFiltMax;
      })
    );
    if (momentos.length === 0) return;
    html += _renderFilaNodo(nodo, momentos, color, variable, dFiltMin, dFiltMax, labelMomento);
  });
  html += `</div>`;
  html += `<div class="tl-hint">Click en un momento para ver detalle</div>`;
  contenedor.innerHTML = html;
  _conectarEventos(contenedor, varId);
}

// ===========================================================================
// VISTA A — Sankey de situaciones adversas entre hitos
// ===========================================================================

/**
 * Renderiza un diagrama de Sankey por nodo seleccionado.
 * Cada fila muestra el flujo de situaciones entre estados a lo largo
 * de los hitos: nuevas → estado, arrastradas (estado_anterior → estado_actual).
 *
 * Estructura del Sankey por nodo:
 *   Columna izq (fuentes): "Nuevas H1", "Arrastradas H1→H2", …
 *   Columna der (destinos): estados (abierto, en_proceso, cerrado, rechazado)
 *
 * Se dibuja un Sankey global que agrega todos los nodos seleccionados,
 * mostrando el flujo de situaciones del conjunto.
 */
function _renderVistaA(contenedor, seleccionados, variable, dFiltMin, dFiltMax, labelMomento, nivel) {
  const EC = {
    abierto:    { color: "#C0693A", label: "Abierto"    },
    en_proceso: { color: "#A08030", label: "En proceso" },
    cerrado:    { color: "#5A9E7A", label: "Cerrado"    },
    rechazado:  { color: "#8A6FAE", label: "Rechazado"  },
  };
  const ESTADOS = ["abierto", "en_proceso", "cerrado", "rechazado"];

  const hitosSet = new Map();
  seleccionados.forEach(({ nodo }) => {
    (nodo.momentos || nodo.hitos || []).forEach((m, i) => {
      const key = m.hito ?? i;
      if (!hitosSet.has(key)) hitosSet.set(key, m.label || `${labelMomento} ${i+1}`);
    });
  });
  const hitosOrden = [...hitosSet.keys()].sort((a, b) => a - b);

  if (!hitosOrden.length) {
    contenedor.innerHTML = `<div class="hint">Sin datos</div>`;
    return;
  }

  const stateByHito = {};
  hitosOrden.forEach(hi => { stateByHito[hi] = {}; });

  seleccionados.forEach(({ nodo }) => {
    (nodo.momentos || nodo.hitos || []).forEach((m, i) => {
      const key = m.hito ?? i;
      const val = m.valores?.[variable.id];
      if (!val) return;
      (val.nuevos || []).forEach(s => {
        const e = s.estado || "abierto";
        stateByHito[key][e] = (stateByHito[key][e] || 0) + 1;
      });
      (val.arrastrados || []).forEach(a => {
        const e = a.estado_actual || "abierto";
        stateByHito[key][e] = (stateByHito[key][e] || 0) + 1;
      });
    });
  });

  const flows = [];
  for (let i = 0; i < hitosOrden.length - 1; i++) {
    const hiTo = hitosOrden[i + 1];
    const f = {};
    seleccionados.forEach(({ nodo }) => {
      const mTo = (nodo.momentos || nodo.hitos || []).find((m, idx) => (m.hito ?? idx) === hiTo);
      const val = mTo?.valores?.[variable.id];
      if (!val) return;
      (val.arrastrados || []).forEach(a => {
        const ant = a.estado_anterior || "abierto";
        const act = a.estado_actual   || "abierto";
        if (!f[ant]) f[ant] = {};
        f[ant][act] = (f[ant][act] || 0) + 1;
      });
    });
    flows.push(f);
  }

  const labelC = _proceso.meta?.vocabulario?.caso || "caso";

  // Función que construye un bloque Sankey para un subset de seleccionados
  function bloqueHTML(titulo, subset, nodoId, tipo) {
    // Recalcular stateByHito y flows para este subset
    const sbh = {};
    hitosOrden.forEach(hi => { sbh[hi] = {}; });
    subset.forEach(({ nodo }) => {
      (nodo.momentos || nodo.hitos || []).forEach((m, i) => {
        const key = m.hito ?? i;
        const val = m.valores?.[variable.id];
        if (!val) return;
        (val.nuevos || []).forEach(s => {
          const e = s.estado || "abierto";
          sbh[key][e] = (sbh[key][e] || 0) + 1;
        });
        (val.arrastrados || []).forEach(a => {
          const e = a.estado_actual || "abierto";
          sbh[key][e] = (sbh[key][e] || 0) + 1;
        });
      });
    });
    const fls = [];
    for (let i = 0; i < hitosOrden.length - 1; i++) {
      const hiTo = hitosOrden[i + 1];
      const f = {};
      subset.forEach(({ nodo }) => {
        const mTo = (nodo.momentos || nodo.hitos || []).find((m, idx) => (m.hito ?? idx) === hiTo);
        const val = mTo?.valores?.[variable.id];
        if (!val) return;
        (val.arrastrados || []).forEach(a => {
          const ant = a.estado_anterior || "abierto";
          const act = a.estado_actual   || "abierto";
          if (!f[ant]) f[ant] = {};
          f[ant][act] = (f[ant][act] || 0) + 1;
        });
      });
      fls.push(f);
    }
    const hasData = hitosOrden.some(hi => ESTADOS.some(e => sbh[hi][e]));
    if (!hasData) return "";
    // Normalizar al máximo local de este subset
    const localMax = Math.max(...hitosOrden.map(hi =>
      ESTADOS.reduce((s, e) => s + (sbh[hi][e] || 0), 0)
    ), 1);
    const labelEl = titulo
      ? `<div class="tl-a-bloque-label tl-a-bloque-label-btn"
            data-nodo-id="${nodoId || ""}"
            data-tipo="${tipo || ""}"
            data-grupo="${typeof titulo === "string" ? titulo : ""}"
            style="cursor:pointer">${titulo}</div>`
      : "";
    return `<div class="tl-a-bloque">${labelEl}${_sankeySVG(hitosOrden, hitosSet, sbh, fls, EC, ESTADOS, labelMomento, localMax, nodoId)}</div>`;
  }

  let sankeyHTML = "";
  if (nivel === "departamento") {
    // Agrupar por departamento
    const grupos = _agruparPorCampo(seleccionados, "departamento", "alfabetico");
    sankeyHTML = grupos.map(({ grupo, items }) =>
      bloqueHTML(grupo, items, null, "departamento")
    ).join("");
  } else if (nivel === "sede") {
    // Un Sankey compacto por sede
    sankeyHTML = seleccionados.map(({ nodo, color }) =>
      bloqueHTML(`<span style="color:${color}">${nodo.label?.valor || nodo.id}</span>`, [{ nodo, color }], nodo.id, "sede")
    ).join("");
  } else {
    // Global: todos juntos
    sankeyHTML = bloqueHTML("", seleccionados);
  }

  // Leyenda única — solo estados que aparecen en los datos
  const estadosUsados = ESTADOS.filter(e => hitosOrden.some(hi =>
    seleccionados.some(({ nodo }) =>
      (nodo.momentos || nodo.hitos || []).some((m, i) => {
        const val = m.valores?.[variable.id];
        return (val?.nuevos || []).some(s => (s.estado||"abierto") === e)
            || (val?.arrastrados || []).some(a => (a.estado_actual||"abierto") === e);
      })
    )
  ));
  const leyendaHTML = `<div class="tl-a-leyenda">
    ${estadosUsados.map(e =>
      `<span class="tl-a-ley-item">
        <span class="tl-a-ley-dot" style="background:${EC[e].color}"></span>
        ${EC[e].label}
      </span>`
    ).join("")}
  </div>`;

  contenedor.innerHTML = `<div class="tl-a-wrap">
    <div class="tl-a-header">
      <span class="tl-a-titulo">${variable.label}</span>
      <span class="tl-a-sub">${seleccionados.length} ${labelC}s &middot; ${hitosOrden.length} ${labelMomento.toLowerCase()}s</span>
    </div>
    ${leyendaHTML}
    ${sankeyHTML}
    <div class="tl-hint">Flujo de situaciones entre ${labelMomento.toLowerCase()}s · click en una barra para ver detalle</div>
  </div>`;

  // Click en barra → panel de detalle con situaciones filtradas
  contenedor.querySelectorAll(".sk-bar").forEach(rect => {
    rect.addEventListener("click", e => {
      e.stopPropagation();
      const hi     = parseInt(rect.dataset.hi);
      const estado = rect.dataset.estado;
      const nId    = rect.dataset.nodoId;
      _mostrarDetalleSankey(contenedor, nId, hi, estado, variable, seleccionados);
    });
  });

  // Click en label de sede/departamento → mini menú
  contenedor.querySelectorAll(".tl-a-bloque-label-btn").forEach(lbl => {
    lbl.addEventListener("click", e => {
      e.stopPropagation();
      const tipo   = lbl.dataset.tipo;
      const nodoId = lbl.dataset.nodoId;
      const grupo  = lbl.dataset.grupo;
      if (tipo === "sede") {
        _mostrarMenuSede(e, nodoId, contenedor);
      } else if (tipo === "departamento") {
        // Construir grupo fake para el menú de depto
        const grupoEl = null; // no hay gantt-grupo en vista A
        _mostrarMenuDeptoVistaA(e, grupo, seleccionados, contenedor);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Panel de detalle al hacer click en barra del Sankey
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mini menú de departamento en vista A (sin colapsar — no hay grupos gantt)
// ---------------------------------------------------------------------------

function _mostrarMenuDeptoVistaA(e, depto, seleccionados, contenedor) {
  if (_menuDeptoEl) { _menuDeptoEl.remove(); _menuDeptoEl = null; }

  const items = seleccionados.filter(s =>
    s.nodo.ubicacion?.departamento === depto
  );
  const labelC = _proceso.meta?.vocabulario?.caso || "caso";

  const menu = document.createElement("div");
  menu.className    = "ctx-depto-menu";
  menu.dataset.depto = depto;
  menu.innerHTML = `
    <div class="ctx-depto-header">${depto} · ${items.length} ${labelC}s</div>
    <div class="ctx-item" data-action="detalle">
      <i class="ti ti-list-details" aria-hidden="true"></i> Ver detalle
    </div>
    <div class="ctx-item ctx-item-danger" data-action="quitar">
      <i class="ti ti-x" aria-hidden="true"></i> Quitar selección
    </div>`;

  const rect = e.currentTarget.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.left = (rect.left) + "px";
  menu.style.top  = (rect.bottom + 4) + "px";
  document.body.appendChild(menu);
  _menuDeptoEl = menu;

  const mr = menu.getBoundingClientRect();
  if (mr.right  > window.innerWidth  - 8) menu.style.left = (window.innerWidth - mr.width - 8) + "px";
  if (mr.bottom > window.innerHeight - 8) menu.style.top  = (rect.top - mr.height - 4) + "px";

  menu.querySelectorAll(".ctx-item").forEach(item => {
    item.addEventListener("click", ev => {
      ev.stopPropagation();
      menu.remove(); _menuDeptoEl = null;
      if (item.dataset.action === "detalle") {
        _toggleDetalleDepartamento(depto, items.map(s => ({ nodo: s.nodo, color: s.color })), contenedor);
      } else if (item.dataset.action === "quitar") {
        if (typeof window.deseleccionarDepartamento === "function")
          window.deseleccionarDepartamento(depto);
      }
    });
  });

  setTimeout(() => {
    document.addEventListener("click", function cerrar() {
      if (_menuDeptoEl) { _menuDeptoEl.remove(); _menuDeptoEl = null; }
      document.removeEventListener("click", cerrar);
    });
  }, 0);
}

function _mostrarDetalleSankey(contenedor, nodoId, hi, estado, variable, seleccionados) {
  const panelEx = document.getElementById("col-detail")?.querySelector(".detalle-panel")
      || document.body.querySelector(".detalle-panel");
  if (panelEx) panelEx.remove();

  // Recolectar situaciones que coinciden con nodoId (si aplica), hito y estado
  const FECHA_LABELS_EST = { abierto:"Abierto", cerrado:"Cerrado", en_proceso:"En proceso", rechazado:"Rechazado" };
  const EC_COLOR = { abierto:"#C0693A", cerrado:"#5A9E7A", en_proceso:"#A08030", rechazado:"#8A6FAE" };
  const labelM = _proceso.meta?.vocabulario?.momento || "Hito";

  const fuentes = nodoId
    ? seleccionados.filter(s => s.nodo.id === nodoId)
    : seleccionados;

  const sits = [];
  fuentes.forEach(({ nodo, color }) => {
    const m = (nodo.momentos || nodo.hitos || []).find((m, i) => (m.hito ?? i) === hi);
    if (!m) return;
    const val = m.valores?.[variable.id];
    if (!val) return;

    // Nuevas en este hito con el estado buscado
    (val.nuevos || []).filter(s => (s.estado||"abierto") === estado).forEach(s => {
      sits.push({ s, fuente: s.fuente, nodoLabel: nodo.label?.valor, color });
    });
    // Arrastradas cuyo estado_actual es el buscado
    (val.arrastrados || []).filter(a => (a.estado_actual||"abierto") === estado).forEach(a => {
      sits.push({ s: { texto: a.texto_original || a.texto, estado: a.estado_actual, fuente: a.fuente }, fuente: a.fuente, nodoLabel: nodo.label?.valor, color });
    });
  });

  const labelHito = (() => {
    for (const { nodo } of fuentes) {
      const m = (nodo.momentos || nodo.hitos || []).find((m, i) => (m.hito ?? i) === hi);
      if (m?.label) return m.label;
    }
    return `${labelM} ${hi}`;
  })();

  let popIdx = 0;
  const filas = sits.map(({ s, fuente, nodoLabel, color }) => {
    const pid = `skp-${popIdx++}`;
    const rowColor = nodoId ? null : color; // en global/depto mostrar color de sede
    const prefijo  = rowColor
      ? `<span style="color:${rowColor};font-size:10px;margin-right:4px">${nodoLabel}</span>`
      : "";
    return _filaConfianza(`${prefijo}${s.texto || ""}`, fuente || null, pid);
  }).join("");

  const panel = document.createElement("div");
  panel.className = "detalle-panel det-sede-panel";
  panel.innerHTML = `
    <div class="det-sede-head">
      <div class="det-dot" style="background:${EC_COLOR[estado]}"></div>
      <div>
        <div class="det-sede-titulo">${FECHA_LABELS_EST[estado]} · ${labelHito}</div>
        <div class="det-sede-sub">${sits.length} situación${sits.length !== 1 ? "es" : ""}</div>
      </div>
      <button class="det-sede-cerrar det-action-btn det-btn-x" title="Cerrar">✕</button>
    </div>
    <div class="det-sec">
      ${filas || `<div style="font-size:11px;color:#bbb;padding:4px 0">Sin situaciones</div>`}
    </div>`;
  (function() {
      const col = document.getElementById("col-detail");
      const layout = document.querySelector(".layout");
      if (col) {
        col.innerHTML = "";
        col.appendChild(panel);
        if (layout) layout.classList.add("con-detalle");
      } else {
        document.body.appendChild(panel);
      }
    })();

  panel.querySelector(".det-sede-cerrar")?.addEventListener("click", () => {
      panel.remove();
      const col = document.getElementById("col-detail");
      const layout = document.querySelector(".layout");
      if (col && !col.querySelector(".detalle-panel")) {
        if (layout) layout.classList.remove("con-detalle");
      }
    });
  _conectarPopoversPanel(panel);
}

function _sankeySVG(hitosOrden, hitosSet, stateByHito, flows, EC, ESTADOS, labelMomento, localMax, nodoId) {
  const nHitos = hitosOrden.length;
  const maxTotal = localMax || Math.max(...hitosOrden.map(hi =>
    ESTADOS.reduce((s, e) => s + (stateByHito[hi][e] || 0), 0)
  ), 1);
  const H = 100;
  const W = 540, mL = 12, mR = 12, mT = 30, mB = 10;
  const iW = W - mL - mR;
  const iH = H - mT - mB;
  const barW = 20;
  const colX = hitosOrden.map((_, i) =>
    nHitos === 1 ? mL + iW / 2 : mL + Math.round(i * iW / (nHitos - 1))
  );

  const nodes = hitosOrden.map((hi) => {
    const pad = 5; let y = mT;
    return ESTADOS.filter(e => (stateByHito[hi][e] || 0) > 0).map(e => {
      const h = Math.max(10, Math.round((stateByHito[hi][e] / maxTotal) * (iH * 0.9)));
      const nd = { estado: e, count: stateByHito[hi][e], y, h, color: EC[e].color };
      y += h + pad;
      return nd;
    });
  });

  let paths = "";
  flows.forEach((flow, fi) => {
    const usedSrc = {}, usedTgt = {};
    const x1 = colX[fi]   + barW / 2;
    const x2 = colX[fi+1] - barW / 2;
    const mx = (x1 + x2) / 2;
    ESTADOS.forEach(ant => {
      ESTADOS.forEach(act => {
        const n = flow[ant]?.[act] || 0;
        if (!n) return;
        const sN = nodes[fi].find(nd => nd.estado === ant);
        const tN = nodes[fi+1].find(nd => nd.estado === act);
        if (!sN || !tN) return;
        const srcTotal = stateByHito[hitosOrden[fi]][ant]   || 1;
        const tgtTotal = stateByHito[hitosOrden[fi+1]][act] || 1;
        const sH = (n / srcTotal) * sN.h;
        const tH = (n / tgtTotal) * tN.h;
        if (!usedSrc[ant]) usedSrc[ant] = 0;
        if (!usedTgt[act]) usedTgt[act] = 0;
        const y1t = sN.y + usedSrc[ant], y1b = y1t + sH;
        const y2t = tN.y + usedTgt[act], y2b = y2t + tH;
        usedSrc[ant] += sH;
        usedTgt[act] += tH;
        const c = EC[act].color;
        paths += `<path d="M ${x1} ${y1t} C ${mx} ${y1t} ${mx} ${y2t} ${x2} ${y2t} L ${x2} ${y2b} C ${mx} ${y2b} ${mx} ${y1b} ${x1} ${y1b} Z" fill="${c}" fill-opacity="0.22" stroke="${c}" stroke-opacity="0.1" stroke-width="0.5"/>`;
      });
    });
  });

  let bars = "";
  nodes.forEach((col, ci) => {
    const hi = hitosOrden[ci];
    col.forEach(nd => {
      const x = colX[ci] - barW / 2;
      bars += `<rect class="sk-bar" x="${x}" y="${nd.y}" width="${barW}" height="${nd.h}" rx="3"
        fill="${nd.color}" fill-opacity="0.85" style="cursor:pointer"
        data-hi="${hi}" data-estado="${nd.estado}" data-nodo-id="${nodoId || ""}"/>`;
      if (nd.h >= 14) {
        bars += `<text x="${colX[ci]}" y="${nd.y + nd.h/2 + 3.5}" text-anchor="middle"
          font-size="9" fill="white" font-weight="500" font-family="system-ui"
          style="pointer-events:none">${nd.count}</text>`;
      }
    });
  });

  let lbls = "";
  hitosOrden.forEach((hi, i) => {
    const raw = hitosSet.get(hi) || `${labelMomento} ${hi+1}`;
    const lbl = raw.replace(/^.*[\u2014\-]\s*/, "").trim();
    const short = lbl.length > 14 ? lbl.slice(0,13)+"..." : lbl;
    lbls += `<text x="${colX[i]}" y="${mT - 10}" text-anchor="middle" font-size="9" fill="#aaa" font-weight="500" font-family="system-ui">${short}</text>`;
  });

  return `<div style="padding:0 40px"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="display:block;overflow:visible" preserveAspectRatio="xMidYMid meet">${paths}${bars}${lbls}</svg></div>`;
}

// ---------------------------------------------------------------------------
// Ordenar nodos
// ---------------------------------------------------------------------------

function _ordenarNodos(seleccionados, orden) {
  // geografico: agrupa por cualquier campo de ubicación disponible en el dataset.
  // Usa macroregion > departamento > ciudad > lo que exista, en ese orden de preferencia.
  // Dentro de cada grupo ordena alfabéticamente por label.
  if (orden === "geografico" || !orden) {
    const geoKey = (nodo) => {
      const u = nodo.ubicacion || {};
      return u.macroregion || u.region || u.departamento || u.provincia || u.ciudad || u.lugar || "";
    };
    return [...seleccionados].sort((a, b) => {
      const gA = geoKey(a.nodo), gB = geoKey(b.nodo);
      const cmp = gA.localeCompare(gB, "es");
      if (cmp !== 0) return cmp;
      return (a.nodo.label?.valor || "").localeCompare(b.nodo.label?.valor || "", "es");
    });
  }

  if (orden === "alfabetico") {
    return [...seleccionados].sort((a, b) =>
      (a.nodo.label?.valor || "").localeCompare(b.nodo.label?.valor || "", "es")
    );
  }

  if (orden === "n_momentos") {
    return [...seleccionados].sort((a, b) => {
      const mA = (a.nodo.momentos || a.nodo.hitos || []).length;
      const mB = (b.nodo.momentos || b.nodo.hitos || []).length;
      return mB - mA;
    });
  }

  if (orden === "fecha_inicio") {
    return [...seleccionados].sort((a, b) => {
      const fA = _fechaMomento((a.nodo.momentos || a.nodo.hitos || [])[0]);
      const fB = _fechaMomento((b.nodo.momentos || b.nodo.hitos || [])[0]);
      return (fA || 0) - (fB || 0);
    });
  }

  if (orden === "fecha_fin") {
    return [...seleccionados].sort((a, b) => {
      const msA = a.nodo.momentos || a.nodo.hitos || [];
      const msB = b.nodo.momentos || b.nodo.hitos || [];
      const fA  = _fechaMomento(msA[msA.length - 1]);
      const fB  = _fechaMomento(msB[msB.length - 1]);
      return (fB || 0) - (fA || 0);
    });
  }

  if (orden === "situaciones") {
    const varA = (_proceso.variables || []).find(v => v.tipo === "A");
    const contarAbiertas = (nodo) => {
      if (!varA) return 0;
      const momentos = nodo.momentos || nodo.hitos || [];
      if (!momentos.length) return 0;
      const ultimo = momentos[momentos.length - 1];
      const val = ultimo.valores?.[varA.id];
      if (!val) return 0;
      return (val.nuevos || []).filter(s => s.estado !== "cerrado").length
           + (val.arrastrados || []).filter(a => a.estado_actual !== "cerrado").length;
    };
    return [...seleccionados].sort((a, b) => contarAbiertas(b.nodo) - contarAbiertas(a.nodo));
  }

  return seleccionados;
}

// ---------------------------------------------------------------------------
// Eventos (timeline con variables)
// ---------------------------------------------------------------------------

function _conectarEventos(contenedor, varId) {
  contenedor.querySelectorAll(".tl-caja-header").forEach(el => {
    el.addEventListener("click", e => {
      e.stopPropagation();
      const id = el.dataset.toggle;
      _cajasAbiertas.has(id) ? _cajasAbiertas.delete(id) : _cajasAbiertas.add(id);
      const caja   = el.closest(".tl-caja");
      const abierta = _cajasAbiertas.has(id);
      caja.classList.toggle("abierta", abierta);
      el.querySelector(".tl-caja-chevron").textContent = abierta ? "▴" : "▾";
      let body = caja.querySelector(".tl-caja-body");
      if (abierta && !body) {
        const nodo    = _proceso.nodos.find(n => n.id === caja.dataset.nodoId);
        const momento = (nodo?.momentos || nodo?.hitos || []).find(m => m.id === caja.dataset.momentoId);
        if (momento) {
          body = document.createElement("div");
          body.className = "tl-caja-body";
          body.innerHTML = _renderFechas(momento);
          caja.appendChild(body);
        }
      } else if (!abierta && body) {
        body.remove();
      }
    });
  });

  contenedor.querySelectorAll(".tl-caja").forEach(el => {
    el.addEventListener("click", e => {
      if (e.target.closest(".tl-caja-header")) return;
      _toggleDetalle(el.dataset.nodoId, el.dataset.momentoId, varId, contenedor);
    });
  });
}

// ---------------------------------------------------------------------------
// Panel de detalle
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Panel de detalle del departamento
// ---------------------------------------------------------------------------

/**
 * Abre el panel de detalle agregado de un departamento.
 * Reemplaza cualquier detalle-panel existente.
 * Tres acciones desde el label lateral:
 *   - Click normal  → abre/cierra detalle
 *   - Botón colapsar dentro del panel → colapsa el grupo
 *   - Botón × dentro del panel → quita todas las sedes del depto de la selección
 */
// ---------------------------------------------------------------------------
// Mini menú contextual del departamento
// ---------------------------------------------------------------------------

let _menuDeptoEl = null;

function _mostrarMenuDepto(e, depto, items, grupo, contenedor) {
  // Cerrar si ya estaba abierto para este depto
  if (_menuDeptoEl) {
    const same = _menuDeptoEl.dataset.depto === depto;
    _menuDeptoEl.remove();
    _menuDeptoEl = null;
    if (same) return;
  }

  const labelC = _proceso.meta?.vocabulario?.caso || "caso";
  const menu   = document.createElement("div");
  menu.className   = "ctx-depto-menu";
  menu.dataset.depto = depto;
  menu.innerHTML = `
    <div class="ctx-depto-header">${depto} · ${items.length} ${labelC}s</div>
    <div class="ctx-item" data-action="detalle">
      <i class="ti ti-list-details" aria-hidden="true"></i> Ver detalle
    </div>
    <div class="ctx-item" data-action="colapsar">
      <i class="ti ti-chevrons-left" aria-hidden="true"></i> Colapsar
    </div>
    <div class="ctx-item ctx-item-danger" data-action="quitar">
      <i class="ti ti-x" aria-hidden="true"></i> Quitar selección
    </div>`;

  // Posicionar junto al label lateral
  const rect = e.currentTarget.getBoundingClientRect
    ? e.currentTarget.getBoundingClientRect()
    : { right: e.clientX, top: e.clientY };
  menu.style.position = "fixed";
  menu.style.left = (rect.right + 4) + "px";
  menu.style.top  = rect.top + "px";
  document.body.appendChild(menu);
  _menuDeptoEl = menu;

  // Ajustar si se sale de la pantalla
  const mr = menu.getBoundingClientRect();
  if (mr.right > window.innerWidth - 8)
    menu.style.left = (rect.left - mr.width - 4) + "px";
  if (mr.bottom > window.innerHeight - 8)
    menu.style.top  = (window.innerHeight - mr.height - 8) + "px";

  menu.querySelectorAll(".ctx-item").forEach(item => {
    item.addEventListener("click", ev => {
      ev.stopPropagation();
      menu.remove();
      _menuDeptoEl = null;
      const action = item.dataset.action;
      if (action === "detalle") {
        _toggleDetalleDepartamento(depto, items, contenedor);
      } else if (action === "colapsar") {
        _gruposColapsados[depto] = true;
        const body = grupo.querySelector(".gantt-grupo-body");
        const chev = grupo.querySelector(".gantt-depto-chevron");
        if (body) { body.style.display = "none"; }
        if (chev) { chev.classList.remove("open"); }
        grupo.classList.add("colapsado");
        // cerrar panel de detalle si estaba abierto para este depto
        const panelEx = document.body.querySelector(`.detalle-panel[data-depto="${_esc(depto)}"]`);
        if (panelEx) panelEx.remove();
      } else if (action === "quitar") {
        if (typeof window.deseleccionarDepartamento === "function") {
          window.deseleccionarDepartamento(depto);
        }
      }
    });
  });

  // Cerrar al click fuera
  setTimeout(() => {
    document.addEventListener("click", function cerrar() {
      if (_menuDeptoEl) { _menuDeptoEl.remove(); _menuDeptoEl = null; }
      document.removeEventListener("click", cerrar);
    });
  }, 0);
}

function _toggleDetalleDepartamento(depto, items, contenedor) {
  const panelEx = document.getElementById("col-detail")?.querySelector(".detalle-panel")
      || document.body.querySelector(".detalle-panel");

  // Si ya está abierto para este depto, cerrar
  if (panelEx && panelEx.dataset.depto === depto) {
    panelEx.remove();
    return;
  }
  if (panelEx) panelEx.remove();

  const panel = document.createElement("div");
  panel.className = "detalle-panel det-depto-panel";
  panel.dataset.depto = depto;
  panel.innerHTML = _renderDetalleDepartamento(depto, items);
  (function() {
      const col = document.getElementById("col-detail");
      const layout = document.querySelector(".layout");
      if (col) {
        col.innerHTML = "";
        col.appendChild(panel);
        if (layout) layout.classList.add("con-detalle");
      } else {
        document.body.appendChild(panel);
      }
    })();

  // Botón cerrar
  panel.querySelector(".det-depto-cerrar")?.addEventListener("click", () => {
    panel.remove();
  });

  // Botones i — popover de evidencia por situación
  panel.querySelectorAll(".det-info-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const targetId = btn.dataset.pop;
      const popover  = panel.querySelector(`#${targetId}`);
      if (!popover) return;
      const visible = popover.classList.toggle("det-pop-visible");
      btn.classList.toggle("active", visible);
      // cerrar otros
      panel.querySelectorAll(".det-popover.det-pop-visible").forEach(p => {
        if (p.id !== targetId) { p.classList.remove("det-pop-visible"); }
      });
      panel.querySelectorAll(".det-info-btn.active").forEach(b => {
        if (b !== btn) b.classList.remove("active");
      });
    });
  });

  // Botones ver PDF
  panel.querySelectorAll("[data-pdf]").forEach(el => {
    el.addEventListener("click", () => {
      const d = JSON.parse(el.dataset.pdf.replace(/&#39;/g, "'"));
      if (typeof abrirPDF === "function") abrirPDF(d.doc, d.pagina, d.coords, d.seccion);
    });
  });
}

function _renderDetalleDepartamento(depto, items) {
  const color    = items[0]?.color || "#888";
  const nSedes   = items.length;
  const proceso  = _proceso;
  const labelM   = proceso.meta?.vocabulario?.momento || "Hito";
  const labelC   = proceso.meta?.vocabulario?.caso    || "ODPE";
  const vars     = proceso.variables || [];

  // ── Hitos disponibles (union de todos los nodos) ──
  const hitosSet = new Map(); // id → label
  items.forEach(({ nodo }) => {
    (nodo.momentos || nodo.hitos || []).forEach((m, i) => {
      if (!hitosSet.has(m.hito ?? i)) hitosSet.set(m.hito ?? i, m.label || `${labelM} ${i+1}`);
    });
  });
  const hitosOrden = [...hitosSet.keys()].sort((a,b) => a - b);

  // ── Avance de actividades (tipo B) ──
  const varB = vars.find(v => v.tipo === "B");
  let avanceHTML = "";
  if (varB) {
    const filas = hitosOrden.map(hi => {
      const vals = items.map(({ nodo }) => {
        const m = (nodo.momentos||nodo.hitos||[]).find((m,i) => (m.hito??i) === hi);
        return m?.valores?.[varB.id];
      }).filter(Boolean);
      if (!vals.length) return null;
      const promReal = vals.reduce((s,v) => s + (v.valor ?? v.porcentaje_real ?? 0), 0) / vals.length;
      const promEst  = vals.reduce((s,v) => s + (v.estimado_a_este_hito ?? v.porcentaje_estimado ?? 0), 0) / vals.length;
      return { hi, promReal, promEst };
    }).filter(Boolean);

    if (filas.length) {
      avanceHTML = `
        <div class="det-sec">
          <div class="det-sec-label">Avance de actividades · promedio ${labelC}s</div>
          ${filas.map(f => `
            <div class="det-prog-fila">
              <div class="det-prog-lbl">h${f.hi}</div>
              <div class="det-prog-track">
                <div class="det-prog-fill" style="width:${Math.round(f.promReal)}%;background:${color}"></div>
                <div class="det-prog-est" style="left:${Math.min(Math.round(f.promEst),100)}%"></div>
              </div>
              <div class="det-prog-val">${Math.round(f.promReal)}%</div>
            </div>`).join("")}
          <div class="det-prog-hint">
            <span class="det-prog-hint-line"></span> línea = estimado
          </div>
        </div>`;
    }
  }

  // ── Situaciones adversas (tipo A) — último hito ──
  const varA = vars.find(v => v.tipo === "A");
  let sitHTML = "";
  if (varA) {
    const lastHi = hitosOrden[hitosOrden.length - 1];
    const todasSits = [];
    items.forEach(({ nodo }) => {
      const m = (nodo.momentos||nodo.hitos||[]).find((m,i) => (m.hito??i) === lastHi);
      const val = m?.valores?.[varA.id];
      if (!val) return;
      const nuevos = val.nuevos || [];
      const arrastrados = (val.arrastrados || []).filter(a => a.estado_actual !== "cerrado");
      [...nuevos, ...arrastrados].forEach(s => todasSits.push({ s, fuente: val.fuente || s.fuente }));
    });

    const abiertas = todasSits.filter(({s}) => (s.estado || s.estado_actual || "abierto") !== "cerrado").length;
    const cerradas = todasSits.filter(({s}) => (s.estado || s.estado_actual) === "cerrado").length;

    const sitRows = todasSits.slice(0, 6).map(({ s, fuente }, idx) => {
      const alucinacion = s.fuente?.alucinacion_sospechosa || false;
      const verificado  = s.fuente?.verificado !== false;
      const flagColor   = alucinacion ? "det-flag-warn" : "det-flag-ok";
      const popId       = `det-pop-${idx}`;
      const frag        = s.fuente?.fragmento_evidencia || fuente?.fragmento_evidencia || "";
      const just        = s.fuente?.justificacion       || fuente?.justificacion       || "";
      const doc         = s.fuente?.doc || fuente?.doc || "";
      const pag         = s.fuente?.pagina || fuente?.pagina || 1;
      const pdfData     = doc ? JSON.stringify({ doc, pagina: pag, coords: null, seccion: "" }).replace(/"/g,"&quot;") : null;

      return `
        <div class="det-dato-row">
          <div class="det-flag ${flagColor}"></div>
          <div class="det-dato-label">${s.texto || s.texto_original || ""}</div>
          <button class="det-info-btn" data-pop="${popId}" aria-label="Ver justificación">i</button>
        </div>
        <div class="det-popover" id="${popId}">
          ${alucinacion ? `<div class="det-pop-alerta">⚠ extracción dudosa</div>` : ""}
          ${frag ? `<div class="det-pop-frag">"${frag.slice(0,160)}${frag.length>160?"…":""}"</div>` : ""}
          ${just ? `<div class="det-pop-just">${just.slice(0,180)}${just.length>180?"…":""}</div>` : ""}
          <div class="det-pop-footer">
            <div class="det-pop-src">${doc ? `${doc.split("/")[0]} · p. ${pag}` : "Sin fuente"}</div>
            ${pdfData ? `<span class="det-pop-link" data-pdf='${pdfData}'>ver PDF ↗</span>` : ""}
          </div>
        </div>`;
    }).join("");

    sitHTML = `
      <div class="det-sec">
        <div class="det-sec-label">Situaciones adversas · último ${labelM.toLowerCase()}</div>
        <div class="det-metrics">
          <div class="det-metric">
            <div class="det-metric-label">Abiertas</div>
            <div class="det-metric-val" style="color:var(--color-text-danger)">${abiertas}</div>
          </div>
          <div class="det-metric">
            <div class="det-metric-label">Cerradas</div>
            <div class="det-metric-val" style="color:var(--color-text-success)">${cerradas}</div>
          </div>
        </div>
        ${sitRows}
      </div>`;
  }

  // ── Estado por hito (tipo C) ──
  const varC = vars.find(v => v.tipo === "C");
  let estadoHTML = "";
  if (varC) {
    const filasE = hitosOrden.map(hi => {
      const counts = {};
      items.forEach(({ nodo }) => {
        const m = (nodo.momentos||nodo.hitos||[]).find((m,i) => (m.hito??i) === hi);
        const v = m?.valores?.[varC.id]?.valor;
        if (v) counts[v] = (counts[v]||0)+1;
      });
      return { hi, counts };
    }).filter(({counts}) => Object.keys(counts).length);

    if (filasE.length) {
      const pillClass = { en_plazo:"det-pill-ok", atrasado:"det-pill-bad", en_riesgo:"det-pill-warn", riesgo:"det-pill-warn" };
      estadoHTML = `
        <div class="det-sec">
          <div class="det-sec-label">Estado por ${labelM.toLowerCase()}</div>
          ${filasE.map(f => `
            <div class="det-estado-row">
              <div class="det-estado-lbl">h${f.hi}</div>
              <div class="det-pills">
                ${Object.entries(f.counts).map(([estado, n]) =>
                  `<span class="det-pill ${pillClass[estado]||"det-pill-neutral"}">${n} ${estado.replace(/_/g," ")}</span>`
                ).join("")}
              </div>
            </div>`).join("")}
        </div>`;
    }
  }

  // ── Plazo de respuesta (tipo F) ──
  const varF = vars.find(v => v.tipo === "F");
  let plazoHTML = "";
  if (varF) {
    const lastHi   = hitosOrden[hitosOrden.length - 1];
    let cumUlt = 0, totUlt = 0, cumAcum = 0, totAcum = 0;
    hitosOrden.forEach(hi => {
      items.forEach(({ nodo }) => {
        const m = (nodo.momentos||nodo.hitos||[]).find((m,i) => (m.hito??i) === hi);
        const v = m?.valores?.[varF.id];
        if (!v) return;
        totAcum++;
        if (v.valor) cumAcum++;
        if (hi === lastHi) { totUlt++; if (v.valor) cumUlt++; }
      });
    });
    if (totUlt > 0) {
      plazoHTML = `
        <div class="det-sec">
          <div class="det-sec-label">Plazo de respuesta cumplido</div>
          <div class="det-metrics">
            <div class="det-metric">
              <div class="det-metric-label">Último ${labelM.toLowerCase()}</div>
              <div class="det-metric-val" style="color:${cumUlt===totUlt?"var(--color-text-success)":"var(--color-text-warning)"}">${cumUlt}/${totUlt}</div>
              <div class="det-metric-sub">${Math.round(cumUlt/totUlt*100)}%</div>
            </div>
            <div class="det-metric">
              <div class="det-metric-label">Acumulado</div>
              <div class="det-metric-val">${cumAcum}/${totAcum}</div>
              <div class="det-metric-sub">${Math.round(cumAcum/totAcum*100)}% histórico</div>
            </div>
          </div>
        </div>`;
    }
  }

  return `
    <div class="det-depto-head">
      <div class="det-depto-dot" style="background:${color}"></div>
      <div>
        <div class="det-depto-titulo">${depto}</div>
        <div class="det-depto-sub">${nSedes} ${labelC}s · ${hitosOrden.length} ${labelM.toLowerCase()}s</div>
      </div>
      <button class="det-depto-cerrar det-action-btn det-btn-x" title="Cerrar">✕</button>
    </div>
    ${avanceHTML}
    ${sitHTML}
    ${estadoHTML}
    ${plazoHTML}
    <div class="det-no-agregan">
      <i>i</i> Actores, conclusiones y narrativo no se agregan
    </div>`;
}

// ---------------------------------------------------------------------------
// Detalle de SEDE — resumen de todos sus hitos
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mini menú contextual de sede
// ---------------------------------------------------------------------------

let _menuSedeEl = null;

function _mostrarMenuSede(e, nodoId, contenedor) {
  if (_menuSedeEl) {
    const same = _menuSedeEl.dataset.nodo === nodoId;
    _menuSedeEl.remove();
    _menuSedeEl = null;
    if (same) return;
  }

  const entry = (typeof seleccionados !== "undefined")
    ? seleccionados.find(s => s.nodo.id === nodoId)
    : null;
  const nodo  = entry?.nodo || _proceso.nodos.find(n => n.id === nodoId);
  const label = nodo?.label?.valor || nodoId;

  const menu = document.createElement("div");
  menu.className    = "ctx-depto-menu";
  menu.dataset.nodo = nodoId;
  menu.innerHTML = `
    <div class="ctx-depto-header">${label}</div>
    <div class="ctx-item" data-action="detalle">
      <i class="ti ti-list-details" aria-hidden="true"></i> Ver detalle
    </div>
    <div class="ctx-item ctx-item-danger" data-action="quitar">
      <i class="ti ti-x" aria-hidden="true"></i> Quitar selección
    </div>`;

  const rect = e.currentTarget.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.left = (rect.right + 4) + "px";
  menu.style.top  = rect.top + "px";
  document.body.appendChild(menu);
  _menuSedeEl = menu;

  const mr = menu.getBoundingClientRect();
  if (mr.right  > window.innerWidth  - 8) menu.style.left = (rect.left - mr.width - 4) + "px";
  if (mr.bottom > window.innerHeight - 8) menu.style.top  = (window.innerHeight - mr.height - 8) + "px";

  menu.querySelectorAll(".ctx-item").forEach(item => {
    item.addEventListener("click", ev => {
      ev.stopPropagation();
      menu.remove();
      _menuSedeEl = null;
      if (item.dataset.action === "detalle") {
        _toggleDetalleSede(nodoId, contenedor);
      } else if (item.dataset.action === "quitar") {
        if (typeof window.quitarNodo === "function") window.quitarNodo(nodoId);
      }
    });
  });

  setTimeout(() => {
    document.addEventListener("click", function cerrar() {
      if (_menuSedeEl) { _menuSedeEl.remove(); _menuSedeEl = null; }
      document.removeEventListener("click", cerrar);
    });
  }, 0);
}

function _toggleDetalleSede(nodoId, contenedor) {
  const panelEx = document.getElementById("col-detail")?.querySelector(".detalle-panel")
      || document.body.querySelector(".detalle-panel");
  if (panelEx && panelEx.dataset.nodo === nodoId) {
    panelEx.remove();
    return;
  }
  if (panelEx) panelEx.remove();

  const entry = (typeof seleccionados !== "undefined")
    ? seleccionados.find(s => s.nodo.id === nodoId)
    : null;
  const nodo  = entry?.nodo || _proceso.nodos.find(n => n.id === nodoId);
  const color = entry?.color || "#888";
  if (!nodo) return;

  const panel = document.createElement("div");
  panel.className    = "detalle-panel det-sede-panel";
  panel.dataset.nodo = nodoId;
  panel.innerHTML    = _renderDetalleSede(nodo, color);
  (function() {
      const col = document.getElementById("col-detail");
      const layout = document.querySelector(".layout");
      if (col) {
        col.innerHTML = "";
        col.appendChild(panel);
        if (layout) layout.classList.add("con-detalle");
      } else {
        document.body.appendChild(panel);
      }
    })();

  // Cerrar
  panel.querySelector(".det-sede-cerrar")?.addEventListener("click", () => {
      panel.remove();
      const col = document.getElementById("col-detail");
      const layout = document.querySelector(".layout");
      if (col && !col.querySelector(".detalle-panel")) {
        if (layout) layout.classList.remove("con-detalle");
      }
    });

  // Botones i
  _conectarPopoversPanel(panel);

  // Al hacer click en un hito-row, abrir detalle de ese hito específico
  panel.querySelectorAll(".det-sede-hito-row").forEach(row => {
    row.addEventListener("click", e => {
      e.stopPropagation();
      const momentoId = row.dataset.momentoId;
      panel.remove();
      _toggleDetalle(nodoId, momentoId, "__momentos__", contenedor);
    });
  });
}

function _renderDetalleSede(nodo, color) {
  const labelM  = _proceso.meta?.vocabulario?.momento || "Hito";
  const vars    = _proceso.variables || [];
  const momentos = nodo.momentos || nodo.hitos || [];
  let popIdx    = 0;

  // ── Header ──
  const header = `
    <div class="det-sede-head">
      <div class="det-dot" style="background:${color}"></div>
      <div>
        <div class="det-sede-titulo">${nodo.label?.valor || nodo.id}</div>
        <div class="det-sede-sub">${momentos.length} ${labelM.toLowerCase()}s</div>
      </div>
      <button class="det-sede-cerrar det-action-btn det-btn-x" title="Cerrar">✕</button>
    </div>`;

  // ── Una fila por hito: estado + avance + situaciones abiertas ──
  const varB = vars.find(v => v.tipo === "B");
  const varC = vars.find(v => v.tipo === "C");
  const varA = vars.find(v => v.tipo === "A");
  const varF = vars.find(v => v.tipo === "F");

  const hitosHTML = momentos.map((m, i) => {
    const valB = varB ? m.valores?.[varB.id] : null;
    const valC = varC ? m.valores?.[varC.id] : null;
    const valA = varA ? m.valores?.[varA.id] : null;
    const valF = varF ? m.valores?.[varF.id] : null;

    const avancePct = valB ? Math.round(valB.valor ?? valB.porcentaje_real ?? 0) : null;
    const estimado  = valB ? Math.round(valB.estimado_a_este_hito ?? valB.porcentaje_estimado ?? 0) : null;
    const estado    = valC?.valor || null;
    const abiertas  = valA ? (valA.nuevos||[]).filter(s=>s.estado!=="cerrado").length
                           + (valA.arrastrados||[]).filter(a=>a.estado_actual!=="cerrado").length : null;
    const plazoCump = valF?.valor;

    const estadoBadge = estado
      ? `<span class="det-estado-badge det-estado-${estado}">${estado.replace(/_/g," ")}</span>`
      : "";
    const plazoBadge = plazoCump !== undefined && plazoCump !== null
      ? `<span class="det-f-icono ${plazoCump ? "det-f-verde" : "det-f-rojo"}">${plazoCump ? "✓" : "✗"}</span>`
      : "";
    const sitBadge = abiertas !== null
      ? `<span style="font-size:10px;color:${abiertas>0?"#b91c1c":"#aaa"}">${abiertas > 0 ? `${abiertas} abierta${abiertas>1?"s":""}` : "sin sit."}</span>`
      : "";

    const barraHTML = avancePct !== null ? `
      <div class="det-prog-track" style="width:80px;flex-shrink:0">
        <div class="det-prog-fill" style="width:${Math.min(avancePct,100)}%;background:${color}"></div>
        ${estimado !== null ? `<div class="det-prog-est" style="left:${Math.min(estimado,100)}%"></div>` : ""}
      </div>
      <span style="font-size:10px;color:#999;min-width:28px;text-align:right">${avancePct}%</span>` : "";

    return `
      <div class="det-sede-hito-row" data-momento-id="${m.id}" title="Ver detalle de ${m.label||labelM+' '+(i+1)}">
        <div class="det-sede-hito-label" style="color:${color}">${labelM.charAt(0)}${i+1}</div>
        <div style="flex:1;display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap">
          ${estadoBadge}
          ${sitBadge}
          ${plazoBadge}
        </div>
        ${barraHTML}
        <span class="det-sede-hito-arrow">›</span>
      </div>`;
  }).join("");

  return `${header}
    <div class="det-sec">
      <div class="det-sec-label">Hitos — click para ver detalle</div>
      ${hitosHTML}
    </div>`;
}

// Reutilizable: conecta eventos i + PDF en cualquier panel
function _conectarPopoversPanel(panel) {
  panel.querySelectorAll(".det-info-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const pop = panel.querySelector(`#${btn.dataset.pop}`);
      if (!pop) return;
      const vis = pop.classList.toggle("det-pop-visible");
      btn.classList.toggle("active", vis);
      panel.querySelectorAll(".det-popover.det-pop-visible").forEach(p => {
        if (p.id !== btn.dataset.pop) p.classList.remove("det-pop-visible");
      });
      panel.querySelectorAll(".det-info-btn.active").forEach(b => {
        if (b !== btn) b.classList.remove("active");
      });
    });
  });
  panel.querySelectorAll("[data-pdf]").forEach(el => {
    el.addEventListener("click", () => {
      const d = JSON.parse(el.dataset.pdf.replace(/&quot;/g, '"'));
      if (typeof abrirPDF === "function") abrirPDF(d.doc, d.pagina, d.coords, d.seccion);
    });
  });
}

function _toggleDetalle(nodoId, momentoId, varId, contenedor) {
  const mismoPunto = _hitoActivo?.nodoId === nodoId && _hitoActivo?.momentoId === momentoId;
  const panelEx = document.getElementById("col-detail")?.querySelector(".detalle-panel")
      || document.body.querySelector(".detalle-panel");
  if (panelEx) panelEx.remove();

  if (mismoPunto) { _hitoActivo = null; _actualizarActivos(contenedor); return; }

  _hitoActivo = { nodoId, momentoId };
  _actualizarActivos(contenedor);

  const nodo    = _proceso.nodos.find(n => n.id === nodoId);
  const momento = (nodo?.momentos || nodo?.hitos || []).find(m => m.id === momentoId);
  if (!nodo || !momento) return;

  const variables = _proceso.variables || _proceso.ejes_y || [];
  const variable  = varId === "__momentos__" ? null : variables.find(v => v.id === varId);

  const panel = document.createElement("div");
  panel.className = "detalle-panel det-sede-panel";
  panel.innerHTML = _renderDetalle(nodo, momento, variable);
  (function() {
      const col = document.getElementById("col-detail");
      const layout = document.querySelector(".layout");
      if (col) {
        col.innerHTML = "";
        col.appendChild(panel);
        if (layout) layout.classList.add("con-detalle");
      } else {
        document.body.appendChild(panel);
      }
    })();

  // Botón cerrar
  panel.querySelector(".det-sede-cerrar")?.addEventListener("click", () => {
    panel.remove();
    _hitoActivo = null;
    _actualizarActivos(contenedor);
  });

  _conectarPopoversPanel(panel);
}

function _actualizarActivos(contenedor) {
  contenedor.querySelectorAll(".gantt-seg-line, .gantt-dot, .tl-caja").forEach(el => {
    const activo = _hitoActivo?.nodoId === el.dataset.nodoId
                && _hitoActivo?.momentoId === el.dataset.momentoId;
    el.classList.toggle("activo", activo);
  });
}

// ---------------------------------------------------------------------------
// Helper: fila de dato con flag de confianza + popover i
// ---------------------------------------------------------------------------

/**
 * Genera una fila de dato con:
 *   - punto de color (verde = verificado, amber = dudoso, gris = sin info)
 *   - texto del dato
 *   - botón i que expande fragmento + justificación + link PDF
 *
 * @param {string} texto       — texto visible del dato
 * @param {object} fuente      — objeto fuente del JSON (con doc, pagina, fragmento_evidencia, justificacion, alucinacion_sospechosa, verificado)
 * @param {string} popId       — id único para el popover
 * @returns {string} HTML
 */
function _filaConfianza(texto, fuente, popId) {
  const alucinacion = fuente?.alucinacion_sospechosa === true;
  const noVerif     = fuente?.verificado === false;
  const dudoso      = alucinacion || noVerif;
  const flagClass   = !fuente ? "det-flag-none"
                    : dudoso  ? "det-flag-warn"
                    :           "det-flag-ok";
  const frag  = fuente?.fragmento_evidencia || "";
  const just  = fuente?.justificacion       || "";
  const doc   = fuente?.doc   || "";
  const pag   = fuente?.pagina || 1;
  const pdfD  = doc
    ? JSON.stringify({ doc, pagina: pag, coords: fuente?.coords_pdf || null, seccion: fuente?.seccion || "" }).replace(/"/g, "&quot;")
    : null;

  const popoverHTML = `
    <div class="det-popover" id="${popId}">
      ${dudoso ? `<div class="det-pop-alerta">⚠ extracción dudosa</div>` : ""}
      ${frag   ? `<div class="det-pop-frag">"${frag.slice(0,180)}${frag.length>180?"…":""}"</div>` : ""}
      ${just   ? `<div class="det-pop-just">${just.slice(0,200)}${just.length>200?"…":""}</div>` : ""}
      <div class="det-pop-footer">
        <div class="det-pop-src">${doc ? `${doc.split("/")[0]} · p.${pag}` : "Sin fuente"}</div>
        ${pdfD ? `<span class="det-pop-link" data-pdf='${pdfD}'>ver PDF ↗</span>` : ""}
      </div>
    </div>`;

  return `
    <div class="det-dato-row">
      <div class="det-flag ${flagClass}"></div>
      <div class="det-dato-label">${texto}</div>
      ${fuente ? `<button class="det-info-btn" data-pop="${popId}" aria-label="Ver justificación">i</button>` : ""}
    </div>
    ${fuente ? popoverHTML : ""}`;
}

function _renderDetalle(nodo, momento, variable) {
  const color    = _colorNodo(nodo);
  const labelM   = _proceso.meta?.vocabulario?.momento || "Hito";
  const vars     = _proceso.variables || [];
  let popIdx     = 0;

  const header = `
    <div class="det-sede-head">
      <div class="det-dot" style="background:${color}"></div>
      <div>
        <div class="det-sede-titulo">${nodo.label?.valor || nodo.id}</div>
        <div class="det-sede-sub">${momento.label || labelM}</div>
      </div>
      <button class="det-sede-cerrar det-action-btn det-btn-x" title="Cerrar">✕</button>
    </div>`;

  const FECHA_LABELS = {
    inspeccion:      "Inspección",
    emision_informe: "Emisión informe",
    plazo_respuesta: "Plazo respuesta",
    fecha_respuesta: "Respuesta real"
  };
  const fechasEntries = Object.entries(momento.fechas || {})
    .filter(([, v]) => v?.valor)
    .sort(([a],[b]) => {
      const order = ["inspeccion","emision_informe","plazo_respuesta","fecha_respuesta"];
      return (order.indexOf(a) - order.indexOf(b));
    });

  const fechasRows = fechasEntries.map(([k, obj]) => {
    const pid = `dp-${popIdx++}`;
    return _filaConfianza(
      `<span style="color:#aaa;margin-right:4px">${FECHA_LABELS[k]||k.replace(/_/g," ")}</span> ${_formatFecha(obj.valor)}`,
      obj.fuente || null,
      pid
    );
  }).join("");

  const fechasHTML = fechasEntries.length
    ? `<div class="det-sec"><div class="det-sec-label">Cronograma</div>${fechasRows}</div>`
    : "";

  let variablesHTML = "";
  vars.forEach(v => {
    const val = momento.valores?.[v.id];
    if (!val) return;

    let secBody = "";

    if (v.tipo === "A") {
      
      const todos = [...(val.nuevos||[]), ...(val.arrastrados||[])];
      if (!todos.length) return;
      secBody = todos.map(s => {
        const fuente = s.fuente || null;
        const estado = s.estado || s.estado_actual || "abierto";
        const estadoBadge = `<span class="det-estado-badge det-estado-${estado}">${estado.replace(/_/g," ")}</span>`;
        const pid = `dp-${popIdx++}`;
        return _filaConfianza(`${estadoBadge} ${s.texto||s.texto_original||""}`, fuente, pid);
      }).join("");
    }

    else if (v.tipo === "B") {
      
      const real = val.valor ?? val.porcentaje_real ?? 0;
      const est  = val.estimado_a_este_hito ?? val.porcentaje_estimado ?? 0;
      const meta = val.meta_total ?? 100;
      const pid  = `dp-${popIdx++}`;
      secBody = `
        <div class="det-prog-fila" style="margin-bottom:6px">
          <div class="det-prog-track" style="flex:1">
            <div class="det-prog-fill" style="width:${Math.min(Math.round(real/meta*100),100)}%;background:${color}"></div>
            <div class="det-prog-est" style="left:${Math.min(Math.round(est/meta*100),100)}%"></div>
          </div>
          <div class="det-prog-val">${Math.round(real)}%</div>
        </div>
        <div style="font-size:10px;color:#aaa;margin-bottom:4px">Meta: ${meta} · Estimado: ${est}</div>
        ${_filaConfianza("Fuente del dato", val.fuente||null, pid)}`;
    }

    else if (v.tipo === "C") {
      
      const pid = `dp-${popIdx++}`;
      const badge = `<span class="det-pill det-pill-${val.valor||"neutral"}">${(val.valor||"").replace(/_/g," ")}</span>`;
      secBody = _filaConfianza(`${badge}${val.nota ? ` <span style="color:#aaa;font-size:10px">${val.nota}</span>` : ""}`, val.fuente||null, pid);
    }

    else if (v.tipo === "D") {
      
      const actores = val.actores || [];
      secBody = actores.map(a => {
        const pid = `dp-${popIdx++}`;
        return _filaConfianza(
          `<span style="font-weight:500">${a.nombre}</span> <span style="color:#aaa;font-size:10px">${a.rol||""}</span>`,
          a.fuente || val.fuente || null, pid
        );
      }).join("");
    }

    else if (v.tipo === "E") {
      
      const pid = `dp-${popIdx++}`;
      secBody = `
        <div class="det-narrativo-texto">${val.texto||""}</div>
        ${_filaConfianza("Fuente del texto", val.fuente||null, pid)}`;
    }

    else if (v.tipo === "F") {
      
      const pid = `dp-${popIdx++}`;
      const icono = val.valor
        ? `<span style="color:#1D9E75;font-weight:500">✓ Cumplido</span>`
        : `<span style="color:#C0693A;font-weight:500">✗ No cumplido</span>`;
      secBody = _filaConfianza(
        `${icono}${val.evidencia ? ` — <span style="color:#aaa;font-size:10px">${val.evidencia}</span>` : ""}`,
        val.fuente||null, pid
      );
    }

    if (secBody) {
      variablesHTML += `<div class="det-sec"><div class="det-sec-label">${v.label}</div>${secBody}</div>`;
    }
  });

  return `${header}${fechasHTML}${variablesHTML}`;
}

function _colorNodo(nodo) {
  if (typeof seleccionados !== "undefined") {
    const s = seleccionados.find(s => s.nodo.id === nodo.id);
    if (s) return s.color;
  }
  return "#888";
}

function _renderDetalleVariable(valor, variable, nodo) {
  switch (variable.tipo) {
    case "A": return _renderTipoA(valor, nodo);
    case "B": return _renderTipoB(valor, variable, nodo);
    case "C": return _renderTipoC(valor);
    case "D": return _renderTipoD(valor);
    case "E": return _renderTipoE(valor);
    case "F": return _renderTipoF(valor);
    default:  return "";
  }
}

function _renderTipoA(valor, nodo) {
  const nuevos = valor.nuevos || [];
  const arr    = valor.arrastrados || [];
  const total  = nuevos.length + arr.length;

  if (total === 0) return `<span style="font-size:10px;color:#ccc">Sin situaciones en este hito</span>`;

  const EC = { cerrado: "#5A9E7A", en_proceso: "#A08030", abierto: "#C0693A", rechazado: "#8A6FAE" };
  const EL = { cerrado: "Cerradas", en_proceso: "En proceso", abierto: "Abiertas", rechazado: "Rechazadas" };

  const nuevosPorE = {}, arrPorE = {};
  nuevos.forEach(n => { const e = n.estado||"abierto"; nuevosPorE[e]=(nuevosPorE[e]||0)+1; });
  arr.forEach(a => { const e = a.estado_actual||"abierto"; arrPorE[e]=(arrPorE[e]||0)+1; });

  const sources = [];
  if (nuevos.length) sources.push({ label:`Nuevas (${nuevos.length})`, count:nuevos.length, estados:nuevosPorE });
  if (arr.length)    sources.push({ label:`Arrastradas (${arr.length})`, count:arr.length, estados:arrPorE });

  const targetTotals = {};
  [...nuevos, ...arr].forEach(x => {
    const e = x.estado || x.estado_actual || "abierto";
    targetTotals[e] = (targetTotals[e]||0)+1;
  });
  const tOrder = ["cerrado","en_proceso","abierto","rechazado"].filter(e => targetTotals[e]);
  const targets = tOrder.map(e => ({ estado:e, count:targetTotals[e] }));

  const W=380, H=150, srcX=90, tgtX=268, barW=12, mT=14, mB=10, pad=8;
  const uH = H - mT - mB;

  function calcNodes(nodes) {
    const totalPad = (nodes.length-1)*pad;
    const totalH   = uH - totalPad;
    let y = mT;
    return nodes.map(n => {
      const h = Math.max(18, (n.count/total)*totalH);
      const node = {...n, y, h};
      y += h + pad;
      return node;
    });
  }
  const srcNodes = calcNodes(sources);
  const tgtNodes = calcNodes(targets);

  const srcAccum = {}, tgtAccum = {};
  srcNodes.forEach(s => srcAccum[s.label] = 0);
  tgtNodes.forEach(t => tgtAccum[t.estado] = 0);

  let paths = "";
  srcNodes.forEach(src => {
    Object.entries(src.estados).forEach(([estado, count]) => {
      const tgt = tgtNodes.find(t => t.estado===estado);
      if (!tgt) return;
      const sh = (count/src.count)*src.h;
      const th = (count/tgt.count)*tgt.h;
      const sy1 = src.y + srcAccum[src.label];
      const ty1 = tgt.y + tgtAccum[estado];
      const sy2 = sy1+sh, ty2 = ty1+th;
      srcAccum[src.label] += sh;
      tgtAccum[estado]    += th;
      const mx = (srcX+barW+tgtX)/2;
      const col = EC[estado]||"#888";
      paths += `<path d="M${srcX+barW},${sy1} C${mx},${sy1} ${mx},${ty1} ${tgtX},${ty1} L${tgtX},${ty2} C${mx},${ty2} ${mx},${sy2} ${srcX+barW},${sy2} Z" fill="${col}" fill-opacity="0.18" stroke="${col}" stroke-opacity="0.35" stroke-width="0.5"/>`;
    });
  });

  let rects="", labels="";
  srcNodes.forEach(s => {
    rects  += `<rect x="${srcX}" y="${s.y}" width="${barW}" height="${s.h}" fill="#b4b2a9" rx="2"/>`;
    labels += `<text x="${srcX-6}" y="${s.y+s.h/2+3.5}" text-anchor="end" font-size="9" fill="#888" font-family="system-ui">${s.label}</text>`;
  });
  tgtNodes.forEach(t => {
    const col = EC[t.estado]||"#888";
    rects  += `<rect x="${tgtX}" y="${t.y}" width="${barW}" height="${t.h}" fill="${col}" rx="2"/>`;
    labels += `<text x="${tgtX+barW+6}" y="${t.y+t.h/2+3.5}" text-anchor="start" font-size="9" fill="${col}" font-family="system-ui" font-weight="500">${EL[t.estado]||t.estado} · ${t.count}</text>`;
  });

  const listaHTML = [
    ...nuevos.map(n => `<div class="det-item"><span class="det-estado det-estado-${n.estado||"abierto"}">${n.estado||"abierto"}</span><span class="det-item-texto">${n.texto||""}</span>${_pdfBtn(n.fuente)}</div>`),
    ...arr.map(a => `<div class="det-item det-item-arrastrado"><div class="det-transicion"><span class="det-estado det-estado-${a.estado_anterior}">${a.estado_anterior}</span><span class="det-flecha">→</span><span class="det-estado det-estado-${a.estado_actual}">${a.estado_actual}</span><span class="det-desde">desde ${a.desde_hito||""}</span></div>${_pdfBtn(a.fuente)}</div>`)
  ].join("");

  return `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block">${paths}${rects}${labels}</svg>
    <div style="margin-top:6px;border-top:0.5px solid #f5f5f2;padding-top:6px">${listaHTML}</div>`;
}

function _renderTipoB(valor, variable, nodo) {
  const varId   = variable.id;
  const momentos = (nodo?.momentos || nodo?.hitos || []);
  const color    = _colorNodo(nodo);

  const serie = momentos.map((m, i) => {
    const v = m.valores?.[varId];
    return v ? { label:`H${i+1}`, real: v.porcentaje_real??null, est: v.porcentaje_estimado??null } : null;
  }).filter(Boolean);

  const pReal = valor.porcentaje_real ?? 0;
  const pEst  = valor.porcentaje_estimado ?? 0;
  const desv  = pReal - pEst;
  const dColor = desv >= 0 ? "#5A9E7A" : "#C0693A";

  if (serie.length < 2) {
    
    return `<div class="det-tipo-b">
      <div class="det-b-fila"><span style="font-size:10px;color:#aaa;min-width:36px">Real</span>
        <div class="det-b-barra-wrap"><div class="det-b-barra-est" style="width:${pEst}%"></div>
          <div class="det-b-barra" style="width:${pReal}%;background:${color}"></div></div>
        <span style="font-size:11px;font-weight:500;min-width:36px;text-align:right">${pReal.toFixed(1)}%</span></div>
      <div class="det-b-valores"><span>${formatearValor(valor.valor, variable.unidad)} / ${formatearValor(valor.meta_total, variable.unidad)}</span>
        <span style="color:${dColor}">${desv>=0?"+":""}${desv.toFixed(1)}% vs est.</span></div>
      ${_pdfBtn(valor.fuente)}</div>`;
  }

  const W=380, H=130, mL=32, mR=16, mT=12, mB=24;
  const iW=W-mL-mR, iH=H-mT-mB;
  const n = serie.length;
  const xS = i => mL + (i/(n-1))*iW;
  const yS = v => mT + iH - (v/100)*iH;

  let grid="";
  [0,25,50,75,100].forEach(v => {
    const y=yS(v);
    grid += `<line x1="${mL}" y1="${y}" x2="${W-mR}" y2="${y}" stroke="#f0f0ec" stroke-width="1"/>`;
    if (v===0||v===50||v===100)
      grid += `<text x="${mL-4}" y="${y+3}" text-anchor="end" font-size="8" fill="#ccc" font-family="system-ui">${v}%</text>`;
  });

  let realD="", estD="";
  serie.forEach((p, i) => {
    if (p.real!==null) realD += (i===0?`M`:`L`)+`${xS(i)},${yS(p.real)}`;
    if (p.est!==null)  estD  += (i===0?`M`:`L`)+`${xS(i)},${yS(p.est)}`;
  });

  let areaD="";
  if (realD && estD) {
    const pts = serie.filter(p=>p.real!==null&&p.est!==null);
    if (pts.length>=2) {
      const fwd = pts.map((p,i)=>`${i===0?"M":"L"}${xS(serie.indexOf(p))},${yS(p.real)}`).join(" ");
      const bck = [...pts].reverse().map((p,i)=>`L${xS(serie.indexOf(p))},${yS(p.est)}`).join(" ");
      areaD = fwd+" "+bck+"Z";
    }
  }

  let dots="";
  serie.forEach((p,i) => {
    if (p.real!==null) dots+=`<circle cx="${xS(i)}" cy="${yS(p.real)}" r="3" fill="${color}" stroke="white" stroke-width="1.5"/>`;
  });

  let xLabels="";
  serie.forEach((p,i) => {
    xLabels+=`<text x="${xS(i)}" y="${H-mB+12}" text-anchor="middle" font-size="8" fill="#aaa" font-family="system-ui">${p.label}</text>`;
  });

  const hitoActualIdx = serie.length - 1;
  const hx = xS(hitoActualIdx);
  const hitoActualLine = `<line x1="${hx}" y1="${mT}" x2="${hx}" y2="${mT+iH}" stroke="#e0e0d8" stroke-width="1" stroke-dasharray="3,2"/>`;

  const lastReal = serie[hitoActualIdx]?.real;
  const anotacion = lastReal!==null ? `<text x="${hx+4}" y="${yS(lastReal)-5}" font-size="9" fill="${color}" font-family="system-ui" font-weight="500">${lastReal.toFixed(1)}%</text>` : "";

  return `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block">
      ${grid}
      ${hitoActualLine}
      ${areaD ? `<path d="${areaD}" fill="${color}" fill-opacity="0.07"/>` : ""}
      ${estD  ? `<path d="${estD}" fill="none" stroke="#ccc" stroke-width="1.5" stroke-dasharray="5,3"/>` : ""}
      ${realD ? `<path d="${realD}" fill="none" stroke="${color}" stroke-width="2"/>` : ""}
      ${dots}
      ${anotacion}
      ${xLabels}
    </svg>
    <div style="display:flex;gap:14px;margin-top:3px;font-size:9px;color:#aaa">
      <span style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:16px;height:2px;background:${color}"></span>Real</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:16px;height:2px;background:#ccc;border-top:2px dashed #ccc"></span>Estimado</span>
      <span style="margin-left:auto;color:${dColor};font-weight:500">${desv>=0?"+":""}${desv.toFixed(1)}% desviación actual</span>
    </div>
    <div style="margin-top:5px;font-size:10px;color:#888">${formatearValor(valor.valor, variable.unidad)} de ${formatearValor(valor.meta_total, variable.unidad)} ${variable.unidad||""}</div>
    ${_pdfBtn(valor.fuente)}`;
}

function _renderTipoC(valor) {
  return `<div class="det-tipo-c">
    <span class="det-badge det-badge-c det-badge-${valor.valor}">${valor.valor}</span>
    ${valor.nota ? `<div class="det-nota">${valor.nota}</div>` : ""}
    ${_pdfBtn(valor.fuente)}</div>`;
}

function _renderTipoD(valor) {
  return `<div class="det-tipo-d">${(valor.entidades || []).map(e =>
    `<div class="det-entidad"><span class="det-entidad-nombre">${e.nombre}</span><span class="det-entidad-rol">${e.rol}</span>${_pdfBtn(e.fuente)}</div>`
  ).join("")}</div>`;
}

function _renderTipoE(valor) {
  return `<div class="det-tipo-e">${(valor.items || []).map(item =>
    `<div class="det-e-item">${item.titulo ? `<div class="det-e-titulo">${item.titulo}</div>` : ""}<div class="det-e-texto">${item.texto}</div>${_pdfBtn(item.fuente)}</div>`
  ).join("")}</div>`;
}

function _renderTipoF(valor) {
  return `<div class="det-tipo-f">
    <span class="det-f-icono det-f-${valor.valor ? "verde" : "rojo"}">${valor.valor ? "✓" : "✗"}</span>
    ${valor.nivel ? `<span class="det-badge det-badge-${valor.nivel}">${valor.nivel.replace("_", " ")}</span>` : ""}
    ${valor.evidencia ? `<div class="det-nota">${valor.evidencia}</div>` : ""}
    ${_pdfBtn(valor.fuente)}</div>`;
}

function _renderVector(vector) {
  const campos = Object.entries(vector).filter(([k, v]) => k !== "fuente_cronograma" && v !== null);
  if (!campos.length) return "";
  return `<div class="det-vector"><div class="det-seccion-titulo">Vector</div><div class="det-vector-grid">
    ${campos.map(([k, v]) => {
      const esNum = typeof v === "number";
      return `<div class="det-vector-item"><span class="det-vector-clave">${k}</span>
        <span class="det-vector-val ${esNum && v < 0 ? "negativo" : ""}">${esNum ? (v*100).toFixed(0)+"%" : v}</span></div>`;
    }).join("")}</div></div>`;
}

function _pdfBtn(fuente) {
  if (!fuente?.doc) return "";
  const data = JSON.stringify({ doc: fuente.doc, pagina: fuente.pagina || 1, coords: fuente.coords_pdf || null, seccion: fuente.seccion || "" });
  return `<span class="tl-pdf-btn" data-pdf='${data}'>${fuente.doc.split("/")[0]} p.${fuente.pagina}</span>`;
}

function _rangoFechas(nodos) {
  const todas = [];
  (nodos || []).forEach(n => {
    (n.momentos || n.hitos || []).forEach(m => {
      
      Object.values(m.fechas || {}).forEach(obj => {
        if (obj?.valor) todas.push(new Date(obj.valor));
      });
    });
  });
  if (!todas.length) { const d = new Date(); return { dMin: d, dMax: d }; }
  return { dMin: new Date(Math.min(...todas)), dMax: new Date(Math.max(...todas)) };
}

function _fechaMomento(momento) {
  const f = momento.fechas?.emision_informe?.valor
         || Object.values(momento.fechas || {}).find(f => f?.valor)?.valor;
  return f ? new Date(f) : null;
}

function _fechaGanttInicio(momento) {
  if (!momento) return null;
  const f = momento.fechas?.inspeccion?.valor
         || Object.values(momento.fechas || {}).find(f => f?.valor)?.valor;
  return f ? new Date(f) : null;
}

function _fechaGanttFin(momento) {
  if (!momento) return null;
  const f = momento.fechas?.plazo_respuesta?.valor
         || momento.fechas?.fecha_respuesta?.valor
         || momento.fechas?.emision_informe?.valor;
  if (!f) return null;
  const d = new Date(f);
  if (!momento.fechas?.plazo_respuesta?.valor && !momento.fechas?.fecha_respuesta?.valor) {
    d.setDate(d.getDate() + 5);
  }
  return d;
}

function _formatFecha(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${parseInt(d)} ${meses[parseInt(m) - 1]}`;
}