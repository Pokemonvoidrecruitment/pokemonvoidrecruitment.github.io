(function () {
  "use strict";

  var config = window.VOID_RECRUITMENT || {};
  var apiBase = (config.apiBaseUrl || "").replace(/\/$/, "");

  function getStoredToken() {
    if (window.__PV_TOKEN__ && window.__PV_TOKEN__ !== "null" && window.__PV_TOKEN__ !== "undefined") {
      return window.__PV_TOKEN__;
    }
    var token = null;
    try { token = localStorage.getItem("pv_token"); } catch (e) {}
    if (!token || token === "null" || token === "undefined") {
      try { token = sessionStorage.getItem("pv_token"); } catch (e) {}
    }
    if (!token || token === "null" || token === "undefined") {
      try {
        var match = document.cookie.match(/(?:^|;\s*)pv_token=([^;]+)/);
        if (match) token = decodeURIComponent(match[1]);
      } catch (e) {}
    }
    if (token && token !== "null" && token !== "undefined") {
      window.__PV_TOKEN__ = token;
      return token;
    }
    return null;
  }

  function saveToken(token) {
    if (!token || token === "null" || token === "undefined") return;
    window.__PV_TOKEN__ = token;
    try { localStorage.setItem("pv_token", token); } catch (e) {}
    try { sessionStorage.setItem("pv_token", token); } catch (e) {}
    try {
      document.cookie = "pv_token=" + encodeURIComponent(token) + "; path=/; max-age=2592000; SameSite=Lax; Secure";
    } catch (e) {}
  }

  function clearStoredToken() {
    window.__PV_TOKEN__ = null;
    try { localStorage.removeItem("pv_token"); } catch (e) {}
    try { sessionStorage.removeItem("pv_token"); } catch (e) {}
    try {
      document.cookie = "pv_token=; path=/; max-age=0; SameSite=Lax; Secure";
    } catch (e) {}
  }

  // Mobile Cross-Domain Auth: Extract token from URL if returning from OAuth
  try {
    var urlParams = new URLSearchParams(window.location.search);
    var urlToken = urlParams.get("token");
    if (urlToken && urlToken !== "null" && urlToken !== "undefined") {
      saveToken(urlToken);
      urlParams.delete("token");
      var cleanSearch = urlParams.toString();
      var cleanUrl = window.location.pathname + (cleanSearch ? "?" + cleanSearch : "") + window.location.hash;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  } catch (e) {}

  function apiUrl(path) {
    var base = (apiBase || "").replace(/\/$/, "");
    var cleanPath = path.startsWith("/") ? path : "/" + path;
    var full = base + cleanPath;
    var token = getStoredToken();
    if (token) {
      var sep = full.indexOf("?") === -1 ? "?" : "&";
      full += sep + "token=" + encodeURIComponent(token);
    }
    return full;
  }

  function getAuthHeaders(extraHeaders) {
    var headers = Object.assign({}, extraHeaders || {});
    var token = getStoredToken();
    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }
    return headers;
  }

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
    var dest = returnTo || window.location.href;
    try {
      var u = new URL(dest, window.location.origin);
      u.searchParams.delete("token");
      dest = u.toString();
    } catch (e) {}
    return (
      (apiBase || "") +
      path +
      "?returnTo=" +
      encodeURIComponent(dest)
    );
  }

  async function logout() {
    try {
      await fetch(apiUrl("/auth/logout"), {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders({ Accept: "application/json" })
      });
    } catch {}
    clearStoredToken();
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

    // Update Header Navigation with Discord Auth Item
    var nav = qs("#site-nav");
    if (nav) {
      var existingAuth = nav.querySelector("#nav-auth-item");
      if (!existingAuth) {
        existingAuth = document.createElement("div");
        existingAuth.id = "nav-auth-item";
        existingAuth.style.display = "flex";
        existingAuth.style.alignItems = "center";
        existingAuth.style.gap = "8px";
        existingAuth.style.marginLeft = "8px";
        nav.append(existingAuth);
      }
      existingAuth.innerHTML = "";

      var existingAdminLink = nav.querySelector('a[data-director-link="true"]');
      if (signedIn && session.user.isDirector) {
        if (!existingAdminLink) {
          var adminLink = document.createElement("a");
          adminLink.href = "admin.html";
          adminLink.dataset.directorLink = "true";
          adminLink.textContent = "Director Desk";
          adminLink.style.borderColor = "#c69214";
          adminLink.style.color = "#ffe885";
          nav.insertBefore(adminLink, existingAuth);
        }
      } else if (existingAdminLink) {
        existingAdminLink.remove();
      }

      if (signedIn) {
        var userBadge = document.createElement("span");
        userBadge.style.fontSize = "13px";
        userBadge.style.color = session.user.isDirector ? "#ffd700" : "#cbd5e1";
        userBadge.style.display = "inline-flex";
        userBadge.style.alignItems = "center";
        userBadge.style.gap = "6px";
        var dot = document.createElement("span");
        dot.style.display = "inline-block";
        dot.style.width = "8px";
        dot.style.height = "8px";
        dot.style.borderRadius = "50%";
        dot.style.background = dotColor;
        var nameSpan = document.createElement("span");
        nameSpan.textContent = session.user.globalName || session.user.username;
        userBadge.append(dot, nameSpan);

        var signOutBtn = document.createElement("button");
        signOutBtn.type = "button";
        signOutBtn.className = "button ghost";
        signOutBtn.style.padding = "3px 8px";
        signOutBtn.style.fontSize = "12px";
        signOutBtn.textContent = "Sign out";
        signOutBtn.addEventListener("click", logout);

        existingAuth.append(userBadge, signOutBtn);
      } else {
        var signInBtn = document.createElement("a");
        signInBtn.href = loginUrl();
        signInBtn.className = "button primary";
        signInBtn.style.padding = "4px 12px";
        signInBtn.style.fontSize = "13px";
        signInBtn.style.background = "#5865F2";
        signInBtn.style.borderColor = "#5865F2";
        signInBtn.style.color = "#fff";
        signInBtn.textContent = "Sign in with Discord";
        existingAuth.append(signInBtn);
      }
    }

    // Dev bar removed completely
    var oldDevBar = qs("#pv-dev-bar");
    if (oldDevBar) oldDevBar.remove();
  }

  async function loadSession() {
    try {
      var response = await fetch(apiUrl("/api/session"), {
        credentials: "include",
        headers: getAuthHeaders({ Accept: "application/json" }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          clearStoredToken();
        }
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
    apiUrl: apiUrl,
    getToken: getStoredToken,
    saveToken: saveToken,
    clearToken: clearStoredToken,
    loginUrl: loginUrl,
    logout: logout,
    loadSession: loadSession,
    getAuthHeaders: getAuthHeaders,
    showInlineMessage: showInlineMessage,
    qs: qs,
    qsa: qsa,
  };

  setYear();
  wireMobileMenu();
  wireDiscordLinks();
  loadSession();
})();
