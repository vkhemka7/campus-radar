const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FLOW_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const CONFIRMATION_OTP_TYPES = ["signup", "invite", "magiclink", "recovery", "email_change", "email"] as const;

export const CONFIRM_EMAIL_MESSAGE =
  "Check your email for a confirmation link. Open it, then choose Confirm email. If you already have an account, log in instead.";

export type ConfirmationOtpType = (typeof CONFIRMATION_OTP_TYPES)[number];

export type AuthFormState = {
  status: "error" | "confirm_email";
  message: string;
  email: string;
};

export type AuthFailure = {
  message: string;
  code?: string | null;
};

export type CredentialResult =
  | { ok: true; email: string; password: string }
  | { ok: false; state: AuthFormState };

export type SignupInterpretation =
  | { kind: "session" }
  | { kind: "confirm_email"; email: string; message: string }
  | { kind: "error"; message: string };

export const CONFIRMATION_NOTICES = {
  confirmation_expired:
    "This confirmation link is invalid or has already been used. If you already confirmed your email, log in. Otherwise sign up again to get a new link.",
  confirmation_failed:
    "That confirmation link could not be completed. Sign up again, or log in if you already confirmed your email.",
  confirmation_incomplete: "That confirmation link did not include the details needed to finish signing in.",
} as const;

export type ConfirmationNotice = keyof typeof CONFIRMATION_NOTICES;

export type AuthCallback =
  | { kind: "code"; code: string; flowId: string | null }
  | { kind: "otp"; tokenHash: string; type: ConfirmationOtpType }
  | { kind: "failure"; notice: ConfirmationNotice };

export type ConfirmationPageModel =
  | { kind: "prompt"; callback: Exclude<AuthCallback, { kind: "failure" }> }
  | { kind: "notice"; notice: ConfirmationNotice };

const LOGIN_NOTICES = CONFIRMATION_NOTICES;

export function parseCredentials(formData: FormData): CredentialResult {
  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");
  const email = typeof emailValue === "string" ? emailValue.trim() : "";
  const password = typeof passwordValue === "string" ? passwordValue : "";

  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return { ok: false, state: { status: "error", message: "Enter a valid email address.", email } };
  }
  if (password.length < 6 || password.length > 72) {
    return {
      ok: false,
      state: { status: "error", message: "Password must be between 6 and 72 characters.", email },
    };
  }
  return { ok: true, email, password };
}

export function loginFailureMessage(error: AuthFailure): string {
  const code = error.code ?? "";
  const lower = error.message.toLowerCase();
  if (code === "email_not_confirmed" || lower.includes("email not confirmed")) {
    return "Confirm your email before logging in. Open the confirmation link and choose Confirm email.";
  }
  if (code === "invalid_credentials" || lower.includes("invalid login credentials")) {
    return "Email or password is incorrect.";
  }
  if (code === "over_request_rate_limit" || lower.includes("rate limit")) {
    return "Too many attempts. Wait a moment and try again.";
  }
  return "Could not log in. Try again.";
}

export function signupFailureMessage(error: AuthFailure): string {
  const code = error.code ?? "";
  const message = error.message.trim();
  const lower = message.toLowerCase();
  if (
    code === "user_already_exists" ||
    code === "email_exists" ||
    lower.includes("already registered") ||
    lower.includes("already been registered")
  ) {
    return "An account with this email already exists. Log in instead.";
  }
  if (code === "weak_password" || lower.includes("password should be at least")) {
    const length = message.match(/at least (\d+) characters/i)?.[1];
    return length ? `Password must be at least ${length} characters.` : "Choose a stronger password and try again.";
  }
  if (code === "over_request_rate_limit" || lower.includes("rate limit")) {
    return "Too many attempts. Wait a moment and try again.";
  }
  if (code === "signup_disabled" || lower.includes("signups not allowed")) {
    return "New accounts are turned off right now.";
  }
  return "Could not create an account. Try again.";
}

export function interpretSignup(
  result: {
    user: { id: string } | null;
    session: object | null;
    error: AuthFailure | null;
  },
  email: string,
): SignupInterpretation {
  if (result.error) return { kind: "error", message: signupFailureMessage(result.error) };
  if (result.session) return { kind: "session" };
  if (result.user) return { kind: "confirm_email", email, message: CONFIRM_EMAIL_MESSAGE };
  return { kind: "error", message: "Could not create an account. Try again." };
}

export function loginNotice(code: string | string[] | undefined): string | null {
  const value = Array.isArray(code) ? code[0] : code;
  if (!value || !(value in LOGIN_NOTICES)) return null;
  return LOGIN_NOTICES[value as keyof typeof LOGIN_NOTICES];
}

export function emailConfirmationRedirect(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return new URL("/auth/confirm", url.origin).toString();
  } catch {
    return null;
  }
}

export function authCallbackRedirectTarget(requestUrl: URL): string | null {
  if (requestUrl.pathname === "/auth/confirm") return null;
  const params = requestUrl.searchParams;
  if (!params.has("code") && !params.has("token_hash") && !params.has("error_description")) return null;
  const target = new URL("/auth/confirm", requestUrl.origin);
  target.search = params.toString();
  return `${target.pathname}${target.search}`;
}

export function confirmationFailureNotice(error: AuthFailure): ConfirmationNotice {
  const code = error.code ?? "";
  const lower = error.message.toLowerCase();
  if (code === "otp_expired" || code === "flow_state_expired" || lower.includes("expired")) {
    return "confirmation_expired";
  }
  return "confirmation_failed";
}

/**
 * Decides what /auth/confirm should show. A token or PKCE code stays unspent
 * until the visitor submits the confirm form.
 */
export function confirmationPageModel(params: URLSearchParams): ConfirmationPageModel {
  const notice = params.get("notice");
  if (notice && isConfirmationNotice(notice)) return { kind: "notice", notice };
  const callback = parseAuthCallback(params);
  if (callback.kind === "failure") return { kind: "notice", notice: callback.notice };
  return { kind: "prompt", callback };
}

export function parseAuthCallback(params: URLSearchParams): AuthCallback {
  if (params.get("error") || params.get("error_description")) {
    return { kind: "failure", notice: confirmationLinkNotice(params) };
  }
  const code = params.get("code")?.trim() ?? "";
  if (code) {
    const flowId = params.get("sb_flow_id");
    return { kind: "code", code, flowId: flowId && FLOW_ID_PATTERN.test(flowId) ? flowId : null };
  }
  const tokenHash = params.get("token_hash")?.trim() ?? "";
  const type = params.get("type")?.trim() ?? "";
  if (tokenHash && isConfirmationOtpType(type)) return { kind: "otp", tokenHash, type };
  return { kind: "failure", notice: "confirmation_incomplete" };
}

function confirmationLinkNotice(params: URLSearchParams): ConfirmationNotice {
  const code = (params.get("error_code") ?? "").toLowerCase();
  const description = (params.get("error_description") ?? "").toLowerCase();
  if (code === "otp_expired" || code === "flow_state_expired" || description.includes("expired")) {
    return "confirmation_expired";
  }
  return "confirmation_failed";
}

function isConfirmationNotice(value: string): value is ConfirmationNotice {
  return Object.prototype.hasOwnProperty.call(CONFIRMATION_NOTICES, value);
}

function isConfirmationOtpType(value: string): value is ConfirmationOtpType {
  return CONFIRMATION_OTP_TYPES.some((type) => type === value);
}
