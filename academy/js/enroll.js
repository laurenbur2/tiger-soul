/* Tiger Soul Academy — application form.
   Posts to the same Supabase Edge Function the main site's contact form uses. */
(function () {
  "use strict";

  var ENDPOINT = "https://werkohszkcytdvljafha.supabase.co/functions/v1/contact-form";

  var form = document.getElementById("enrollForm");
  if (!form) return;

  var btn = document.getElementById("enrollSubmit");
  var msg = document.getElementById("enrollMsg");
  var idle = btn.textContent;
  var sending = false;

  function say(text, isError) {
    msg.textContent = text;
    msg.classList.toggle("auth__msg--err", !!isError);
    msg.hidden = false;
  }

  function collect() {
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name) return;
      out[el.name] = (el.value || "").trim();
    });
    return out;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (sending) return;

    var data = collect();
    var missing = ["firstName", "lastName", "email", "message"].filter(function (k) {
      return !data[k];
    });
    if (missing.length) {
      say("Please fill in your name, email, and a note about where you are.", true);
      var el = form.elements[missing[0]];
      el.focus();
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    /* The application is a contact enquiry with the track named up front, so the
       message that lands in the inbox reads as one thing. */
    data.message = "Academy application: " + (data.offering || "track not stated") +
      "\n\n" + data.message;

    sending = true;
    btn.disabled = true;
    btn.textContent = "Sending";
    say("");
    msg.hidden = true;

    fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data)
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (payload) {
          if (!res.ok) {
            var err = new Error(payload.error || "That didn't go through.");
            err.fromServer = true;
            throw err;
          }
        });
      })
      .then(function () {
        form.reset();
        btn.textContent = "Sent";
        say("Your application is in. Someone reads every one of these, and we will be in touch within a few days.");
      })
      .catch(function (err) {
        sending = false;
        btn.disabled = false;
        btn.textContent = idle;
        var text = (err && err.fromServer)
          ? err.message
          : "That didn't send. Check your connection and try again.";
        say(text + " You can also email hello@tigersoulretreats.com.", true);
      });
  });
})();
