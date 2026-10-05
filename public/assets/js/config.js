(function () {
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
