const API_KEY = "AIzaSyCRVZGQ3PtbGDqQbpL_JP9WZcKUl2f589w";

// ─── Message Router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {

    case "ANALYZE_ACTIVE":
      handleAnalyzeActive().then(sendResponse).catch((err) =>
        sendResponse({ ok: false, error: "AI_FAILED" })
      );
      return true;

    case "ANALYZE_URL":
      handleAnalyzeURL(message.url).then(sendResponse).catch((err) =>
        sendResponse({ ok: false, error: "AI_FAILED" })
      );
      return true;

    case "SAVE_ANALYSIS":
      handleSaveAnalysis(message.analysis).then(sendResponse).catch(() =>
        sendResponse({ ok: false })
      );
      return true;

    case "GET_HISTORY":
      handleGetHistory().then(sendResponse).catch(() =>
        sendResponse({ ok: false, history: [] })
      );
      return true;

    case "CLEAR_HISTORY":
      handleClearHistory().then(sendResponse).catch(() =>
        sendResponse({ ok: false })
      );
      return true;

    case "HIGHLIGHT_APPLIED":
      return false;

    default:
      return false;
  }
});

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleAnalyzeActive() {
  console.log("handleAnalyzeActive called");
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs?.[0];
  console.log("Tab URL:", tab?.url);

  if (!tab?.url || !tab.url.startsWith("http")) {
    return { ok: false, error: "NO_ACTIVE_HTTP_TAB" };
  }

  const policyURL = await findPrivacyPolicyURL(tab.url, tab.id);
  console.log("Policy URL found:", policyURL);

  if (!policyURL) {
    return { ok: false, error: "NO_POLICY" };
  }

  const policyText = await fetchPolicyText(policyURL);
  console.log("Policy text length:", policyText?.length);

  if (!policyText) {
    return { ok: false, error: "FETCH_POLICY_FAILED" };
  }

  const analysis = await analyzeWithGemini(policyText);
  console.log("Analysis result:", analysis);

  analysis.siteHost = new URL(tab.url).hostname.replace("www.", "");
  analysis.siteName = analysis.siteHost;
  analysis.favicon = `https://www.google.com/s2/favicons?domain=${tab.url}&sz=32`;
  analysis.savedAt = Date.now();

  await saveToHistory(analysis);
  return { ok: true, analysis };
}

async function handleAnalyzeURL(inputURL) {
  if (!inputURL) return { ok: false, error: "INVALID_URL" };

  let url = inputURL.trim();
  if (!url.startsWith("http")) url = "https://" + url;

  const policyURL = await findPrivacyPolicyURL(url, null) || url;

  const policyText = await fetchPolicyText(policyURL);
  if (!policyText) {
    return { ok: false, error: "FETCH_POLICY_FAILED" };
  }

  const analysis = await analyzeWithGemini(policyText);
  const host = new URL(url).hostname.replace("www.", "");
  analysis.siteHost = host;
  analysis.siteName = host;
  analysis.favicon = `https://www.google.com/s2/favicons?domain=${url}&sz=32`;
  analysis.savedAt = Date.now();

  await saveToHistory(analysis);
  return { ok: true, analysis };
}

async function handleSaveAnalysis(analysis) {
  if (!analysis) return { ok: false };
  await saveToHistory(analysis);
  return { ok: true };
}

async function handleGetHistory() {
  const result = await chrome.storage.local.get("history");
  return { ok: true, history: result.history || [] };
}

async function handleClearHistory() {
  await chrome.storage.local.set({ history: [] });
  return { ok: true };
}

// ─── Privacy Policy URL Finder ───────────────────────────────────────────────

async function findPrivacyPolicyURL(pageURL, tabId) {
  if (tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const anchors = Array.from(document.querySelectorAll("a[href]"));
          const keywords = ["privacy policy", "privacy notice", "data policy", "privacy"];
          for (const a of anchors) {
            const text = a.textContent.toLowerCase().trim();
            const href = a.href || "";
            if (keywords.some((kw) => text.includes(kw)) && href.startsWith("http")) {
              return href;
            }
          }
          return null;
        }
      });
      if (results?.[0]?.result) return results[0].result;
    } catch {
      // scripting failed, fall through
    }
  }

  try {
    const base = new URL(pageURL).origin;
    const candidates = [
      `${base}/privacy`,
      `${base}/privacy-policy`,
      `${base}/legal/privacy`,
      `${base}/policies/privacy`
    ];

    for (const candidate of candidates) {
      try {
        const res = await fetch(candidate, { method: "HEAD" });
        if (res.ok) return candidate;
      } catch {
        continue;
      }
    }
  } catch {
    // URL parsing failed
  }

  return null;
}

// ─── Policy Text Fetcher ──────────────────────────────────────────────────────

async function fetchPolicyText(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const html = await response.text();

    const cleaned = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return cleaned.substring(0, 4000);
  } catch {
    return null;
  }
}

// ─── Gemini API Call ──────────────────────────────────────────────────────────

async function analyzeWithGemini(policyText) {
  const prompt = `You are a privacy policy analyzer focused on digital stalking risks.
Analyze this privacy policy and return ONLY a valid JSON object.
No markdown, no backticks, no explanation, just raw JSON.

Return exactly this structure:
{
  "overall_score": "RED",
  "overall_summary": "2 sentence plain english summary here.",
  "general_privacy": {
    "score": 45,
    "data_collected": ["email", "location", "browsing history"],
    "data_sold": true,
    "third_parties": ["Google", "Meta"],
    "user_control": "LOW"
  },
  "stalking_risk": {
    "score": 75,
    "risk_level": "HIGH",
    "location_tracking": true,
    "real_time_location": true,
    "activity_monitoring": true,
    "contact_list_access": false,
    "data_shared_with_third_parties": true,
    "hard_to_delete_account": false,
    "flags": ["Precise location can be shared with third parties"],
    "protective_features": ["Location sharing can be disabled in settings"]
  },
  "red_flag_phrases": ["we may share your data with third parties", "law enforcement requests"],
  "safer_alternatives": ["DuckDuckGo", "Signal", "ProtonMail"]
}

Rules:
- Analyze this privacy policy for digital stalking risks - how easy does this app make it for an abuser, stalker, or controlling partner to track, monitor, or locate someone.
- overall_score must be exactly "RED", "YELLOW", or "GREEN"
- scores must be numbers between 0 and 100
- stalking_risk.risk_level must be exactly "HIGH", "MEDIUM", or "LOW"
- stalking_risk boolean fields must be true or false
- user_control must be exactly "HIGH", "MEDIUM", or "LOW"

Privacy policy text to analyze:
${policyText}`;

  console.log("Calling Gemini API...");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1 }
      })
    }
  );

  if (!response.ok) {
    const errText = await response.json();
    console.error("Gemini error:", JSON.stringify(errText));
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const result = await response.json();
  const text = result.candidates[0].content.parts[0].text;

  const cleaned = text.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("AI returned invalid JSON");
  }
}

// ─── History Helpers ──────────────────────────────────────────────────────────

async function saveToHistory(analysis) {
  const result = await chrome.storage.local.get("history");
  const history = Array.isArray(result.history) ? result.history : [];

  const filtered = history.filter((item) => item.siteHost !== analysis.siteHost);

  const updated = [analysis, ...filtered].slice(0, 5);
  await chrome.storage.local.set({ history: updated });
}
