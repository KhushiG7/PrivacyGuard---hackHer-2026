(() => {
  const API_KEY = "AIzaSyCLsJuuBpzGYIV0BcH-CElFoe67WmAXn9g";
  const keyPreview = document.getElementById("api-key-preview");
  if (keyPreview) {
    keyPreview.textContent = `Gemini API key (hardcoded): ${API_KEY}`;
  }
})();
