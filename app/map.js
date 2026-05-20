

let _map          = null;
let _allMarkers     = [];
let _herramienta    = "click";
let _gruposDepto    = {};   
let _zoomDesagregar = 7;    
let _lassoPoints  = [];
let _lassoDrawing = false;
let _rectStart    = null;
let _rectDrawing  = false;
let _onSeleccion  = null;

function initMap(nodos, onSeleccionCambia, vocabulario) {
  console.log("[MAP] v3 — clusters sin números, radio 8");
  const _momLabel = (vocabulario?.momento || "momento").toLowerCase();
  _onSeleccion = onSeleccionCambia;
  _allMarkers  = [];
  if (_map) { _map.remove(); _map = null; }

  _map = L.map("map", {
    center:          [-9, -75],
    zoom:            5,
    doubleClickZoom: false,
    zoomControl:     false
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 18
  }).addTo(_map);

  window._colorBase = _colorBase;

  const _capaDepto      = L.layerGroup();
  const _capaIndividual = L.layerGroup();

  nodos.forEach((nodo, i) => {
    const momentos = nodo.momentos || nodo.hitos || [];
    const n        = momentos.length;
    const marker = L.circleMarker(
      [nodo.ubicacion.lat, nodo.ubicacion.lng],
      { radius: _radio(n), fillColor: "#3c3c3c74", fillOpacity: 0.70,
        color: "white", weight: 2, text: n }
    );
    marker.bindTooltip(
      `<strong>${nodo.label.valor}</strong><br>${nodo.ubicacion.ciudad}, ${nodo.ubicacion.departamento}<br>${n} ${_momLabel}${n !== 1 ? "s" : ""}`,
      { sticky: true }
    );
    marker.on("click", () => {
      if (_herramienta !== "click") return;
      onSeleccionCambia(nodo, i, marker);
    });
    _capaIndividual.addLayer(marker);
    _allMarkers.push({ nodo, marker, index: i });
  });

  function _agruparPor(claveFn, nombreFn) {
    const grupos = {};
    nodos.forEach((nodo, idx) => {
      const k = claveFn(nodo) || "—";
      if (!grupos[k]) grupos[k] = { nodos: [], lats: [], lngs: [], nombre: nombreFn(nodo, k) };
      grupos[k].nodos.push({ nodo, idx });
      grupos[k].lats.push(nodo.ubicacion.lat);
      grupos[k].lngs.push(nodo.ubicacion.lng);
    });
    return grupos;
  }

  const gruposDepto = _agruparPor(
    n => n.ubicacion?.departamento,
    (n, k) => k
  );
  _gruposDepto = gruposDepto;

  const _clustersPorDepto = {};

  function _construirCluster(grupos, capa) {
    capa.clearLayers();
    const totales = Object.values(grupos).map(g => g.nodos.length);
    const maxT    = Math.max(...totales, 1);

    Object.entries(grupos).forEach(([clave, g]) => {
      const lat = g.lats.reduce((a,b)=>a+b,0) / g.lats.length;
      const lng = g.lngs.reduce((a,b)=>a+b,0) / g.lngs.length;
      const n   = g.nodos.length;

      const t       = (n - 1) / Math.max(maxT - 1, 1);
      const tono    = Math.round(170 - t * 110);
      const tonoHex = tono.toString(16).padStart(2, "0");
      const colorGris = "#" + tonoHex + tonoHex + tonoHex;

      const radio = 8;

      const cluster = L.circleMarker([lat, lng], {
        radius:      radio,
        fillColor:   colorGris,
        fillOpacity: 0.85,
        color:       "white",
        weight:      1.5
      });

      cluster._depto       = clave;
      cluster._grupoNodos  = g.nodos;
      cluster._colorBase   = colorGris;
      _clustersPorDepto[clave] = cluster;

      cluster.bindTooltip(
        `<strong>${g.nombre}</strong><br>${n} ODPE${n !== 1 ? "s" : ""}`,
        { sticky: true, direction: "top", offset: [0, -radio] }
      );

      cluster.on("click", () => {
        const todosSel = g.nodos.every(({ nodo }) =>
          window._estaSeleccionado && window._estaSeleccionado(nodo.id)
        );
        g.nodos.forEach(({ nodo, idx }) => {
          const m = _allMarkers[idx]?.marker;
          if (!m || !_onSeleccion) return;
          if (todosSel) _onSeleccion(nodo, idx, m, false);
          else          _onSeleccion(nodo, idx, m, true);
        });
      });

      cluster.on("dblclick", (e) => {
        L.DomEvent.stopPropagation(e);
        const bounds = L.latLngBounds(g.lats.map((la, k) => [la, g.lngs[k]]));
        _map.fitBounds(bounds.pad(0.4), { maxZoom: 9 });
      });

      capa.addLayer(cluster);
    });
  }

  _construirCluster(gruposDepto, _capaDepto);

  window._actualizarClustersMapa = () => {
    Object.values(_clustersPorDepto).forEach(cluster => {
      const nodosSel = cluster._grupoNodos.filter(({ nodo }) =>
        window._estaSeleccionado && window._estaSeleccionado(nodo.id)
      );
      const total       = cluster._grupoNodos.length;
      const nSel        = nodosSel.length;

      if (nSel === 0) {
        
        cluster.setStyle({
          fillColor: cluster._colorBase, fillOpacity: 0.85,
          color: "white", weight: 1.5
        });
      } else {
        
        const colorDepto = colorDeptoBase(nodosSel[0].nodo);
        const opacidad   = (nSel === total) ? 0.95 : 0.55;
        cluster.setStyle({
          fillColor: colorDepto, fillOpacity: opacidad,
          color: "white", weight: 2
        });
      }
    });
  };

  const ZOOM_DESAGREGAR = 7;

  const _quitarTodas = () => {
    [_capaDepto, _capaIndividual].forEach(c => {
      if (_map.hasLayer(c)) _map.removeLayer(c);
    });
  };

  const _actualizarVista = () => {
    const z = _map.getZoom();
    _quitarTodas();
    if (z < ZOOM_DESAGREGAR) _capaDepto.addTo(_map);
    else                     _capaIndividual.addTo(_map);
  };

  _map.on("zoomend", _actualizarVista);

  if (nodos.length > 0) {
    const bounds = L.latLngBounds(nodos.map(n => [n.ubicacion.lat, n.ubicacion.lng]));
    _map.fitBounds(bounds.pad(0.2), { maxZoom: 8 });
  }

  _actualizarVista();
  _initCanvas();

  document.querySelectorAll(".map-tool").forEach(btn => {
    btn.addEventListener("click", () => _activarHerramienta(btn.dataset.tool));
  });

  _activarHerramienta("click");
}

