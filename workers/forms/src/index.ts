// Tiger Soul — website forms Worker
//
// One Worker serves all three public forms, at the same paths the Supabase
// Edge Functions used:
//   POST /contact-form      js/forms.js (contact page) and academy/js/enroll.js
//   POST /health-screening  js/forms.js (health screening)
//   POST /waiver            waiver/index.html
//   POST /contact           Ancestral Encounters contact form

import { corsHeaders, json, type Env } from "./shared";
import { handle as contact } from "./contact";
import { handle as screening } from "./screening";
import { handle as waiver } from "./waiver";
import { handle as ancestral } from "./ancestral";

const ROUTES: Record<string, (req: Request, env: Env) => Promise<Response>> = {
  "/contact-form": contact,
  "/health-screening": screening,
  "/waiver": waiver,
  "/contact": ancestral,
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const route = ROUTES[new URL(req.url).pathname.replace(/\/$/, "")];
    if (!route) return json(req, 404, { error: "Not found" });
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
    try {
      return await route(req, env);
    } catch (err) {
      console.error("forms worker: unhandled", err);
      return json(req, 500, { error: "Something went wrong. Please email us directly." });
    }
  },
};
