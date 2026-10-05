(function () {
  "use strict";

  var config = window.VOID_RECRUITMENT || {};
  var apiBase = (config.apiBaseUrl || "").replace(/\/$/, "");

  function qs(selector, scope) {
    return (scope || document).querySelector(selector);
  }

  function qsa(selector, scope) {
    return Array.prototype.slice.call(
      (scope || document).querySelectorAll(selector),
    );
  }

  function setYear() {
    qsa("[data-current-year]").forEach(function (node) {
      node.textContent = new Date().getFullYear();
    });
  }

  function wireMobileMenu() {
    var button = qs("[data-menu-button]");
    var nav = qs("[data-site-nav]");
    if (!button || !nav) return;

    button.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      button.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("open")) {
        nav.classList.remove("open");
        button.setAttribute("aria-expanded", "false");
        button.focus();
      }
    });
  }

  function loginUrl(returnTo) {
    var path = config.discordLoginPath || "/auth/discord";
    return (
      (apiBase || "") +
      path +
      "?returnTo=" +
      encodeURIComponent(returnTo || window.location.href)
    );
  }

  async function logout() {
    try {
      await fetch((apiBase || "") + "/auth/logout", {
        method: "POST",
        credentials: "include"
      });
    } catch {}
    window.location.reload();
  }

  function wireDiscordLinks() {
    qsa("[data-discord-login]").forEach(function (link) {
      link.setAttribute(
        "href",
        loginUrl(link.getAttribute("data-return-to") || window.location.href),
      );
    });
  }

  function showInlineMessage(message, type) {
    var region = qs("[data-site-message]");
    if (!region) {
      region = document.createElement("div");
      region.dataset.siteMessage = "";
      region.setAttribute("role", "status");
      var main = document.querySelector("main");
      if (main) main.prepend(region);
    }
    if (region) {
      region.className = "notice-strip " + (type || "info");
      region.textContent = message;
      region.hidden = false;
      region.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function updateAccountUi(session) {
    var signedIn = Boolean(session && session.user);

    qsa("[data-account-state]").forEach(function (node) {
      if (!signedIn) {
        node.textContent = "Not signed in. Connect your Discord account to continue.";
        return;
      }
      var name = session.user.globalName || session.user.username || "Discord user";
      var roleBadge = session.user.isDirector ? " (Director)" : "";
      node.textContent = "Signed in as " + name + roleBadge;
    });

    qsa("[data-account-name]").forEach(function (node) {
      node.textContent = signedIn
        ? session.user.globalName || session.user.username || "Discord user"
        : "—";
    });

    qsa("[data-signed-out-only]").forEach(function (node) {
      node.hidden = signedIn;
    });
    qsa("[data-signed-in-only]").forEach(function (node) {
      node.hidden = !signedIn;
    });

    // Provide a sign-out button in account strips when signed in
    qsa(".account-strip").forEach(function (strip) {
      var existingLogout = strip.querySelector("[data-action-logout]");
      if (signedIn) {
        if (!existingLogout) {
          var logoutBtn = document.createElement("button");
          logoutBtn.type = "button";
          logoutBtn.className = "button ghost";
          logoutBtn.dataset.actionLogout = "true";
          logoutBtn.textContent = "Sign out";
          logoutBtn.style.marginLeft = "auto";
          logoutBtn.addEventListener("click", logout);
          strip.append(logoutBtn);
        }
      } else if (existingLogout) {
        existingLogout.remove();
      }
    });

    // If user is a Director, ensure the Director Portal link exists in navigation
    if (signedIn && session.user.isDirector) {
      var nav = qs("#site-nav");
      if (nav && !nav.querySelector('a[href="admin.html"]')) {
        var adminLink = document.createElement("a");
        adminLink.href = "admin.html";
        adminLink.textContent = "Director Portal";
        adminLink.style.borderColor = "#c69214";
        adminLink.style.color = "#ffe885";
        nav.append(adminLink);
      }
    }

    // Render Testing Dev Bar if in Dev Mode
    if (session && session.devMode) {
      renderDevBar(session);
    }
  }

  function renderDevBar(session) {
    if (qs("#pv-dev-bar")) return;
    var bar = document.createElement("div");
    bar.id = "pv-dev-bar";
    bar.style.background = "#18202d";
    bar.style.borderBottom = "1px solid #334460";
    bar.style.padding = "6px 16px";
    bar.style.fontSize = "13px";
    bar.style.color = "#cbd5e1";
    bar.style.display = "flex";
    bar.style.alignItems = "center";
    bar.style.gap = "12px";
    bar.style.flexWrap = "wrap";
    bar.style.zIndex = "9999";

    var label = document.createElement("span");
    label.innerHTML = "<strong>Test Switcher:</strong>";
    bar.append(label);

    var currentPath = window.location.pathname.startsWith("/") ? window.location.pathname : ("/" + window.location.pathname);
    var applicantBtn = document.createElement("a");
    applicantBtn.href = (apiBase || "") + "/auth/dev/login?role=applicant&name=Ash Ketchum&returnTo=" + encodeURIComponent(currentPath);
    applicantBtn.textContent = "Sign in as Applicant";
    applicantBtn.className = "button ghost";
    applicantBtn.style.padding = "3px 10px";
    applicantBtn.style.fontSize = "12px";
    bar.append(applicantBtn);

    var directorBtn = document.createElement("a");
    directorBtn.href = (apiBase || "") + "/auth/dev/login?role=director&name=Director Oak&returnTo=" + encodeURIComponent("/admin.html");
    directorBtn.textContent = "Sign in as Director";
    directorBtn.className = "button ghost";
    directorBtn.style.padding = "3px 10px";
    directorBtn.style.fontSize = "12px";
    bar.append(directorBtn);

    if (session.user) {
      var currentLabel = document.createElement("span");
      currentLabel.style.color = session.user.isDirector ? "#ffd700" : "#a3e635";
      currentLabel.textContent = "Active: " + (session.user.globalName || session.user.username) + (session.user.isDirector ? " (Director)" : " (Applicant)");
      bar.append(currentLabel);

      var signOut = document.createElement("button");
      signOut.type = "button";
      signOut.className = "text-button";
      signOut.textContent = "Sign out";
      signOut.style.fontSize = "12px";
      signOut.style.marginLeft = "auto";
      signOut.addEventListener("click", logout);
      bar.append(signOut);
    }

    document.body.prepend(bar);
  }

  async function loadSession() {
    try {
      var response = await fetch((apiBase || "") + "/api/session", {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        updateAccountUi(null);
        return null;
      }
      var session = await response.json();
      updateAccountUi(session);
      return session;
    } catch (error) {
      updateAccountUi(null);
      return null;
    }
  }

  window.VoidRecruitment = {
    apiBase: apiBase,
    loginUrl: loginUrl,
    logout: logout,
    loadSession: loadSession,
    showInlineMessage: showInlineMessage,
    qs: qs,
    qsa: qsa,
  };

  setYear();
  wireMobileMenu();
  wireDiscordLinks();
  loadSession();
})();
