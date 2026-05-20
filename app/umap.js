
let _umapNodos         = [];
let _umapPuntos        = [];
let _umapSvg           = null;
let _umapCanvas        = null;
let _umapHerramienta   = "click";
let _umapSeleccionados = new Set();
let _umapXS            = null;
let _umapYS            = null;
let _umapM             = { top:10, right:10, bottom:20, left:42 };
let _umapZoomBehavior  = null;

function initUMAP(nodos) {
  _umapNodos  = nodos || [];
  _umapPuntos = _generarPuntosPCA(_umapNodos);
  requestAnimationFrame(() => _dibujarUMAP());
}

function updateUMAPSelection(seleccionados) {
  _umapSeleccionados = new Set((seleccionados || []).map(s => s.nodo.id));
  _actualizarResaltado();
}

function _pca2d(embeddings) {
  const n = embeddings.length;
  if (n === 0) return [];
  const d = embeddings[0].length;

  const mean = new Array(d).fill(0);
  embeddings.forEach(e => e.forEach((v, i) => mean[i] += v));
  for (let i = 0; i < d; i++) mean[i] /= n;

  const X = embeddings.map(e => e.map((v, i) => v - mean[i]));

  const cov = Array.from({length: d}, () => new Array(d).fill(0));
  X.forEach(e => {
    for (let i = 0; i < d; i++)
      for (let j = 0; j < d; j++)
        cov[i][j] += e[i] * e[j];
  });
  for (let i = 0; i < d; i++)
    for (let j = 0; j < d; j++)
      cov[i][j] /= Math.max(n - 1, 1);

  const _norm = v => Math.sqrt(v.reduce((s,x) => s+x*x, 0)) || 1;
  const _matVec = (M, v) => {
    const r = new Array(M.length).fill(0);
    for (let i = 0; i < M.length; i++)
      for (let j = 0; j < v.length; j++)
        r[i] += M[i][j] * v[j];
    return r;
  };

  let v1 = new Array(d).fill(0).map((_, i) => i === 0 ? 1 : 0.01 * Math.random());
  for (let it = 0; it < 80; it++) {
    const nx = _matVec(cov, v1);
    const nm = _norm(nx);
    v1 = nx.map(x => x / nm);
  }

  let lambda1 = 0;
  const cv1 = _matVec(cov, v1);
  for (let i = 0; i < d; i++) lambda1 += v1[i] * cv1[i];
  const cov2 = cov.map((row, i) => row.map((v, j) => v - lambda1 * v1[i] * v1[j]));

  let v2 = new Array(d).fill(0).map((_, i) => i === 1 ? 1 : 0.01 * Math.random());
  for (let it = 0; it < 80; it++) {
    let nx = _matVec(cov2, v2);
    
    let dot = 0;
    for (let i = 0; i < d; i++) dot += nx[i] * v1[i];
    for (let i = 0; i < d; i++) nx[i] -= dot * v1[i];
    const nm = _norm(nx);
    v2 = nx.map(x => x / nm);
  }

  const proj = X.map(e => {
    let p1 = 0, p2 = 0;
    for (let i = 0; i < d; i++) { p1 += e[i] * v1[i]; p2 += e[i] * v2[i]; }
    return [p1, p2];
  });

  const p0 = proj.map(p => p[0]), p1 = proj.map(p => p[1]);
  const min0 = Math.min(...p0), max0 = Math.max(...p0);
  const min1 = Math.min(...p1), max1 = Math.max(...p1);
  const pad = 0.06;
  const r0 = max0 - min0 || 1, r1 = max1 - min1 || 1;
  return proj.map(p => ({
    x: pad + (1 - 2*pad) * (p[0] - min0) / r0,
    y: pad + (1 - 2*pad) * (p[1] - min1) / r1,
  }));
}

function _generarPuntosPCA(nodos) {
  
  const conEmb = nodos.filter(n => Array.isArray(n.embedding) && n.embedding.length > 0);
  if (conEmb.length === nodos.length && nodos.length > 0) {
    const coords = _pca2d(nodos.map(n => n.embedding));
    return nodos.map((nodo, i) => ({
      x: coords[i].x, y: coords[i].y,
      nodo, color: colorPorNodo(nodo, i), index: i
    }));
  }
  
  return nodos.map((nodo, i) => ({
    x: 0.1 + 0.8 * ((i * 0.137) % 1),
    y: 0.1 + 0.8 * ((i * 0.281) % 1),
    nodo, color: colorPorNodo(nodo, i), index: i
  }));
}

