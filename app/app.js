
let proceso       = null;
let seleccionados = [];
let sliderRango   = [0, 100];

function cargarProceso(ruta = "../data/extracted/proceso.json") {
  fetch(ruta)
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(data => { proceso = data; init(data); })
    .catch(err => console.error("Error cargando proceso:", err.message));
}

window.cargarDataset = () => {
  const sel = document.getElementById("sel-dataset");
  if (sel) cargarProceso(sel.value);
};

cargarProceso();

function init(data) {
  const ctx = document.getElementById("contexto-proceso");
  if (ctx) ctx.textContent = data.meta.titulo || "";

  initTimeline(data);

  const labelMomento = data.meta?.vocabulario?.momento || "Momentos";
  _poblarDropdownVariables(data.variables || data.ejes_y, labelMomento);
  _poblarDropdownAgrupar(data.nodos);

  seleccionados      = [];
  window._hitoActivo = null;
  sliderRango        = [0, 100];

  initMap(data.nodos, onSeleccionCambia, data.meta?.vocabulario);
  renderInfoProceso(data);
  _initSlider(data);
  if (window.initUMAP) {
    initUMAP(data.nodos);
    const totalMom = (data.nodos || []).reduce((s, n) => s + (n.momentos || n.hitos || []).length, 0);
    const badge = document.getElementById("umap-badge");
    if (badge) badge.textContent = `${totalMom} docs · ${data.nodos?.length || 0} entidades`;
  }
  renderViz();
}

function _initSlider(data) {
  const fechas = [];
  (data.nodos || []).forEach(nodo => {
    (nodo.momentos || nodo.hitos || []).forEach(m => {

      Object.values(m.fechas || {}).forEach(obj => {
        if (obj?.valor) fechas.push(new Date(obj.valor));
      });
    });
  });
  if (!fechas.length) return;

  const dMin = new Date(Math.min(...fechas));
  const dMax = new Date(Math.max(...fechas));
  const fmt  = d => d.toLocaleDateString("es-PE", { day: "2-digit", month: "short" });

  initSliderDual("slider-container", (rango) => {
    sliderRango = rango;
    const container = document.getElementById("slider-container");
    if (container?._setLabels) {
      const dFiltMin = new Date(dMin.getTime() + (rango[0] / 100) * (dMax - dMin));
      const dFiltMax = new Date(dMin.getTime() + (rango[1] / 100) * (dMax - dMin));
      container._setLabels(fmt(dFiltMin), fmt(dFiltMax));
    }
    renderViz();
  }, fmt(dMin), fmt(dMax));
}

function _poblarDropdownVariables(variables, labelMomento) {
  const sel = document.getElementById("sel-variable");
  if (!sel) return;

  const opMoment = `<option value="__momentos__">${labelMomento || "Momentos"}</option>`;
  
  const TIPOS_IMPL = ["A", "B", "C", "D", "F"];
  const opVars = (variables || [])
    .filter(v => TIPOS_IMPL.includes(v.tipo))
    .map(v => `<option value="${v.id}">${v.label}${v.tipo === "A" ? " *" : ""}</option>`)
    .join("");

  sel.innerHTML = opMoment + opVars;
}

let _agruparActivo  = true;
let _agruparBActivo = true;
let _agruparCActivo = true;

window.toggleAgruparC = function() {
  _agruparCActivo = !_agruparCActivo;
  const btn = document.getElementById("btn-agrupar-c");
  if (btn) btn.classList.toggle("activo", _agruparCActivo);
  renderViz();
};

window.toggleAgruparB = function() {
  _agruparBActivo = !_agruparBActivo;
  const btn = document.getElementById("btn-agrupar-b");
  if (btn) btn.classList.toggle("activo", _agruparBActivo);
  renderViz();
};

window.toggleAgrupar = function() {
  _agruparActivo = !_agruparActivo;
  const btn  = document.getElementById("btn-agrupar");
  const pill = document.getElementById("pill-ordenar");
  if (btn)  btn.classList.toggle("activo", _agruparActivo);
  if (pill) pill.style.display = _agruparActivo ? "none" : "";
  renderViz();
};

function _poblarDropdownAgrupar() {

}

function onSeleccionCambia(nodo, index, marker, desdeArea = false) {
  const pos = seleccionados.findIndex(s => s.nodo.id === nodo.id);
  if (pos >= 0 && !desdeArea) {
    seleccionados.splice(pos, 1);
    marcarDeseleccionado(marker);
    if (window._hitoActivo?.nodoId === nodo.id) window._hitoActivo = null;
    liberarColoresNoUsados(seleccionados);
  } else if (pos < 0) {
    const color = colorPorNodo(nodo, index);
    seleccionados.push({ nodo, color, marker });
    marcarSeleccionado(marker, color);
  }
  if (window._actualizarClustersMapa) window._actualizarClustersMapa();
  renderViz();
}

