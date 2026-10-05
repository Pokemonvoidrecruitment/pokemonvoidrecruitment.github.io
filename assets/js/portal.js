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

  function authHeaders(extra = {}) {
    return helpers.getAuthHeaders ? helpers.getAuthHeaders(extra) : Object.assign({}, extra);
  }

  function apiUrl(path) {
    if (helpers.apiUrl) return helpers.apiUrl(path);
    const base = (helpers.apiBase || "").replace(/\/$/, "");
    const cleanPath = path.startsWith("/") ? path : "/" + path;
    const token = helpers.getToken ? helpers.getToken() : null;
    let full = base + cleanPath;
    if (token) {
      const sep = full.indexOf("?") === -1 ? "?" : "&";
      full += sep + "token=" + encodeURIComponent(token);
    }
    return full;
  }

  function apiFetch(path, options = {}) {
    const url = apiUrl(path);
    const opts = Object.assign({}, options);
    opts.credentials = "include";
    const headers = Object.assign({}, opts.headers || { Accept: "application/json" });
    if (opts.body instanceof FormData) {
      delete headers["Content-Type"];
    }
    opts.headers = authHeaders(headers);
    return fetch(url, opts);
  }

  function formatFileSize(bytes) {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  function getFileIcon(name) {
    const ext = (name || "").split(".").pop().toLowerCase();
    if (["aseprite", "ase"].includes(ext)) return "🎨";
    if (["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus", "mid", "midi"].includes(ext)) return "🎵";
    if (ext === "rxdata") return "🗺️";
    if (ext === "dat") return "🎬";
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) return "🖼️";
    if (["mp4", "webm", "mov"].includes(ext)) return "🎥";
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "📦";
    return "📄";
  }

  function renderSelectedFiles(filesList, container, onRemove) {
    if (!container) return;
    container.innerHTML = "";
    filesList.forEach((file, index) => {
      const chip = document.createElement("div");
      chip.style.cssText = "display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; font-size: 12px; color: #f1f5f9; max-width: 280px;";
      
      const icon = document.createElement("span");
      icon.textContent = getFileIcon(file.name);
      
      const label = document.createElement("span");
      label.style.cssText = "overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
      label.textContent = `${file.name} (${formatFileSize(file.size)})`;
      label.title = file.name;
      
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.style.cssText = "background: none; border: none; color: #ef4444; cursor: pointer; font-size: 13px; line-height: 1; padding: 0 2px;";
      removeBtn.textContent = "✕";
      removeBtn.title = "Remove file";
      removeBtn.onclick = (e) => {
        e.preventDefault();
        if (onRemove) onRemove(index);
      };
      
      chip.append(icon, label, removeBtn);
      container.append(chip);
    });
  }

  let applicantPollInterval = null;
  function pollApplicantInterview() {
    if (applicantPollInterval) return;
    applicantPollInterval = setInterval(async () => {
      try {
        const r = await apiFetch("/api/application/status");
        if (!r.ok) return;
        const res = await r.json();
        if (res.application && res.application.interview) {
          const log = $("#ticket-log");
          const currentCount = log ? log.querySelectorAll(".ticket-entry").length : 0;
          const newCount = (res.application.interview.messages || []).length;
          if (newCount !== currentCount) {
            renderTicket(res.application.interview, false);
          }
        }
      } catch {}
    }, 3500);
  }

  let directorPollInterval = null;
  function pollDirectorInterview(appId) {
    if (directorPollInterval) clearInterval(directorPollInterval);
    directorPollInterval = setInterval(async () => {
      if (!selected || selected.id !== appId) {
        clearInterval(directorPollInterval);
        return;
      }
      try {
        const r = await apiFetch("/api/admin/applications/" + encodeURIComponent(appId));
        if (!r.ok) return;
        const res = await r.json();
        if (res.application && res.application.interview) {
          const currentCount = (selected.interview?.messages || []).length;
          const newCount = (res.application.interview.messages || []).length;
          if (newCount !== currentCount) {
            renderDirectorInterview(res.application.interview);
            selected.interview = res.application.interview;
          }
        }
      } catch {}
    }, 3500);
  }

  function message(copy, error = false) {
    const node = $("#" + page + "-message");
    if (!node) return;
    node.className = "notice-strip " + (error ? "error" : "info");
    node.textContent = copy;
    node.hidden = false;
  }

  async function getJson(path) {
    const response = await apiFetch(path, {
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
        "Sign in with Discord to view your application status.",
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

  function renderMessageBody(rawText) {
    const container = document.createElement("div");
    container.className = "ticket-body";
    if (!rawText) return container;

    // 1. Extract media & file attachments
    const attachmentNodes = [];
    const urlPattern = /(https?:\/\/[^\s<]+)/gi;

    function getFileName(url) {
      try {
        const pathname = new URL(url).pathname;
        const decoded = decodeURIComponent(pathname.split("/").pop() || "file");
        return decoded.replace(/-\d{10,14}-[a-f0-9]{4,12}(\.[a-zA-Z0-9]+)$/i, "$1") || decoded;
      } catch {
        return "attachment";
      }
    }

    const classifyUrl = (url) => {
      const cleanUrl = url.split("?")[0].toLowerCase();
      const isImg = /\.(png|jpe?g|gif|webp|bmp|svg|tiff)$/i.test(cleanUrl) ||
        /cdn\.discordapp\.com\/attachments\/.*\.(png|jpe?g|gif|webp|bmp|svg)/i.test(url) ||
        /media\.discordapp\.net\/attachments\/.*\.(png|jpe?g|gif|webp|bmp|svg)/i.test(url) ||
        /media\.tenor\.com\/.*\.gif/i.test(url) ||
        /media\.giphy\.com\/.*\.gif/i.test(url) ||
        /i\.imgur\.com\/.*\.(png|jpe?g|gif|webp)/i.test(url);
      const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(cleanUrl) ||
        /cdn\.discordapp\.com\/attachments\/.*\.(mp4|webm|mov|m4v)/i.test(url) ||
        /media\.discordapp\.net\/attachments\/.*\.(mp4|webm|mov|m4v)/i.test(url);
      const isAudio = /\.(mp3|wav|ogg|flac|m4a|aac|opus|mid|midi)$/i.test(cleanUrl) ||
        /cdn\.discordapp\.com\/attachments\/.*\.(mp3|wav|ogg|flac|m4a|aac|opus|mid|midi)/i.test(url);
      const isAseprite = /\.(aseprite|ase)$/i.test(cleanUrl) ||
        /cdn\.discordapp\.com\/attachments\/.*\.(aseprite|ase)/i.test(url);
      const isRxdata = /\.rxdata$/i.test(cleanUrl) ||
        /cdn\.discordapp\.com\/attachments\/.*\.rxdata/i.test(url);
      const isDat = /\.dat$/i.test(cleanUrl) ||
        /cdn\.discordapp\.com\/attachments\/.*\.dat/i.test(url);
      const isArchive = /\.(zip|rar|7z|tar|gz|rb|json|txt|pdf)$/i.test(cleanUrl) ||
        /cdn\.discordapp\.com\/attachments\/.*\.(zip|rar|7z|tar|gz|rb|json|txt|pdf)/i.test(url);

      return { isImg, isVideo, isAudio, isAseprite, isRxdata, isDat, isArchive };
    };

    // Remove media & file URLs from text and collect their HTML elements
    let stripped = String(rawText).replace(urlPattern, (matchedUrl) => {
      let url = matchedUrl;
      let trailingPunct = "";
      const matchPunct = url.match(/[.,!?;:)>]+$/);
      if (matchPunct) {
        trailingPunct = matchPunct[0];
        url = url.slice(0, -trailingPunct.length);
      }
      const c = classifyUrl(url);
      if (c.isImg) {
        attachmentNodes.push(
          `<a href="${url}" target="_blank" rel="noopener noreferrer" style="display:inline-block; margin-top:8px; margin-right:8px;"><img class="ticket-media-img" src="${url}" loading="lazy" alt="Image" style="max-width: 100%; max-height: 400px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); display: block;" onerror="this.onerror=null;this.style.display='none';"></a>`
        );
        return "";
      }
      if (c.isVideo) {
        attachmentNodes.push(
          `<div style="margin-top:8px;"><video class="ticket-media-video" controls playsinline src="${url}" preload="metadata" style="max-width: 100%; max-height: 400px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); display: block;"></video></div>`
        );
        return "";
      }
      if (c.isAudio) {
        const name = getFileName(url);
        attachmentNodes.push(
          `<div class="ticket-file-card ticket-audio-card" style="margin-top:8px; padding:12px 14px; background:rgba(15, 23, 42, 0.75); border:1px solid #38bdf8; border-radius:10px; display:flex; flex-direction:column; gap:8px; max-width:480px;">` +
            `<div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">` +
              `<span style="font-size:13px; font-weight:600; color:#38bdf8; display:flex; align-items:center; gap:6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">` +
                `🎵 <span title="${name}">${name}</span>` +
              `</span>` +
              `<a href="${url}" download="${name}" target="_blank" rel="noopener noreferrer" class="button ghost" style="padding:3px 10px; font-size:11px; text-decoration:none; white-space:nowrap; border-color:#38bdf8; color:#e0f2fe;">Download ⬇</a>` +
            `</div>` +
            `<audio controls preload="metadata" src="${url}" style="width:100%; height:36px; outline:none; border-radius:4px;"></audio>` +
          `</div>`
        );
        return "";
      }
      if (c.isAseprite) {
        const name = getFileName(url);
        attachmentNodes.push(
          `<div class="ticket-file-card ticket-aseprite-card" style="margin-top:8px; padding:12px 14px; background:rgba(30, 27, 75, 0.65); border:1px solid #818cf8; border-radius:10px; display:flex; align-items:center; justify-content:space-between; gap:12px; max-width:480px;">` +
            `<div style="display:flex; align-items:center; gap:10px; min-width:0;">` +
              `<span style="font-size:24px; line-height:1;">🎨</span>` +
              `<div style="min-width:0;">` +
                `<div style="font-size:13px; font-weight:600; color:#e0e7ff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${name}">${name}</div>` +
                `<div style="font-size:11px; color:#a5b4fc;">Aseprite Sprite File · Spriter Asset</div>` +
              `</div>` +
            `</div>` +
            `<a href="${url}" download="${name}" target="_blank" rel="noopener noreferrer" class="button primary" style="padding:4px 12px; font-size:12px; text-decoration:none; white-space:nowrap; background:#6366f1; border-color:#6366f1; color:#fff;">Download ⬇</a>` +
          `</div>`
        );
        return "";
      }
      if (c.isRxdata) {
        const name = getFileName(url);
        attachmentNodes.push(
          `<div class="ticket-file-card ticket-rxdata-card" style="margin-top:8px; padding:12px 14px; background:rgba(19, 78, 74, 0.6); border:1px solid #2dd4bf; border-radius:10px; display:flex; align-items:center; justify-content:space-between; gap:12px; max-width:480px;">` +
            `<div style="display:flex; align-items:center; gap:10px; min-width:0;">` +
              `<span style="font-size:24px; line-height:1;">🗺️</span>` +
              `<div style="min-width:0;">` +
                `<div style="font-size:13px; font-weight:600; color:#ccfbf1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${name}">${name}</div>` +
                `<div style="font-size:11px; color:#5eead4;">RPG Maker XP / Essentials Map File (.rxdata)</div>` +
              `</div>` +
            `</div>` +
            `<a href="${url}" download="${name}" target="_blank" rel="noopener noreferrer" class="button primary" style="padding:4px 12px; font-size:12px; text-decoration:none; white-space:nowrap; background:#0d9488; border-color:#0d9488; color:#fff;">Download ⬇</a>` +
          `</div>`
        );
        return "";
      }
      if (c.isDat) {
        const name = getFileName(url);
        attachmentNodes.push(
          `<div class="ticket-file-card ticket-dat-card" style="margin-top:8px; padding:12px 14px; background:rgba(120, 53, 15, 0.5); border:1px solid #f59e0b; border-radius:10px; display:flex; align-items:center; justify-content:space-between; gap:12px; max-width:480px;">` +
            `<div style="display:flex; align-items:center; gap:10px; min-width:0;">` +
              `<span style="font-size:24px; line-height:1;">🎬</span>` +
              `<div style="min-width:0;">` +
                `<div style="font-size:13px; font-weight:600; color:#fef3c7; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${name}">${name}</div>` +
                `<div style="font-size:11px; color:#fcd34d;">Animation / Move Data (.dat) · Move Animators</div>` +
              `</div>` +
            `</div>` +
            `<a href="${url}" download="${name}" target="_blank" rel="noopener noreferrer" class="button primary" style="padding:4px 12px; font-size:12px; text-decoration:none; white-space:nowrap; background:#d97706; border-color:#d97706; color:#fff;">Download ⬇</a>` +
          `</div>`
        );
        return "";
      }
      if (c.isArchive) {
        const name = getFileName(url);
        attachmentNodes.push(
          `<div class="ticket-file-card ticket-archive-card" style="margin-top:8px; padding:12px 14px; background:rgba(30, 41, 59, 0.65); border:1px solid #64748b; border-radius:10px; display:flex; align-items:center; justify-content:space-between; gap:12px; max-width:480px;">` +
            `<div style="display:flex; align-items:center; gap:10px; min-width:0;">` +
              `<span style="font-size:24px; line-height:1;">📦</span>` +
              `<div style="min-width:0;">` +
                `<div style="font-size:13px; font-weight:600; color:#f1f5f9; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${name}">${name}</div>` +
                `<div style="font-size:11px; color:#94a3b8;">Asset Archive / Project Document</div>` +
              `</div>` +
            `</div>` +
            `<a href="${url}" download="${name}" target="_blank" rel="noopener noreferrer" class="button ghost" style="padding:4px 12px; font-size:12px; text-decoration:none; white-space:nowrap; border-color:#64748b; color:#f1f5f9;">Download ⬇</a>` +
          `</div>`
        );
        return "";
      }
      // Non-media URL: protect with placeholder
      return `###URL_TOKEN:${encodeURIComponent(url)}###` + trailingPunct;
    });

    // 2. Escape HTML
    let safe = stripped
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // 3. Restore non-media URLs as clickable links
    safe = safe.replace(/###URL_TOKEN:(.*?)###/g, (_, encoded) => {
      const url = decodeURIComponent(encoded);
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="ticket-link" style="color: #38bdf8; text-decoration: underline; word-break: break-all;">${url}</a>`;
    });

    // 4. Replace Discord custom emojis: <:name:id> or <a:name:id>
    safe = safe.replace(/&lt;(a)?:([a-zA-Z0-9_]+):([0-9]+)&gt;/g, (match, anim, name, id) => {
      const ext = anim ? "gif" : "png";
      return `<img class="discord-emoji" src="https://cdn.discordapp.com/emojis/${id}.${ext}?size=48" alt=":${name}:" title=":${name}:" loading="lazy" style="width: 1.45em; height: 1.45em; vertical-align: -0.3em; display: inline-block; object-fit: contain;">`;
    });

    safe = safe.trim().replace(/\n/g, "<br>");
    const attachmentHtml = attachmentNodes.length ? `<div class="ticket-attachments-group" style="margin-top: ${safe ? '8px' : '0'}; display:flex; flex-direction:column; gap:8px;">${attachmentNodes.join("")}</div>` : "";
    container.innerHTML = (safe ? `<div>${safe}</div>` : "") + attachmentHtml;
    return container;
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
      sender.textContent = item.senderType === "director" ? "Director" : (item.senderLabel || "Applicant");
      const when = document.createElement("span");
      when.textContent = item.sentAt || "";
      meta.append(sender, when);
      const body = renderMessageBody(item.body || "");
      entry.append(meta, body);
      log.append(entry);
    }
    if (!ticket.messages?.length) {
      const empty = document.createElement("p");
      empty.className = "ticket-empty";
      empty.textContent = "No messages in this ticket yet. Write a reply below to contact the Directors.";
      log.append(empty);
    }

    // Wire up applicant reply sending with file attachments
    if (!example) {
      const replyBtn = $("[data-send-reply]");
      const replyInput = $("#ticket-reply");
      const fileInput = $("#ticket-file-input");
      const fileList = $("#ticket-file-list");
      let attachedFiles = [];

      const updateChips = () => {
        renderSelectedFiles(attachedFiles, fileList, (idx) => {
          attachedFiles.splice(idx, 1);
          updateChips();
        });
      };

      if (fileInput && !fileInput.dataset.wired) {
        fileInput.dataset.wired = "true";
        fileInput.addEventListener("change", () => {
          if (fileInput.files && fileInput.files.length) {
            for (let i = 0; i < fileInput.files.length; i++) {
              if (attachedFiles.length < 5) {
                attachedFiles.push(fileInput.files[i]);
              }
            }
            fileInput.value = "";
            updateChips();
          }
        });
      }

      if (replyBtn && replyInput && !replyBtn.dataset.wired) {
        replyBtn.dataset.wired = "true";
        replyBtn.addEventListener("click", async () => {
          const body = replyInput.value.trim();
          if (!body && !attachedFiles.length) return;
          replyBtn.disabled = true;
          replyBtn.textContent = "Sending…";
          try {
            let r;
            if (attachedFiles.length > 0) {
              const formData = new FormData();
              if (body) formData.append("message", body);
              for (const file of attachedFiles) {
                formData.append("files", file);
              }
              r = await apiFetch("/api/interview/message", {
                method: "POST",
                body: formData,
              });
            } else {
              r = await apiFetch("/api/interview/message", {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ message: body })
              });
            }
            const res = await r.json();
            if (!r.ok) throw new Error(res.message || "Failed to send message.");
            replyInput.value = "";
            attachedFiles = [];
            updateChips();
            renderTicket(res.ticket, false);
          } catch (err) {
            alert(err.message);
          } finally {
            replyBtn.disabled = false;
            replyBtn.textContent = "Send reply";
          }
        });
      }
      pollApplicantInterview();
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

  const selectedAppIds = new Set();

  function updateBulkToolbar() {
    const toolbar = $("[data-bulk-toolbar]");
    const countEl = $("[data-bulk-count]");
    const selectAllCheckbox = $("#queue-select-all");
    if (!toolbar) return;

    if (selectedAppIds.size > 0) {
      toolbar.style.display = "flex";
      if (countEl) countEl.textContent = `${selectedAppIds.size} application${selectedAppIds.size === 1 ? "" : "s"} selected`;
    } else {
      toolbar.style.display = "none";
    }

    if (selectAllCheckbox) {
      const visibleCheckboxes = document.querySelectorAll(".queue-row-select");
      if (visibleCheckboxes.length > 0) {
        selectAllCheckbox.checked = Array.from(visibleCheckboxes).every(cb => cb.checked);
      } else {
        selectAllCheckbox.checked = false;
      }
    }
  }

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

      // Checkbox column
      const checkTd = document.createElement("td");
      checkTd.style.textAlign = "center";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "queue-row-select";
      cb.dataset.appId = app.id;
      cb.checked = selectedAppIds.has(app.id);
      cb.addEventListener("change", (e) => {
        e.stopPropagation();
        if (cb.checked) selectedAppIds.add(app.id);
        else selectedAppIds.delete(app.id);
        updateBulkToolbar();
      });
      checkTd.append(cb);
      row.append(checkTd);

      // Applicant name button
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

      // Row Delete button
      const actionTd = document.createElement("td");
      actionTd.style.textAlign = "right";
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "text-button";
      delBtn.title = "Delete application";
      delBtn.textContent = "🗑️";
      delBtn.style.color = "#ef4444";
      delBtn.style.padding = "4px 8px";
      delBtn.style.borderRadius = "4px";
      delBtn.style.cursor = "pointer";
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Permanently delete application ${app.id} (${app.displayName || "Applicant"})?`)) return;
        delBtn.disabled = true;
        try {
          if (helpers.apiBase) {
            const r = await apiFetch("/api/admin/applications/" + encodeURIComponent(app.id), {
              method: "DELETE",
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.message || "Failed to delete.");
            selectedAppIds.delete(app.id);
            if (selected?.id === app.id) {
              $("#director-detail").hidden = true;
              selected = null;
            }
            await loadLivePage();
          } else {
            applications = applications.filter(a => a.id !== app.id);
            selectedAppIds.delete(app.id);
            if (selected?.id === app.id) {
              $("#director-detail").hidden = true;
              selected = null;
            }
            renderQueue();
          }
        } catch (err) {
          alert("Delete failed: " + err.message);
        }
      });
      actionTd.append(delBtn);
      row.append(actionTd);

      body.append(row);
    }
    $("[data-queue-empty]").hidden = visible.length > 0;
    text(
      "[data-queue-count]",
      visible.length + " of " + applications.length + " applications",
    );
    updateBulkToolbar();
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
      const body = renderMessageBody(item.body || "");
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
          pollDirectorInterview(selected.id);

          const dirFileInput = $("#director-file-input");
          const dirFileList = $("#director-file-list");
          let directorAttachedFiles = [];

          const updateDirChips = () => {
            renderSelectedFiles(directorAttachedFiles, dirFileList, (idx) => {
              directorAttachedFiles.splice(idx, 1);
              updateDirChips();
            });
          };

          if (dirFileInput && !dirFileInput.dataset.wired) {
            dirFileInput.dataset.wired = "true";
            dirFileInput.addEventListener("change", () => {
              if (dirFileInput.files && dirFileInput.files.length) {
                for (let i = 0; i < dirFileInput.files.length; i++) {
                  if (directorAttachedFiles.length < 5) {
                    directorAttachedFiles.push(dirFileInput.files[i]);
                  }
                }
                dirFileInput.value = "";
                updateDirChips();
              }
            });
          }

          if (directorSendBtn && !directorSendBtn.dataset.wired) {
            directorSendBtn.dataset.wired = "true";
            directorSendBtn.addEventListener("click", async () => {
              const body = directorReplyInput.value.trim();
              if (!body && !directorAttachedFiles.length || !selected) return;
              directorSendBtn.disabled = true;
              directorSendBtn.textContent = "Sending…";
              try {
                let r;
                if (directorAttachedFiles.length > 0) {
                  const formData = new FormData();
                  if (body) formData.append("message", body);
                  for (const file of directorAttachedFiles) {
                    formData.append("files", file);
                  }
                  r = await apiFetch(
                    "/api/admin/applications/" + encodeURIComponent(selected.id) + "/interview/message",
                    {
                      method: "POST",
                      body: formData,
                    }
                  );
                } else {
                  r = await apiFetch(
                    "/api/admin/applications/" + encodeURIComponent(selected.id) + "/interview/message",
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json", Accept: "application/json" },
                      body: JSON.stringify({ message: body }),
                    }
                  );
                }
                const res = await r.json();
                if (!r.ok) throw new Error(res.message || "Could not send message.");
                directorReplyInput.value = "";
                directorAttachedFiles = [];
                updateDirChips();
                renderDirectorInterview(res.ticket);
                selected.interview = res.ticket;
              } catch (err) {
                alert(err.message);
              } finally {
                directorSendBtn.disabled = false;
                directorSendBtn.textContent = "Send message";
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

    const selectAll = $("#queue-select-all");
    if (selectAll) {
      selectAll.addEventListener("change", () => {
        const visibleCheckboxes = document.querySelectorAll(".queue-row-select");
        for (const cb of visibleCheckboxes) {
          cb.checked = selectAll.checked;
          const id = cb.dataset.appId;
          if (id) {
            if (selectAll.checked) selectedAppIds.add(id);
            else selectedAppIds.delete(id);
          }
        }
        updateBulkToolbar();
      });
    }

    const deselectBtn = $("[data-bulk-deselect]");
    if (deselectBtn) {
      deselectBtn.addEventListener("click", () => {
        selectedAppIds.clear();
        const visibleCheckboxes = document.querySelectorAll(".queue-row-select");
        for (const cb of visibleCheckboxes) cb.checked = false;
        if (selectAll) selectAll.checked = false;
        updateBulkToolbar();
      });
    }

    const bulkDeleteBtn = $("[data-bulk-delete]");
    if (bulkDeleteBtn) {
      bulkDeleteBtn.addEventListener("click", async () => {
        if (selectedAppIds.size === 0) return;
        const count = selectedAppIds.size;
        const confirmed = window.confirm(`Permanently delete ${count} selected application${count === 1 ? "" : "s"}? This action cannot be undone.`);
        if (!confirmed) return;

        bulkDeleteBtn.disabled = true;
        try {
          if (helpers.apiBase) {
            const r = await apiFetch("/api/admin/applications/bulk-delete", {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ ids: Array.from(selectedAppIds) }),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.message || "Bulk delete failed.");
            if (selected && selectedAppIds.has(selected.id)) {
              $("#director-detail").hidden = true;
              selected = null;
            }
            selectedAppIds.clear();
            await loadLivePage();
            alert(`Successfully deleted ${data.deletedCount} application(s).`);
          } else {
            applications = applications.filter((a) => !selectedAppIds.has(a.id));
            if (selected && selectedAppIds.has(selected.id)) {
              $("#director-detail").hidden = true;
              selected = null;
            }
            selectedAppIds.clear();
            renderQueue();
          }
        } catch (err) {
          alert("Delete failed: " + err.message);
        } finally {
          bulkDeleteBtn.disabled = false;
          updateBulkToolbar();
        }
      });
    }
  }

  async function wireLiveActions() {
    const claim = $("[data-claim]");
    const change = $("[data-change-status]");
    if (!claim || !change || !helpers.apiBase) return;

    claim.addEventListener("click", async () => {
      if (!selected) return;
      try {
        const r = await apiFetch(
          "/api/admin/applications/" + encodeURIComponent(selected.id) + "/claim",
          { method: "POST" },
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
        const r = await apiFetch(
          "/api/admin/applications/" + encodeURIComponent(selected.id) + "/status",
          {
            method: "POST",
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

    const deleteBtn = $("[data-delete-application]");
    if (deleteBtn && !deleteBtn.dataset.wired) {
      deleteBtn.dataset.wired = "true";
      deleteBtn.addEventListener("click", async () => {
        if (!selected) return;
        const confirmDelete = window.confirm(`Are you sure you want to permanently delete application ${selected.id} (${selected.displayName || "Applicant"})? This action cannot be undone.`);
        if (!confirmDelete) return;

        deleteBtn.disabled = true;
        try {
          const r = await apiFetch(
            "/api/admin/applications/" + encodeURIComponent(selected.id),
            { method: "DELETE" }
          );
          const data = await r.json();
          if (!r.ok) throw new Error(data.message || "Could not delete application.");
          $("#director-detail").hidden = true;
          selected = null;
          await loadLivePage();
          alert(`Application ${data.deleted} has been permanently deleted.`);
        } catch (e) {
          alert("Delete failed: " + e.message);
        } finally {
          deleteBtn.disabled = false;
        }
      });
    }
  }

  function previewAdmin() {
    message(
      "Preview workspace — fictional applications only. Changes stay on this page and reset when you reload.",
    );
    const deleteBtn = $("[data-delete-application]");
    if (deleteBtn && !deleteBtn.dataset.wiredPreview) {
      deleteBtn.dataset.wiredPreview = "true";
      deleteBtn.addEventListener("click", () => {
        if (!selected) return;
        if (confirm(`Delete application ${selected.id}?`)) {
          applications = applications.filter((a) => a.id !== selected.id);
          $("#director-detail").hidden = true;
          selected = null;
          renderQueue();
        }
      });
    }
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

    if (page === "admin" && !session.user.isDirector) {
      const lockedSec = $("#admin-locked");
      if (lockedSec) {
        lockedSec.hidden = false;
        text("#admin-locked-title", "Director access restricted");
        const name = session.user.globalName || session.user.username;
        const copyNode = $("#admin-locked-copy");
        if (copyNode) {
          copyNode.innerHTML = `Signed in as <strong>${name}</strong>, but this Discord account does not have the Recruitment Director role in the server. Only authorized staff can view the application desk.`;
        }
        const loginBtn = $("#admin-login-btn");
        if (loginBtn) loginBtn.hidden = true;
        const switchBtn = $("#admin-switch-btn");
        if (switchBtn) {
          switchBtn.hidden = false;
          switchBtn.textContent = "Sign out / Switch account";
          switchBtn.onclick = () => helpers.logout();
        }
      }
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
        const lockedSec = $("#admin-locked");
        if (lockedSec) {
          lockedSec.hidden = false;
          text("#admin-locked-title", "Director access restricted");
          const name = session?.user?.globalName || session?.user?.username || "this account";
          const copyNode = $("#admin-locked-copy");
          if (copyNode) {
            copyNode.innerHTML = `Signed in as <strong>${name}</strong>, but this Discord account does not have the Recruitment Director role in the server.`;
          }
          const loginBtn = $("#admin-login-btn");
          if (loginBtn) loginBtn.hidden = true;
          const switchBtn = $("#admin-switch-btn");
          if (switchBtn) {
            switchBtn.hidden = false;
            switchBtn.textContent = "Sign out / Switch account";
            switchBtn.onclick = () => helpers.logout();
          }
        }
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
