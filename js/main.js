/* Tiger Soul Medicine Retreats — interactions */
(function () {
  "use strict";

  const header = document.getElementById("header");
  const toggle = document.getElementById("menuToggle");
  const overlay = document.getElementById("navOverlay");
  const close = document.getElementById("navClose");
  const body = document.body;

  /* ---------- Menu overlay ---------- */
  function openMenu() {
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    toggle.setAttribute("aria-expanded", "true");
    body.classList.add("no-scroll");
    // stagger nav items via animation-delay
    overlay.querySelectorAll(".nav-list a").forEach((a, i) => {
      a.style.animationDelay = 0.15 + i * 0.06 + "s";
    });
  }
  function closeMenu() {
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
    toggle.setAttribute("aria-expanded", "false");
    body.classList.remove("no-scroll");
  }

  toggle && toggle.addEventListener("click", openMenu);
  close && close.addEventListener("click", closeMenu);
  overlay &&
    overlay.querySelectorAll("a[href^='#']").forEach((a) =>
      a.addEventListener("click", closeMenu)
    );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeMenu();
  });

  /* ---------- Header: dock at top, hide on scroll-down, adapt color ---------- */
  // Sections over which the header should use dark text
  const lightSet = new Set(
    document.querySelectorAll(".mission, .sacred, .about-teaser, .section--light")
  );
  const sections = document.querySelectorAll("section, footer");

  function updateHeaderTone() {
    const probe = window.matchMedia("(max-width: 720px)").matches ? 44 : 58;
    let over = null;
    sections.forEach((s) => {
      const r = s.getBoundingClientRect();
      if (r.top <= probe && r.bottom > probe) over = s;
    });
    header.classList.toggle("header--on-light", !!over && lightSet.has(over));
  }

  let lastY = window.scrollY;
  let ticking = false;
  function onScroll() {
    const y = window.scrollY;
    if (y > 40) {
      header.classList.add("solid");
      body.classList.add("scrolled");
    } else {
      header.classList.remove("solid");
      body.classList.remove("scrolled");
    }
    // hide when scrolling down past the hero, reveal on scroll up
    if (y > 600 && y > lastY + 6) {
      header.classList.add("hidden");
    } else if (y < lastY - 6) {
      header.classList.remove("hidden");
    }
    updateHeaderTone();
    lastY = y;
    ticking = false;
  }
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        window.requestAnimationFrame(onScroll);
        ticking = true;
      }
    },
    { passive: true }
  );
  onScroll();

  /* ---------- Scroll reveal ---------- */
  const revealEls = document.querySelectorAll("[data-reveal]");
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReduced || !("IntersectionObserver" in window)) {
    // No animation (or no support) — show everything straight away.
    revealEls.forEach((el) => el.classList.add("in"));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      // Reveal just before an element enters the viewport so there's no
      // blank gap as you scroll down to it.
      { threshold: 0, rootMargin: "0px 0px 15% 0px" }
    );
    revealEls.forEach((el) => io.observe(el));

    // Failsafe: never let content stay stuck hidden. Once the page has
    // loaded, reveal anything at or near the top of the page even if the
    // observer's first pass missed it.
    window.addEventListener("load", () => {
      setTimeout(() => {
        revealEls.forEach((el) => {
          if (el.getBoundingClientRect().top < window.innerHeight * 1.15) {
            el.classList.add("in");
          }
        });
      }, 400);
    });
  }

  /* ---------- Hero carousel: slow crossfade ---------- */
  const slides = document.querySelectorAll(".hero__slide");
  if (slides.length > 1 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    let idx = 0;
    const HOLD = 4200; // ms between slides (2.4s crossfade overlaps for a continuous melt)
    setInterval(() => {
      slides[idx].classList.remove("is-active");
      idx = (idx + 1) % slides.length;
      slides[idx].classList.add("is-active");
    }, HOLD);
  }

  /* ---------- Testimonial modal: read full review ---------- */
  const testiModal = document.getElementById("testiModal");
  if (testiModal) {
    const mBody = testiModal.querySelector(".modal__body");
    const mWho = testiModal.querySelector("#testiModalWho");
    let lastFocus = null;

    function openTesti(card) {
      const full = card.querySelector(".testi__full");
      const who = card.querySelector(".who");
      mBody.innerHTML = full ? full.innerHTML : "";
      mWho.innerHTML = who ? who.innerHTML : "";
      testiModal.querySelector(".modal__panel").scrollTop = 0;
      lastFocus = document.activeElement;
      testiModal.classList.add("open");
      testiModal.setAttribute("aria-hidden", "false");
      body.classList.add("no-scroll");
      const c = testiModal.querySelector(".modal__close");
      c && c.focus();
    }
    function closeTesti() {
      testiModal.classList.remove("open");
      testiModal.setAttribute("aria-hidden", "true");
      body.classList.remove("no-scroll");
      lastFocus && lastFocus.focus();
    }

    document.querySelectorAll(".testi__more").forEach((btn) =>
      btn.addEventListener("click", () => openTesti(btn.closest(".testi")))
    );
    testiModal.querySelectorAll("[data-modal-close]").forEach((el) =>
      el.addEventListener("click", closeTesti)
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && testiModal.classList.contains("open")) closeTesti();
    });
  }

  /* ---------- Testimonials: drag / wheel to scroll horizontally ---------- */
  const track = document.getElementById("testiTrack");
  if (track) {
    let down = false, startX = 0, startScroll = 0;
    track.style.cursor = "grab";
    track.style.overflowX = "auto";
    track.style.scrollbarWidth = "none";
    track.style.paddingBottom = "1.5rem";
    track.addEventListener("pointerdown", (e) => {
      down = true; startX = e.clientX; startScroll = track.scrollLeft;
      track.style.cursor = "grabbing"; track.setPointerCapture(e.pointerId);
    });
    track.addEventListener("pointermove", (e) => {
      if (!down) return;
      track.scrollLeft = startScroll - (e.clientX - startX);
    });
    const end = () => { down = false; track.style.cursor = "grab"; };
    track.addEventListener("pointerup", end);
    track.addEventListener("pointercancel", end);
  }
})();
