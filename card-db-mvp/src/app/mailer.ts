// Outbound email (password-reset links today; receipts and alerts later).
//
// Zero dependencies: the only provider that needs network is Resend's REST API,
// called with fetch. Selected by MAIL_PROVIDER:
//   log    = print the message to the server log (default; local dev — the reset
//            link shows up in the terminal so the flow can be exercised without
//            an email account)
//   resend = send through https://resend.com (RESEND_API_KEY + MAIL_FROM)
// APP_BASE_URL is the public origin used to build links inside messages; when
// unset the request's own origin is used.

export type Mail = { to: string; subject: string; text: string; html?: string };

const PROVIDER = (process.env.MAIL_PROVIDER ?? "log").toLowerCase();
const FROM = process.env.MAIL_FROM ?? "CardIndex <no-reply@localhost>";

export function mailConfigured(): boolean {
  return PROVIDER === "resend" && !!process.env.RESEND_API_KEY;
}

/** Human label for the auth pages ("we emailed you" vs. "check the server log"). */
export function mailMode(): "live" | "log" {
  return mailConfigured() ? "live" : "log";
}

export async function sendMail(m: Mail): Promise<void> {
  if (mailConfigured()) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html ?? undefined }),
    });
    if (!r.ok) throw new Error(`Resend rejected the message (${r.status}): ${(await r.text()).slice(0, 300)}`);
    return;
  }
  console.log(`\n  [mail:log] To: ${m.to}\n  Subject: ${m.subject}\n  ${m.text.replace(/\n/g, "\n  ")}\n`);
}

/** Public origin for links in emails. */
export function appBaseUrl(fallbackOrigin: string): string {
  return (process.env.APP_BASE_URL ?? fallbackOrigin).replace(/\/+$/, "");
}
