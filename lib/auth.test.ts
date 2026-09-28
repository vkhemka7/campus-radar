import { describe, expect, test } from "vitest";
import {
  CONFIRM_EMAIL_MESSAGE,
  authCallbackRedirectTarget,
  confirmationFailureNotice,
  confirmationPageModel,
  emailConfirmationRedirect,
  interpretSignup,
  loginFailureMessage,
  loginNotice,
  parseAuthCallback,
  parseCredentials,
  signupFailureMessage,
} from "@/lib/auth";

function credentials(email: string, password: string) {
  const formData = new FormData();
  formData.set("email", email);
  formData.set("password", password);
  return parseCredentials(formData);
}

describe("authentication form logic", () => {
  test("accepts a trimmed email and a password inside the provider limits", () => {
    expect(credentials("  student@example.com ", "secret")).toEqual({
      ok: true,
      email: "student@example.com",
      password: "secret",
    });
    expect(credentials("student@example.com", "a".repeat(72)).ok).toBe(true);
  });

  test("rejects missing, invalid, and oversized credentials before calling Auth", () => {
    expect(credentials("", "secret").ok).toBe(false);
    expect(credentials("not-an-email", "secret")).toMatchObject({
      ok: false,
      state: { status: "error", message: "Enter a valid email address." },
    });
    expect(credentials("student@example.com", "short")).toMatchObject({
      ok: false,
      state: { message: "Password must be between 6 and 72 characters." },
    });
    expect(credentials("student@example.com", "a".repeat(73)).ok).toBe(false);

    const formData = new FormData();
    formData.set("email", new Blob(["student@example.com"]), "email.txt");
    formData.set("password", "secret");
    expect(parseCredentials(formData)).toMatchObject({
      ok: false,
      state: { message: "Enter a valid email address.", email: "" },
    });
  });

  test("treats a signup user without a session as email confirmation, not failure", () => {
    const user = { id: "user-1", identities: [] as { id: string }[] };
    expect(interpretSignup({ user, session: null, error: null }, "student@example.com")).toEqual({
      kind: "confirm_email",
      email: "student@example.com",
      message: CONFIRM_EMAIL_MESSAGE,
    });
  });

  test("follows a signup session and maps provider failures", () => {
    expect(interpretSignup({ user: { id: "user-1" }, session: { access_token: "token" }, error: null }, "a@b.co")).toEqual({
      kind: "session",
    });
    expect(interpretSignup({ user: null, session: null, error: null }, "a@b.co")).toEqual({
      kind: "error",
      message: "Could not create an account. Try again.",
    });
    expect(signupFailureMessage({ code: "email_exists", message: "User already registered" })).toBe(
      "An account with this email already exists. Log in instead.",
    );
    expect(signupFailureMessage({ message: "Password should be at least 8 characters." })).toBe(
      "Password must be at least 8 characters.",
    );
    expect(signupFailureMessage({ code: "signup_disabled", message: "Signups not allowed for this instance" })).toBe(
      "New accounts are turned off right now.",
    );
    expect(signupFailureMessage({ message: "database connection reset" })).toBe("Could not create an account. Try again.");
  });

  test("maps login failures without echoing provider internals", () => {
    expect(loginFailureMessage({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe(
      "Email or password is incorrect.",
    );
    expect(loginFailureMessage({ code: "email_not_confirmed", message: "Email not confirmed" })).toContain(
      "Confirm your email",
    );
    expect(loginFailureMessage({ code: "over_request_rate_limit", message: "Request rate limit reached" })).toBe(
      "Too many attempts. Wait a moment and try again.",
    );
    expect(loginFailureMessage({ message: "unexpected auth response" })).toBe("Could not log in. Try again.");
    expect(loginNotice("confirmation_failed")).toContain("confirmation link");
    expect(loginNotice(["confirmation_incomplete"])).toContain("did not include");
    expect(loginNotice("not-a-real-notice")).toBeNull();
    expect(loginNotice(undefined)).toBeNull();
  });

  test("builds a same-origin confirmation redirect", () => {
    expect(emailConfirmationRedirect("https://campus.example/app")).toBe("https://campus.example/auth/confirm");
    expect(emailConfirmationRedirect("http://localhost:3000")).toBe("http://localhost:3000/auth/confirm");
    expect(emailConfirmationRedirect("javascript:alert(1)")).toBeNull();
    expect(emailConfirmationRedirect("not a url")).toBeNull();
  });

  test("forwards confirmation callbacks to the confirm route", () => {
    expect(authCallbackRedirectTarget(new URL("http://localhost:3000/?view=all"))).toBeNull();
    expect(authCallbackRedirectTarget(new URL("http://localhost:3000/auth/confirm?code=abc"))).toBeNull();
    expect(authCallbackRedirectTarget(new URL("http://localhost:3000/?code=abc&view=all"))).toBe(
      "/auth/confirm?code=abc&view=all",
    );
    expect(
      authCallbackRedirectTarget(new URL("http://localhost:3000/login?error_description=expired&error=access_denied")),
    ).toBe("/auth/confirm?error_description=expired&error=access_denied");
  });

  test("accepts a PKCE code or an email token hash and rejects anything else", () => {
    expect(parseAuthCallback(new URLSearchParams("code=abc&sb_flow_id=flow-12345678"))).toEqual({
      kind: "code",
      code: "abc",
      flowId: "flow-12345678",
    });
    expect(parseAuthCallback(new URLSearchParams("code=abc&sb_flow_id=../bad"))).toEqual({
      kind: "code",
      code: "abc",
      flowId: null,
    });
    expect(parseAuthCallback(new URLSearchParams("token_hash=hash&type=signup"))).toEqual({
      kind: "otp",
      tokenHash: "hash",
      type: "signup",
    });
    expect(parseAuthCallback(new URLSearchParams("token_hash=hash&type=signup&error=access_denied"))).toEqual({
      kind: "failure",
      notice: "confirmation_failed",
    });
    expect(
      parseAuthCallback(
        new URLSearchParams(
          "error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
        ),
      ),
    ).toEqual({ kind: "failure", notice: "confirmation_expired" });
    expect(parseAuthCallback(new URLSearchParams("token_hash=hash&type=not-a-type"))).toEqual({
      kind: "failure",
      notice: "confirmation_incomplete",
    });
    expect(parseAuthCallback(new URLSearchParams("code="))).toEqual({
      kind: "failure",
      notice: "confirmation_incomplete",
    });
  });

  test("shows a confirm button instead of spending a token on arrival", () => {
    expect(confirmationPageModel(new URLSearchParams("token_hash=hash&type=signup"))).toEqual({
      kind: "prompt",
      callback: { kind: "otp", tokenHash: "hash", type: "signup" },
    });
    expect(confirmationPageModel(new URLSearchParams("code=abc"))).toEqual({
      kind: "prompt",
      callback: { kind: "code", code: "abc", flowId: null },
    });
    expect(
      confirmationPageModel(
        new URLSearchParams("error=access_denied&error_code=otp_expired&error_description=expired"),
      ),
    ).toEqual({ kind: "notice", notice: "confirmation_expired" });
    expect(confirmationPageModel(new URLSearchParams("notice=confirmation_expired"))).toEqual({
      kind: "notice",
      notice: "confirmation_expired",
    });
    expect(loginNotice("confirmation_expired")).toContain("already been used");
    expect(confirmationFailureNotice({ code: "otp_expired", message: "Email link is invalid or has expired" })).toBe(
      "confirmation_expired",
    );
    expect(confirmationFailureNotice({ code: "unexpected_failure", message: "database unavailable" })).toBe(
      "confirmation_failed",
    );
  });
});
