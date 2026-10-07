"""Rebuild the admin portal's records after the Supabase account was lost.

Reads, all from ~/Documents/Tiger-soul-data (never committed: it holds health data):
  - the Proton Mail export of hello@ (.eml files): every health screening, signed
    waiver and contact message was emailed there by the forms
  - recovered/snapshots/*.json: the 70 profiles, the Bufo program dates, roster
    rows and the one campaign, recovered from earlier Claude Code transcripts
  - recovered/sources/profiles.csv: the Squarespace contact export

Writes one SQL file of INSERTs for D1, plus a short report of what it found.
Run, then apply:
  python3 build_import.py
  npx wrangler d1 execute tiger-soul --remote --file=<DATA>/import/import.sql
"""

import csv
import email
import email.utils
import glob
import html
import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from email.header import decode_header, make_header

DATA = os.path.expanduser("~/Documents/Tiger-soul-data")
EXPORT = sorted(glob.glob(f"{DATA}/tigersoulretreats@pm.me/mail_*"))[-1]
RECOVERED = f"{DATA}/recovered"
OUT = f"{DATA}/import"
HERE = os.path.dirname(os.path.abspath(__file__))

# The screening's question wording lives in the Worker; map labels back to keys.
_src = open(os.path.join(HERE, "..", "src", "screening.ts"), encoding="utf-8").read()
QUESTIONS = dict(re.findall(r'^\s+(\w+): "(.*)",$', _src.split("const QUESTIONS")[1].split("};")[0], re.M))
QUESTIONS = {k: v.replace('\\"', '"') for k, v in QUESTIONS.items()}
LABEL_TO_KEY = {v.lower(): k for k, v in QUESTIONS.items()}

NOT_ANSWERED = "— not answered —"

# Submissions made while building and testing the forms, not real clients.
TEST_NAMES = {"deployment test", "key check", "example example", "waiver test", "final check", "url check", "test (claude)"}


def is_test(name):
    return name.strip().lower() in TEST_NAMES


def subject_of(m):
    return str(make_header(decode_header(m.get("Subject", "") or "")))


def iso(m):
    d = email.utils.parsedate_to_datetime(m.get("Date"))
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def html_of(m):
    for p in m.walk():
        if p.get_content_type() == "text/html":
            return p.get_payload(decode=True).decode(p.get_content_charset() or "utf-8", errors="replace")
    return ""


