import { beforeEach, describe, expect, test, vi } from "vitest";
import { confirmEmail, establishRecoverySession, logIn, logOut, setNewPassword, signUp } from "./actions";
const { session, auth } = vi.hoisted(() => ({ session: vi.fn(), auth: {
  signUp: vi.fn(), signInWithPassword: vi.fn(), signOut: vi.fn(), exchangeCodeForSession: vi.fn(), verifyOtp: vi.fn(),
  setSession: vi.fn(), getUser: vi.fn(), updateUser: vi.fn(),
} }));
vi.mock("@/lib/supabase-server", () => ({ createRequestSupabaseClient: session }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "campus.example", "x-forwarded-proto": "https" }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
function credentials() {
  const data = new FormData(); data.set("email", "student@example.test"); data.set("password", "test-password"); return data;
}
beforeEach(() => { vi.resetAllMocks(); session.mockResolvedValue({ ok: true, supabase: { auth } }); });
describe("authentication server actions", () => {
  test("signup sends confirmation to the app and handles email confirmation without a session", async () => {
    auth.signUp.mockResolvedValue({ data: { user: { id: "user" }, session: null }, error: null });
    expect(await signUp(undefined, credentials())).toMatchObject({ status: "confirm_email" });
    expect(auth.signUp).toHaveBeenCalledWith({ email: "student@example.test", password: "test-password", options: { emailRedirectTo: "https://campus.example/auth/confirm" } });
  });
  test("signup with a session redirects to the account", async () => {
    auth.signUp.mockResolvedValue({ data: { user: { id: "user" }, session: {} }, error: null });
    await expect(signUp(undefined, credentials())).rejects.toThrow("redirect:/account");
  });
  test("password login redirects only on success", async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: { code: "invalid_credentials", message: "Invalid login credentials" } })
      .mockResolvedValueOnce({ error: null });
    expect(await logIn(undefined, credentials())).toMatchObject({ status: "error", message: "Email or password is incorrect." });
    await expect(logIn(undefined, credentials())).rejects.toThrow("redirect:/account");
  });
  test("confirmation spends the PKCE code on explicit action submission", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    const data = new FormData(); data.set("code", "test-code");
    await expect(confirmEmail(data)).rejects.toThrow("redirect:/account");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("test-code", undefined);
  });
  test("recovery OTP confirmation continues to the set-password page", async () => {
    auth.verifyOtp.mockResolvedValue({ error: null });
    const data = new FormData(); data.set("token_hash", "hash"); data.set("type", "recovery");
    await expect(confirmEmail(data)).rejects.toThrow("redirect:/auth/reset");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "hash" });
  });
  test("implicit recovery tokens become a session before the password form", async () => {
    auth.setSession.mockResolvedValue({ error: null });
    const data = new FormData(); data.set("access_token", "access"); data.set("refresh_token", "refresh");
    await expect(establishRecoverySession(data)).rejects.toThrow("redirect:/auth/reset");
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: "access", refresh_token: "refresh" });
  });
  test("set password updates the authenticated user and does not record before success", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "user" } }, error: null });
    auth.updateUser.mockResolvedValueOnce({ error: { code: "weak_password", message: "Password should be at least 8 characters" } })
      .mockResolvedValueOnce({ error: null });
    const data = new FormData(); data.set("password", "test-password"); data.set("confirm_password", "test-password");
    expect(await setNewPassword(undefined, data)).toMatchObject({ status: "error", message: "Password must be at least 8 characters." });
    await expect(setNewPassword(undefined, data)).rejects.toThrow("redirect:/account?notice=password_updated");
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "test-password" });
  });
  test("set password spends a recovery token hash then updates the password", async () => {
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.getUser.mockResolvedValue({ data: { user: { id: "user" } }, error: null });
    auth.updateUser.mockResolvedValue({ error: null });
    const data = new FormData();
    data.set("password", "test-password"); data.set("confirm_password", "test-password");
    data.set("token_hash", "hash"); data.set("type", "recovery");
    await expect(setNewPassword(undefined, data)).rejects.toThrow("redirect:/account?notice=password_updated");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "hash" });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "test-password" });
  });
  test("set password without a session does not call updateUser", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const data = new FormData(); data.set("password", "test-password"); data.set("confirm_password", "test-password");
    expect(await setNewPassword(undefined, data)).toMatchObject({ status: "error" });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  test("successful sign-out redirects to the public feed", async () => {
    auth.signOut.mockResolvedValue({ error: null });
    await expect(logOut()).rejects.toThrow("redirect:/");
    expect(auth.signOut).toHaveBeenCalledOnce();
  });
  test.each(["provider", "network", "config"])("sign-out %s failure is visible without pretending success", async (kind) => {
    if (kind === "provider") auth.signOut.mockResolvedValue({ error: { message: "private detail" } });
    if (kind === "network") auth.signOut.mockRejectedValue(new Error("private detail"));
    if (kind === "config") session.mockResolvedValue({ ok: false, error: "missing configuration" });
    expect(await logOut()).toEqual({ message: "Could not log out. Try again." });
  });
});
