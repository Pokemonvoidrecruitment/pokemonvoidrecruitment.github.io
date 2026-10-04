(function () {
  "use strict";
  const helpers = window.VoidRecruitment;
  if (!helpers) return;
  const $ = (selector) => document.querySelector(selector);
  const text = (selector, value) => {
    const node = $(selector);
    if (node) node.textContent = value || "—";
  };
  const statusClass = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z]+/g, "-");
  const roleNames = {
    programmer: "Programmer",
    "move-animator": "Move Animator",
    spriter: "Spriter",
    music: "Music",
  };
  const roleText = (roles) =>
    (roles || []).map((role) => roleNames[role] || role).join(", ");
  const page = document.body.dataset.portalPage;

  function message(copy, error = false) {
    const node = $("#" + page + "-message");
    if (!node) return;
    node.className = "notice-strip " + (error ? "error" : "info");
    node.textContent = copy;
    node.hidden = false;
  }

  async function getJson(path) {
    const response = await fetch((helpers.apiBase || "") + path, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        body.message || "This page could not load. Please try again.",
      );
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function renderStatus(app, example = false) {
    $("#status-panel").hidden = false;
    text(
      "[data-record-title]",
      example ? "Example application · Alex" : (app.displayName ? `${app.displayName}’s application` : "Application record"),
    );
    text("[data-status-id]", app.id);
    text("[data-status-roles]", roleText(app.roles));
    text("[data-status-updated]", app.updatedAt ? new Date(app.updatedAt).toLocaleString() : (app.submittedAt || "—"));
    text("[data-status-badge]", app.status);
    const badge = $("[data-status-badge]");
    if (badge) badge.className = "status-badge " + statusClass(app.status);

    const list = $("[data-status-timeline]");
    if (list) {
      list.replaceChildren();
      for (const item of app.timeline || []) {
        const li = document.createElement("li");
        if (item.complete) li.className = "done";
        const title = document.createElement("strong");
        title.textContent = item.title;
        const detail = document.createElement("span");
        detail.textContent = item.detail || "";
        li.append(title, detail);
        list.append(li);
      }
    }
    const interviewLink = $("[data-interview-link]");
    if (interviewLink) {
      interviewLink.hidden = statusClass(app.status) !== "interview" && !app.hasInterview;
    }
  }

  function previewStatus() {
    text(
      "[data-status-intro]",
      "Your draft stays in this tab. Live application tracking is available once you sign in.",
    );
    $("#status-empty").hidden = false;
    let draft;
    try {
      draft = JSON.parse(sessionStorage.getItem("void-recruitment-draft-v1"));
    } catch {}
    if (draft?.version === 1 && draft.values?.name) {
      text("[data-empty-title]", draft.values.name + "’s draft");
      text(
        "[data-empty-copy]",
        (draft.previewComplete
          ? "You finished the form preview. "
          : "You have a draft in this tab. ") +
          "Nothing has been submitted. You can return to your answers at any time.",
      );
      text("[data-draft-link]", "Return to your draft");
    } else {
      text("[data-empty-title]", "No application submitted");
      text(
        "[data-empty-copy]",
        "Sign in with Discord or use the test switcher above to begin an application.",
      );
    }
    $("[data-status-examples]").hidden = false;
    $("[data-show-status]").addEventListener("click", () => {
      const status = $("#example-status").value;
      const details = {
        Submitted: "Your application has been received.",
        "In review": "The recruitment team is reviewing your answers.",
        Interview: "The team has invited you to continue in an interview ticket.",
        "On hold": "The team has paused the review. There is no action to take right now.",
        Accepted: "The team will arrange your onboarding with you.",
        Declined: "The team is not continuing with this application.",
      };
      renderStatus(
        {
          id: "EXAMPLE-01",
          roles: ["Spriter"],
          status,
          updatedAt: "Example only",
          timeline: [
            { title: "Application received", detail: "This is a fictional record.", complete: true },
            { title: status, detail: details[status], complete: ["Accepted", "Declined"].includes(status) },
          ],
        },
        true,
      );
      $("#status-panel").scrollIntoView({ block: "start" });
    });
  }

  function renderTicket(ticket, example = false) {
    $("#interview-panel").hidden = false;
    text("[data-ticket-id]", ticket.id);
    text("[data-ticket-status]", ticket.status);
    $("[data-ticket-example-label]").hidden = !example;
    const log = $("[data-ticket-log]");
    log.replaceChildren();
    for (const item of ticket.messages || []) {
      const entry = document.createElement("article");
      entry.className = "ticket-entry";
      const meta = document.createElement("div");
      meta.className = "ticket-meta";
      const sender = document.createElement("strong");
      sender.textContent = item.senderLabel || (item.senderType === "director" ? "Director" : "Applicant");
      const when = document.createElement("span");
      when.textContent = item.sentAt || "";
      meta.append(sender, when);
      const body = document.createElement("div");
      body.className = "ticket-body";
      body.textContent = item.body || "";
      entry.append(meta, body);
      log.append(entry);
    }
    if (!ticket.messages?.length) {
      const empty = document.createElement("p");
      empty.className = "ticket-empty";
      empty.textContent = "No messages in this ticket yet. Write a reply below to contact the Directors.";
      log.append(empty);
    }

    // Wire up applicant reply sending
    if (!example) {
      const replyBtn = $("[data-send-reply]");
      const replyInput = $("#ticket-reply");
      if (replyBtn && replyInput && !replyBtn.dataset.wired) {
        replyBtn.dataset.wired = "true";
        replyBtn.addEventListener("click", async () => {
          const body = replyInput.value.trim();
          if (!body) return;
          replyBtn.disabled = true;
          replyBtn.textContent = "Sending…";
          try {
            const r = await fetch((helpers.apiBase || "") + "/api/interview/message", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ message: body })
            });
            const res = await r.json();
            if (!r.ok) throw new Error(res.message || "Failed to send message.");
            replyInput.value = "";
            renderTicket(res.ticket, false);
          } catch (err) {
            alert(err.message);
          } finally {
            replyBtn.disabled = false;
            replyBtn.textContent = "Send reply";
          }
        });
      }
    }
  }

  function previewInterview() {
    $("#interview-empty").hidden = false;
    $("[data-interview-example]").hidden = false;
    $("[data-show-interview]").addEventListener("click", () => {
      $("#interview-empty").hidden = true;
      $("[data-interview-example]").hidden = true;
      renderTicket(
        {
          id: "EXAMPLE-01",
          status: "Example",
          messages: [
            {
              senderLabel: "Pokemon Void Recruitment",
              sentAt: "Example message 1",
              body: "Thanks for sharing your sprites, Alex. Could you walk us through how you made the overworld example?",
            },
            {
              senderLabel: "Alex · example applicant",
              sentAt: "Example message 2",
              body: "I started with the silhouette, then checked the walking frames together before adding the shading.",
            },
            {
              senderLabel: "Pokemon Void Recruitment",
              sentAt: "Example message 3",
              body: "That helps, thank you. Which part would you want feedback on first?",
            },
          ],
        },
        true,
      );
    });
  }

  let applications = [],
    selected = null,
    queueFilter = "all";

  function renderQueue() {
    const query = $("#queue-search").value.trim().toLowerCase();
    const visible = applications.filter((app) => {
      const s = statusClass(app.status);
      const matchesFilter =
        queueFilter === "all" ||
        (queueFilter === "archived" ? app.archived || s === "archived" : s === queueFilter);
      const matchesQuery = [app.id, app.displayName, app.discordUsername, roleText(app.roles)]
        .join(" ")
        .toLowerCase()
        .includes(query);
      return matchesFilter && matchesQuery;
    });

    const body = $("[data-queue-body]");
    body.replaceChildren();
    for (const app of visible) {
      const row = document.createElement("tr");
      const name = document.createElement("td");
      const button = document.createElement("button");
      button.className = "text-button";
      button.type = "button";
      button.textContent = app.displayName || app.discordUsername || app.id;
      button.addEventListener("click", () => openRecord(app));
      name.append(button);
      row.append(name);
      for (const value of [
        roleText(app.roles),
        app.status,
        app.submittedAt ? new Date(app.submittedAt).toLocaleDateString() : "—",
        app.claimedBy || "Unclaimed",
      ]) {
        const cell = document.createElement("td");
        cell.textContent = value || "—";
        row.append(cell);
      }
      body.append(row);
    }
    $("[data-queue-empty]").hidden = visible.length > 0;
    text(
      "[data-queue-count]",
      visible.length + " of " + applications.length + " applications",
    );
  }

  function renderDirectorInterview(ticket) {
    const interviewLog = $("[data-director-interview-log]");
    if (!interviewLog) return;
    interviewLog.replaceChildren();
    for (const item of ticket?.messages || []) {
      const entry = document.createElement("article");
      entry.className = "ticket-entry";
      const meta = document.createElement("div");
      meta.className = "ticket-meta";
      const sender = document.createElement("strong");
      sender.textContent = item.senderLabel || (item.senderType === "director" ? "Director" : "Applicant");
      const when = document.createElement("span");
      when.textContent = item.sentAt || "";
      meta.append(sender, when);
      const body = document.createElement("div");
      body.className = "ticket-body";
      body.textContent = item.body || "";
      entry.append(meta, body);
      interviewLog.append(entry);
    }
    if (!ticket?.messages?.length) {
      const empty = document.createElement("p");
      empty.className = "ticket-empty";
      empty.textContent = "No messages in this interview yet. Send a message to start the conversation.";
      interviewLog.append(empty);
    }
    interviewLog.scrollTop = interviewLog.scrollHeight;
  }

  async function openRecord(app) {
    selected = app;
    $("#director-detail").hidden = false;
    text("#detail-title", app.displayName || app.id);
    text("[data-detail-meta]", app.id + " · " + roleText(app.roles) + " · " + app.status);
    $("[data-detail-feedback]").textContent = "";

    // Make sure director action buttons are unhidden
    const actions = document.querySelector("[data-demo-actions]");
    if (actions) actions.hidden = false;

    const answers = $("[data-detail-answers]");
    answers.replaceChildren();
    if (!helpers.apiBase) return;

    try {
      const data = await getJson("/api/admin/applications/" + encodeURIComponent(app.id));
      const detail = data.application;
      for (const [title, copy] of Object.entries(flattenAnswers(detail.answers || {}))) {
        const row = document.createElement("div");
        row.className = "review-row";
        const term = document.createElement("div");
        term.className = "review-term";
        term.textContent = title;
        const value = document.createElement("div");
        value.className = "review-value";
        value.textContent = copy;
        row.append(term, value);
        answers.append(row);
      }
      text("[data-claim]", detail.claimedBy ? "Release application" : "Claim application");
      $("#director-status").value = detail.status;
      selected = detail;

      // Interview Ticket Section in Director detail
      const interviewSec = $("#director-interview-section");
      const directorReplyInput = $("#director-reply-input");
      const directorSendBtn = $("[data-director-send-reply]");

      if (interviewSec) {
        if (detail.interview || detail.status === "Interview") {
          interviewSec.hidden = false;
          renderDirectorInterview(detail.interview || { messages: [] });

          if (directorSendBtn && !directorSendBtn.dataset.wired) {
            directorSendBtn.dataset.wired = "true";
            directorSendBtn.addEventListener("click", async () => {
              const body = directorReplyInput.value.trim();
              if (!body || !selected) return;
              directorSendBtn.disabled = true;
              try {
                const r = await fetch(
                  (helpers.apiBase || "") + "/api/admin/applications/" + encodeURIComponent(selected.id) + "/interview/message",
                  {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify({ message: body }),
                  },
                );
                const res = await r.json();
                if (!r.ok) throw new Error(res.message || "Could not send message.");
                directorReplyInput.value = "";
                renderDirectorInterview(res.ticket);
                selected.interview = res.ticket;
              } catch (err) {
                alert(err.message);
              } finally {
                directorSendBtn.disabled = false;
              }
            });
          }
        } else {
          interviewSec.hidden = true;
        }
      }
    } catch (e) {
      text("[data-detail-feedback]", e.message, true);
    }
    $("#detail-title").focus({ preventScroll: true });
    $("#director-detail").scrollIntoView({ block: "start" });
  }

  function flattenAnswers(value, prefix = "") {
    const out = {};
    if (value === null || value === undefined || value === "") return out;
    if (Array.isArray(value)) {
      out[prefix || "Answer"] = value.join(", ");
      return out;
    }
    if (typeof value !== "object") {
      out[prefix || "Answer"] = String(value);
      return out;
    }
    for (const [k, v] of Object.entries(value)) {
      const label = prefix ? prefix + " · " + k : k;
      Object.assign(out, flattenAnswers(v, label));
    }
    return out;
  }

  function wireQueue() {
    for (const button of document.querySelectorAll("[data-queue-filter]"))
      button.addEventListener("click", () => {
        queueFilter = button.dataset.queueFilter;
        for (const other of document.querySelectorAll("[data-queue-filter]"))
          other.setAttribute("aria-pressed", String(other === button));
        renderQueue();
      });
    $("#queue-search").addEventListener("input", renderQueue);
    $("[data-close-detail]").addEventListener("click", () => {
      $("#director-detail").hidden = true;
      $("#queue-search").focus();
    });
  }

  async function wireLiveActions() {
    const claim = $("[data-claim]");
    const change = $("[data-change-status]");
    if (!claim || !change || !helpers.apiBase) return;

    claim.addEventListener("click", async () => {
      if (!selected) return;
      try {
        const r = await fetch(
          (helpers.apiBase || "") + "/api/admin/applications/" + encodeURIComponent(selected.id) + "/claim",
          { method: "POST", credentials: "include", headers: { Accept: "application/json" } },
        );
        const data = await r.json();
        if (!r.ok) throw new Error(data.message || "Could not update claim.");
        selected.claimedBy = data.claimedBy;
        text("[data-claim]", selected.claimedBy ? "Release application" : "Claim application");
        text("[data-detail-feedback]", selected.claimedBy ? "Application assigned to you." : "Application released.");
        await loadLivePage();
      } catch (e) {
        text("[data-detail-feedback]", e.message);
      }
    });

    change.addEventListener("click", async () => {
      if (!selected) return;
      try {
        const status = $("#director-status").value;
        const r = await fetch(
          (helpers.apiBase || "") + "/api/admin/applications/" + encodeURIComponent(selected.id) + "/status",
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ status }),
          },
        );
        const data = await r.json();
        if (!r.ok) throw new Error(data.message || "Could not change status.");
        text("[data-detail-feedback]", "Application moved to " + status + ".");
        await loadLivePage();
        // If moved to Interview, refresh open record to reveal interview section
        if (selected) openRecord(selected);
      } catch (e) {
        text("[data-detail-feedback]", e.message);
      }
    });
  }

  function previewAdmin() {
    message(
      "Preview workspace — fictional applications only. Changes stay on this page and reset when you reload.",
    );
    applications = [
      {
        id: "EXAMPLE-01",
        displayName: "Alex · example",
        roles: ["Spriter"],
        status: "Submitted",
        submittedAt: "Example day 1",
        claimedBy: null,
        answers: {
          Experience: "I make small overworld sprites and have practised walk cycles.",
          Availability: "Around three hours at weekends.",
          "Spriting areas": "Overworld sprites, icons",
          "Style comfort": "Small sprites with a limited palette.",
        },
      },
      {
        id: "EXAMPLE-02",
        displayName: "Rowan · example",
        roles: ["Programmer", "Move Animator"],
        status: "In review",
        submittedAt: "Example day 2",
        claimedBy: "Example Director",
        answers: {
          Experience: "I have built events in RPG Maker XP and tried writing simple plugins.",
          Availability: "Two evenings each week.",
          "Programming interests": "Events, plugins",
          "Animation experience": "Practising battle effects for a personal project.",
        },
      },
    ];
    $("#admin-shell").hidden = false;
    renderQueue();
  }

  async function loadLivePage() {
    const session = await helpers.loadSession();
    const msgNode = $("#" + page + "-message");
    if (msgNode) msgNode.hidden = true;

    if (!session?.user) {
      const lockTarget = $(
        page === "status"
          ? "#status-empty"
          : page === "interview"
            ? "#interview-signin"
            : "#admin-locked",
      );
      if (lockTarget) lockTarget.hidden = false;
      return;
    }

    try {
      const path = {
        status: "/api/application/status",
        interview: "/api/interview",
        admin: "/api/admin/applications",
      }[page];
      const data = await getJson(path);

      if (page === "status") {
        if (data.application) renderStatus(data.application);
        else {
          $("#status-empty").hidden = false;
          text("[data-empty-title]", "No application yet");
          text(
            "[data-empty-copy]",
            "There is no application attached to this Discord account. Choose Apply above to submit one.",
          );
        }
      } else if (page === "interview") {
        if (data.ticket) renderTicket(data.ticket);
        else $("#interview-empty").hidden = false;
      } else if (!data.authorized) {
        $("#admin-locked").hidden = false;
      } else {
        applications = data.applications || [];
        $("#admin-shell").hidden = false;
        renderQueue();
      }
    } catch (error) {
      if (page === "admin" && [401, 403].includes(error.status)) {
        $("#admin-locked").hidden = false;
      } else if (page === "interview" && error.status === 404) {
        $("#interview-empty").hidden = false;
      } else {
        message(error.message, true);
      }
    }
  }

  if (page === "admin") wireQueue();
  if (page === "admin" && helpers.apiBase) wireLiveActions();
  if (helpers.apiBase) loadLivePage();
  else if (page === "status") previewStatus();
  else if (page === "interview") previewInterview();
  else if (page === "admin") previewAdmin();
})();
