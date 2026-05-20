
function renderInfoProceso(proceso) {
  const panel = document.getElementById("panel-info");
  if (!proceso || !proceso.meta) {
    panel.innerHTML = `<div class="hint">Sin datos del proceso</div>`;
    return;
  }

  const meta = proceso.meta;
  let html = "";

  html += `
    <div class="panel-info-header">
      <div class="info-titulo">${meta.titulo || "Sin título"}</div>
      <button class="panel-info-cerrar"
       onclick="document.getElementById('panel-info').classList.remove('visible'); document.getElementById('btn-info').classList.remove('abierto'); document.getElementById('btn-info').textContent='+';" title="Cerrar">×</button>
    </div>`;

  if (meta.descripcion) {
    html += `<div class="info-desc">${meta.descripcion}</div>`;
  }

  if (meta.marco_normativo && meta.marco_normativo.length > 0) {
    html += `<div class="info-norma-label">Marco normativo</div>`;

    meta.marco_normativo.forEach(norma => {
      const fuente  = norma.fuente;
      const doc     = fuente?.doc    || "";
      const pagina  = fuente?.pagina || 1;
      const citaKey = fuente?._ref;
      const cita    = citaKey ? proceso.citas?.[citaKey] : null;
      const coords  = cita?.coords_pdf || null;
      const seccion = cita?.seccion    || "";

      const iconoPDF = doc ? `
        <span class="info-pdf-link"
          title="${doc} p.${pagina}"
          onclick="abrirPDF('${doc}', ${pagina}, ${coords ? JSON.stringify(coords) : null}, '${seccion}')">
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
            <rect x="2" y="1" width="10" height="12" rx="1.5"
              stroke="currentColor" stroke-width="1.2"/>
            <line x1="4.5" y1="4.5" x2="9.5" y2="4.5" stroke="currentColor" stroke-width="1"/>
            <line x1="4.5" y1="7"   x2="9.5" y2="7"   stroke="currentColor" stroke-width="1"/>
            <line x1="4.5" y1="9.5" x2="7.5" y2="9.5" stroke="currentColor" stroke-width="1"/>
          </svg>
          ${doc.split("/")[0]} p.${pagina}
        </span>` : "";

      html += `
        <div class="info-norma-item">
          <span>· ${norma.valor}</span>
          ${iconoPDF}
        </div>`;
    });
  }

  panel.innerHTML = html;
}