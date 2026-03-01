(() => {
  const RULES = [
    {
      level: "red",
      reason: "data selling or monetization",
      patterns: [/sell\s+.*data/i, /data\s+broker/i, /monetiz(e|ation)\s+.*data/i]
    },
    {
      level: "red",
      reason: "government or law-enforcement sharing",
      patterns: [/law\s+enforcement/i, /government\s+request/i, /subpoena/i, /court\s+order/i]
    },
    {
      level: "red",
      reason: "health or reproductive data collection",
      patterns: [/health\s+data/i, /reproductive/i, /pregnan/i, /fertility/i, /period\s+tracking/i]
    },
    {
      level: "red",
      reason: "exact location tracking",
      patterns: [/precise\s+location/i, /exact\s+location/i, /gps\s+location/i]
    },
    {
      level: "yellow",
      reason: "third-party data sharing",
      patterns: [/third[-\s]?part(y|ies)/i, /affiliates/i, /partners/i]
    },
    {
      level: "yellow",
      reason: "cookie or behavioral tracking",
      patterns: [/cookies?/i, /behavioral\s+tracking/i, /ad\s+targeting/i, /analytics/i]
    },
    {
      level: "green",
      reason: "user control and rights",
      patterns: [/delete\s+your\s+data/i, /opt[-\s]?out/i, /access\s+your\s+data/i, /privacy\s+controls/i]
    },
    {
      level: "green",
      reason: "security or encryption commitments",
      patterns: [/encrypt/i, /security\s+measures/i, /end-to-end/i]
    }
  ];

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "HIGHLIGHT_PAGE") {
      return;
    }

    try {
      const result = applyHighlights();
      sendResponse({ ok: true, ...result });
      chrome.runtime.sendMessage({
        type: "HIGHLIGHT_APPLIED",
        counts: result.counts,
        url: location.href
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return true;
  });

  function applyHighlights() {
    if (!document.body) {
      return { counts: { red: 0, yellow: 0, green: 0 }, alreadyApplied: false };
    }

    injectStyles();

    const counts = { red: 0, yellow: 0, green: 0 };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node || !node.textContent || !node.textContent.trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        const parent = node.parentElement;
        if (!parent) {
          return NodeFilter.FILTER_REJECT;
        }

        if (
          parent.closest("script, style, noscript, textarea, input, [contenteditable='true']") ||
          parent.classList.contains("pg-highlight") ||
          parent.closest("#privacyguard-legend")
        ) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }

    nodes.forEach((node) => {
      const replacement = buildHighlightedFragment(node.textContent || "", counts);
      if (replacement) {
        node.parentNode.replaceChild(replacement, node);
      }
    });

    renderLegend();
    return { counts, alreadyApplied: document.body.dataset.pgHighlighted === "1" };
  }

  function buildHighlightedFragment(text, counts) {
    const sentenceParts = text.match(/[^.!?\n]+[.!?\n]*/g);
    if (!sentenceParts || sentenceParts.length === 0) {
      return null;
    }

    let changed = false;
    const fragment = document.createDocumentFragment();

    sentenceParts.forEach((sentence) => {
      const match = classifySentence(sentence);
      if (!match) {
        fragment.appendChild(document.createTextNode(sentence));
        return;
      }

      changed = true;
      counts[match.level] += 1;

      const span = document.createElement("span");
      span.className = `pg-highlight pg-${match.level}`;
      span.textContent = sentence;
      span.title = `⚠️ Flagged because: ${match.reason}`;
      fragment.appendChild(span);
    });

    if (!changed) {
      return null;
    }

    document.body.dataset.pgHighlighted = "1";
    return fragment;
  }

  function classifySentence(sentence) {
    let selected = null;

    for (const rule of RULES) {
      const hit = rule.patterns.some((pattern) => pattern.test(sentence));
      if (!hit) continue;

      if (!selected || severityValue(rule.level) > severityValue(selected.level)) {
        selected = rule;
      }
    }

    return selected;
  }

  function severityValue(level) {
    if (level === "red") return 3;
    if (level === "yellow") return 2;
    return 1;
  }

  function renderLegend() {
    const existing = document.getElementById("privacyguard-legend");
    if (existing) existing.remove();

    const legend = document.createElement("div");
    legend.id = "privacyguard-legend";
    legend.innerHTML = `
      <strong>PrivacyGuard Legend</strong>
      <div><span class="pg-dot pg-red"></span> High risk (selling, government, health, exact location)</div>
      <div><span class="pg-dot pg-yellow"></span> Medium risk (3rd parties, cookies, behavior tracking)</div>
      <div><span class="pg-dot pg-green"></span> Positive controls (deletion, opt-out, encryption)</div>
    `;

    document.body.appendChild(legend);
  }

  function injectStyles() {
    if (document.getElementById("privacyguard-highlight-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "privacyguard-highlight-style";
    style.textContent = `
      .pg-highlight {
        border-radius: 4px;
        padding: 1px 2px;
        cursor: help;
      }
      .pg-red { background: #FEE2E2; }
      .pg-yellow { background: #FEF3C7; }
      .pg-green { background: #D1FAE5; }
      #privacyguard-legend {
        position: fixed;
        bottom: 16px;
        right: 16px;
        z-index: 2147483647;
        width: 300px;
        background: #FFFFFF;
        border: 2px solid #FDACAC;
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.2);
        padding: 10px;
        font-family: system-ui, -apple-system, Segoe UI, sans-serif;
        font-size: 12px;
        color: #111827;
      }
      #privacyguard-legend strong {
        display: block;
        margin-bottom: 8px;
      }
      #privacyguard-legend div {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 4px;
        line-height: 1.3;
      }
      .pg-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        display: inline-block;
        flex: 0 0 auto;
      }
    `;

    document.head.appendChild(style);
  }
})();
