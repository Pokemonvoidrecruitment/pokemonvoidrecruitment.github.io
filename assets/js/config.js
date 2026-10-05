(function () {
  // Mobile Cross-Domain Auth: Extract and preserve token immediately before anything else
  try {
    var urlParams = new URLSearchParams(window.location.search);
    var urlToken = urlParams.get("token");
    if (urlToken && urlToken !== "null" && urlToken !== "undefined") {
      window.__PV_TOKEN__ = urlToken;
      try { localStorage.setItem("pv_token", urlToken); } catch (e) {}
      try { sessionStorage.setItem("pv_token", urlToken); } catch (e) {}
      try {
        document.cookie = "pv_token=" + encodeURIComponent(urlToken) + "; path=/; max-age=2592000; SameSite=Lax; Secure";
      } catch (e) {}
    }
  } catch (e) {}

  var isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  window.VOID_RECRUITMENT = {
    apiBaseUrl: isLocal ? "" : "https://pokemonvoidrecruitmentgithubio-production.up.railway.app",
    discordLoginPath: "/auth/discord"
  };

  // Automatically clean .html from address bar without page reload
  if (window.location.pathname.endsWith(".html")) {
    var cleanPath = window.location.pathname.replace(/\.html$/, "");
    if (cleanPath.endsWith("/index")) cleanPath = cleanPath.slice(0, -6) || "/";
    window.history.replaceState(null, "", cleanPath + window.location.search + window.location.hash);
  }

  // Rewrite internal page navigation links to clean paths
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("a[href]").forEach(function (a) {
      var href = a.getAttribute("href");
      if (href && !href.startsWith("http") && !href.startsWith("//") && !href.startsWith("#") && !href.startsWith("mailto:")) {
        if (href === "index.html") {
          a.setAttribute("href", "./");
        } else if (href.endsWith(".html")) {
          a.setAttribute("href", href.replace(/\.html$/, ""));
        } else if (href.includes(".html?")) {
          a.setAttribute("href", href.replace(/\.html\?/, "?"));
        } else if (href.includes(".html#")) {
          a.setAttribute("href", href.replace(/\.html#/, "#"));
        }
      }
    });
  });
})();
