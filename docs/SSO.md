# Single sign-on and two-factor authentication

Kanbun accounts can sign in with a password, with single sign-on (SSO) through any OpenID Connect identity provider (IdP), or both. Password accounts can add two-factor authentication (2FA) with an authenticator app.

## Single sign-on (OpenID Connect)

SSO is off until `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` are set. The login page then shows a "Sign in with ..." button next to the password form.

### Environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `OIDC_ISSUER` | yes | Issuer URL. Kanbun reads `<issuer>/.well-known/openid-configuration`. |
| `OIDC_CLIENT_ID` | yes | Client ID of the application you create in the IdP. |
| `OIDC_CLIENT_SECRET` | yes | Client secret (confidential client). |
| `OIDC_NAME` | no | Label of the login button, e.g. `Authentik`. Default `SSO`. |
| `OIDC_SCOPES` | no | Requested scopes. Default `openid profile email`. Add `groups` if your IdP needs it for the groups claim. |
| `OIDC_ALLOW_SIGNUP` | no | `true` creates a member account on the first SSO login of someone without a Kanbun account. Default `false`: only existing users can sign in (see the linking rules). |
| `OIDC_ADMIN_GROUP` | no | A value of the `groups` claim that makes the user an admin. When set, the IdP decides the role at every SSO login (see below). |
| `OIDC_MATCH_USERNAME` | no | `true` also links an IdP account to the Kanbun user whose username equals `preferred_username`. Default `false`. Only enable it if users can not choose their own username in the IdP. |
| `OIDC_DISABLE_PASSWORD` | no | `true` hides the password form. Admins keep a break-glass password login (see below). |

Register this redirect URI (also called callback URL) in the IdP:

```
<NEXTAUTH_URL>/api/auth/callback/oidc
```

for example `https://kanbun.example.com/api/auth/callback/oidc`. `NEXTAUTH_URL` (or `AUTH_URL`) must be the public URL users open. Kanbun uses the authorization code flow with PKCE and state, validates the ID token and then reads the claims from the userinfo endpoint.

Restart Kanbun after changing these variables.

### Linking rules

Kanbun stores each linked IdP account as a (provider, subject) pair, where the subject is the IdP's stable `sub` claim. At an SSO login, the first matching rule wins:

1. **Already linked**: the IdP account signs in as the user it is linked to.
2. **Verified email**: if the IdP says the email is verified (`email_verified: true`) and exactly one Kanbun user has that email address (Settings, Notifications, compared without case), the account is linked to that user and signed in. Unverified emails are never used.
3. **Username** (only with `OIDC_MATCH_USERNAME=true`): `preferred_username` equal to a Kanbun username links that user.
4. **Sign-up** (only with `OIDC_ALLOW_SIGNUP=true`): a new member account is created. The username comes from `preferred_username` or the part of the email before `@` (with `-2`, `-3`, ... added when taken), the display name from `name`, and the verified email is saved. These accounts have no password.
5. Otherwise the login is refused with "There is no Kanbun account for this single sign-on user".

A user who already has a different IdP account linked is never linked automatically, and two users with the same email are not linked either ("not linked" error). Deactivated users can not sign in with SSO, whether linked or matched.

Users can also link and unlink their IdP account themselves in **Settings, Connected accounts** while signed in with their password. A user must keep at least one way to sign in, so the link can not be removed from an account without a password (or from a member account when `OIDC_DISABLE_PASSWORD` is on). The admin users page shows an "SSO" badge and the linked email for each linked user.

### Admin group

With `OIDC_ADMIN_GROUP=kanbun-admins`, a user whose `groups` claim contains `kanbun-admins` becomes an admin at their next SSO login, and an admin without it becomes a member. The last active admin is never demoted. Without `OIDC_ADMIN_GROUP`, roles are managed only in Kanbun. Role changes made this way are recorded in the audit log.

### Break-glass access when passwords are disabled

`OIDC_DISABLE_PASSWORD=true` hides the password form so people use the IdP. When the IdP is down or misconfigured, admins can still sign in with their Kanbun password at:

```
<NEXTAUTH_URL>/login?local=1
```

Only admin accounts are accepted there; members are refused. Keep at least one admin with a strong password (and 2FA) for this. If no admin can sign in at all, run `npm run create-admin` on the server (`docker compose exec kanbun npm run create-admin`) to reset an admin password.

### Error messages

The login page explains these SSO errors:

- **Not linked**: the IdP account matched a user that can not be linked automatically (ambiguous email, or the user already has another IdP account). Sign in with the password and link it in Settings, or ask an admin.
- **Sign-up disabled**: no matching Kanbun user and `OIDC_ALLOW_SIGNUP` is off. An admin creates the user (with the same email) first.
- **Deactivated**: the account was deactivated by an admin.

