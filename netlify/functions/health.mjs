const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }
});

export default async () => json({
  ok: true,
  service: "WBS-40 Recruitment",
  version: "2.0.0",
  storage: "Netlify Blobs",
  hrAuth: "enabled"
});
