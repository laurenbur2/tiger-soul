/* ============================================================
   TIGER SOUL ACADEMY — student sign in
   Supabase auth. The anon key is public by design; Row Level
   Security is what protects the data, not this key.
   ============================================================ */
window.TS_ACADEMY_SUPABASE = {
  url: "https://werkohszkcytdvljafha.supabase.co",
  anonKey: "sb_publishable_YkTpPIzaCE-paCYapejC9w_G3iTt6g5"
};

(function () {
  "use strict";

  var cfg = window.TS_ACADEMY_SUPABASE;
  var sb = (window.supabase && cfg.anonKey)
    ? window.supabase.createClient(cfg.url, cfg.anonKey)
    : null;

  var form = document.getElementById("loginForm");
  if (!form) return;

  var msg = document.getElementById("authMsg");
  var submit = document.getElementById("authSubmit");
  var emailEl = document.getElementById("email");
  var pwEl = document.getElementById("password");
  var pwField = document.getElementById("pwField");
  var pwToggle = document.getElementById("pwToggle");
  var modeBtn = document.getElementById("modeBtn");
  var modeText = document.getElementById("modeText");
  var forgot = document.getElementById("forgotBtn");
  var mode = "password";

  function say(text, isError) {
    msg.textContent = text;
    msg.classList.toggle("auth__msg--err", !!isError);
    msg.hidden = false;
  }
  function quiet() { msg.hidden = true; }
  function busy(on, label) {
    submit.disabled = on;
    submit.textContent = on ? "One moment" : label;
  }

  pwToggle && pwToggle.addEventListener("click", function () {
    var show = pwEl.type === "password";
    pwEl.type = show ? "text" : "password";
    pwToggle.textContent = show ? "Hide" : "Show";
  });

  modeBtn && modeBtn.addEventListener("click", function () {
    quiet();
    mode = mode === "password" ? "link" : "password";
    if (mode === "link") {
      pwField.hidden = true;
      pwEl.required = false;
      submit.textContent = "Email me a sign in link";
      modeText.textContent = "Prefer a password?";
      modeBtn.textContent = "Use a password";
    } else {
      pwField.hidden = false;
      pwEl.required = true;
      submit.textContent = "Sign in";
      modeText.textContent = "No password yet?";
      modeBtn.textContent = "Email me a sign in link";
    }
  });

  forgot && forgot.addEventListener("click", function () {
    quiet();
    if (!sb) return say("Sign in is not connected yet. Write to hello@tigersoulretreats.com and we will let you in.", true);
    var email = (emailEl.value || "").trim();
    if (!email) return say("Enter your email first, then choose reset.", true);
    sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/login/"
    }).then(function (r) {
      if (r.error) return say(r.error.message, true);
      say("Reset link sent. Check your inbox.");
    });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    quiet();

    var email = (emailEl.value || "").trim();
    if (!email) return say("Please enter the email you enrolled with.", true);

    if (!sb) {
      return say("Sign in is not connected yet. Write to hello@tigersoulretreats.com and we will get you into your course.", true);
    }

    if (mode === "link") {
      busy(true);
      sb.auth.signInWithOtp({
        email: email,
        options: { emailRedirectTo: window.location.origin + "/login/" }
      }).then(function (r) {
        busy(false, "Email me a sign in link");
        if (r.error) return say(r.error.message, true);
        say("Link sent. Check your inbox, it expires in an hour.");
      });
      return;
    }

    var pw = pwEl.value || "";
    if (!pw) return say("Please enter your password.", true);

    busy(true);
    sb.auth.signInWithPassword({ email: email, password: pw }).then(function (r) {
      busy(false, "Sign in");
      if (r.error) return say(r.error.message, true);
      window.location.href = "../portal/";
    });
  });

  /* If we came back from an email link, the session lands here. */
  if (sb) {
    sb.auth.getSession().then(function (r) {
      if (r.data && r.data.session) {
        say("You are signed in. Opening your courses.");
        setTimeout(function () { window.location.href = "../portal/"; }, 900);
      }
    });
  }
})();
