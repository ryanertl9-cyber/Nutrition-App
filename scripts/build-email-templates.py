#!/usr/bin/env python3
"""Builds the branded Supabase Auth email templates into supabase/email-templates/.
Paste each file's HTML into Supabase: Authentication -> Emails -> Templates (subject lines are in README.md there).
Email-safe HTML: tables, inline styles, no web fonts or SVG."""
import os

SITE = 'https://simplynutrition.app'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'supabase', 'email-templates')
FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"

def page(preheader, heading, intro, button=None, url='{{ .ConfirmationURL }}', code=None, note=''):
    btn = ''
    if button:
        btn = f'''
          <tr><td style="padding:8px 40px 8px 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td bgcolor="#000000" style="border-radius:999px;">
                <a href="{url}" style="display:inline-block;padding:14px 30px;font-family:{FONT};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">{button}</a>
              </td></tr></table>
          </td></tr>
          <tr><td style="padding:18px 40px 0 40px;font-family:{FONT};font-size:13px;line-height:20px;color:#6e6e73;">
            If the button doesn't work, copy this link into your browser:<br>
            <a href="{url}" style="color:#0066cc;word-break:break-all;">{url}</a>
          </td></tr>'''
    if code:
        btn += f'''
          <tr><td style="padding:8px 40px 0 40px;">
            <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:30px;letter-spacing:8px;font-weight:700;color:#1d1d1f;background:#f5f5f7;border-radius:12px;padding:18px 0;text-align:center;">{code}</div>
          </td></tr>'''
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{heading}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f5f7">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td bgcolor="#000000" style="border-radius:18px 18px 0 0;padding:22px 40px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle;"><img src="{SITE}/assets/brand/email-mark.png" width="22" height="22" alt="" style="display:block;border:0;"></td>
          <td style="vertical-align:middle;padding-left:12px;font-family:{FONT};font-size:13px;font-weight:600;letter-spacing:4px;color:#f5f5f7;">SIMPLY NUTRITION</td>
        </tr></table>
      </td></tr>
      <tr><td bgcolor="#ffffff" style="border-radius:0 0 18px 18px;padding:0 0 36px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="padding:40px 40px 12px 40px;font-family:{FONT};font-size:28px;line-height:34px;font-weight:700;letter-spacing:-0.5px;color:#1d1d1f;">{heading}</td></tr>
          <tr><td style="padding:0 40px 24px 40px;font-family:{FONT};font-size:16px;line-height:25px;color:#424245;">{intro}</td></tr>{btn}
          <tr><td style="padding:28px 40px 0 40px;font-family:{FONT};font-size:13px;line-height:20px;color:#6e6e73;">{note}</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:22px 40px 0 40px;font-family:{FONT};font-size:12px;line-height:18px;color:#86868b;text-align:center;">
        Simply Nutrition · Free nutrition tracking · <a href="{SITE}/privacy.html" style="color:#86868b;">Privacy</a> · <a href="{SITE}/terms.html" style="color:#86868b;">Terms</a><br>
        You're getting this email because of a request on simplynutrition.app.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>
'''

TEMPLATES = {
    'confirm-signup': page(
        'One tap to finish creating your account.', 'Confirm your email',
        "Welcome to Simply Nutrition. Confirm this address to finish creating your account. Your log will then sync across your phone and computer.",
        'Confirm email', note="This link works once and expires in 1 hour. If you didn't sign up, ignore this email and no account will be created."),
    'reset-password': page(
        'Choose a new password for Simply Nutrition.', 'Reset your password',
        "Someone, hopefully you, asked to reset the password for <strong>{{ .Email }}</strong>. Tap below to choose a new one.",
        'Choose a new password', note="This link works once and expires in 1 hour. If you didn't ask for this, you can ignore this email: your password stays the same."),
    'change-email': page(
        'Confirm the new email address for your account.', 'Confirm your new email',
        "You asked to change your Simply Nutrition email from <strong>{{ .Email }}</strong> to <strong>{{ .NewEmail }}</strong>. Confirm to make the switch.",
        'Confirm new email', note="If you didn't ask for this, ignore this email and contact us at ertlbragger@gmail.com: your account stays on your current address."),
    'magic-link': page(
        'Your one-tap sign-in link.', 'Sign in to Simply Nutrition',
        "Tap below to sign in. No password needed.",
        'Sign in', note="This link works once and expires in 1 hour. If you didn't ask to sign in, ignore this email."),
    'invite': page(
        "You've been invited to Simply Nutrition.", "You're invited",
        "You've been invited to Simply Nutrition, a free tracker that shows which nutrients you hit each day and which you miss. Accept to set up your account.",
        'Accept invitation', note="If you weren't expecting this, you can ignore it."),
    'reauthentication': page(
        'Your verification code.', 'Confirm it\'s you',
        "Enter this code in Simply Nutrition to confirm the change you're making.",
        code='{{ .Token }}', note="The code expires shortly. If you didn't request it, ignore this email and consider changing your password."),
}

os.makedirs(OUT, exist_ok=True)
for name, html in TEMPLATES.items():
    open(os.path.join(OUT, name + '.html'), 'w').write(html)
print('Wrote', ', '.join(TEMPLATES))
