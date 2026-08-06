import { getStore } from "@netlify/blobs";

const STORE_NAME = "wbs40-reports-v1";
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }
});

function isHrAuthorized(request) {
  const expected = "11123";
  return request.headers.get("x-hr-password") === expected;
}

export default async (request) => {
  try {
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    const accessToken = new URL(request.url).searchParams.get("token") || "";
    if (!/^[a-f0-9]{32}$/i.test(accessToken)) return json({ error: "Invalid token" }, 400);

    const store = getStore(STORE_NAME);
    const mapping = await store.get(`tokens/${accessToken}`, { type: "json", consistency: "strong" });
    if (!mapping?.reportKey) return json({ error: "Report not found" }, 404);
    if (mapping.scope === "hr" && !isHrAuthorized(request)) return json({ error: "Unauthorized" }, 401);
    const stored = await store.get(mapping.reportKey, { type: "json", consistency: "strong" });
    if (!stored) return json({ error: "Report not found" }, 404);

    const base = {
      id: stored.id,
      candidateName: stored.candidateName,
      candidateRole: stored.candidateRole,
      completedAt: stored.completedAt,
      roleName: stored.roleName,
      roleCode: stored.roleCode,
      algorithmVersion: stored.algorithmVersion,
      modelVersion: stored.modelVersion,
      primaryMode: stored.primaryMode,
      secondaryMode: stored.secondaryMode,
      displays: stored.displays,
      facetScores: stored.facetScores || null,
      discAnalysis: stored.discAnalysis || null,
      situations: stored.situations,
      adaptation: stored.adaptation
    };
    const report = mapping.scope === "hr" ? {
      ...base,
      quality: stored.quality
    } : base;
    return json({ scope: mapping.scope, report });
  } catch (error) {
    console.error("report function failed", error);
    return json({ error: "Report service unavailable" }, 500);
  }
};
