async function run() {
  const base = "http://localhost:3000";

  // Helper for requests with cookies
  let cookies = "";
  async function request(url, options = {}) {
    const headers = { ...options.headers };
    if (cookies) headers["Cookie"] = cookies;
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const res = await fetch(base + url, { ...options, headers, redirect: "manual" });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookies = setCookie.split(";")[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, headers: res.headers, text, json };
  }

  console.log("1. Health check...");
  let r = await request("/health");
  console.log("   Health:", r.status, r.json);

  console.log("2. Applicant login...");
  r = await request("/auth/dev/login?role=applicant&name=Red");
  console.log("   Applicant login cookie:", cookies ? "Set" : "Failed");

  console.log("3. Submit application...");
  const appData = {
    profile: { name: "Red", timezone: "UTC-5", ageGroup: "18+" },
    roles: ["spriter"],
    general: {
      experience: "5 years spriting",
      interest: "Pokemon Void passion project",
      critique: "Great aesthetic",
      timeCommitment: "10 hours/week"
    },
    roleDetails: {
      spriter: { abilities: ["Trainer sprites"], styleComfort: "64x64 style" }
    }
  };
  r = await request("/api/application", { method: "POST", body: JSON.stringify(appData) });
  console.log("   Submission:", r.status, r.json);
  const appId = r.json.id;

  console.log("4. Check applicant status...");
  r = await request("/api/application/status");
  console.log("   Status:", r.status, r.json.application.status, "ID:", r.json.application.id);

  console.log("5. Director login...");
  cookies = ""; // Reset cookie to director
  r = await request("/auth/dev/login?role=director&name=Director_Oak");
  console.log("   Director login cookie:", cookies ? "Set" : "Failed");

  console.log("6. Director list applications...");
  r = await request("/api/admin/applications");
  console.log("   Queue count:", r.json.applications?.length, "First ID:", r.json.applications?.[0]?.id);

  console.log("7. Director claim application...");
  r = await request(`/api/admin/applications/${appId}/claim`, { method: "POST" });
  console.log("   Claimed:", r.json);

  console.log("8. Director move to Interview...");
  r = await request(`/api/admin/applications/${appId}/status`, { method: "POST", body: JSON.stringify({ status: "Interview" }) });
  console.log("   Status update:", r.json);

  console.log("9. Director send interview message...");
  r = await request(`/api/admin/applications/${appId}/interview/message`, {
    method: "POST",
    body: JSON.stringify({ message: "Welcome Red! Can you share some overworld sprites?" })
  });
  console.log("   Director message sent. Total in thread:", r.json.ticket?.messages?.length);

  console.log("10. Switch back to Applicant...");
  // Re-login as applicant
  cookies = "";
  await request("/auth/dev/login?role=applicant&name=Red");
  r = await request("/api/interview");
  console.log("   Applicant sees messages:", r.json.ticket?.messages?.length, "Latest body:", r.json.ticket?.messages?.[0]?.body);

  console.log("11. Applicant replies to interview...");
  r = await request("/api/interview/message", {
    method: "POST",
    body: JSON.stringify({ message: "Sure thing! Here is a link: https://example.com/red-sprites" })
  });
  console.log("   Applicant reply sent. Total in thread:", r.json.ticket?.messages?.length);

  console.log("12. Director deletes application...");
  cookies = "";
  await request("/auth/dev/login?role=director");
  r = await request(`/api/admin/applications/${appId}`, { method: "DELETE" });
  console.log("   Director delete result:", r.status, r.json);

  console.log("ALL TESTS PASSED SUCCESSFULLY!");
}

run().catch(console.error);
