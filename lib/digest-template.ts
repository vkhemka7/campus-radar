import type { ForYouRecommendation } from "./for-you";

function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? escape(url.href) : null;
  } catch {
    return null;
  }
}
function uniqueSafe(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const safe = safeUrl(value);
    if (!safe || seen.has(safe)) continue;
    seen.add(safe);
    links.push(safe);
  }
  return links;
}

/** Pure, offline renderer. Tables, bgcolor, and inline styles target email clients. */
export function renderDigestHtml(
  items: readonly ForYouRecommendation[],
  siteUrl: string,
  now = new Date(),
): string {
  const origin = siteUrl.replace(/\/$/, "");
  const browse = safeUrl(`${origin}/?view=for-you`);
  const interests = safeUrl(`${origin}/account/interests`);
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Chicago",
  }).format(now);
  const count = items.length;
  const heading = `${count} upcoming ${count === 1 ? "opportunity" : "opportunities"} worth a look.`;
  const modules = items
    .map((item, index) => {
      const { event, provenance } = item.occurrence;
      const start = new Date(event.startTime);
      const format = (value: string) =>
        new Intl.DateTimeFormat("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: event.timezone,
          timeZoneName: "short",
        }).format(new Date(value));
      const marker = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        weekday: "short",
        timeZone: event.timezone,
      }).formatToParts(start);
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        marker.find((entry) => entry.type === type)?.value ?? "";
      const sources = uniqueSafe([
        ...provenance.map((row) => row.sourceUrl),
        event.sourceUrl,
      ]);
      const registrations = uniqueSafe(
        provenance.map((row) => row.registrationUrl),
      ).filter((url) => !sources.includes(url));
      const sourceLinks = [
        ...sources.map((url, sourceIndex) =>
          link(
            url,
            sourceIndex === 0
              ? "View event"
              : `View listing ${sourceIndex + 1}`,
          ),
        ),
        ...registrations.map((url) => link(url, "Register")),
      ].join("");
      const fallback =
        sourceLinks || !browse
          ? ""
          : link(browse, "Open CampusRadar");
      return `<tr><td class="event-pad" style="padding:22px 28px;border-bottom:1px solid #dadcd3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="58" valign="top" style="width:58px;padding:2px 14px 0 0;">
<table role="presentation" width="54" cellpadding="0" cellspacing="0" border="0" bgcolor="#fffefa" style="width:54px;border:1px solid #dadcd3;">
<tr><td align="center" style="padding:8px 2px 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;letter-spacing:1px;color:#626b66;">${escape(part("month").toUpperCase())}</td></tr>
<tr><td align="center" style="padding:0;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.1;font-weight:bold;color:#202b29;">${escape(part("day"))}</td></tr>
<tr><td align="center" style="padding:0 2px 8px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;letter-spacing:.6px;color:#626b66;">${escape(part("weekday").toUpperCase())}</td></tr>
</table>
</td>
<td valign="top" style="word-break:break-word;">
<p style="margin:0 0 8px;color:#85401e;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">${String(index + 1).padStart(2, "0")} &nbsp; / &nbsp; ${escape(event.category || "On campus")}</p>
<h2 class="event-title" style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.25;letter-spacing:-.4px;color:#202b29;">${escape(event.title)}</h2>
${event.company ? `<p style="margin:0 0 10px;font-size:14px;font-weight:bold;color:#202b29;">${escape(event.company)}</p>` : ""}
<p style="margin:0;font-size:13px;line-height:1.7;color:#202b29;">${escape(format(event.startTime))}${event.startTime !== event.endTime ? `<br><span style="color:#626b66;">Ends ${escape(format(event.endTime))}</span>` : ""}<br>${escape(event.location || "Location to be announced")}</p>
<p style="margin:12px 0;font-size:14px;line-height:1.6;color:#245c48;">${escape(item.explanation)}</p>
${sourceLinks || fallback}
<p style="margin:8px 0 0;font-size:12px;line-height:1.6;color:#626b66;">From ${escape(provenance[0]?.source || event.source || "the campus calendar")}${provenance.length > 1 ? ` &middot; ${provenance.length} listings brought together` : ""}</p>
</td></tr></table>
</td></tr>`;
    })
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>CampusRadar — Your daily radar</title>
<style>
@media screen and (max-width:600px){
  .digest-title{font-size:28px !important;}
  .event-title{font-size:20px !important;}
  .event-pad{padding:18px 16px !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f6f5f0;color:#202b29;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;font-size:1px;color:#f6f5f0;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${heading} Your Illinois campus edit for ${escape(date)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f6f5f0" style="background-color:#f6f5f0;"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fffefa" style="max-width:600px;background-color:#fffefa;">
<tr><td style="padding:22px 28px;border-top:4px solid #b83c16;border-bottom:1px solid #dadcd3;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;letter-spacing:-.6px;color:#202b29;">CampusRadar <span style="color:#b83c16;">&nearr;</span></td></tr>
<tr><td bgcolor="#ecefe5" style="padding:28px;background-color:#ecefe5;"><p style="margin:0 0 14px;font-size:11px;font-weight:bold;letter-spacing:1.4px;color:#202b29;">YOUR ILLINOIS CAMPUS EDIT</p><h1 class="digest-title" style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:32px;line-height:1.15;letter-spacing:-.8px;color:#202b29;">Your radar for<br>${escape(date)}.</h1><p style="margin:0;font-size:15px;line-height:1.6;color:#202b29;">${heading}</p></td></tr>
${modules}
<tr><td style="padding:28px;"><h2 style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.25;color:#202b29;">Keep a little room for what’s next.</h2><p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#626b66;">Save your favorites and make a plan on CampusRadar.</p>${browse ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#202b29" style="border-radius:6px;padding:14px 18px;"><a href="${browse}" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">Open your radar &rarr;</a></td></tr></table>` : ""}</td></tr>
<tr><td style="padding:22px 28px;border-top:1px solid #dadcd3;font-size:12px;line-height:1.7;color:#626b66;">CampusRadar / University of Illinois Urbana-Champaign<br>You’re receiving this because you saved career interests on CampusRadar.${interests ? `<br><a href="${interests}" style="color:#626b66;text-decoration:underline;">Manage interests</a> &middot; Clear all interests to stop these digests.` : ""}</td></tr>
</table><!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}

function link(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;padding:8px 14px 8px 0;color:#b83c16;font-size:13px;font-weight:bold;text-decoration:underline;">${label} &rarr;</a>`;
}
