// Tiger Soul — health screening / application -> Resend
//
// pages/health-screening.html POSTs JSON here. We email the full screening to
// Tiger Soul (reply-to the applicant) and send the applicant a short "we have
// your application" confirmation.
//
// NOTE: these notification emails carry sensitive health information. Keep
// NOTIFY_TO pointed at an inbox only the facilitators can read.
//
// The question wording lives HERE, not in the request. The browser sends only
// answers keyed q5…q47, so a forged request can't rewrite the questions in the
// email it produces.
//
// Deploy: supabase functions deploy health-screening --project-ref werkohszkcytdvljafha --no-verify-jwt

import {
  corsHeaders,
  emailShell,
  fieldRow,
  headerSafe,
  isAllowedOrigin,
  isEmail,
  json,
  notifyAddress,
  paragraph,
  readBody,
  sectionHeading,
  sendEmail,
  str,
} from "../_shared/forms.ts";

type Section = { title: string; keys: string[] };

const QUESTIONS: Record<string, string> = {
  offering: "Choose the offering you're applying for",
  q5: "First Name",
  q6: "Last Name",
  q7: "What is your gender?",
  q8: "Email",
  q9: "What's your phone number?",
  q10: "Emergency Contact",
  q11: "Who referred you?",
  q12: "Do you have any experience with plant medicine? (If so please share which ones and how often you take them.)",
  q13: "Do you take any recreational substances including drugs and/or alcohol? If so please share which ones and how often.",
  q14: "Do you have a history of substance abuse? If so please explain.",
  q15: "Are you taking any other drugs like caffeine, pain killers or allergy medications?",
  q16: "Are you on any prescription medications? If so which ones and what dosage are you taking / how often?",
  q17: "Are you taking any of the following supplements: Kratom, mood stabilizing supplements, natural sleep aids, diet pills?",
  q18: "Do you have any history with mental illness? If so please describe.",
  q19: "Do you have a history of PTSD or suffer from acute trauma? If so please explain.",
  q20: "Do you struggle with addictions, depression or anxiety? Please explain.",
  q21: "Do you have any of the following: schizophrenia, schizophrenic tendencies, borderline personality disorder, serotonin syndrome, bipolar disorder or suicidal tendencies?",
  q22: "Please share any major traumas that have happened in your life (including childhood traumas) and any therapies or treatments you have accessed.",
  q23: "Do you have any of the following: high blood pressure, low blood pressure, cardiovascular issues, liver & kidney, head injuries, history of seizures, respiratory issues or drug allergies?",
  q24: "Do you have a history of hypertension? Do you know your most recent vital signs (blood pressure, heart rate, oxygen saturation)?",
  q25: "Do you have serious heart problems? Have you had heart surgery? (Includes a pacemaker, excludes stents.)",
  q26: "Have you had a stroke or a brain haemorrhage?",
  q27: "Have you had an aneurism or blood clot?",
  q28: "Are you on medication for low blood pressure?",
  q29: "Are you recovering from a major surgical procedure with internal stitches?",
  q30: "Are you recovering from a major surgical procedure?",
  q31: "Are you undergoing chemotherapy, radiotherapy or have done so within the last 4 weeks?",
  q32: "Are you taking immune-suppressants after an organ transplant?",
  q33: "Do you have Addison's Disease?",
  q34: "Do you have current and severe epilepsy? Are you on any medication for epilepsy?",
  q35: "Do you have certain types of eating disorders?",
  q36: "Do you have Crohn's Disease, IBS or any digestive issues?",
  q37: "Do you have any pre-existing medical conditions? If so please explain.",
  q38: "Have you been vaccinated with CV19 vaccine? If so, how many times and when?",
  q39: "Are you pregnant or breast feeding? Are you breast feeding a child under 6 months old?",
  q40: "Will you have been fasting at any point 7 days before or after your ceremony work?",
  q41: "Will you be able to avoid enemas, colonics, intensive sweating or liver flushes within 3 days before and after your ceremony work?",
  q42: "Will you be menstruating at the time of your session?",
  q43: "Can you abstain from alcohol, marijuana and other recreational substances for at least 24–48 hours before your Kambo session?",
  q44: "Do you have any dietary restrictions?",
  q45: "Please share about what is calling you to ceremony at this time.",
  q46: "What resources do you have in your life to support you?",
  q47: "Is there anything else that you wish to share? Do you have any further questions?",
};

const SECTIONS: Section[] = [
  { title: "Offering", keys: ["offering"] },
  { title: "About You", keys: ["q5", "q6", "q7", "q8", "q9", "q10", "q11"] },
  { title: "Your Experience", keys: ["q12", "q13", "q14"] },
  { title: "Medications & Supplements", keys: ["q15", "q16", "q17"] },
  { title: "Mental & Emotional Health", keys: ["q18", "q19", "q20", "q21", "q22"] },
  { title: "Heart & Circulation", keys: ["q23", "q24", "q25", "q26", "q27", "q28"] },
  { title: "Medical History", keys: ["q29", "q30", "q31", "q32", "q33", "q34", "q35", "q36", "q37", "q38", "q39"] },
  { title: "Preparing for Ceremony", keys: ["q40", "q41", "q42", "q43", "q44"] },
  { title: "Your Intention", keys: ["q45", "q46", "q47"] },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });
  if (!isAllowedOrigin(req)) return json(req, 403, { error: "Forbidden" });

  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch {
    return json(req, 400, { error: "We couldn't read that submission." });
  }

  if (str(body.website)) return json(req, 200, { ok: true }); // honeypot

  const firstName = str(body.q5, 120);
  const lastName = str(body.q6, 120);
  const email = str(body.q8, 200);
  const offering = str(body.offering, 120);

  if (!firstName || !lastName) return json(req, 400, { error: "Please include your first and last name." });
  if (!isEmail(email)) return json(req, 400, { error: "Please include a valid email address." });

  const fullName = `${firstName} ${lastName}`;

  const inner = SECTIONS.map((section) => {
    const rows = section.keys
      .map((key) => fieldRow(QUESTIONS[key], str(body[key], 8000)))
      .join("");
    return sectionHeading(section.title) + rows;
  }).join("");

  const notification = emailShell(
    `Health screening — ${fullName}`,
    paragraph(
      '<strong style="color:#7a2020;">Confidential health information.</strong> Handle and store accordingly.',
    ) + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${inner}</table>`,
  );

  try {
    await sendEmail({
      to: notifyAddress(),
      subject: `Health screening — ${headerSafe(fullName)}${offering ? ` (${headerSafe(offering)})` : ""}`,
      html: notification,
      replyTo: email,
    });
  } catch (err) {
    console.error("health-screening: notification failed", err);
    return json(req, 502, { error: "We couldn't send that just now. Please email us directly." });
  }

  try {
    await sendEmail({
      to: email,
      subject: "Your application has begun — Tiger Soul",
      html: emailShell(
        `Thank you, ${firstName}`,
        paragraph("Your health screening reached us, and your application is now open.") +
          paragraph("A facilitator reads every screening personally. What you shared stays between you and the people holding your ceremony.") +
          paragraph("<strong>What happens next:</strong> once we've read it, we'll reach out to arrange a personal conversation. If you're cleared for the work, we'll walk you through reserving your place and send everything you need to prepare.") +
          paragraph("If anything changes before we speak — a new medication, a health development — just reply to this email and tell us."),
        ),
      replyTo: notifyAddress(),
    });
  } catch (err) {
    console.error("health-screening: confirmation to applicant failed", err);
  }

  return json(req, 200, { ok: true });
});
