"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction, ssoLoginAction, type LoginState } from "@/server/auth-actions";
import { t, type Locale } from "@/lib/i18n";

const initial: LoginState = {};

const primaryClass =
  "w-full rounded-control bg-accent hover:bg-accent-hover text-accent-fg py-2.5 font-medium transition disabled:opacity-60 flex items-center justify-center gap-2";
const secondaryClass =
  "w-full rounded-control border border-line-strong bg-surface hover:bg-paper text-ink py-2.5 font-medium transition disabled:opacity-60 flex items-center justify-center gap-2";

function SubmitButton({ label, busyLabel, className = primaryClass }: { label: string; busyLabel: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending && (
        <span className="w-4 h-4 rounded-full border-2 border-current/70 border-t-transparent animate-spin" aria-hidden="true" />
      )}
      <span>{pending ? busyLabel : label}</span>
    </button>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <p
      className="text-sm text-danger bg-danger/10 border border-danger/40 rounded-control px-3 py-2"
      role="alert"
    >
      {message}
    </p>
  );
}

export default function LoginForm({
  from,
  ssoName,
  showPassword,
  initialError,
  locale,
}: {
  from: string;
  /** Label of the single sign-on button, or null when SSO is not configured. */
  ssoName: string | null;
  showPassword: boolean;
  initialError: string | null;
  locale: Locale;
}) {
  const [state, formAction] = useActionState(loginAction, initial);
  // Controlled, so the values survive the form reset after the first step.
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [restarted, setRestarted] = useState<LoginState | null>(null);
  const codeStep = state?.step === "code" && restarted !== state;
  const actionError = state?.error === "code" ? t("authCodeInvalid", locale) : state?.error ? t("authInvalid", locale) : null;
  const error = restarted === state ? null : actionError ?? (state === initial ? initialError : null);

  return (
    <div className="space-y-4">
      {showPassword && (
        <form action={formAction} className="space-y-4" autoComplete="on">
          <input type="hidden" name="from" value={from} />
          {codeStep ? (
            <>
              <input type="hidden" name="username" value={username} />
              <input type="hidden" name="password" value={password} />
              <div>
                <h3 className="text-sm font-semibold">{t("twoFactorTitle", locale)}</h3>
                <p id="code-hint" className="text-sm text-ink-muted mt-1">
                  {t("authCodeHint", locale)}
                </p>
              </div>
              <label className="block">
                <span className="text-sm font-medium text-ink-muted">{t("authCodeLabel", locale)}</span>
                <input
                  name="code"
                  autoComplete="one-time-code"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  autoFocus
                  maxLength={32}
                  aria-describedby="code-hint"
                  className="mt-1.5 font-mono tracking-wider"
                />
              </label>
              {error && <ErrorMessage message={error} />}
              <SubmitButton label={t("authVerify", locale)} busyLabel={t("authVerifying", locale)} />
              <button
                type="button"
                className="w-full text-sm text-ink-muted hover:text-ink underline min-h-6"
                onClick={() => {
                  setPassword("");
                  setRestarted(state);
                }}
              >
                {t("authOtherAccount", locale)}
              </button>
            </>
          ) : (
            <>
              <label className="block">
                <span className="text-sm font-medium text-ink-muted">{t("authUsername", locale)}</span>
                <input
                  name="username"
                  autoComplete="username"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="mt-1.5"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink-muted">{t("authPassword", locale)}</span>
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1.5"
                />
              </label>
              {error && <ErrorMessage message={error} />}
              <SubmitButton label={t("authSignIn", locale)} busyLabel={t("authSigningIn", locale)} />
            </>
          )}
        </form>
      )}

      {ssoName && !codeStep && (
        <>
          {showPassword && (
            <div className="flex items-center gap-3 text-xs text-ink-muted" aria-hidden="true">
              <span className="h-px flex-1 bg-line" />
              {t("authOr", locale)}
              <span className="h-px flex-1 bg-line" />
            </div>
          )}
          {!showPassword && error && <ErrorMessage message={error} />}
          <form action={ssoLoginAction}>
            <input type="hidden" name="from" value={from} />
            <SubmitButton
              label={t("authSsoButton", locale).replace("{name}", ssoName)}
              busyLabel={t("authRedirecting", locale)}
              className={showPassword ? secondaryClass : primaryClass}
            />
          </form>
        </>
      )}
    </div>
  );
}
