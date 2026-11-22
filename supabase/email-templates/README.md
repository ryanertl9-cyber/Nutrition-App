# Branded email templates

Supabase sends these emails for Simply Nutrition. To install them, open the Supabase dashboard,
go to **Authentication → Emails → Templates**, and for each template:

1. Pick the template in the list.
2. Replace the **Subject** with the one below.
3. Replace the **Message body** with the full contents of the matching `.html` file (open it, select all, copy).
4. Click **Save**.

| Supabase template | File | Subject |
|---|---|---|
| Confirm signup | `confirm-signup.html` | Confirm your Simply Nutrition account |
| Reset Password | `reset-password.html` | Reset your Simply Nutrition password |
| Change Email Address | `change-email.html` | Confirm your new email address |
| Magic Link | `magic-link.html` | Your Simply Nutrition sign-in link |
| Invite user | `invite.html` | You're invited to Simply Nutrition |
| Reauthentication | `reauthentication.html` | Your Simply Nutrition verification code |

The `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .NewEmail }}` and `{{ .Token }}` placeholders are
filled in by Supabase; leave them exactly as they are. The emails say links expire in 1 hour, which is
Supabase's default (Authentication → Providers → Email → Email OTP Expiration); update the wording if you change it.

The logo image loads from `https://simplynutrition.app/assets/brand/email-mark.png`, so publish the site
before installing the templates. To change the wording, edit `scripts/build-email-templates.py` and run
`python3 scripts/build-email-templates.py`.
