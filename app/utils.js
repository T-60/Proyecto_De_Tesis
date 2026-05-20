

function sec(titulo, color) {
  const estilo = color
    ? `color:${color}; border-left: 2px solid ${color}; padding-left: 8px`
    : `color: #999`;
  return `<div style="margin: 16px 0 8px; font-size: 10px; font-weight: 500;
    text-transform: uppercase; letter-spacing: .07em; ${estilo}">${titulo}</div>`;
}

function row(label, valor) {
  return `
    <div style="display: grid; grid-template-columns: 170px 1fr; gap: 8px;
      margin-bottom: 5px; font-size: 11px;
      border-bottom: 0.5px solid #f5f5f2; padding-bottom: 5px">
      <span style="color: #aaa; flex-shrink: 0">${label}</span>
      <span style="color: #333">${valor}</span>
    </div>`;
}

function ref(fuente) {
  if (!fuente) return "";
  
  const docCorto = (fuente.doc || "").split("/")[0];
  return `<span style="font-size: 10px; color: #ddd; margin-left: 4px">
    [${docCorto} p.${fuente.pagina}]</span>`;
}

function formatearValor(valor) {
  if (Array.isArray(valor)) {
    return valor.join(", ");
  }
  if (typeof valor === "object" && valor !== null) {
    return Object.entries(valor)
      .map(([clave, n]) => `${clave}: ${n}`)
      .join(", ");
  }
  if (typeof valor === "boolean") {
    return valor ? "Si" : "No";
  }
  return String(valor);
}

const _deptoHueMap   = {};   
const _DEPTO_INDICES = {};   

const HUES_ORDENADOS = [
  210,  
  25,   
  145,  
  290,  
  50,   
  330,  
  180,  
  100,  
  255,  
  0,    
  75,   
  315,  
];

function _siguienteHue() {
  const enUso = new Set(Object.values(_deptoHueMap));
  for (const h of HUES_ORDENADOS) {
    if (!enUso.has(h)) return h;
  }
  
  for (const h of HUES_ORDENADOS) {
    const h2 = (h + 15) % 360;
    if (!enUso.has(h2)) return h2;
  }
  return HUES_ORDENADOS[0];
}

function colorPorNodo(nodo, indexGlobal) {
  if (!nodo || !nodo.ubicacion) return PALETTE[indexGlobal % PALETTE.length];
  const depto = nodo.ubicacion.departamento;

  let hue = _deptoHueMap[depto];
  if (hue === undefined) {
    hue = _siguienteHue();
    _deptoHueMap[depto] = hue;
  }

  if (!_DEPTO_INDICES[depto]) _DEPTO_INDICES[depto] = {};
  if (_DEPTO_INDICES[depto][nodo.id] === undefined) {
    _DEPTO_INDICES[depto][nodo.id] = Object.keys(_DEPTO_INDICES[depto]).length;
  }
  const idxLocal = _DEPTO_INDICES[depto][nodo.id];

  const lums = [50, 38, 62, 44, 56, 32, 68, 47, 53, 41];
  const L = lums[idxLocal % lums.length];
  const S = 60;
  return `hsl(${hue}, ${S}%, ${L}%)`;
}

function colorDeptoBase(nodo) {
  if (!nodo || !nodo.ubicacion) return "#888";
  const depto = nodo.ubicacion.departamento;
  let hue = _deptoHueMap[depto];
  if (hue === undefined) {
    hue = _siguienteHue();
    _deptoHueMap[depto] = hue;
  }
  return `hsl(${hue}, 70%, 45%)`;
}

function liberarColoresNoUsados(seleccionados) {
  const deptosEnUso = new Set(
    (seleccionados || []).map(s => s.nodo?.ubicacion?.departamento).filter(Boolean)
  );
  for (const d of Object.keys(_deptoHueMap)) {
    if (!deptosEnUso.has(d)) {
      delete _deptoHueMap[d];
      delete _DEPTO_INDICES[d];
    }
  }
}

const PALETTE = [
  "#4A7FA5", "#C0693A", "#5A9E7A", "#8A6FAE",
  "#A08030", "#5B8FA8", "#B05070", "#6A8E5A"
];