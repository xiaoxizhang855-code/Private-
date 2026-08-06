import { getStore } from "@netlify/blobs";

const STORE_NAME = "wbs40-reports-v1";
const MAX_BODY_BYTES = 120_000;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }
});

const text = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
const token = () => crypto.randomUUID().replaceAll("-", "");

function isHrAuthorized(request) {
  const expected = "11123";
  return request.headers.get("x-hr-password") === expected;
}

const scoreKeys = new Set(["S", "X", "O", "G", "C"]);
const validScoreMap = value => value && scoreKeys.size === Object.keys(value).length && [...scoreKeys].every(key => Number.isFinite(Number(value[key])) && Number(value[key]) >= 0 && Number(value[key]) <= 100);
const facetKeys = [
  "N_ANXIETY", "N_SELF_CONSCIOUSNESS", "N_IMPULSIVENESS", "N_VULNERABILITY",
  "E_GREGARIOUSNESS", "E_ASSERTIVENESS",
  "O_IMAGINATION", "O_IDEAS", "O_VALUES",
  "A_TRUST", "A_STRAIGHTFORWARDNESS", "A_ALTRUISM", "A_COMPLIANCE", "A_TENDER_MINDEDNESS",
  "C_COMPETENCE", "C_ORDER", "C_DUTIFULNESS", "C_ACHIEVEMENT", "C_SELF_DISCIPLINE", "C_DELIBERATION"
];
const validFacetScores = value => value && Object.keys(value).length === facetKeys.length && facetKeys.every(key => Number.isFinite(Number(value[key])) && Number(value[key]) >= 0 && Number(value[key]) <= 100);
const validScenarioCounts = value => value && scoreKeys.size === Object.keys(value).length && [...scoreKeys].every(key => Number.isInteger(Number(value[key])) && Number(value[key]) >= 0) && [...scoreKeys].reduce((sum, key) => sum + Number(value[key]), 0) === 26;

function normalizeReport(body) {
  const completedAt = body.completedAt || new Date().toISOString();
  const now = Date.now();
  const id = `WBS-${now.toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  return {
    id,
    candidateName: text(body.candidateName, 40),
    candidateRole: text(body.candidateRole || "待确认岗位", 60),
    completedAt,
    roleName: text(body.roleName, 40),
    roleCode: text(body.roleCode, 8),
    algorithmVersion: text(body.algorithmVersion || "WBS-BIG5-20-DISC-4.2", 32),
    modelVersion: text(body.modelVersion || "BIG5-20-FACETS-1.0", 40),
    roleStability: body.roleStability || null,
    primaryMode: text(body.primaryMode, 20),
    secondaryMode: text(body.secondaryMode, 20),
    displays: body.displays,
    facetScores: validFacetScores(body.facetScores) ? Object.fromEntries(facetKeys.map(key => [key, Math.round(Number(body.facetScores[key]))])) : null,
    discAnalysis: body.discAnalysis || null,
    situations: body.situations || { S: 0, X: 0, O: 0, G: 0, C: 0 },
    adaptation: body.adaptation || { distribution: { S: 0, X: 0, O: 0, G: 0, C: 0 }, total: 0, range: 0, primary: "C", primaryCount: 0, level: "暂无数据" },
    quality: body.quality,
    consentVersion: text(body.consentVersion, 40),
    consentAt: completedAt,
    candidateToken: token(),
    hrToken: token(),
    createdAt: new Date(now).toISOString()
  };
}

export default async (request) => {
  try {
    const store = getStore(STORE_NAME);

    if (request.method === "POST") {
      const size = Number(request.headers.get("content-length") || 0);
      if (size > MAX_BODY_BYTES) return json({ error: "Payload too large" }, 413);
      const body = await request.json().catch(() => null);
      if (!body?.candidateName || body.modelVersion !== "BIG5-20-FACETS-1.0" || !validScoreMap(body.displays) || !validFacetScores(body.facetScores) || !validScenarioCounts(body.situations) || !body?.quality || body.privacyConsent !== true || !body.consentVersion) return json({ error: "Invalid Big Five report payload or missing consent" }, 400);

      const report = normalizeReport(body);
      const reportKey = `reports/${Date.now().toString().padStart(13, "0")}-${report.id}`;
      await store.setJSON(reportKey, report, { onlyIfNew: true, metadata: { completedAt: report.completedAt } });
      await Promise.all([
        store.setJSON(`tokens/${report.candidateToken}`, { reportKey, scope: "candidate" }, { onlyIfNew: true }),
        store.setJSON(`tokens/${report.hrToken}`, { reportKey, scope: "hr" }, { onlyIfNew: true })
      ]);

      return json({
        id: report.id,
        candidateUrl: `/candidate-result.html?token=${report.candidateToken}`,
        hrUrl: `/hr-report.html?token=${report.hrToken}`
      }, 201);
    }

    if (request.method === "GET") {
      if (!isHrAuthorized(request)) return json({ error: "Unauthorized" }, 401);
      const url = new URL(request.url);
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
      const { blobs } = await store.list({ prefix: "reports/" });
      const selected = blobs.sort((a, b) => b.key.localeCompare(a.key)).slice(0, limit);
      const reports = (await Promise.all(selected.map(item => store.get(item.key, { type: "json", consistency: "strong" })))).filter(Boolean);
      reports.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
      const today = new Date().toISOString().slice(0, 10);
      return json({
        stats: {
          reports: blobs.length,
          candidates: new Set(reports.map(item => item.candidateName)).size,
          today: reports.filter(item => String(item.completedAt).slice(0, 10) === today).length
        },
        items: reports.map(item => ({
          id: item.id,
          candidateName: item.candidateName,
          candidateRole: item.candidateRole,
          completedAt: item.completedAt,
          roleName: item.roleName,
          roleCode: item.roleCode,
          qualityScore: item.quality?.score || 0,
          hrToken: item.hrToken
        }))
      });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error("reports function failed", error);
    return json({ error: "Report service unavailable" }, 500);
  }
};
