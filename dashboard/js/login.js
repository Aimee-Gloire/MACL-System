/*
 * Login page logic (BL-13). Exchanges org credentials for a session token via
 * MACL.login(), then sends the user into the dashboard. Deliberately does NOT
 * load ui.js (which would redirect back here when no session exists yet).
 */
(function () {
  // Already signed in? Go straight in.
  if (MACL.isLoggedIn()) { location.href = "index.html"; return; }

  const form = document.getElementById("loginForm");
  const btn = document.getElementById("loginBtn");
  const err = document.getElementById("loginErr");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.classList.add("hidden");
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    btn.disabled = true;
    btn.textContent = "Signing in…";
    try {
      await MACL.login(username, password);
      location.href = "index.html";
    } catch (e2) {
      err.textContent = MACL.parseError(e2) || "Sign-in failed.";
      err.classList.remove("hidden");
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  });
})();
