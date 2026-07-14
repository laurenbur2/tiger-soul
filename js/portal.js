/* ============================================================
   TIGER SOUL — MEMBER PORTAL
   Auth + session via Supabase. Section data is sample data for now,
   being wired to the database section by section. Demo mode still
   works offline (the "Enter as a demo member" button).
   ============================================================ */
(async function () {
  "use strict";

  var LS_KEY = "tigersoul_member";
  var LS_MSGS = "tigersoul_portal_msgs";
  var sb = window.supabaseClient || null;

  /* ---------- Session helpers ---------- */
  function getMember() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { return null; }
  }
  function setMember(m) { localStorage.setItem(LS_KEY, JSON.stringify(m)); }
  function clearMember() { localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_MSGS); }
  function initials(name) {
    return name.split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase();
  }

  /* ============================================================
     LOGIN PAGE
     ============================================================ */
  var loginForm = document.getElementById("loginForm");
  if (loginForm) { setupLogin(); return; }

  function setupLogin() {
    var demoBtn = document.getElementById("demoBtn");
    var errEl = document.getElementById("loginError");
    var toggle = document.getElementById("toggleMode");
    var nameField = document.getElementById("nameField");
    var submitBtn = loginForm.querySelector(".auth__submit");
    var mode = "signin";

    function showErr(m) { errEl.textContent = m; errEl.hidden = false; }
    function go() { window.location.href = "portal.html"; }

    var pwToggle = document.getElementById("pwToggle");
    var pwInput = document.getElementById("password");
    pwToggle && pwToggle.addEventListener("click", function () {
      var show = pwInput.type === "password";
      pwInput.type = show ? "text" : "password";
      pwToggle.textContent = show ? "Hide" : "Show";
      pwToggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });

    toggle && toggle.addEventListener("click", function () {
      mode = mode === "signin" ? "signup" : "signin";
      if (nameField) nameField.hidden = mode !== "signup";
      submitBtn.textContent = mode === "signup" ? "Create Account" : "Enter the Circle";
      toggle.textContent = mode === "signup" ? "Sign in instead" : "Create an account";
      errEl.hidden = true;
    });

    loginForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var email = document.getElementById("email").value.trim();
      var pass = document.getElementById("password").value.trim();
      if (!email || !pass) { showErr("Please enter your email and password."); return; }
      if (!sb) {
        showErr("Backend not connected yet — add your Supabase anon key to js/supabase-client.js, or use the demo below.");
        return;
      }
      submitBtn.disabled = true;
      try {
        if (mode === "signup") {
          var nm = (document.getElementById("fullName") || {}).value || "";
          var up = await sb.auth.signUp({ email: email, password: pass, options: { data: { full_name: nm.trim() } } });
          if (up.error) throw up.error;
          if (up.data.session) { go(); }
          else { showErr("Account created — check your email to confirm, then sign in."); }
        } else {
          var si = await sb.auth.signInWithPassword({ email: email, password: pass });
          if (si.error) throw si.error;
          go();
        }
      } catch (err) {
        showErr(err && err.message ? err.message : "Something went wrong. Please try again.");
      } finally {
        submitBtn.disabled = false;
      }
    });

    demoBtn && demoBtn.addEventListener("click", function () {
      setMember({ name: "Aria Rivers", email: "aria@example.com" });
      go();
    });
  }

  /* ============================================================
     PORTAL PAGE
     ============================================================ */
  var portal = document.getElementById("portal");
  if (!portal) return;

  // Gate: require a signed-in Supabase session (or an offline demo session).
  var member = await resolveMember();
  if (!member) { window.location.replace("portal-login.html"); return; }

  var firstName = member.name.split(/\s+/)[0];

  async function resolveMember() {
    if (sb) {
      try {
        var s = await sb.auth.getSession();
        var session = s.data && s.data.session;
        if (session) {
          var q = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
          var p = q.data;
          if (p) return { name: p.full_name || (p.email || "Member").split("@")[0], email: p.email, status: p.membership_status, renews: p.renews_at, role: p.role, real: true };
          return { name: (session.user.email || "Member").split("@")[0], email: session.user.email, real: true };
        }
      } catch (e) { /* fall through to demo */ }
    }
    var d = getMember();
    if (d) return { name: d.name, email: d.email, real: false };
    return null;
  }

  /* ---------- SAMPLE DATA ---------- */
  var IMG = "../assets/images/pages/";
  var HERO = IMG + "retreats-hero.webp";

  // Dates are relative to "now" so the prototype always feels current.
  var now = new Date();
  function future(days) { var d = new Date(now); d.setDate(d.getDate() + days); return d; }
  function past(days) { var d = new Date(now); d.setDate(d.getDate() - days); return d; }

  var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var MON3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function fmtRange(start, nights) {
    var s = MON3[start.getMonth()] + " " + start.getDate();
    if (!nights) return s + ", " + start.getFullYear(); // single-day / recurring
    var end = new Date(start); end.setDate(end.getDate() + nights);
    var sameMonth = start.getMonth() === end.getMonth();
    var e = (sameMonth ? "" : MON3[end.getMonth()] + " ") + end.getDate();
    return s + "–" + e + ", " + start.getFullYear();
  }

  var TRIPS = [
    {
      type: "retreat", tag: "Immersive Retreat", name: "Costa Rica Awakening",
      start: future(23), nights: 6, place: "Nosara, Costa Rica",
      status: "confirmed", statusLabel: "Confirmed",
      desc: "Seven days of Bufo, Kambo & cacao ceremony in the jungle canopy, held in a small circle.",
      img: HERO
    },
    {
      type: "program", tag: "8-Week Program", name: "Integration Circle — Cohort III",
      start: future(4), nights: 0, place: "Online · Thursdays 6pm PT",
      status: "confirmed", statusLabel: "In progress",
      desc: "Weekly live integration calls with the circle. You're in week 3 of 8.",
      img: IMG + "retreats-cta.webp"
    },
    {
      type: "retreat", tag: "Practitioner Training", name: "Bufo Facilitator Training",
      start: future(74), nights: 4, place: "Sedona, Arizona",
      status: "waitlist", statusLabel: "Waitlisted",
      desc: "Certification intensive in safe facilitation of sacred toad medicine.",
      img: IMG + "retreats-hero.webp"
    },
    {
      type: "retreat", tag: "Weekend Ceremony", name: "New Moon Kambo Circle",
      start: past(38), nights: 1, place: "Topanga, California",
      status: "complete", statusLabel: "Attended",
      desc: "A cleansing weekend of Kambo and Rapéh under the new moon.",
      img: IMG + "retreats-cta.webp"
    }
  ];

  var GENERAL_RES = [
    { icon: "❧", type: "Guide · PDF", title: "Preparing for Ceremony", desc: "Diet, mindset, and the days before. How to arrive open and ready.", meta: "12 pages" },
    { icon: "☙", type: "Guide · PDF", title: "The Art of Integration", desc: "Weaving your insights into daily life so the medicine keeps working.", meta: "18 pages" },
    { icon: "♪", type: "Audio", title: "Grounding Meditation", desc: "A 20-minute practice to steady the nervous system before or after.", meta: "20 min" },
    { icon: "✦", type: "Guide · PDF", title: "Safety & Contraindications", desc: "Medications, conditions, and honesty. Please read before any medicine.", meta: "6 pages" },
    { icon: "❋", type: "Reading", title: "Community Agreements", desc: "How we hold this circle with consent, confidentiality, and care.", meta: "Web" }
  ];

  var PROGRAM_RES = [
    { icon: "❦", type: "Costa Rica Awakening", title: "Retreat Welcome Packet", desc: "Travel, packing list, what to expect on arrival day.", meta: "PDF", locked: false },
    { icon: "❦", type: "Costa Rica Awakening", title: "Pre-Retreat Preparation Video", desc: "Blaine walks you through the two weeks before we gather.", meta: "24 min", locked: false },
    { icon: "☾", type: "Integration Circle III", title: "Week 3 — Working with Grief", desc: "This week's recording, worksheet, and journal prompts.", meta: "Video + PDF", locked: false },
    { icon: "☾", type: "Integration Circle III", title: "Week 4 — Reclaiming the Body", desc: "Unlocks after this week's live call.", meta: "Locked", locked: true }
  ];

  var ANNOUNCEMENTS = [
    { from: "Blaine · Tiger Soul", when: "2 days ago", body: "Costa Rica travel details are now in your Resources. Please review the arrival-day instructions before booking flights." },
    { from: "Tiger Soul", when: "1 week ago", body: "New guided meditation added to the library — a grounding practice for the days after ceremony." },
    { from: "Integration Circle", when: "1 week ago", body: "Reminder: our week 3 call is Thursday at 6pm PT. This week we sit with grief." }
  ];

  var STORIES = [
    { q: "I could never have afforded this on my own. The circle carried me — and now I carry others.", who: "Sponsored guest, 2025" },
    { q: "Someone I'll never meet gave me the week that saved my life.", who: "Scholarship recipient" },
    { q: "Healing isn't a luxury. Your gift makes it a birthright.", who: "Blaine, founder" }
  ];

  var FAQS = [
    { q: "How do I access my retreat materials?", a: "Everything for the programs and retreats you're enrolled in lives under Resources → My Program Materials. New materials unlock as your program progresses and you'll get a message when they do." },
    { q: "Can I message other members directly?", a: "Yes. Members in the same retreat or program circle can message one another, and you can always reach the Tiger Soul team. Please hold everything shared here in confidence — this is a sacred circle." },
    { q: "How does the Scholarship Circle work?", a: "Your gift goes into a shared fund that sponsors a place in ceremony for someone who cannot afford one. 100% of gifts go directly to a guest's participation. You can give once or monthly." },
    { q: "When does my membership renew?", a: "Membership is annual at $25/year and renews automatically on your join date. You can manage or cancel renewal any time by messaging us." },
    { q: "What if I need to reschedule a retreat?", a: "Reach out through Messages or email hello@tigersoulretreats.com as early as you can. We'll always work with you — the medicine meets you when you're ready." },
    { q: "Is my information private?", a: "Deeply. Your participation, health disclosures, and anything shared in the circle are strictly confidential and never shared outside the Tiger Soul team." }
  ];

  // Conversations for the messaging panel
  var CONVERSATIONS = [
    {
      id: "broadcast", name: "Tiger Soul Announcements", sub: "Official updates · broadcast",
      avatar: "✦", broadcast: true, unread: 1,
      messages: [
        { who: "Blaine", out: false, broadcast: true, text: "Welcome to the portal, everyone. This is home base now — retreats, resources, and each other, all in one place. 🌿", day: "Mon" },
        { who: "Blaine", out: false, broadcast: true, text: "Costa Rica travel details are live in your Resources. Please review arrival-day instructions before booking flights.", day: "Today" }
      ]
    },
    {
      id: "cr", name: "Costa Rica Awakening", sub: "Retreat circle · 11 members",
      avatar: "❋", broadcast: false, unread: 2,
      messages: [
        { who: "Maya", out: false, text: "So excited to meet you all. First time doing Bufo — any advice?", day: "Tue" },
        { who: "You", out: true, text: "Same here! Just trusting the process 🙏", day: "Tue" },
        { who: "Diego", out: false, text: "Been once before — the prep video really helped me. Watch it twice.", day: "Yesterday" },
        { who: "Facilitator · Sofia", out: false, text: "Beautiful questions. We'll cover all of this on our pre-retreat call Sunday.", day: "Today" }
      ]
    },
    {
      id: "circle", name: "Integration Circle III", sub: "Program cohort · 8 members",
      avatar: "☾", broadcast: false, unread: 0,
      messages: [
        { who: "Blaine", out: false, text: "This week we sit with grief. Come as you are. Recording will be posted after.", day: "Mon" },
        { who: "You", out: true, text: "Thank you. This one feels important for me.", day: "Mon" }
      ]
    },
    {
      id: "maya", name: "Maya Chen", sub: "Direct message",
      avatar: "M", broadcast: false, unread: 0,
      messages: [
        { who: "Maya", out: false, text: "Loved talking with you on the call. Want to be integration buddies for Costa Rica?", day: "Yesterday" },
        { who: "You", out: true, text: "Yes! I'd love that 💛", day: "Yesterday" }
      ]
    }
  ];

  /* ---------- SHELL: member chip + greeting ---------- */
  document.getElementById("memberName").textContent = member.name;
  document.getElementById("memberAvatar").textContent = initials(member.name);
  var hour = now.getHours();
  var salut = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  document.getElementById("greeting").textContent = salut + ", " + firstName + ".";

  /* ---------- PANEL NAVIGATION ---------- */
  var navItems = Array.prototype.slice.call(document.querySelectorAll(".portal-nav__item"));
  var panels = Array.prototype.slice.call(document.querySelectorAll(".panel"));
  var body = document.body;

  function showPanel(name) {
    navItems.forEach(function (n) { n.classList.toggle("is-active", n.dataset.panel === name); });
    panels.forEach(function (p) { p.classList.toggle("is-active", p.dataset.panel === name); });
    closeNav();
    // scroll main to top when switching
    var main = document.getElementById("portalMain");
    if (main) main.scrollTop = 0;
    window.scrollTo(0, 0);
  }
  navItems.forEach(function (n) { n.addEventListener("click", function () { showPanel(n.dataset.panel); }); });
  // Any element with data-goto jumps to a panel
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-goto]");
    if (t) showPanel(t.dataset.goto);
  });

  /* ---------- MOBILE NAV DRAWER ---------- */
  var menuToggle = document.getElementById("portalMenuToggle");
  var scrim = document.getElementById("portalScrim");
  function openNav() { body.classList.add("nav-open"); scrim.hidden = false; menuToggle.setAttribute("aria-expanded", "true"); }
  function closeNav() { body.classList.remove("nav-open"); if (scrim) scrim.hidden = true; menuToggle && menuToggle.setAttribute("aria-expanded", "false"); }
  menuToggle && menuToggle.addEventListener("click", function () { body.classList.contains("nav-open") ? closeNav() : openNav(); });
  scrim && scrim.addEventListener("click", closeNav);

  /* ---------- SIGN OUT ---------- */
  document.getElementById("signOutBtn").addEventListener("click", async function () {
    if (sb) { try { await sb.auth.signOut(); } catch (e) {} }
    clearMember();
    window.location.href = "portal-login.html";
  });

  /* ---------- TOAST ---------- */
  var toastEl = document.getElementById("toast");
  var toastTimer;
  function toast(msg) {
    toastEl.innerHTML = '<span class="mark">✦</span>' + msg;
    toastEl.hidden = false;
    requestAnimationFrame(function () { toastEl.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 3200);
  }

  /* ---------- HOME: next gathering + countdown + announcements ---------- */
  var nextTrip = TRIPS.filter(function (t) { return t.start > now; })
    .sort(function (a, b) { return a.start - b.start; })[0] || TRIPS[0];
  document.getElementById("nextTitle").textContent = nextTrip.name;
  document.getElementById("nextMeta").textContent = fmtRange(nextTrip.start, nextTrip.nights) + " · " + nextTrip.place;
  var nextMedia = document.querySelector(".next-card__media img");
  if (nextMedia) nextMedia.src = nextTrip.img;

  function renderCountdown() {
    var diff = nextTrip.start - new Date();
    var el = document.getElementById("nextCountdown");
    if (diff <= 0) { el.innerHTML = '<span class="unit"><span class="num">✦</span><span class="lbl">Happening now</span></span>'; return; }
    var days = Math.floor(diff / 86400000);
    var hrs = Math.floor((diff % 86400000) / 3600000);
    var mins = Math.floor((diff % 3600000) / 60000);
    el.innerHTML =
      unit(days, "Days") + unit(hrs, "Hours") + unit(mins, "Minutes");
  }
  function unit(n, l) { return '<span class="unit"><span class="num">' + n + '</span><span class="lbl">' + l + "</span></span>"; }
  renderCountdown();
  setInterval(renderCountdown, 60000);

  var announceList = document.getElementById("announceList");
  announceList.innerHTML = ANNOUNCEMENTS.map(function (a) {
    return '<li class="announce-item" data-goto="messages"><div class="top"><span class="from">' + a.from +
      '</span><span class="when">' + a.when + '</span></div><p class="body">' + a.body + "</p></li>";
  }).join("");

  if (member.status) document.getElementById("statMembership").textContent = member.status.charAt(0).toUpperCase() + member.status.slice(1);
  (function () {
    var rn = "Renews " + MON3[now.getMonth()] + " " + (now.getFullYear() + 1);
    if (member.renews) { var rd = new Date(member.renews); if (!isNaN(rd.getTime())) rn = "Renews " + MON3[rd.getMonth()] + " " + rd.getFullYear(); }
    document.getElementById("statRenews").textContent = rn;
  })();

  /* ---------- UPCOMING ---------- */
  var upcomingList = document.getElementById("upcomingList");
  function tripCard(t) {
    var isPast = t.start < now;
    var statusClass = "status--" + t.status;
    return '<article class="trip' + (isPast ? " is-past" : "") + '" data-type="' + t.type + '" data-past="' + isPast + '">' +
        '<div class="trip__media"><img src="' + t.img + '" alt="" loading="lazy" />' +
          '<div class="trip__date"><span class="d">' + t.start.getDate() + '</span><span class="m">' + MON3[t.start.getMonth()] + "</span></div></div>" +
        '<div class="trip__body">' +
          '<span class="trip__tag">' + t.tag + "</span>" +
          '<h3 class="trip__name">' + t.name + "</h3>" +
          '<p class="trip__meta">' + fmtRange(t.start, t.nights) + " · " + t.place + "</p>" +
          '<p class="trip__desc">' + t.desc + "</p>" +
        "</div>" +
        '<div class="trip__side">' +
          '<span class="trip__status ' + statusClass + '">' + t.statusLabel + "</span>" +
          '<button class="trip__link" data-goto="resources">Materials →</button>' +
        "</div>" +
      "</article>";
  }
  function renderUpcoming(filter) {
    var rows = TRIPS.slice().sort(function (a, b) { return a.start - b.start; }).filter(function (t) {
      var isPast = t.start < now;
      if (filter === "all") return !isPast;
      if (filter === "past") return isPast;
      return t.type === filter && !isPast;
    });
    if (!rows.length) rows = [];
    upcomingList.innerHTML = rows.length
      ? rows.map(tripCard).join("")
      : '<p style="color:var(--ink-soft)">Nothing here yet. When you book a retreat or join a program, it will appear here.</p>';
  }
  renderUpcoming("all");
  document.querySelectorAll("#panel-upcoming .seg__btn").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#panel-upcoming .seg__btn").forEach(function (x) { x.classList.remove("is-active"); });
      b.classList.add("is-active");
      renderUpcoming(b.dataset.filter);
    });
  });

  /* ---------- RESOURCES ---------- */
  function resCard(r) {
    var locked = r.locked;
    return '<' + (locked ? "div" : "button") + ' class="res" ' + (locked ? "" : 'data-res="' + r.title + '"') + '>' +
        '<span class="res__icon">' + r.icon + "</span>" +
        '<span class="res__type">' + r.type + "</span>" +
        '<h4 class="res__title">' + r.title + "</h4>" +
        '<p class="res__desc">' + r.desc + "</p>" +
        '<span class="res__foot">' +
          (locked
            ? '<span class="res__lock">🔒 Locked</span>'
            : '<span class="res__cta">Open →</span><span>' + r.meta + "</span>") +
        "</span>" +
      "</" + (locked ? "div" : "button") + ">";
  }
  document.getElementById("resGeneral").innerHTML = GENERAL_RES.map(resCard).join("");
  document.getElementById("resProgram").innerHTML = PROGRAM_RES.map(resCard).join("");
  document.querySelectorAll("[data-res]").forEach(function (el) {
    el.addEventListener("click", function () { toast("Opening “" + el.dataset.res + "” — this is a prototype, so the file isn't wired up yet."); });
  });

  /* ---------- CALENDAR ---------- */
  var calGrid = document.getElementById("calGrid");
  var calMonthEl = document.getElementById("calMonth");
  var viewMonth = now.getMonth(), viewYear = now.getFullYear();

  var EVENTS = TRIPS.map(function (t) { return { date: t.start, name: t.name, type: t.type, place: t.place }; });
  // add the weekly integration calls as recurring dots for the next 6 weeks
  for (var w = 0; w < 6; w++) {
    var d = future(4 + w * 7);
    EVENTS.push({ date: d, name: "Integration Circle — live call", type: "program", place: "Online 6pm PT" });
  }

  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

  function renderCalendar() {
    calMonthEl.textContent = MONTHS[viewMonth] + " " + viewYear;
    var first = new Date(viewYear, viewMonth, 1);
    var startDow = first.getDay();
    var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    var cells = "";
    for (var i = 0; i < startDow; i++) cells += '<div class="cal__cell is-muted"></div>';
    for (var day = 1; day <= daysInMonth; day++) {
      var cellDate = new Date(viewYear, viewMonth, day);
      var ev = EVENTS.filter(function (e) { return sameDay(e.date, cellDate); })[0];
      var cls = "cal__cell";
      if (sameDay(cellDate, now)) cls += " is-today";
      if (ev) cls += " has-event type-" + ev.type;
      cells += '<div class="' + cls + '"' + (ev ? ' title="' + ev.name + '" data-goto="upcoming"' : "") + ">" + day + "</div>";
    }
    calGrid.innerHTML = cells;
  }
  renderCalendar();
  document.getElementById("calPrev").addEventListener("click", function () {
    viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } renderCalendar();
  });
  document.getElementById("calNext").addEventListener("click", function () {
    viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } renderCalendar();
  });

  var agendaList = document.getElementById("agendaList");
  agendaList.innerHTML = EVENTS.filter(function (e) { return e.date >= now; })
    .sort(function (a, b) { return a.date - b.date; }).slice(0, 6)
    .map(function (e) {
      return '<li class="agenda-item"><div class="agenda-item__date"><span class="d">' + e.date.getDate() +
        '</span><span class="m">' + MON3[e.date.getMonth()] + '</span></div>' +
        '<div class="agenda-item__body"><b>' + e.name + "</b><span>" + e.place + "</span></div></li>";
    }).join("");

  /* ---------- MESSAGES ---------- */
  // Persist any messages the user sends this session
  var stored = {};
  try { stored = JSON.parse(localStorage.getItem(LS_MSGS)) || {}; } catch (e) { stored = {}; }
  CONVERSATIONS.forEach(function (c) {
    if (stored[c.id]) c.messages = c.messages.concat(stored[c.id]);
  });

  var chatThreads = document.getElementById("chatThreads");
  var chatThread = document.getElementById("chatThread");
  var chatName = document.getElementById("chatName");
  var chatSub = document.getElementById("chatSub");
  var chatAvatar = document.getElementById("chatAvatar");
  var chatEl = document.querySelector(".chat");
  var activeConv = null;

  function totalUnread() {
    return CONVERSATIONS.reduce(function (s, c) { return s + (c.unread || 0); }, 0);
  }
  function updateBadges() {
    var total = totalUnread();
    var badge = document.getElementById("msgBadge");
    if (total > 0) { badge.hidden = false; badge.textContent = total; }
    else badge.hidden = true;
    var quick = document.getElementById("quickMsg");
    if (quick) quick.textContent = total > 0 ? "You have " + total + " new message" + (total > 1 ? "s" : "") : "You're all caught up";
  }

  function renderThreadList() {
    chatThreads.innerHTML = CONVERSATIONS.map(function (c) {
      var last = c.messages[c.messages.length - 1];
      var preview = (last.out ? "You: " : "") + last.text;
      return '<button class="thread-row' + (activeConv === c.id ? " is-active" : "") + '" data-conv="' + c.id + '">' +
          '<span class="thread-row__avatar' + (c.broadcast ? " is-broadcast" : "") + '">' + c.avatar + "</span>" +
          '<span class="thread-row__main"><span class="thread-row__top">' +
            '<span class="thread-row__name">' + c.name + '</span><span class="thread-row__time">' + last.day + "</span></span>" +
            '<span class="thread-row__preview">' + preview + "</span></span>" +
          (c.unread ? '<span class="thread-row__unread">' + c.unread + "</span>" : "") +
        "</button>";
    }).join("");
    chatThreads.querySelectorAll(".thread-row").forEach(function (r) {
      r.addEventListener("click", function () { openConv(r.dataset.conv); });
    });
  }

  function renderMessages(c) {
    var lastDay = null, html = "";
    c.messages.forEach(function (m) {
      if (m.day !== lastDay) { html += '<div class="chat__daysep">' + m.day + "</div>"; lastDay = m.day; }
      var cls = m.broadcast ? "bubble bubble--broadcast" : "bubble " + (m.out ? "bubble--out" : "bubble--in");
      html += '<div class="' + cls + '">' +
        (!m.out ? '<span class="who">' + m.who + "</span>" : "") +
        escapeHtml(m.text) + "</div>";
    });
    chatThread.innerHTML = html;
    chatThread.scrollTop = chatThread.scrollHeight;
  }

  function openConv(id) {
    var c = CONVERSATIONS.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    activeConv = id;
    c.unread = 0;
    chatName.textContent = c.name;
    chatSub.textContent = c.sub;
    chatAvatar.textContent = c.avatar;
    renderMessages(c);
    renderThreadList();
    updateBadges();
    if (chatEl) chatEl.classList.add("show-view");
  }

  var chatComposer = document.getElementById("chatComposer");
  var chatInput = document.getElementById("chatInput");
  chatComposer.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = chatInput.value.trim();
    if (!text || !activeConv) return;
    var c = CONVERSATIONS.filter(function (x) { return x.id === activeConv; })[0];
    var msg = { who: "You", out: true, text: text, day: "Today" };
    c.messages.push(msg);
    // persist
    if (!stored[activeConv]) stored[activeConv] = [];
    stored[activeConv].push(msg);
    localStorage.setItem(LS_MSGS, JSON.stringify(stored));
    chatInput.value = "";
    renderMessages(c);
    renderThreadList();
    // a gentle mock reply on group/DM threads
    if (!c.broadcast) {
      setTimeout(function () {
        var reply = pickReply(c);
        c.messages.push(reply);
        if (activeConv === c.id) renderMessages(c);
        renderThreadList();
      }, 1800);
    }
  });
  function pickReply(c) {
    var who = c.id === "maya" ? "Maya" : c.id === "cr" ? "Diego" : c.id === "circle" ? "Blaine" : "Facilitator · Sofia";
    var lines = ["Holding that with you. 🙏", "So glad you're here.", "Beautifully said.", "See you in the circle 💛", "Thank you for sharing that."];
    return { who: who, out: false, text: lines[c.messages.length % lines.length], day: "Today" };
  }

  document.getElementById("chatBack").addEventListener("click", function () {
    if (chatEl) chatEl.classList.remove("show-view");
  });

  renderThreadList();
  openConv("broadcast");
  updateBadges();

  /* ---------- DONATE ---------- */
  var GOAL = 5000;
  var raised = 3180;
  var sponsored = 7;
  var donateAmt = 50;

  function refreshDonate() {
    document.getElementById("donateBarFill").style.width = Math.min(100, (raised / GOAL) * 100) + "%";
    document.getElementById("donateRaised").textContent = "$" + raised.toLocaleString();
    document.getElementById("donateGoal").textContent = "$" + GOAL.toLocaleString();
    document.getElementById("donateSponsored").textContent = sponsored;
    document.getElementById("donateBtnAmt").textContent = "$" + donateAmt;
  }
  // set bar after a tick so the transition animates
  setTimeout(refreshDonate, 250);
  refreshDonate();

  var donateAmounts = document.getElementById("donateAmounts");
  var donateCustom = document.getElementById("donateCustom");
  donateAmounts.querySelectorAll(".donate-amt[data-amt]").forEach(function (b) {
    b.addEventListener("click", function () {
      donateAmounts.querySelectorAll(".donate-amt").forEach(function (x) { x.classList.remove("is-active"); });
      b.classList.add("is-active");
      donateCustom.value = "";
      donateAmt = parseInt(b.dataset.amt, 10);
      document.getElementById("donateBtnAmt").textContent = "$" + donateAmt;
    });
  });
  donateCustom.addEventListener("input", function () {
    donateAmounts.querySelectorAll(".donate-amt[data-amt]").forEach(function (x) { x.classList.remove("is-active"); });
    donateCustom.closest(".donate-amt--custom").classList.add("is-active");
    donateAmt = parseInt(donateCustom.value, 10) || 0;
    document.getElementById("donateBtnAmt").textContent = "$" + donateAmt;
  });

  document.getElementById("donateForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!donateAmt || donateAmt < 1) { toast("Please choose a gift amount."); return; }
    var monthly = document.getElementById("donateMonthly").checked;
    raised += donateAmt;
    sponsored += donateAmt >= 500 ? 1 : 0;
    refreshDonate();
    toast("Thank you for your gift of $" + donateAmt + (monthly ? "/mo" : "") + ". Healing, passed hand to hand. 💛");
    document.getElementById("donateNote").value = "";
    document.getElementById("donateMonthly").checked = false;
  });

  document.getElementById("storyGrid").innerHTML = STORIES.map(function (s) {
    return '<div class="story"><p class="story__q">“' + s.q + '”</p><span class="story__who">' + s.who + "</span></div>";
  }).join("");

  /* ---------- FAQ ---------- */
  var faqWrap = document.getElementById("faqAccordion");
  faqWrap.innerHTML = FAQS.map(function (f) {
    return '<div class="faq-q"><button class="faq-q__btn" aria-expanded="false"><h3>' + f.q +
      '</h3><span class="faq-q__sign">+</span></button><div class="faq-q__body"><p>' + f.a + "</p></div></div>";
  }).join("");
  faqWrap.querySelectorAll(".faq-q__btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var item = btn.closest(".faq-q");
      var body = item.querySelector(".faq-q__body");
      var open = item.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      body.style.maxHeight = open ? body.scrollHeight + "px" : "0";
    });
  });

  /* ---------- PAYMENTS (simple test-mode card payment via Stripe) ---------- */
  function loadPayments() {
    var el = document.getElementById("paymentsBody");
    if (!el) return;
    var link = (window.TIGER_SUPABASE && window.TIGER_SUPABASE.paymentLink) || "";
    el.innerHTML =
      '<div class="pay-card">' +
        '<span class="pay-card__k">Make a payment</span>' +
        '<h2 class="pay-card__title">Pay securely by card</h2>' +
        '<p class="pay-card__lede">You’ll enter your amount and card details on Stripe’s secure checkout page, ' +
          'and a receipt is emailed to you automatically.</p>' +
        '<button class="btn btn--solid pay-card__btn" id="payNowBtn">Pay with card</button>' +
        '<p class="pay-card__test"><b>Test mode</b> — use card 4242 4242 4242 4242, any future date, any CVC. No real money moves.</p>' +
      "</div>";
    var btn = document.getElementById("payNowBtn");
    btn && btn.addEventListener("click", function () {
      if (link) { window.open(link, "_blank", "noopener"); }
      else { toast("Add your Stripe test payment link to turn this on — that’s the next step. 🌿"); }
    });
  }
  loadPayments();

  /* ---------- utils ---------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
})();
