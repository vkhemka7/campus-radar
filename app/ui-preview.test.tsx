import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import Home from "./page";
import { SiteHeader } from "./components/site-header";
import { getViewer } from "@/lib/current-user";
import { getEvents, type BrowsingEvent } from "@/lib/get-events";
import { AuthPage } from "./components/auth-page";
import { CredentialForm } from "./components/credential-form";
import { ResetPasswordForm } from "./components/reset-password-form";
import Loading from "./loading";
import ErrorPage from "./error";

vi.stubGlobal("React", React);
vi.mock("@/lib/current-user", () => ({ getViewer: vi.fn() }));
vi.mock("@/lib/get-events", () => ({
  getEvents: vi.fn(),
  EVENT_RESULT_LIMIT: 30,
}));
vi.mock("@/app/occurrence-state-actions", () => ({
  saveOccurrenceState: vi.fn(),
}));
vi.mock("@/app/auth/actions", () => ({
  logOut: vi.fn(),
  setNewPassword: vi.fn(),
}));
vi.mock("@/lib/supabase-server", () => ({
  createRequestSupabaseClient: async () => ({
    ok: true,
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async () => ({
              error: null,
              data: [
                { occurrence_id: "preview-0", status: "interested" },
                { occurrence_id: "preview-1", status: "going" },
              ],
            }),
          }),
        }),
      }),
    },
  }),
}));
const events: BrowsingEvent[] = [
  "Meet the teams building what’s next",
  "From campus project to first startup: an evening with Illinois founders, researchers, and the people helping ideas become reality",
].map((title, index) => {
  const event = {
    id: `source-${index}`,
    title,
    company: "Illinois Research Park",
    category: "Networking",
    description:
      "Meet the people working on problems you care about. Get a closer look at internships, hear how founders got started, and bring your questions. ".repeat(
        index ? 10 : 1,
      ),
    startTime: "2026-10-08T22:00:00Z",
    endTime: "2026-10-08T23:30:00Z",
    timezone: "America/Chicago",
    location: "EnterpriseWorks · 60 Hazelwood Drive",
    registrationUrl: "https://example.test/register",
    sourceUrl: "https://example.test/event",
    source: "Illinois Webtools",
    externalId: `source-${index}`,
    discoveredAt: "2026-10-07T12:00:00Z",
  };
  return {
    occurrenceId: `preview-${index}`,
    event,
    provenance: [
      event,
      {
        ...event,
        externalId: `second-${index}`,
        sourceUrl: "https://example.test/second",
      },
    ],
    relevance: { classification: "relevant", reasons: [] },
  };
});
async function page(signedIn = false, empty = false) {
  vi.mocked(getViewer).mockResolvedValue(
    signedIn
      ? ({
          status: "authenticated",
          user: { id: "fixture-user", email: "student@example.test" },
        } as never)
      : { status: "anonymous" },
  );
  vi.mocked(getEvents).mockResolvedValue({
    ok: true,
    events: empty ? [] : events,
  });
  return renderToStaticMarkup(
    <>
      {await SiteHeader()}
      {await Home({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({ view: "all" }),
      })}
    </>,
  );
}
test("anonymous discovery exposes login instead of mutation controls", async () => {
  const html = await page();
  expect(html).toContain("Log in to save");
  expect(html).not.toContain('name="occurrence_id"');
  expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>All events<\/a>/);
});
test("authenticated discovery retains Interested and Going plans", async () => {
  const html = await page(true);
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
  expect(html).toContain("Clear Interested");
  expect(html).toContain("Clear Going");
});
test("empty discovery offers a route back to browsing", async () => {
  const html = await page(false, true);
  expect(html).toContain("Reset your filters");
  expect(html).not.toContain("0 events");
});

// Optional offline visual fixtures from the actual components, never a public app route.
test.runIf(Boolean(process.env.CAMPUS_UI_PREVIEW))(
  "exports offline visual fixtures",
  async () => {
    const dir = "/tmp/campusradar-preview";
    mkdirSync(dir, { recursive: true });
    const css = readdirSync(".next/static/css")
      .filter((file) => file.endsWith(".css"))
      .map((file) => readFileSync(`.next/static/css/${file}`, "utf8"))
      .join("\n");
    const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style>`;
    const write = (name: string, html: string) =>
      writeFileSync(
        `${dir}/${name}.html`,
        `<!doctype html><html lang="en"><head>${head}</head><body>${html}</body></html>`,
      );
    write("signed-in", await page(true));
    write("anonymous", await page());
    write("empty", await page(false, true));
    const action = async () => ({
      status: "error" as const,
      email: "",
      message: "We couldn’t sign you in. Check your email and password.",
    });
    write(
      "login",
      renderToStaticMarkup(
        <AuthPage title="Welcome back." lede="Pick up where you left off.">
          <CredentialForm mode="login" notice={null} action={action} />
        </AuthPage>,
      ),
    );
    write(
      "signup",
      renderToStaticMarkup(
        <AuthPage
          title="Find your next thing."
          lede="Save events and choose your interests."
        >
          <CredentialForm mode="signup" notice={null} action={action} />
        </AuthPage>,
      ),
    );
    write(
      "auth-error",
      renderToStaticMarkup(
        <AuthPage title="Welcome back." lede="Pick up where you left off.">
          <CredentialForm
            mode="login"
            notice="We couldn’t sign you in. Check your email and password."
            action={action}
          />
        </AuthPage>,
      ),
    );
    write(
      "reset",
      renderToStaticMarkup(
        <AuthPage
          title="Set new password"
          lede="Choose a new password for your CampusRadar account."
        >
          <ResetPasswordForm callback={null} />
        </AuthPage>,
      ),
    );
    write("loading", renderToStaticMarkup(<Loading />));
    write("error", renderToStaticMarkup(<ErrorPage reset={() => {}} />));
    const names = [
      "signed-in",
      "anonymous",
      "empty",
      "login",
      "signup",
      "auth-error",
      "reset",
      "loading",
      "error",
      "digest",
    ];
    for (const name of names) {
      writeFileSync(
        `${dir}/review-${name}.html`,
        `<!doctype html><html><body style="margin:0;background:#ddd;font:14px Arial"><nav style="padding:10px">${names.map((n) => `<a style="margin:8px" href="review-${n}.html">${n}</a>`).join("")}</nav><p>Mobile 375px / 320px</p><div style="display:flex;gap:12px"><iframe title="375px" src="${name}.html" width="375" height="1050" style="border:0"></iframe><iframe title="320px" src="${name}.html" width="320" height="1050" style="border:0"></iframe></div><p>Desktop 1440px / Laptop 1024px (scaled to fit)</p><div style="height:600px"><iframe title="Desktop 1440px" src="${name}.html" width="1440" height="1100" style="border:0;transform:scale(.45);transform-origin:top left"></iframe></div><div style="height:600px"><iframe title="Laptop 1024px" src="${name}.html" width="1024" height="1000" style="border:0;transform:scale(.6);transform-origin:top left"></iframe></div></body></html>`,
      );
    }
  },
);
