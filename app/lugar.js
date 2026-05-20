

function renderLugar(contenedor, seleccionados) {
  if (seleccionados.length === 0) {
    contenedor.innerHTML = `<div class="hint">Selecciona nodos en el mapa para visualizar</div>`;
    return;
  }

  const anchoTotal = Math.max(contenedor.offsetWidth - 10, 400);
  const anchoCol   = Math.max(80, Math.floor((anchoTotal - 60) / seleccionados.length));
  const alturaFila = 32;
  const marginL    = 40;
  const marginT    = 50;

  const tiposHito = [...new Set(
    seleccionados.flatMap(s =>
      s.nodo.hitos.map(h => h.label.split("—")[1]?.trim() || h.label)
    )
  )];

  const alturaTotal = marginT + tiposHito.length * alturaFila + 30;

  const svg = d3.create("svg")
    .attr("width",  anchoTotal)
    .attr("height", alturaTotal)
    .style("font-family", "system-ui, sans-serif")
    .style("display", "block");

  seleccionados.forEach(({ nodo, color }, ci) => {
    const xCentro = marginL + ci * anchoCol + anchoCol / 2;

    svg.append("text")
      .attr("x", xCentro).attr("y", marginT - 20)
      .attr("text-anchor", "middle")
      .attr("font-size", 10).attr("font-weight", "500").attr("fill", color)
      .text(nodo.label.valor.replace("ODPE ", ""));

    svg.append("text")
      .attr("x", xCentro).attr("y", marginT - 8)
      .attr("text-anchor", "middle")
      .attr("font-size", 9).attr("fill", "#bbb")
      .text(nodo.ubicacion.ciudad);

    svg.append("line")
      .attr("x1", xCentro).attr("x2", xCentro)
      .attr("y1", marginT).attr("y2", alturaTotal - 20)
      .attr("stroke", "#f0f0f0").attr("stroke-width", 1);

    nodo.hitos.forEach(h => {
      const tipo     = h.label.split("—")[1]?.trim() || h.label;
      const filaIdx  = tiposHito.indexOf(tipo);
      const yCentro  = marginT + filaIdx * alturaFila + alturaFila / 2;

      svg.append("circle")
        .attr("cx", xCentro).attr("cy", yCentro)
        .attr("r", 8)
        .attr("fill", color).attr("fill-opacity", 0.85)
        .attr("stroke", "white").attr("stroke-width", 1.5);

      svg.append("text")
        .attr("x", xCentro).attr("y", yCentro + 4)
        .attr("text-anchor", "middle")
        .attr("font-size", 9).attr("font-weight", "500").attr("fill", "white")
        .text(h.fecha.valor.slice(5)); 
    });
  });

  tiposHito.forEach((tipo, ri) => {
    const yCentro = marginT + ri * alturaFila + alturaFila / 2;

    svg.append("text")
      .attr("x", marginL - 6).attr("y", yCentro + 4)
      .attr("text-anchor", "end")
      .attr("font-size", 10).attr("fill", "#999")
      .text(tipo);

    svg.append("line")
      .attr("x1", marginL)
      .attr("x2", marginL + seleccionados.length * anchoCol)
      .attr("y1", yCentro).attr("y2", yCentro)
      .attr("stroke", "#f5f5f0").attr("stroke-width", 1);
  });

  contenedor.innerHTML = "";
  contenedor.appendChild(svg.node());
}
