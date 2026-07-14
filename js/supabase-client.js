/* ============================================================
   TIGER SOUL — Supabase connection
   The anon (public) key is SAFE to expose in front-end code:
   Row Level Security is what protects your data, not this key.
   Paste your anon public key below (Supabase → Settings → API).
   ============================================================ */
window.TIGER_SUPABASE = {
  url: "https://werkohszkcytdvljafha.supabase.co",
  anonKey: "sb_publishable_YkTpPIzaCE-paCYapejC9w_G3iTt6g5",
  // Stripe test-mode Payment Link (https://buy.stripe.com/test_...). Paste it here to turn on the Pay button.
  paymentLink: ""
};

(function () {
  var cfg = window.TIGER_SUPABASE;
  var ready = window.supabase && cfg.anonKey && cfg.anonKey.indexOf("PASTE_") === -1;
  window.supabaseClient = ready
    ? window.supabase.createClient(cfg.url, cfg.anonKey)
    : null;
  if (!window.supabaseClient) {
    console.warn("[Tiger Soul] Supabase not connected yet — add your anon key to js/supabase-client.js. Running in demo mode.");
  }
})();
