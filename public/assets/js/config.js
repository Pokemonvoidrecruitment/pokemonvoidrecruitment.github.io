(function () {
  var isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  window.VOID_RECRUITMENT = {
    apiBaseUrl: isLocal ? "" : "https://pokemonvoidrecruitmentgithubio-production.up.railway.app",
    discordLoginPath: "/auth/discord"
  };
})();