function _dibujarUMAP() {
  const contenedor = document.getElementById("umap-container");
  if (!contenedor) return;
  contenedor.innerHTML = "";
  contenedor.style.position = "relative";

  const W = contenedor.offsetWidth  || 280;
  const H = contenedor.offsetHeight || 180;

  if (W < 10 || H < 10) {
    requestAnimationFrame(() => _dibujarUMAP());
    return;
  }

  const M  = _umapM;
  const iW = W - M.left - M.right;
  const iH = H - M.top  - M.bottom;

  _umapXS = d3.scaleLinear([0,1], [0,iW]);
  _umapYS = d3.scaleLinear([0,1], [iH,0]);

  const svg = d3.select(contenedor)
    .append("svg").attr("width", W).attr("height", H)
    .style("display","block").style("position","absolute")
    .style("top","0").style("left","0").style("z-index","1");
  _umapSvg = svg;

  const g = svg.append("g")
    .attr("class","umap-zoom-g")
    .attr("transform", "translate("+M.left+","+M.top+")");

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = "position:absolute;top:0;left:0;z-index:2;pointer-events:none;cursor:crosshair;display:none;";
  contenedor.appendChild(canvas);
  _umapCanvas = canvas;

  const tip = document.createElement("div");
  tip.style.cssText = "position:absolute;display:none;pointer-events:none;background:white;border:0.5px solid #e0e0d8;padding:5px 10px;font-size:10px;line-height:1.5;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.08);z-index:20;";
  contenedor.appendChild(tip);

  const puntoG = g.selectAll(".umap-pg")
    .data(_umapPuntos).join("g")
    .attr("class", d => "umap-pg umap-pg-"+d.nodo.id)
    .attr("transform", d => "translate("+_umapXS(d.x)+","+_umapYS(d.y)+")")
    .style("cursor","pointer");

  puntoG.append("circle").attr("class","umap-halo")
    .attr("r",0).attr("fill-opacity",0.18).attr("stroke","none");

  puntoG.append("circle").attr("class","umap-circulo")
    .attr("r",4.5).attr("fill","#bbb").attr("stroke","white").attr("stroke-width",1);

  _umapZoomBehavior = d3.zoom()
    .scaleExtent([0.5, 12])
    .filter(event => {
      if (_umapHerramienta !== "click") return false;
      if (event.type === "wheel") return true;
      return !event.target.closest(".umap-pg");
    })
    .on("start", () => svg.style("cursor","grabbing"))
    .on("end",   () => svg.style("cursor","grab"))
    .on("zoom", (event) => {
      const t = event.transform;
      puntoG.attr("transform", d =>
        "translate(" + (M.left + t.x + t.k * _umapXS(d.x)) + "," + (M.top + t.y + t.k * _umapYS(d.y)) + ")"
      );
      
      g.attr("transform", "translate(0,0)");
    });

  svg.call(_umapZoomBehavior).style("cursor","grab");
  svg.on("dblclick.zoom", null);

  puntoG
    .on("click", function(event,d) {
      if (_umapHerramienta !== "click") return;
      event.stopPropagation();
      if (window.onUMAPClick) window.onUMAPClick(d.nodo, d.index);
    })
    .on("mouseenter", function(event,d) {
      if (_umapHerramienta !== "click") return;
      const sel = _umapSeleccionados.has(d.nodo.id);
      const colorDin = sel ? colorPorNodo(d.nodo, d.index) : "#222";
      d3.select(this).select(".umap-circulo").attr("r",7);
      d3.select(this).select(".umap-halo").attr("r",12).attr("fill", sel ? colorDin : "rgba(0,0,0,0.08)");
      const r = contenedor.getBoundingClientRect();
      const n = (d.nodo.momentos || d.nodo.hitos || []).length;
      tip.style.display = "block";
      tip.style.left = (event.clientX - r.left + 14) + "px";
      tip.style.top  = (event.clientY - r.top - 12) + "px";
      tip.innerHTML  = "<b style='color:" + colorDin + "'>" + (d.nodo.label?.valor || d.nodo.id) + "</b><br>" +
        "<span style='color:#aaa'>" + (d.nodo.ubicacion?.departamento || "") +
        " &middot; " + n + " hito" + (n !== 1 ? "s" : "") + "</span>";
    })
    .on("mousemove", function(event) {
      const r = contenedor.getBoundingClientRect();
      tip.style.left = (event.clientX - r.left + 14) + "px";
      tip.style.top  = (event.clientY - r.top - 12) + "px";
    })
    .on("mouseleave", function(event,d) {
      d3.select(this).select(".umap-circulo").attr("r",4.5);
      if (!_umapSeleccionados.has(d.nodo.id)) d3.select(this).select(".umap-halo").attr("r",0);
      tip.style.display = "none";
    });

  svg.append("text").attr("x", W - 6).attr("y", H - 4)
    .attr("text-anchor","end").attr("font-size",8).attr("fill","#ccc")
    .attr("font-family","system-ui,sans-serif").text("UMAP · embedding semántico");

  _actualizarResaltado();
  _initCanvasInteraccion(contenedor);

  document.querySelectorAll(".umap-tool").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation(); e.preventDefault();
      _activarHerramientaUMAP(btn.dataset.utool);
    };
  });
  _activarHerramientaUMAP("click");
}

