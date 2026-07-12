# Getting started with Apical

Apical does tasks for you. You ask in plain language — "combine these files into
a PDF", "how much disk space do I have?", "every Monday, draft client update
emails" — and it plans and runs the work, one-shot or on a schedule.

## Your first ask

Press **⌘K** (Ctrl-K) anywhere and start typing. Whatever you type becomes the
question — hit Enter and Apical drops into a fresh chat and starts working. Or
just use the composer on the main screen; the example chips prefill it for you.

A one-shot ask stays ephemeral — nothing is added to your saved agents. If you
want to keep it, use **Save as workflow** to turn what just happened into a
repeatable agent you can re-run or schedule.

## Connect a model

Apical answers using an AI model. If your workspace already has a provider
configured, you're set. Otherwise, go to **Settings → Models** and either add a
provider key (BYOK) or link your Apical cloud token. Until a model is available,
asks will tell you to add one rather than failing silently.

## Connect your computer (optional)

Some tasks are about *your* machine — "how much space do I have", "rename these
files", "open this app". Install the desktop app and connect it; Apical can then
read/write files and run commands **on your computer**, with your permission.
Without a connected computer, Apical does what it can in the cloud and offers a
one-tap way to connect.

You control what the desktop will do: **Settings** exposes a three-way CLI
policy — off, allowlist-only, or always-allow — so remote command execution is
never a surprise.

## Connect your apps

**Vault → Apps** connects services (Gmail, Slack, Notion, and thousands more).
Once connected, agents can act in those apps on your behalf. Connections are
real OAuth — Apical never shows an app as "connected" when it isn't.

## Save, repeat, schedule

Any ask can become a durable agent: give it a name, and optionally a schedule
(e.g. every weekday at 9am) so it runs itself and reports back. Long or
background jobs run durably — they survive closing the tab and continue on the
worker.

## Keep it light

The whole point is that asking should feel like texting a friend, not spinning
up a project. Start with a single ask; grow it into an agent only when you want
to.