def clean(fragment):
    t = re.sub(r"<br\s*/?>", "\n", fragment, flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", "", t)).strip()
    return "" if t == NOT_ANSWERED else t


# One label/answer pair as rendered by fieldRow() in the Worker's shared.ts.
FIELD = re.compile(
    r'<div[^>]*text-transform:\s*uppercase;\s*color:\s*#a3813f;[^>]*>(.*?)</div>\s*'
    r'<div[^>]*>(.*?)</div>\s*</td>',
    re.S | re.I,
)


def fields(body):
    """Ordered (label, value) pairs from the first copy of the form in the email."""
    out, seen = [], set()
    for label, value in FIELD.findall(body):
        label = clean(label)
        if label.lower() in seen:
            break  # a quoted second copy further down a reply thread
        seen.add(label.lower())
        out.append((label, clean(value)))
    return out


def q(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def main():
    report = []
    profiles = {}  # email -> dict

    def profile(email_addr, first="", last="", phone="", country="", created=None, source=""):
        e = (email_addr or "").strip().lower()
        if not e or "@" not in e:
            return None
        p = profiles.setdefault(e, {"id": str(uuid.uuid4()), "email": e, "first_name": "", "last_name": "",
                                    "phone": "", "country": "", "created_at": created, "sources": set()})
        for k, v in (("first_name", first), ("last_name", last), ("phone", phone), ("country", country)):
            if v and not p[k]:
                p[k] = v.strip()
        if created and (not p["created_at"] or created < p["created_at"]):
            p["created_at"] = created
        p["sources"].add(source)
        return p["id"]

    # 1. Profiles recovered from transcripts (includes the Squarespace import).
    for r in json.load(open(f"{RECOVERED}/snapshots/profiles.json")):
        created = r.get("_squarespace_created_on")
        profile(r.get("email"), r.get("first_name") or "", r.get("last_name") or "", r.get("phone") or "",
                created=created, source="recovered")

    # 2. Squarespace CSV: fills phone and country where the snapshot lacks them.
    csv_path = f"{RECOVERED}/sources/squarespace-contacts-profiles.csv"
    if os.path.exists(csv_path):
        for r in csv.DictReader(open(csv_path, encoding="utf-8-sig")):
            low = {k.lower().strip(): (v or "").strip() for k, v in r.items() if k}
            e = low.get("email") or low.get("email address")
            phone = low.get("phone") or low.get("phone number") or low.get("billing phone") or ""
            country = low.get("country") or low.get("billing country") or low.get("shipping country") or ""
            if e and e.lower() in profiles:
                profile(e, phone=phone, country=country, source="squarespace")

    # 3. Form emails from the Proton export.
    screenings, waivers, contacts = {}, {}, {}
    skipped = []
    for f in sorted(glob.glob(f"{EXPORT}/*.eml")):
        m = email.message_from_binary_file(open(f, "rb"))
        subj = subject_of(m)
        base = re.sub(r"^(re|fw|fwd):\s*", "", subj, flags=re.I).strip()
        is_reply = base != subj
        body = html_of(m)
        when = iso(m)

        if base.startswith("Health screening"):
            pairs = fields(body)
            if not pairs:
                continue
            answers = []
            for label, value in pairs:
                key = LABEL_TO_KEY.get(label.lower()) or "x_" + re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:40]
                answers.append({"key": key, "question": QUESTIONS.get(key, label), "answer": value})
            a = {x["key"]: x["answer"] for x in answers}
            first, last, em = a.get("q5", ""), a.get("q6", ""), a.get("q8", "")
            offering = a.get("offering", "")
            if not em:
                continue
            if is_test(f"{first} {last}") or offering.strip().lower() == "test":
                skipped.append(("screening", "test submission"))
                continue
            # The original notification wins over a quoted copy in a reply; the
            # earliest copy dates it.
            k = (em.lower(), offering)
            prev = screenings.get(k)
            row = {"email": em.lower(), "first": first, "last": last, "phone": a.get("q9", ""),
                   "offering": offering, "answers": answers, "created_at": when, "reply": is_reply}
            if not prev or (prev["reply"] and not is_reply) or (prev["reply"] == is_reply and when < prev["created_at"]):
                if prev and prev["created_at"] < when:
                    row["created_at"] = prev["created_at"]
                screenings[k] = row
            elif when < prev["created_at"]:
                prev["created_at"] = when

        elif base.startswith("Signed waiver") and not is_reply:
            a = {l.lower(): v for l, v in fields(body)}
            em = a.get("email", "")
            if not em:
                continue
            if is_test(f"{a.get('first name', '')} {a.get('last name', '')}".replace("—", "")):
                skipped.append(("waiver", "test submission"))
                continue
            sig = None
            for p in m.walk():
                if p.get_content_type() == "image/png":
                    import base64
                    sig = "data:image/png;base64," + base64.b64encode(p.get_payload(decode=True)).decode()
                    break
            name = (a.get("first name", "") + " " + (a.get("last name", "") if a.get("last name") not in ("—", "") else "")).strip()
            waivers[(em.lower(), a.get("signed at", when))] = {
                "email": em.lower(), "first": a.get("first name", ""), "last": a.get("last name", "").strip("—").strip(),
                "full_name": name, "phone": a.get("phone", "").strip("—").strip(), "country": a.get("country", "").strip("—").strip(),
                "date_signed": a.get("date signed", ""), "signed_at": a.get("signed at", "") or when,
                "signature": sig, "created_at": when,
            }

        elif base.startswith("Contact form") and not is_reply:
            a = {l.lower(): v for l, v in fields(body)}
            em = a.get("email", "")
            if not em or is_test(a.get("name", "")):
                skipped.append(("contact", "test submission"))
                continue
            name = a.get("name", "")
            parts = name.split()
            msg = a.get("message", "")
            contacts[(em.lower(), when)] = {
                "email": em.lower(), "name": name, "first": parts[0] if parts else "", "last": " ".join(parts[1:]),
                "phone": a.get("phone", "").strip("—").strip(), "topic": a.get("asking about", ""),
                "message": msg, "created_at": when,
                "source": "academy" if msg.startswith("Academy application:") else "contact",
            }

    for s in screenings.values():
        s["profile_id"] = profile(s["email"], s["first"], s["last"], s["phone"], created=s["created_at"], source="screening")
    for w in waivers.values():
        w["profile_id"] = profile(w["email"], w["first"], w["last"], w["phone"], w["country"], created=w["created_at"], source="waiver")
    for c in contacts.values():
        c["profile_id"] = profile(c["email"], c["first"], c["last"], c["phone"], created=c["created_at"], source="contact")

    # 4. Programs: dates, roster, room choices.
    sessions = json.load(open(f"{RECOVERED}/snapshots/program_sessions.json"))
    session_ids = {}
    for s in sessions:
        s["id"] = str(uuid.uuid4())
        session_ids[s["program"]] = s["id"]

    enrollments = []
    for r in json.load(open(f"{RECOVERED}/snapshots/program_enrollments.json")):
        if r.get("email") == "lburandt2@gmail.com":
            continue  # a test row removed in the old portal
        pid = profile(r["email"], *(r.get("name") or "").split(" ", 1), source="enrollment") if r.get("name") else profile(r["email"], source="enrollment")
        old_plan = r.get("payment_plan")
        enrollments.append({
            "profile_id": pid, "program": r["program"], "session_id": session_ids.get(r["program"]),
            "accommodation": r.get("accommodation"), "status": r.get("status") or "enrolled",
            # Everyone was refunded in Sept 2026 when the payment processor changed.
            "payment_status": "unpaid", "payment_plan": None,
            "notes": ("Before the Sept 2026 refund: " + old_plan) if old_plan else None,
        })

    for e in json.load(open(f"{RECOVERED}/snapshots/extra_enrollments.json")) if os.path.exists(f"{RECOVERED}/snapshots/extra_enrollments.json") else []:
        pid = profile(e["email"], e.get("first", ""), e.get("last", ""), source="enrollment")
        if any(x["profile_id"] == pid and x["program"] == e["program"] for x in enrollments):
            for x in enrollments:
                if x["profile_id"] == pid and x["program"] == e["program"] and not x["accommodation"]:
                    x["accommodation"] = e.get("accommodation")
            continue
        enrollments.append({"profile_id": pid, "program": e["program"], "session_id": session_ids.get(e["program"]),
                            "accommodation": e.get("accommodation"), "status": "enrolled",
                            "payment_status": "unpaid", "payment_plan": None, "notes": e.get("notes")})

    campaigns = json.load(open(f"{RECOVERED}/snapshots/campaigns.json"))

    # 5. SQL.
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    L = ["-- Generated by workers/forms/import/build_import.py on " + now, "PRAGMA foreign_keys = ON;"]
    for p in profiles.values():
        created = p["created_at"] or now
        if len(created) == 10:
            created += "T00:00:00.000Z"
        L.append(
            "INSERT INTO profiles (id, email, first_name, last_name, phone, country, notes, created_at, updated_at) VALUES "
            f"({q(p['id'])}, {q(p['email'])}, {q(p['first_name'])}, {q(p['last_name'])}, {q(p['phone'] or None)}, "
            f"{q(p['country'] or None)}, '', {q(created)}, {q(now)}) "
            "ON CONFLICT (email) DO NOTHING;"
        )
    # Rows below look the profile up by email, so they still attach correctly
    # if a profile already existed (e.g. created by a live form submission).
    pid_sql = lambda e: f"(SELECT id FROM profiles WHERE email = {q(e)})"
    email_of = {p["id"]: p["email"] for p in profiles.values()}
    for s in screenings.values():
        L.append(
            "INSERT INTO screenings (id, profile_id, full_name, email, phone, offering, answers, created_at) VALUES "
            f"({q(str(uuid.uuid4()))}, {pid_sql(s['email'])}, {q((s['first'] + ' ' + s['last']).strip())}, {q(s['email'])}, "
            f"{q(s['phone'] or None)}, {q(s['offering'])}, {q(json.dumps(s['answers'], ensure_ascii=False))}, {q(s['created_at'])});"
        )
    for w in waivers.values():
        L.append(
            "INSERT INTO waivers (id, profile_id, full_name, email, phone, signature, date_signed, signed_at, created_at) VALUES "
            f"({q(str(uuid.uuid4()))}, {pid_sql(w['email'])}, {q(w['full_name'])}, {q(w['email'])}, {q(w['phone'] or None)}, "
            f"{q(w['signature'])}, {q(w['date_signed'])}, {q(w['signed_at'])}, {q(w['created_at'])});"
        )
    for c in contacts.values():
        L.append(
            "INSERT INTO contact_messages (id, profile_id, name, email, phone, topic, message, source, created_at) VALUES "
            f"({q(str(uuid.uuid4()))}, {pid_sql(c['email'])}, {q(c['name'])}, {q(c['email'])}, {q(c['phone'] or None)}, "
            f"{q(c['topic'])}, {q(c['message'])}, {q(c['source'])}, {q(c['created_at'])});"
        )
    for s in sessions:
        L.append(
            "INSERT INTO program_sessions (id, program, label, starts_on, ends_on, location, created_at) VALUES "
            f"({q(s['id'])}, {q(s['program'])}, {q(s.get('label'))}, {q(s.get('starts_on'))}, {q(s.get('ends_on'))}, "
            f"{q(s.get('location'))}, {q(now)});"
        )
    for e in enrollments:
        L.append(
            "INSERT INTO program_enrollments (id, profile_id, program, session_id, accommodation, payment_plan, payment_status, status, notes, created_at, updated_at) VALUES "
            f"({q(str(uuid.uuid4()))}, {pid_sql(email_of[e['profile_id']])}, {q(e['program'])}, {q(e['session_id'])}, "
            f"{q(e['accommodation'])}, {q(e['payment_plan'])}, {q(e['payment_status'])}, {q(e['status'])}, {q(e['notes'])}, {q(now)}, {q(now)}) "
            "ON CONFLICT (profile_id, program) DO NOTHING;"
        )
    for c in campaigns:
        L.append(
            "INSERT INTO campaigns (id, name, subject, preview_text, content_html, audience_type, status, created_at, updated_at) VALUES "
            f"({q(str(uuid.uuid4()))}, {q(c['name'])}, {q(c['subject'])}, {q(c.get('preview_text') or '')}, "
            f"{q(c['content_html'])}, {q(c.get('audience_type') or 'all')}, 'draft', {q(now)}, {q(now)});"
        )

    os.makedirs(OUT, exist_ok=True)
    open(f"{OUT}/import.sql", "w", encoding="utf-8").write("\n".join(L) + "\n")

    report.append(f"profiles: {len(profiles)}")
    report.append(f"screenings: {len(screenings)}")
    report.append(f"waivers: {len(waivers)} ({sum(1 for w in waivers.values() if w['signature'])} with signature image)")
    report.append(f"contact messages: {len(contacts)}")
    report.append(f"program sessions: {len(sessions)}")
    report.append(f"enrollments: {len(enrollments)} ({sum(1 for e in enrollments if e['accommodation'])} with a room choice)")
    report.append(f"campaigns: {len(campaigns)}")
    report.append(f"skipped test submissions: {len(skipped)}")
    unknown = sorted({a['key'] for s in screenings.values() for a in s['answers'] if a['key'].startswith('x_')})
    if unknown:
        report.append("screening labels not in today's question list (kept as-is): " + ", ".join(unknown))
    open(f"{OUT}/REPORT.txt", "w").write("\n".join(report) + "\n")
    print("\n".join(report))


if __name__ == "__main__":
    sys.exit(main())