function _activarHerramienta(nombre) {
  if (!_map) return;

  if (nombre === "select-all")  { _seleccionarTodos();    return; }
  if (nombre === "deselect")    { _deseleccionarTodos();  return; }
  if (nombre === "zoom-in")     { _map.zoomIn();          return; }
  if (nombre === "zoom-out")    { _map.zoomOut();         return; }
  if (nombre === "reset-view")  {
    if (_allMarkers && _allMarkers.length) {
      const bnds = L.latLngBounds(_allMarkers.map(m => [m.nodo.ubicacion.lat, m.nodo.ubicacion.lng]));
      _map.fitBounds(bnds.pad(0.2), { maxZoom: 8 });
    }
    return;
  }

  _herramienta = nombre;

  document.querySelectorAll(".map-tool").forEach(btn => {
    if (["click","lasso","rect"].includes(btn.dataset.tool)) {
      btn.classList.toggle("activo", btn.dataset.tool === nombre);
    }
  });

  if (nombre === "click") {
    _map.dragging.enable();
    _getCanvas().classList.remove("drawing");
  } else {
    _map.dragging.disable();
    _getCanvas().classList.add("drawing");
  }
}

window._getMarker = (nodoId) => {
  const found = _allMarkers.find(m => m.nodo.id === nodoId);
  return found ? found.marker : null;
};

function marcarSeleccionado(marker, color) {
  marker.setStyle({ color, weight: 3, fillColor: color });
}

function marcarDeseleccionado(marker) {
  marker.setStyle({ color: "white", weight: 2, fillColor: "#3c3c3c74" });
}

function _initCanvas() {
  const canvas = _getCanvas();
  const ctx    = canvas.getContext("2d");

  function resize() {
    const r = document.getElementById("map-container").getBoundingClientRect();
    canvas.width  = r.width;
    canvas.height = r.height;
  }
  resize();
  window.addEventListener("resize", resize);

  canvas.addEventListener("mousedown", e => {
    if (_herramienta !== "lasso" && _herramienta !== "rect") return;
    const r  = canvas.getBoundingClientRect();
    const pt = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (_herramienta === "lasso") { _lassoDrawing = true; _lassoPoints = [pt]; }
    else                          { _rectDrawing  = true; _rectStart   = pt;  }
  });

  canvas.addEventListener("mousemove", e => {
    if (!_lassoDrawing && !_rectDrawing) return;
    const r  = canvas.getBoundingClientRect();
    const pt = { x: e.clientX - r.left, y: e.clientY - r.top };
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (_herramienta === "lasso" && _lassoDrawing) {
      _lassoPoints.push(pt); _dibujarLasso(ctx);
    } else if (_herramienta === "rect" && _rectDrawing) {
      _dibujarRect(ctx, _rectStart, pt);
    }
  });

  canvas.addEventListener("mouseup", e => {
    const r  = canvas.getBoundingClientRect();
    const pt = { x: e.clientX - r.left, y: e.clientY - r.top };
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (_herramienta === "lasso" && _lassoDrawing) {
      _lassoDrawing = false;
      if (_lassoPoints.length >= 3) _aplicarLasso(_lassoPoints);
      _lassoPoints = [];
    } else if (_herramienta === "rect" && _rectDrawing) {
      _rectDrawing = false;
      _aplicarRect(_rectStart, pt);
      _rectStart = null;
    }
    _activarHerramienta("click");
  });
}

