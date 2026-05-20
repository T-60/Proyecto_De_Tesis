

window.abrirPDF = (docNombre, pagina, coords, seccion) => {
  if (!docNombre) return;

  const nombreArchivo = docNombre.replace(/\
  const urlPDF = `../data/raw/${nombreArchivo}`;

  _mostrarModal(urlPDF, pagina, coords, seccion, docNombre);
};

function _mostrarModal(urlPDF, pagina, coords, seccion, docNombre) {
  
  const anterior = document.getElementById("pdf-modal");
  if (anterior) anterior.remove();

  const modal = document.createElement("div");
  modal.id = "pdf-modal";
  modal.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.55);
    z-index: 9000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  `;

  modal.addEventListener("click", e => {
    if (e.target === modal) modal.remove();
  });

  const box = document.createElement("div");
  box.style.cssText = `
    background: white;
    border-radius: 10px;
    width: 100%;
    max-width: 780px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: system-ui, sans-serif;
  `;

  const header = document.createElement("div");
  header.style.cssText = `
    padding: 12px 16px;
    border-bottom: 0.5px solid #e0e0d8;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-shrink: 0;
  `;
  header.innerHTML = `
    <div>
      <div style="font-size:13px;font-weight:500;color:#1a1a1a">${docNombre}</div>
      <div style="font-size:11px;color:#999;margin-top:2px">
        Pagina ${pagina}${seccion ? " · " + seccion : ""}
      </div>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <button onclick="document.getElementById('pdf-modal').remove()"
        style="font-size:11px;padding:4px 10px;border-radius:6px;
          border:0.5px solid #ddd;background:white;cursor:pointer;color:#555">
        Cerrar
      </button>
    </div>`;

  const nav = document.createElement("div");
  nav.style.cssText = `
    padding: 6px 16px;
    border-bottom: 0.5px solid #f0f0f0;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    font-size: 11px;
    color: #888;
  `;
  nav.innerHTML = `
    <button id="pdf-prev" onclick="cambiarPaginaPDF(-1)"
      style="padding:2px 8px;border-radius:4px;border:0.5px solid #ddd;
        background:white;cursor:pointer;font-size:11px">
      Anterior
    </button>
    <span id="pdf-info">Pagina ${pagina}</span>
    <button id="pdf-next" onclick="cambiarPaginaPDF(1)"
      style="padding:2px 8px;border-radius:4px;border:0.5px solid #ddd;
        background:white;cursor:pointer;font-size:11px">
      Siguiente
    </button>
    <span style="margin-left:auto;font-size:10px;color:#bbb">
      Rectangulo amarillo = texto fuente del dato
    </span>`;

  const canvasWrapper = document.createElement("div");
  canvasWrapper.style.cssText = `
    flex: 1;
    overflow: auto;
    padding: 16px;
    background: #f5f5f0;
    display: flex;
    justify-content: center;
    position: relative;
  `;

  const canvas = document.createElement("canvas");
  canvas.id = "pdf-canvas";
  canvas.style.cssText = `
    box-shadow: 0 2px 12px rgba(0,0,0,0.15);
    border-radius: 4px;
    max-width: 100%;
  `;

  canvasWrapper.appendChild(canvas);
  box.appendChild(header);
  box.appendChild(nav);
  box.appendChild(canvasWrapper);
  modal.appendChild(box);
  document.body.appendChild(modal);

  _cargarPDF(urlPDF, pagina, coords);
}

let _pdfDoc      = null;
let _paginaActual = 1;
let _coordsActuales = null;

function _cargarPDF(url, pagina, coords) {
  _coordsActuales = coords;
  _paginaActual   = pagina;

  if (typeof pdfjsLib === "undefined") {
    _mostrarError("PDF.js no esta cargado. Verificar la conexion a internet.");
    return;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const canvas = document.getElementById("pdf-canvas");
  if (!canvas) return;

  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);

  pdfjsLib.getDocument(url).promise
    .then(doc => {
      _pdfDoc = doc;
      document.getElementById("pdf-info").textContent =
        `Pagina ${_paginaActual} de ${doc.numPages}`;
      _renderizarPagina(_paginaActual);
    })
    .catch(err => {
      console.error("Error cargando PDF:", err);
      _mostrarError(
        `No se pudo cargar el PDF.<br>` +
        `Verificar que el archivo existe en <code>data/raw/</code><br>` +
        `y que el servidor esta corriendo desde la raiz del proyecto.<br><br>` +
        `<span style="color:#aaa;font-size:10px">Error: ${err.message}</span>`
      );
    });
}

function _renderizarPagina(numPagina) {
  if (!_pdfDoc) return;

  _pdfDoc.getPage(numPagina).then(pagina => {
    const canvas  = document.getElementById("pdf-canvas");
    if (!canvas) return;

    const ctx     = canvas.getContext("2d");
    
    const escala  = Math.min(2, 700 / pagina.getViewport({ scale: 1 }).width);
    const viewport = pagina.getViewport({ scale: escala });

    canvas.width  = viewport.width;
    canvas.height = viewport.height;

    const renderCtx = { canvasContext: ctx, viewport };

    pagina.render(renderCtx).promise.then(() => {
      
      if (_coordsActuales && numPagina === _paginaActual) {
        _dibujarHighlight(ctx, viewport, _coordsActuales, escala);
      }

      const info = document.getElementById("pdf-info");
      if (info) info.textContent = `Pagina ${numPagina} de ${_pdfDoc.numPages}`;
    });
  });
}

function _dibujarHighlight(ctx, viewport, coords, escala) {
  if (!coords) return;

  const alturaTotal = viewport.height;
  const x  = coords.x1 * escala;
  const y  = alturaTotal - coords.y2 * escala;  
  const w  = (coords.x2 - coords.x1) * escala;
  const h  = (coords.y2 - coords.y1) * escala;

  ctx.save();
  ctx.fillStyle   = "rgba(255, 220, 0, 0.3)";
  ctx.strokeStyle = "rgba(200, 160, 0, 0.8)";
  ctx.lineWidth   = 1.5;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function _mostrarError(mensaje) {
  const canvas = document.getElementById("pdf-canvas");
  if (!canvas) return;
  const wrapper = canvas.parentElement;
  canvas.remove();
  const div = document.createElement("div");
  div.style.cssText = `
    padding: 20px; font-size: 12px; color: #A32D2D;
    background: #FCEBEB; border-radius: 8px; line-height: 1.6;
  `;
  div.innerHTML = mensaje;
  wrapper.appendChild(div);
}

window.cambiarPaginaPDF = (delta) => {
  if (!_pdfDoc) return;
  const nueva = _paginaActual + delta;
  if (nueva < 1 || nueva > _pdfDoc.numPages) return;
  _paginaActual = nueva;

  _renderizarPagina(_paginaActual);
};
