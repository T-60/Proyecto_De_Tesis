

function initSliderDual(containerId, onChange, labelMin = "", labelMax = "") {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="sd-wrap">
      <span class="sd-label sd-label-min" id="${containerId}-lmin">${labelMin}</span>
      <div class="sd-track-wrap">
        <div class="sd-track-fill" id="${containerId}-fill"></div>
        <input type="range" class="sd-input sd-input-min"
          id="${containerId}-min" min="0" max="100" value="0" step="1">
        <input type="range" class="sd-input sd-input-max"
          id="${containerId}-max" min="0" max="100" value="100" step="1">
      </div>
      <span class="sd-label sd-label-max" id="${containerId}-lmax">${labelMax}</span>
    </div>
  `;

  const inputMin  = document.getElementById(`${containerId}-min`);
  const inputMax  = document.getElementById(`${containerId}-max`);
  const fill      = document.getElementById(`${containerId}-fill`);
  const labelMinEl= document.getElementById(`${containerId}-lmin`);
  const labelMaxEl= document.getElementById(`${containerId}-lmax`);

  function actualizarFill() {
    const min = parseInt(inputMin.value);
    const max = parseInt(inputMax.value);
    
    fill.style.left  = min + "%";
    fill.style.width = (max - min) + "%";
  }

  function onInput() {
    let min = parseInt(inputMin.value);
    let max = parseInt(inputMax.value);

    if (min >= max) {
      if (this === inputMin) inputMin.value = max - 1;
      else                   inputMax.value = min + 1;
      min = parseInt(inputMin.value);
      max = parseInt(inputMax.value);
    }

    actualizarFill();
    onChange([min, max]);
  }

  inputMin.addEventListener("input", onInput);
  inputMax.addEventListener("input", onInput);

  actualizarFill();

  container._setLabels = (lmin, lmax) => {
    if (labelMinEl) labelMinEl.textContent = lmin;
    if (labelMaxEl) labelMaxEl.textContent = lmax;
  };

  container._getValues = () => [
    parseInt(inputMin.value),
    parseInt(inputMax.value)
  ];
}