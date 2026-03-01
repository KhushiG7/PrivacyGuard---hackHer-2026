(() => {
  const state = {
    currentAnalysis: null,
    compareAnalysis: null,
    loading: false
  };

  const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
  const panels = {
    analyze: document.getElementById("tab-analyze"),
    compare: document.getElementById("tab-compare"),
    history: document.getElementById("tab-history")
  };

  const analyzeContent = document.getElementById("analyze-content");
  const loadingEl = document.getElementById("loading");
  const statusEl = document.getElementById("global-status");
  const compareCurrent = document.getElementById("compare-current");
  const compareResults = document.getElementById("compare-results");
  const historyList = document.getElementById("history-list");

  init();

  function init() {
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    document.getElementById("run-compare")?.addEventListener("click", runCompare);
    document.getElementById("clear-history")?.addEventListener("click", clearHistory);

    analyzeActiveTab();
    loadHistory();
  }

  function switchTab(tabName) {
    tabButtons.forEach((btn) => {
      const active = btn.dataset.tab === tabName;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
    });

    Object.entries(panels).forEach(([name, panel]) => {
      panel.classList.toggle("active", name === tabName);
    });

    if (tabName === "history") loadHistory();
    if (tabName === "compare") renderCompareCurrent();
  }

  async function analyzeActiveTab() {
    setStatus("");
    setLoading(true);
    try {
      const response = await sendRuntimeMessage({ type: "ANALYZE_ACTIVE" });
      setLoading(false);
      handleAnalysisResponse(response, true);
    } catch {
      setLoading(false);
      renderErrorCard("Could not fetch privacy policy content", "FETCH_POLICY_FAILED");
    }
  }

  function handleAnalysisResponse(response, isCurrentSite) {
    if (!response?.ok) {
      renderErrorCard(mapErrorToText(response?.error || "UNKNOWN"), response?.error || "UNKNOWN");
      return;
    }

    const analysis = response.analysis;
    if (!analysis) {
      renderErrorCard("AI analysis failed - tap to retry", "AI_FAILED");
      return;
    }

    if (isCurrentSite) {
      state.currentAnalysis = analysis;
      renderAnalyze(analysis);
      renderCompareCurrent();
    }

    loadHistory();
  }

  function mapErrorToText(error) {
    if (error === "NO_POLICY") return "No privacy policy found on this page";
    if (error === "FETCH_POLICY_FAILED") return "Could not fetch privacy policy content";
    if (error === "AI_FAILED") return "AI analysis failed - tap to retry";
    if (error === "NO_ACTIVE_HTTP_TAB") return "Open a website tab to analyze.";
    if (error === "INVALID_URL") return "Please enter a valid website URL.";
    return "Click here to set up your API key";
  }

  function renderErrorCard(message, code) {
    const showManual = code === "NO_POLICY";
    const showRetry = code === "AI_FAILED" || code === "FETCH_POLICY_FAILED";
    const showSetup = code !== "NO_POLICY";

    analyzeContent.innerHTML = `
      <div class="card">
        <h3>${escapeHtml(message)}</h3>
        <p class="muted">Try again or analyze a privacy policy URL directly.</p>
        ${showManual ? `
          <div class="manual-input">
            <input id="manual-url" placeholder="Enter privacy policy URL" />
            <button id="manual-analyze" class="primary-btn">Analyze</button>
          </div>
        ` : ""}
        ${showRetry ? `<button id="retry-analyze" class="primary-btn">Retry</button>` : ""}
        ${showSetup ? `<button id="open-options" class="ghost-btn">Click here to set up your API key</button>` : ""}
      </div>
    `;

    document.getElementById("retry-analyze")?.addEventListener("click", analyzeActiveTab);
    document.getElementById("open-options")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
    document.getElementById("manual-analyze")?.addEventListener("click", async () => {
      const input = document.getElementById("manual-url");
      const url = input?.value?.trim() || "";
      if (!url) return;
      setLoading(true);
      const response = await sendRuntimeMessage({ type: "ANALYZE_URL", url });
      setLoading(false);
      handleAnalysisResponse(response, true);
    });
  }

  function renderAnalyze(analysis) {
    const stalking = analysis.stalking_risk || {};
    const overall = getOverallBadge(analysis.overall_score);
    const gpScore = Number(analysis.general_privacy?.score || 0);
    const stalkingScore = Number(stalking.score || 0);
    const privacyLevel = getScoreLevel(gpScore);
    const stalkingLevel = getStalkingScoreLevel(stalkingScore);
    const privacyLabel = getRiskLabel(privacyLevel);
    const stalkingLabel = getRiskLabel(stalkingLevel);
    const stalkingFlags = Array.isArray(stalking.flags) ? stalking.flags.slice(0, 3) : [];
    const protectiveFeatures = Array.isArray(stalking.protective_features) ? stalking.protective_features : [];
    const redFlags = analysis.red_flag_phrases || [];
    const alternatives = analysis.safer_alternatives || [];

    analyzeContent.innerHTML = `
      <div class="white-card">
        <div class="site-row">
          <img src="${escapeAttr(analysis.favicon || "")}" alt="favicon" onerror="this.style.display='none'" />
          <div class="site-name">${escapeHtml(analysis.siteName || analysis.siteHost || "Unknown Site")}</div>
        </div>
        <div class="risk-badge ${overall.className}">${overall.label}</div>
        <p class="summary summary-text">${escapeHtml(analysis.overall_summary || "No summary available.")}</p>
      </div>

      <div class="two-col">
        <div class="general-card card">
          <h4 class="card-title">General Privacy</h4>
          <div class="score-circle score--${privacyLevel}">${Math.round(gpScore)}</div>
          <div class="level-pill level--${privacyLevel}">${privacyLabel}</div>
          <div class="kv">Data sold:
            <span class="badge ${(analysis.general_privacy?.data_sold) ? "badge-yes" : "badge-no"}">
              ${(analysis.general_privacy?.data_sold) ? "Yes" : "No"}
            </span>
          </div>
          <div class="kv">User control:
            <span class="badge badge-no">${escapeHtml(analysis.general_privacy?.user_control || "MEDIUM")}</span>
          </div>
          <div class="tags">
            ${(analysis.general_privacy?.data_collected || []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("") || "<span class='tag'>No details</span>"}
          </div>
        </div>

        <div class="stalking-card card">
          <h4 class="card-title">Digital Stalking Risk</h4>
          <div class="score-circle score--${stalkingLevel}">${Math.round(stalkingScore)}</div>
          <div class="level-pill level--${stalkingLevel}">${stalkingLabel}</div>

          <div class="kv stalking-row"><span class="row-label">📍 Real-time location sharing</span>
            <span class="badge ${(stalking.real_time_location || stalking.location_tracking) ? "badge-yes" : "badge-no"}">
              ${(stalking.real_time_location || stalking.location_tracking) ? "YES" : "NO"}
            </span>
          </div>
          <div class="kv stalking-row"><span class="row-label">👁️ Activity monitoring</span>
            <span class="badge ${stalking.activity_monitoring ? "badge-yes" : "badge-no"}">
              ${stalking.activity_monitoring ? "YES" : "NO"}
            </span>
          </div>
          <div class="kv stalking-row"><span class="row-label">📱 Contact list access</span>
            <span class="badge ${stalking.contact_list_access ? "badge-yes" : "badge-no"}">
              ${stalking.contact_list_access ? "YES" : "NO"}
            </span>
          </div>
          <div class="kv stalking-row"><span class="row-label">🔒 Hard to delete account</span>
            <span class="badge ${stalking.hard_to_delete_account ? "badge-yes" : "badge-no"}">
              ${stalking.hard_to_delete_account ? "YES" : "NO"}
            </span>
          </div>

          <div class="stalking-divider"></div>
          <div class="tags warning-tags">
            ${stalkingFlags.length ? stalkingFlags.map((item) => `<span class="tag warning-chip">${escapeHtml(item)}</span>`).join("") : "<span class='tag'>No stalking flags</span>"}
          </div>
          ${protectiveFeatures.length ? `
            <div class="protective-section-title">🛡️ Protective Features</div>
            <div class="tags">
              ${protectiveFeatures.map((item) => `<span class="tag protective-chip">${escapeHtml(item)}</span>`).join("")}
            </div>
          ` : ""}
        </div>
      </div>

      <div class="red-flags">
        <details>
          <summary>Red Flag Phrases (${redFlags.length})</summary>
          ${redFlags.map((phrase) => `<div class="red-quote">"${escapeHtml(phrase)}"</div>`).join("") || "<p class='muted'>No explicit dangerous phrases found.</p>"}
        </details>
      </div>

      <div class="card">
        <h4 class="card-title">Safer Alternatives</h4>
        <div class="alt-wrap">
          ${alternatives.map((alt) => `<button class="alt-chip" data-alt="${escapeAttr(alt)}">${escapeHtml(alt)}</button>`).join("") || "<span class='muted'>No alternatives suggested.</span>"}
        </div>
      </div>

      <div class="actions">
        <button class="action-btn" id="btn-highlight">Highlight Page</button>
        <button class="action-btn" id="btn-goto-compare">Compare</button>
        <button class="action-btn" id="btn-save">Save</button>
        <button class="action-btn" id="btn-share">Share</button>
      </div>
    `;

    wireAnalyzeActions(analysis);
  }

  function wireAnalyzeActions(analysis) {
    document.querySelectorAll(".alt-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const alt = btn.getAttribute("data-alt") || "";
        if (!alt) return;
        chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(alt + " privacy policy")}` });
      });
    });

    document.getElementById("btn-highlight")?.addEventListener("click", highlightCurrentPage);
    document.getElementById("btn-goto-compare")?.addEventListener("click", () => switchTab("compare"));
    document.getElementById("btn-save")?.addEventListener("click", async () => {
      await sendRuntimeMessage({ type: "SAVE_ANALYSIS", analysis });
      setStatus("Saved to history.");
      loadHistory();
    });
    document.getElementById("btn-share")?.addEventListener("click", () => shareAnalysis(analysis));
  }

  async function highlightCurrentPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      let response;
      try {
        response = await chrome.tabs.sendMessage(tab.id, { type: "HIGHLIGHT_PAGE" });
      } catch {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
        response = await chrome.tabs.sendMessage(tab.id, { type: "HIGHLIGHT_PAGE" });
      }

      setStatus(response?.ok ? "Page highlights applied." : "Could not apply highlights on this page.");
    } catch {
      setStatus("Could not apply highlights on this page.");
    }
  }

  async function runCompare() {
    if (!state.currentAnalysis) {
      setStatus("Analyze the current site first.");
      switchTab("analyze");
      return;
    }

    const input = document.getElementById("compare-url");
    const url = input?.value?.trim() || "";
    if (!url) {
      setStatus("Enter a URL to compare.");
      return;
    }

    compareResults.innerHTML = `<div class="compare-panel"><div class="spinner"></div><p class="muted">Comparing...</p></div>`;
    const result = await sendRuntimeMessage({ type: "ANALYZE_URL", url });
    if (!result?.ok || !result.analysis) {
      compareResults.innerHTML = `<div class="compare-panel">${escapeHtml(mapErrorToText(result?.error || "AI_FAILED"))}</div>`;
      return;
    }

    state.compareAnalysis = result.analysis;
    renderCompareResult();
    loadHistory();
  }

  function renderCompareCurrent() {
    if (!state.currentAnalysis) {
      compareCurrent.textContent = "No current analysis yet.";
      return;
    }
    compareCurrent.innerHTML = `Current: <strong>${escapeHtml(state.currentAnalysis.siteName)}</strong> | Stalking score: <strong>${Math.round(state.currentAnalysis.stalking_risk?.score || 0)}</strong>`;
  }

  function renderCompareResult() {
    const a = state.currentAnalysis;
    const b = state.compareAnalysis;
    if (!a || !b) return;

    const safer = (a.stalking_risk?.score || 0) <= (b.stalking_risk?.score || 0) ? a : b;
    const riskier = safer === a ? b : a;

    compareResults.innerHTML = `
      <div class="compare-panel">
        <div class="compare-grid">
          <div class="compare-mini">
            <strong>${escapeHtml(a.siteName)}</strong><br />
            Overall: ${escapeHtml(a.overall_score)}<br />
            Stalking score: ${Math.round(a.stalking_risk?.score || 0)}
            ${safer === a ? `<div class="check">✅ Lower stalking risk</div>` : ""}
          </div>
          <div class="compare-mini">
            <strong>${escapeHtml(b.siteName)}</strong><br />
            Overall: ${escapeHtml(b.overall_score)}<br />
            Stalking score: ${Math.round(b.stalking_risk?.score || 0)}
            ${safer === b ? `<div class="check">✅ Lower stalking risk</div>` : ""}
          </div>
        </div>
        <p class="muted" style="margin-top:10px;">
          ${escapeHtml(safer.siteName)} has lower digital stalking risk because it has a lower stalking score and fewer tracking/monitoring risks than ${escapeHtml(riskier.siteName)}.
        </p>
      </div>
    `;
  }

  async function loadHistory() {
    const result = await sendRuntimeMessage({ type: "GET_HISTORY" });
    const history = Array.isArray(result?.history) ? result.history : [];

    if (history.length === 0) {
      historyList.innerHTML = `<div class="card">No history yet.</div>`;
      return;
    }

    historyList.innerHTML = history
      .slice(0, 5)
      .map((item, index) => {
        const badge = getOverallBadge(item.overall_score);
        return `
          <button class="history-item" data-index="${index}">
            <img src="${escapeAttr(item.favicon || "")}" alt="favicon" onerror="this.style.display='none'" />
            <span>
              <strong>${escapeHtml(item.siteName || item.siteHost || "Unknown")}</strong>
              <small>${badge.shortLabel} | Stalking: ${Math.round(item.stalking_risk?.score || 0)}</small>
            </span>
            <span class="history-score">${Math.round(item.general_privacy?.score || 0)}</span>
          </button>
        `;
      })
      .join("");

    Array.from(historyList.querySelectorAll(".history-item")).forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-index"));
        if (Number.isNaN(idx)) return;
        const selected = history[idx];
        if (!selected) return;
        state.currentAnalysis = selected;
        renderAnalyze(selected);
        renderCompareCurrent();
        switchTab("analyze");
      });
    });
  }

  async function clearHistory() {
    await sendRuntimeMessage({ type: "CLEAR_HISTORY" });
    loadHistory();
    setStatus("History cleared.");
  }

  function setLoading(isLoading) {
    state.loading = isLoading;
    loadingEl.classList.toggle("hidden", !isLoading);
  }

  function setStatus(text) {
    if (!text) {
      statusEl.textContent = "";
      statusEl.classList.add("hidden");
      return;
    }
    statusEl.textContent = text;
    statusEl.classList.remove("hidden");
  }

  function getOverallBadge(overallScore) {
    const score = String(overallScore || "YELLOW").toUpperCase();
    if (score === "RED") return { className: "risk-red", label: "High Risk", shortLabel: "High Risk" };
    if (score === "GREEN") return { className: "risk-green", label: "Low Risk", shortLabel: "Low Risk" };
    return { className: "risk-yellow", label: "Medium Risk", shortLabel: "Medium Risk" };
  }

  function getScoreLevel(score) {
    const n = Number(score);
    if (n >= 70) return "good";
    if (n >= 40) return "medium";
    return "bad";
  }

  // For stalking risk, lower scores are better.
  function getStalkingScoreLevel(score) {
    const n = Number(score);
    if (n >= 70) return "bad";
    if (n >= 40) return "medium";
    return "good";
  }

  function getRiskLabel(level) {
    if (level === "good") return "LOW";
    if (level === "medium") return "MEDIUM";
    return "HIGH";
  }

  function shareAnalysis(analysis) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 300;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const gradient = ctx.createLinearGradient(0, 0, 400, 300);
      gradient.addColorStop(0, "#6D28D9");
      gradient.addColorStop(1, "#9333EA");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 400, 300);

      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 18px Inter, system-ui";
      ctx.fillText("PrivacyGuard", 20, 32);

      ctx.font = "bold 28px Inter, system-ui";
      const siteTitle = (analysis.siteName || analysis.siteHost || "Unknown Site").slice(0, 22);
      ctx.fillText(siteTitle, 20, 82);

      ctx.font = "bold 44px Inter, system-ui";
      ctx.fillStyle = "#FDE68A";
      ctx.fillText(String(Math.round(analysis.stalking_risk?.score || 0)), 20, 145);

      ctx.fillStyle = "#FFFFFF";
      ctx.font = "13px Inter, system-ui";
      ctx.fillText("Digital Stalking Risk Score", 20, 165);

      ctx.font = "12px Inter, system-ui";
      (analysis.red_flag_phrases || []).slice(0, 3).forEach((flag, i) => {
        const line = `- ${flag}`.slice(0, 52);
        ctx.fillText(line, 20, 195 + i * 20);
      });

      ctx.globalAlpha = 0.7;
      ctx.fillText("Analyzed by PrivacyGuard", 250, 286);
      ctx.globalAlpha = 1;

      const link = document.createElement("a");
      const filename = `${(analysis.siteHost || "site").replace(/[^a-z0-9.-]+/gi, "-")}-privacy-warning.png`;
      link.download = filename;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch {
      setStatus("Failed to generate share card.");
    }
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
          resolve(response);
        });
      } catch {
        resolve({ ok: false, error: "MESSAGE_FAILED" });
      }
    });
  }

  function escapeHtml(input) {
    return String(input || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(input) {
    return escapeHtml(input).replace(/`/g, "");
  }
})();