Other failures (wrong client secret, unreachable issuer, cancelled login) show a generic "Single sign-on failed" message; details are in the server log.

### Authentik

1. Applications, Providers, Create, **OAuth2/OpenID Provider**. Client type: Confidential. Redirect URI: `https://kanbun.example.com/api/auth/callback/oidc` (strict). Signing key: any certificate.
2. Scopes: keep `openid`, `email`, `profile` (Authentik's `profile` scope includes `groups`).
3. Create an **Application** that uses this provider, slug for example `kanbun`.
4. Configure Kanbun:

```
OIDC_ISSUER="https://authentik.example.com/application/o/kanbun/"
OIDC_CLIENT_ID="<client id>"
OIDC_CLIENT_SECRET="<client secret>"
OIDC_NAME="Authentik"
# optional
OIDC_ADMIN_GROUP="kanbun-admins"
```

Depending on the version and the email scope mapping, Authentik may send `email_verified: false`. Kanbun then does not link by email: users link their account in Settings, or you adjust the scope mapping to return `email_verified: true` for addresses you trust.

### Keycloak

1. In your realm: Clients, Create client. Client type OpenID Connect, client ID `kanbun`. Turn on **Client authentication** (confidential), keep **Standard flow**.
2. Valid redirect URIs: `https://kanbun.example.com/api/auth/callback/oidc`. Web origins: `https://kanbun.example.com`.
3. Credentials tab: copy the client secret.
4. For the admin group: Client scopes, `kanbun-dedicated`, Add mapper, By configuration, **Group Membership**. Token claim name `groups`, turn off "Full group path", turn on "Add to userinfo".
5. Configure Kanbun:

```
OIDC_ISSUER="https://keycloak.example.com/realms/<realm>"
OIDC_CLIENT_ID="kanbun"
OIDC_CLIENT_SECRET="<client secret>"
OIDC_NAME="Keycloak"
```

### Google Workspace

1. Google Cloud console, APIs and Services, Credentials, Create credentials, **OAuth client ID**, type Web application.
2. Authorized redirect URI: `https://kanbun.example.com/api/auth/callback/oidc`.
3. OAuth consent screen: User type **Internal**, so only accounts of your Workspace can sign in.
4. Configure Kanbun:

```
OIDC_ISSUER="https://accounts.google.com"
OIDC_CLIENT_ID="<id>.apps.googleusercontent.com"
OIDC_CLIENT_SECRET="<secret>"
OIDC_NAME="Google"
```

Google sends verified emails, so existing users are linked by email once their Kanbun email matches. Google does not send groups, so `OIDC_ADMIN_GROUP` does not apply; manage roles in Kanbun.

### SSO and two-factor authentication

SSO logins do not ask for Kanbun's 2FA code: the IdP is responsible for multi-factor authentication, so enforce MFA there. A user who has both a password with 2FA and a linked IdP account is asked for the code only when signing in with the password.

## Two-factor authentication (TOTP)

Users with a password can turn on 2FA in **Settings, Two-factor authentication**:

1. Click **Set up**, scan the QR code with an authenticator app (Aegis, 2FAS, Google Authenticator, 1Password, ...) or enter the key shown below it, then enter the 6-digit code to turn it on.
2. Save the 10 **recovery codes** shown once. Each works one time in place of an app code.

After that, the login form asks for a code after a correct password. A recovery code can be entered in the same field. To turn 2FA off or to create new recovery codes (the old ones stop working), confirm with a current code, a recovery code or the password.

Details:

- Standard TOTP (RFC 6238): HMAC-SHA1, 30 second steps, 6 digits, one step of clock drift accepted either way. Each code works once: Kanbun remembers the last used time step per user.
- Wrong codes count as failed logins in the login rate limiter (10 per IP and username, 50 per IP, per 15 minutes) and are written to the audit log.
- The TOTP secret is stored encrypted (AES-256-GCM, key derived from `AUTH_SECRET` with HKDF); recovery codes are stored as keyed hashes. **Changing `AUTH_SECRET` makes existing 2FA setups unusable**: affected users then need an admin reset.
- No full session is issued before the second factor is verified.

### Lost phone

An admin opens **Admin, Users**, expands the user and clicks **Reset two-factor**. The user can then sign in with the password and set 2FA up again. If the locked-out user is the only admin, run `npm run create-admin` for that username on the server: it resets the password and offers to turn 2FA off.

### Audit log

These events are recorded: `sso.login`, `sso.link`, `sso.unlink`, `2fa.enable`, `2fa.disable`, `2fa.reset` (by an admin), `2fa.failure` (wrong code), `2fa.recoveryCodes` (new codes created) and `recoveryCode.used`.
