/**
 * Pure HTML auth page for the Tauri desktop shell.
 *
 * Safari 15 (macOS 12 WebView) cannot run Next.js dev bundles, so React
 * hydration never completes and controlled inputs appear frozen. This page
 * uses zero JavaScript — only native HTML forms and links.
 */

type Mode = "signin" | "signup";

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const MARK_SVG = `<svg viewBox="0 0 180 180" fill="none" width="44" height="44" aria-hidden="true">
  <polygon points="90,20 160,150 20,150" fill="#2d6a4f"/>
  <polygon points="90,70 125,140 55,140" fill="#fafafa"/>
  <polygon points="90,95 105,135 75,135" fill="#2d6a4f"/>
</svg>`;

export function buildDesktopAuthHtml(opts: {
  mode: Mode;
  error?: string;
  isDev: boolean;
}) {
  const { mode, error, isDev } = opts;
  const isSignup = mode === "signup";
  const err = error ? decodeURIComponent(error.replace(/\+/g, " ")) : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Apical Desktop</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0;
      height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #171717;
      background: #fafafa;
      -webkit-user-select: text;
      user-select: text;
    }
    .page {
      min-height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card { width: 100%; max-width: 360px; }
    .brand { text-align: center; margin-bottom: 32px; }
    .brand h1 {
      margin: 16px 0 4px;
      font-size: 22px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    .brand p { margin: 0; color: #525252; font-size: 13px; }
    .toggle {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      padding: 4px;
      margin-bottom: 24px;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      background: #f5f5f5;
    }
    .toggle a {
      display: block;
      padding: 6px 12px;
      text-align: center;
      font-size: 13px;
      font-weight: 500;
      text-decoration: none;
      border-radius: 6px;
      color: #525252;
      cursor: pointer;
      -webkit-user-select: none;
      user-select: none;
    }
    .toggle a.active {
      background: #fff;
      color: #171717;
      box-shadow: 0 1px 2px rgba(0,0,0,0.06);
    }
    .error {
      margin-bottom: 16px;
      padding: 8px 12px;
      font-size: 12px;
      color: #b91c1c;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 6px;
    }
    .field { margin-bottom: 12px; text-align: left; }
    .field label {
      display: block;
      margin-bottom: 6px;
      font-size: 12px;
      font-weight: 500;
      color: #525252;
    }
    .field input {
      display: block;
      width: 100%;
      height: 44px;
      padding: 0 12px;
      font-size: 14px;
      border: 1px solid #e5e5e5;
      border-radius: 6px;
      background: transparent;
      color: #171717;
      outline: none;
      -webkit-appearance: none;
      appearance: none;
    }
    .field input:focus {
      border-color: #737373;
      box-shadow: 0 0 0 3px rgba(115, 115, 115, 0.2);
    }
    button[type="submit"] {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 44px;
      margin-top: 4px;
      font-size: 14px;
      font-weight: 500;
      color: #fafafa;
      background: #171717;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }
    button[type="submit"]:hover { background: #262626; }
    .dev-skip {
      display: block;
      margin-top: 24px;
      text-align: center;
      font-size: 12px;
      color: #525252;
      text-decoration: none;
    }
    .dev-skip:hover { color: #171717; }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <div class="brand">
        ${MARK_SVG}
        <h1>${isSignup ? "Create your account" : "Welcome back"}</h1>
        <p>${isSignup ? "Set up Apical to start running agents." : "Sign in to pick up where you left off."}</p>
      </div>

      <div class="toggle">
        <a href="/api/auth/desktop-ui" class="${!isSignup ? "active" : ""}">Sign in</a>
        <a href="/api/auth/desktop-ui?mode=signup" class="${isSignup ? "active" : ""}">Create account</a>
      </div>

      ${err ? `<div class="error">${esc(err)}</div>` : ""}

      <form method="POST" action="/api/auth/desktop-login">
        <input type="hidden" name="mode" value="${mode}"/>
        ${
          isSignup
            ? `<div class="field">
          <label for="name">Name</label>
          <input id="name" name="name" type="text" autocomplete="name" placeholder="Jordan Doe"/>
        </div>`
            : ""
        }
        <div class="field">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required autofocus/>
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="${isSignup ? "new-password" : "current-password"}" placeholder="••••••••" required/>
        </div>
        <button type="submit">${isSignup ? "Create account" : "Sign in"}</button>
      </form>

      ${isDev ? `<a class="dev-skip" href="/api/auth/desktop-dev">Skip and continue in dev mode</a>` : ""}
    </div>
  </div>
</body>
</html>`;
}
