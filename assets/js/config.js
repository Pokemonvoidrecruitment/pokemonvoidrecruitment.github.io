/* Same-origin deployment: the Node backend serves this site and its /api routes. */
window.VOID_RECRUITMENT = {
  apiBaseUrl: typeof window !== "undefined" && window.location ? window.location.origin : "",
  discordLoginPath: "/auth/discord",
};