window.quitarNodo = (id) => {
  const e = seleccionados.find(s => s.nodo.id === id);
  if (e) marcarDeseleccionado(e.marker);
  seleccionados = seleccionados.filter(s => s.nodo.id !== id);
  if (window._hitoActivo?.nodoId === id) window._hitoActivo = null;
  liberarColoresNoUsados(seleccionados);
  if (window._actualizarClustersMapa) window._actualizarClustersMapa();
  renderViz();
};

window.deseleccionarDepartamento = (depto) => {
  const ids = seleccionados
    .filter(s => s.nodo.ubicacion?.departamento === depto)
    .map(s => s.nodo.id);
  ids.forEach(id => {
    const e = seleccionados.find(s => s.nodo.id === id);
    if (e?.marker) marcarDeseleccionado(e.marker);
  });
  seleccionados = seleccionados.filter(s => s.nodo.ubicacion?.departamento !== depto);
  liberarColoresNoUsados(seleccionados);
  if (window._actualizarClustersMapa) window._actualizarClustersMapa();
  if (window.updateUMAPSelection) updateUMAPSelection(seleccionados);
  renderViz();
};

window._limpiarSeleccion = () => {
  seleccionados.forEach(s => {
    if (s.marker) marcarDeseleccionado(s.marker);
  });
  seleccionados = [];
  window._hitoActivo = null;
  liberarColoresNoUsados(seleccionados);
  if (window._actualizarClustersMapa) window._actualizarClustersMapa();
  if (window.updateUMAPSelection) updateUMAPSelection(seleccionados);
  renderViz();
};

window._estaSeleccionado = (id) => seleccionados.some(s => s.nodo.id === id);

window.onUMAPClick = function(nodo, index, soloAgregar = false) {
  const pos = seleccionados.findIndex(s => s.nodo.id === nodo.id);
  if (pos >= 0 && !soloAgregar) {
    
    const e = seleccionados[pos];
    if (e.marker) marcarDeseleccionado(e.marker);
    seleccionados.splice(pos, 1);
    if (window._hitoActivo?.nodoId === nodo.id) window._hitoActivo = null;
  } else if (pos < 0) {
    const color = colorPorNodo(nodo, index);
    const marker = window._getMarker ? window._getMarker(nodo.id) : null;
    seleccionados.push({ nodo, color, marker });
    if (marker) marcarSeleccionado(marker, color);
  }
  if (window.updateUMAPSelection) updateUMAPSelection(seleccionados);
  renderViz();
};

window.renderViz = function () {
  const c = document.getElementById("viz-canvas");
  if (!proceso || seleccionados.length === 0) {
    c.innerHTML = `<div class="hint">Selecciona nodos en el mapa para visualizar</div>`;
    
    const ejeX = document.getElementById("eje-x-track");
    if (ejeX) ejeX.innerHTML = "";
    return;
  }

  const varId    = document.getElementById("sel-variable")?.value || "__momentos__";
  const variable = (proceso?.variables || []).find(v => v.id === varId);
  const tipoVar  = variable?.tipo || null;

  const ctrlGantt  = document.getElementById("ctrl-gantt");
  const ctrlVistaA = document.getElementById("ctrl-vistaA");
  const ejeXBar    = document.querySelector(".eje-x-bar");
  const ctrlVistaB = document.getElementById("ctrl-vistaB");
  const ctrlVistaC = document.getElementById("ctrl-vistaC");
  const esEspecial = ["A","B","C","D","F"].includes(tipoVar);
  if (ctrlGantt)  ctrlGantt.style.display  = esEspecial ? "none" : "flex";
  if (ctrlVistaA) ctrlVistaA.style.display = (tipoVar === "A") ? "" : "none";
  if (ctrlVistaB) ctrlVistaB.style.display = (tipoVar === "B") ? "flex" : "none";
  if (ctrlVistaC) ctrlVistaC.style.display = (tipoVar === "C" || tipoVar === "F") ? "flex" : "none";
  const ctrlVistaD = document.getElementById("ctrl-vistaD");
  if (ctrlVistaD) ctrlVistaD.style.display = (tipoVar === "D") ? "flex" : "none";
  if (ejeXBar)    ejeXBar.style.display    = esEspecial ? "none" : "";

  const agrupar  = _agruparActivo  ? "departamento" : "__ninguno__";
  const agruparB = _agruparBActivo ? "departamento" : "__ninguno__";
  const agruparC = _agruparCActivo ? "departamento" : "__ninguno__";
  const ordenY   = document.getElementById("sel-orden-y")?.value  || "alfabetico";
  const ordenB   = document.getElementById("sel-orden-b")?.value  || "avance";
  const ordenC   = document.getElementById("sel-orden-c")?.value  || "alfabetico";
  const nivelD   = document.getElementById("sel-nivel-d")?.value  || "global";
  const nivelA   = document.getElementById("sel-nivel-a")?.value  || "global";

  if (window.updateUMAPSelection) updateUMAPSelection(seleccionados);

  renderTimeline(c, seleccionados, varId, sliderRango, agrupar, ordenY, nivelA, agruparB, ordenB, agruparC, ordenC, nivelD);
};

window.toggleLasso = () => window._activarHerramientaImpl?.("lasso");