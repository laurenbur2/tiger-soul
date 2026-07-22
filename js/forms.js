/* ============================================================
   TIGER SOUL — public form submission

   Posts the contact form and the health screening to the Supabase
   Edge Functions in supabase/functions/, which send the email through
   Resend and reply { ok: true }. On success we send the visitor to a
   thank-you page; on failure we show the error above the button and
   leave their answers in place.
   ============================================================ */
(function () {
  "use strict";

  var FUNCTIONS_BASE = "https://werkohszkcytdvljafha.supabase.co/functions/v1";

  /* Collects every named control in the form into a plain object. */
  function collect(form) {
    var data = {};
    new FormData(form).forEach(function (value, key) {
      data[key] = typeof value === "string" ? value : "";
    });
    return data;
  }

  /* A status line that lives just above the submit button. */
  function statusEl(button) {
    var el = button.parentNode.querySelector(".form-status");
    if (!el) {
      el = document.createElement("p");
      el.className = "form-status";
      el.setAttribute("role", "status");
      button.parentNode.insertBefore(el, button);
    }
    return el;
  }

  function setStatus(el, message, kind) {
    el.textContent = message || "";
    el.className = "form-status" + (kind ? " form-status--" + kind : "");
  }

  /*
    Marks the first empty required field, focuses it, and returns false.
    Required fields are declared by `requiredFields` — the markup uses a
    visual asterisk rather than the `required` attribute.
  */
  function firstMissing(form, requiredFields) {
    for (var i = 0; i < requiredFields.length; i++) {
      var field = form.elements[requiredFields[i]];
      if (field && !String(field.value || "").trim()) return field;
    }
    return null;
  }

  /**
   * @param {Object} opts
   * @param {string} opts.formId      id of the <form>
   * @param {string} opts.endpoint    Edge Function name
   * @param {string} opts.redirect    page to land on after success
   * @param {string[]} opts.required  names of fields that must be filled
   * @param {string} opts.busyLabel   button text while sending
   */
  function wire(opts) {
    var form = document.getElementById(opts.formId);
    if (!form) return;

    /* The submit button may sit outside the <form> (the screening does). */
    var button = form.querySelector('button[type="submit"]') ||
      document.querySelector('[data-form="' + opts.formId + '"] button[type="submit"]');
    if (!button) return;

    /* Honeypot: off-screen, not tabbable, hidden from screen readers.
       Real people never fill it; bots that autofill everything do. */
    var pot = document.createElement("input");
    pot.type = "text";
    pot.name = "website";
    pot.tabIndex = -1;
    pot.autocomplete = "off";
    pot.setAttribute("aria-hidden", "true");
    pot.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0;";
    form.appendChild(pot);

    var status = statusEl(button);
    var idleLabel = button.textContent;
    var sending = false;

    function submit(event) {
      if (event) event.preventDefault();
      if (sending) return;

      var missing = firstMissing(form, opts.required);
      if (missing) {
        setStatus(status, "Please answer the question we've jumped you to, then send again.", "error");
        missing.focus();
        missing.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      sending = true;
      button.disabled = true;
      button.textContent = opts.busyLabel;
      setStatus(status, "");

      fetch(FUNCTIONS_BASE + "/" + opts.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(collect(form))
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (payload) {
            if (!res.ok) {
              /* Flagged so the catch below knows this message is ours and
                 safe to show, rather than a raw browser network error. */
              var err = new Error(payload.error || "That didn't go through.");
              err.fromServer = true;
              throw err;
            }
            return payload;
          });
        })
        .then(function () {
          /* Don't re-enable the button — we're navigating away. */
          window.location.href = opts.redirect;
        })
        .catch(function (err) {
          sending = false;
          button.disabled = false;
          button.textContent = idleLabel;
          /* Anything not from the server is a dropped connection or a blocked
             request — "Failed to fetch" means nothing to a visitor. */
          var message = err && err.fromServer
            ? err.message
            : "That didn't send. Check your connection and try again.";
          setStatus(
            status,
            message + " You can also email us at hello@tigersoulretreats.com.",
            "error"
          );
        });
    }

    form.addEventListener("submit", submit);
    /* The screening's button lives outside the form, so it needs its own click. */
    if (!form.contains(button)) button.addEventListener("click", submit);
  }

  wire({
    formId: "contactForm",
    endpoint: "contact-form",
    redirect: "/thank-you/",
    required: ["firstName", "lastName", "email", "message"],
    busyLabel: "Sending…"
  });

  wire({
    formId: "screeningForm",
    endpoint: "health-screening",
    redirect: "/thank-you-screening/",
    required: ["offering", "q5", "q6", "q8", "q9"],
    busyLabel: "Submitting…"
  });
})();