function _activarHerramientaUMAP(nombre) {
  if (nombre === "select-all") { _umapSeleccionarTodos(); return; }
  if (nombre === "deselect")   { if (window._limpiarSeleccion) window._limpiarSeleccion(); return; }
  if (nombre === "zoom-in")    { _zoomBy(1.4); return; }
  if (nombre === "zoom-out")   { _zoomBy(1/1.4); return; }
  if (nombre === "reset-view") { _resetZoom(); return; }

  _umapHerramienta = nombre;
  document.querySelectorAll(".umap-tool").forEach(btn => {
    if (["click","lasso","rect"].includes(btn.dataset.utool)) {
      btn.classList.toggle("activo", btn.dataset.utool === nombre);
    }
  });

  if (_umapCanvas) {
    const dibujar = (nombre !== "click");
    _umapCanvas.style.display       = dibujar ? "block" : "none";
    _umapCanvas.style.pointerEvents = dibujar ? "all" : "none";
  }
}

function _zoomBy(factor) {
  if (!_umapSvg || !_umapZoomBehavior) return;
  _umapSvg.transition().duration(220).call(_umapZoomBehavior.scaleBy, factor);
}

function _resetZoom() {
  if (!_umapSvg || !_umapZoomBehavior) return;
  _umapSvg.transition().duration(300).call(_umapZoomBehavior.transform, d3.zoomIdentity);
}

function _initCanvasInteraccion(contenedor) {
  const canvas  = _umapCanvas;
  const ctx     = canvas.getContext("2d");
  let drag      = false;
  let inicio    = null;
  let lassoPath = [];

  canvas.addEventListener("mousedown", e => {
    drag = true; inicio = _evPx(canvas, e); lassoPath = [inicio];
  });

  canvas.addEventListener("mousemove", e => {
    if (!drag) return;
    const pos = _evPx(canvas, e);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 1;
    ctx.setLineDash([4,3]); ctx.fillStyle = "rgba(26,26,26,0.05)";

    if (_umapHerramienta === "lasso") {
      lassoPath.push(pos);
      ctx.beginPath(); ctx.moveTo(lassoPath[0].x, lassoPath[0].y);
      lassoPath.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (_umapHerramienta === "rect" && inicio) {
      const x = Math.min(inicio.x, pos.x), y = Math.min(inicio.y, pos.y);
      ctx.beginPath();
      ctx.rect(x, y, Math.abs(pos.x-inicio.x), Math.abs(pos.y-inicio.y));
      ctx.fill(); ctx.stroke();
    }
  });

  const finDrag = e => {
    if (!drag) return;
    drag = false;
    const fin = _evPx(canvas, e);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if (_umapHerramienta === "lasso" && lassoPath.length > 2) _aplicarLasso(lassoPath);
    else if (_umapHerramienta === "rect" && inicio)            _aplicarRect(inicio, fin);
    lassoPath = [];
  };
  canvas.addEventListener("mouseup",    finDrag);
  canvas.addEventListener("mouseleave", finDrag);
}

function _evPx(canvas, e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function _pxDePunto(p) {
  
  const t = d3.zoomTransform(_umapSvg.node());
  return {
    x: _umapM.left + t.x + t.k * _umapXS(p.x),
    y: _umapM.top  + t.y + t.k * _umapYS(p.y)
  };
}

function _aplicarLasso(poly) {
  _umapPuntos.forEach(p => {
    if (_ptEnPoly(_pxDePunto(p), poly))
      if (window.onUMAPClick) window.onUMAPClick(p.nodo, p.index, true);
  });
}

function _aplicarRect(ini, fin) {
  const x1 = Math.min(ini.x, fin.x), x2 = Math.max(ini.x, fin.x);
  const y1 = Math.min(ini.y, fin.y), y2 = Math.max(ini.y, fin.y);
  _umapPuntos.forEach(p => {
    const px = _pxDePunto(p);
    if (px.x >= x1 && px.x <= x2 && px.y >= y1 && px.y <= y2)
      if (window.onUMAPClick) window.onUMAPClick(p.nodo, p.index, true);
  });
}

function _ptEnPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length-1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > pt.y) != (yj > pt.y)) && (pt.x < (xj-xi)*(pt.y-yi)/(yj-yi)+xi)) inside = !inside;
  }
  return inside;
}

function _umapSeleccionarTodos() {
  _umapPuntos.forEach(p => {
    if (window.onUMAPClick) window.onUMAPClick(p.nodo, p.index, true);
  });
}

function _actualizarResaltado() {
  if (!_umapSvg) return;
  const hay = _umapSeleccionados.size > 0;

  _umapSvg.selectAll(".umap-circulo")
    .attr("fill", d => _umapSeleccionados.has(d.nodo.id) ? colorPorNodo(d.nodo, d.index) : (hay ? "#ddd" : "#bbb"))
    .attr("r",    d => _umapSeleccionados.has(d.nodo.id) ? 6 : 4);

  _umapSvg.selectAll(".umap-halo")
    .attr("r",    d => _umapSeleccionados.has(d.nodo.id) ? 12 : 0)
    .attr("fill", d => _umapSeleccionados.has(d.nodo.id) ? colorPorNodo(d.nodo, d.index) : "transparent");
}

window.umapSelectAll = _umapSeleccionarTodos;