function _getCanvas() { return document.getElementById("lasso-canvas"); }

function _dibujarLasso(ctx) {
  ctx.beginPath();
  ctx.strokeStyle = "#185FA5"; ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]); ctx.fillStyle = "rgba(24,95,165,0.08)";
  _lassoPoints.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.closePath(); ctx.stroke(); ctx.fill();
}

function _dibujarRect(ctx, inicio, fin) {
  const x = Math.min(inicio.x, fin.x), y = Math.min(inicio.y, fin.y);
  const w = Math.abs(fin.x - inicio.x), h = Math.abs(fin.y - inicio.y);
  ctx.beginPath();
  ctx.strokeStyle = "#185FA5"; ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]); ctx.fillStyle = "rgba(24,95,165,0.08)";
  ctx.strokeRect(x, y, w, h); ctx.fillRect(x, y, w, h);
}

function _aplicarLasso(puntos) {
  const enVistaCluster = _map.getZoom() < _zoomDesagregar;

  if (enVistaCluster) {
    
    Object.values(_gruposDepto).forEach(g => {
      const lat = g.lats.reduce((a,b)=>a+b,0) / g.lats.length;
      const lng = g.lngs.reduce((a,b)=>a+b,0) / g.lngs.length;
      const pt  = _map.latLngToContainerPoint(L.latLng(lat, lng));
      if (_puntoEnPoligono({ x: pt.x, y: pt.y }, puntos)) {
        
        g.nodos.forEach(({ nodo, idx }) => {
          const m = _allMarkers[idx]?.marker;
          if (m && _onSeleccion) _onSeleccion(nodo, idx, m, true);
        });
      }
    });
  } else {
    _allMarkers.forEach(({ nodo, marker, index }) => {
      const pt = _map.latLngToContainerPoint(marker.getLatLng());
      if (_puntoEnPoligono({ x: pt.x, y: pt.y }, puntos))
        if (_onSeleccion) _onSeleccion(nodo, index, marker, true);
    });
  }
}

function _aplicarRect(inicio, fin) {
  const xMin = Math.min(inicio.x, fin.x), xMax = Math.max(inicio.x, fin.x);
  const yMin = Math.min(inicio.y, fin.y), yMax = Math.max(inicio.y, fin.y);
  const enVistaCluster = _map.getZoom() < _zoomDesagregar;

  if (enVistaCluster) {
    Object.values(_gruposDepto).forEach(g => {
      const lat = g.lats.reduce((a,b)=>a+b,0) / g.lats.length;
      const lng = g.lngs.reduce((a,b)=>a+b,0) / g.lngs.length;
      const pt  = _map.latLngToContainerPoint(L.latLng(lat, lng));
      if (pt.x >= xMin && pt.x <= xMax && pt.y >= yMin && pt.y <= yMax) {
        g.nodos.forEach(({ nodo, idx }) => {
          const m = _allMarkers[idx]?.marker;
          if (m && _onSeleccion) _onSeleccion(nodo, idx, m, true);
        });
      }
    });
  } else {
    _allMarkers.forEach(({ nodo, marker, index }) => {
      const pt = _map.latLngToContainerPoint(marker.getLatLng());
      if (pt.x >= xMin && pt.x <= xMax && pt.y >= yMin && pt.y <= yMax)
        if (_onSeleccion) _onSeleccion(nodo, index, marker, true);
    });
  }
}

function _seleccionarTodos() {
  _allMarkers.forEach(({ nodo, marker, index }) => {
    if (_onSeleccion) _onSeleccion(nodo, index, marker, true);
  });
}

function _deseleccionarTodos() {
  _allMarkers.forEach(({ nodo, marker }) => marcarDeseleccionado(marker));
  if (window._limpiarSeleccion) window._limpiarSeleccion();
}

function _radio(nMomentos) {
  return 8 + nMomentos * 0.8;
}

function _colorBase() { return "#378ADD"; }

function _puntoEnPoligono(punto, poligono) {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const xi = poligono[i].x, yi = poligono[i].y;
    const xj = poligono[j].x, yj = poligono[j].y;
    if (((yi > punto.y) !== (yj > punto.y)) &&
        punto.x < (xj - xi) * (punto.y - yi) / (yj - yi) + xi)
      dentro = !dentro;
  }
  return dentro;
}

window.toggleLasso = () => _activarHerramienta("lasso");