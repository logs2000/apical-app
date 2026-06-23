// Apical seed — agents (not "employees"), workspaces, profile, conversations,
// a dev user, and a sample personal access token (PAT).
// Agent names are evocative/non-human (Nomi, Vexa, Kiro, Sova, Runa, Kovo).
import { db } from '../src/lib/db'
import { createHash, randomBytes } from 'crypto'

async function main() {
  await db.runStep.deleteMany()
  await db.run.deleteMany()
  await db.executionPattern.deleteMany()
  await db.workflow.deleteMany()
  await db.integration.deleteMany()
  await db.credential.deleteMany()
  await db.conversation.deleteMany()
  await db.workspace.deleteMany()
  await db.userProfile.deleteMany()
  await db.personalAccessToken.deleteMany()
  await db.mcpAuditLog.deleteMany()
  await db.apiKey.deleteMany()
  await db.developerAccount.deleteMany()
  await db.account.deleteMany()
  await db.user.deleteMany()

  // ---------------- Dev user (AUTH-1) ----------------
  // The dev user owns all seeded data + appears as "logged in" when dev bypass
  // is on (AUTH_BYPASS_DEV=true). Email dev@apical.local, name "Developer".
  const devUser = await db.user.create({
    data: {
      id: 'user_dev',
      email: 'dev@apical.local',
      name: 'Developer',
      provider: 'credentials',
      passwordHash: null,
    },
  })

  // ---------------- Workspaces ----------------
  const wsMain = await db.workspace.create({ data: { id: 'ws_main', userId: devUser.id, name: 'Main', description: 'Your primary workspace.', color: 'emerald' } })
  await db.workspace.create({ data: { id: 'ws_lab', userId: devUser.id, name: 'R&D Lab', description: 'Experiments and one-offs.', color: 'violet' } })
  await db.workspace.create({ data: { id: 'ws_acme', userId: devUser.id, name: 'Client: Acme Co', description: 'Automations running for Acme.', color: 'amber' } })

  // ---------------- Integrations (built-in + public library + private) ----------------
  const builtin = [
    { id: 'int_files', name: 'Local Filesystem', kind: 'http', description: 'Read, list, and move files on this machine.', category: 'files', color: 'emerald', config: { url: 'http://127.0.0.1:7777', auth: { type: 'apikey', ref: 'cred_local_daemon' } }, tools: [
      { id: 'files.list', name: 'List folder', description: 'List files in a folder.', integrationId: 'int_files' },
      { id: 'files.read', name: 'Read file text', description: 'Extract text content from a file.', integrationId: 'int_files' },
      { id: 'files.move', name: 'Move file', description: 'Move a file to a destination folder.', integrationId: 'int_files' },
      { id: 'files.write', name: 'Write file', description: 'Write text content to a file.', integrationId: 'int_files' },
    ]},
    { id: 'int_gmail', name: 'Gmail', kind: 'api', description: 'Send, search, and read email.', category: 'email', color: 'emerald', config: { specUrl: 'https://gmail.googleapis.com/openapi.json', auth: { type: 'oauth', ref: 'cred_gmail' } }, tools: [
      { id: 'gmail.send', name: 'Send email', description: 'Send an email.', integrationId: 'int_gmail' },
      { id: 'gmail.search', name: 'Search mail', description: 'Search messages.', integrationId: 'int_gmail' },
      { id: 'gmail.read', name: 'Read message', description: 'Fetch a message.', integrationId: 'int_gmail' },
      { id: 'gmail.draft', name: 'Create draft', description: 'Create a draft email.', integrationId: 'int_gmail' },
    ]},
    { id: 'int_scanner', name: 'Scanner Watch', kind: 'mcp', description: 'MCP server from the scanner driver.', category: 'files', color: 'emerald', config: { url: 'stdio://scanner-mcp', auth: { type: 'none' } }, tools: [
      { id: 'scanner.listNew', name: 'List new scans', description: 'List unprocessed scans.', integrationId: 'int_scanner' },
      { id: 'scanner.markProcessed', name: 'Mark processed', description: 'Mark a scan handled.', integrationId: 'int_scanner' },
    ]},
    { id: 'int_quickbooks', name: 'QuickBooks', kind: 'api', description: 'Accounting. Expenses, invoices, payments.', category: 'finance', color: 'emerald', config: { specUrl: 'https://developer.intuit.com/openapi.json', auth: { type: 'oauth', ref: 'cred_quickbooks' } }, tools: [
      { id: 'quickbooks.createExpense', name: 'Create expense', description: 'Record an expense.', integrationId: 'int_quickbooks' },
      { id: 'quickbooks.listInvoices', name: 'List invoices', description: 'List invoices.', integrationId: 'int_quickbooks' },
      { id: 'quickbooks.markPaid', name: 'Mark invoice paid', description: 'Mark an invoice paid.', integrationId: 'int_quickbooks' },
    ]},
    { id: 'int_slack', name: 'Slack', kind: 'mcp', description: 'Notify channels and post messages.', category: 'messaging', color: 'emerald', config: { url: 'stdio://slack-mcp', auth: { type: 'mcp_token', ref: 'cred_slack' } }, tools: [
      { id: 'slack.notify', name: 'Notify channel', description: 'Send a notification.', integrationId: 'int_slack' },
      { id: 'slack.postMessage', name: 'Post message', description: 'Post a message.', integrationId: 'int_slack' },
    ]},
    { id: 'int_stripe', name: 'Stripe', kind: 'api', description: 'Payments. Invoices, charges, customers.', category: 'finance', color: 'emerald', config: { specUrl: 'https://api.stripe.com/openapi.json', auth: { type: 'apikey', ref: 'cred_stripe' } }, tools: [
      { id: 'stripe.listInvoices', name: 'List invoices', description: 'List unpaid invoices.', integrationId: 'int_stripe' },
      { id: 'stripe.sendInvoice', name: 'Send invoice', description: 'Send an invoice.', integrationId: 'int_stripe' },
      { id: 'stripe.charge', name: 'Charge customer', description: 'Charge a customer.', integrationId: 'int_stripe' },
    ]},
    { id: 'int_ocr', name: 'Document OCR', kind: 'mcp', description: 'Vision MCP. Extracts text and classifies documents.', category: 'documents', color: 'emerald', config: { url: 'stdio://doc-ocr-mcp', auth: { type: 'none' } }, tools: [
      { id: 'ocr.extract', name: 'Extract text', description: 'OCR-extract text.', integrationId: 'int_ocr' },
      { id: 'ocr.classify', name: 'Classify document', description: 'Classify a document.', integrationId: 'int_ocr' },
    ]},
    { id: 'int_tracker', name: 'Project Tracker', kind: 'api', description: 'Internal project tracker. REST API with OpenAPI spec.', category: 'general', color: 'emerald', config: { specUrl: 'https://tracker.internal/openapi.json', auth: { type: 'apikey', ref: 'cred_tracker' } }, tools: [
      { id: 'tracker.listActivity', name: 'List activity', description: 'List recent activity.', integrationId: 'int_tracker' },
      { id: 'tracker.getTasks', name: 'Get tasks', description: 'Get tasks for a project.', integrationId: 'int_tracker' },
    ]},
  ]
  const publicLib = [
    { id: 'int_notion_pub', name: 'Notion', kind: 'api', description: 'Read and update Notion pages and databases.', category: 'general', color: 'violet', authorLabel: '@hannah', installs: 1284, config: { specUrl: 'https://notion-community.dev/openapi.json', auth: { type: 'oauth' } }, tools: [
      { id: 'notion.queryDatabase', name: 'Query database', description: 'Query a Notion database.', integrationId: 'int_notion_pub' },
      { id: 'notion.createPage', name: 'Create page', description: 'Create a page.', integrationId: 'int_notion_pub' },
    ]},
    { id: 'int_hubspot_pub', name: 'HubSpot CRM', kind: 'api', description: 'Contacts, deals, pipelines.', category: 'general', color: 'amber', authorLabel: '@marcus', installs: 892, config: { specUrl: 'https://hubspot-community.dev/openapi.json', auth: { type: 'apikey' } }, tools: [
      { id: 'hubspot.createContact', name: 'Create contact', description: 'Create a CRM contact.', integrationId: 'int_hubspot_pub' },
      { id: 'hubspot.listDeals', name: 'List deals', description: 'List deals by stage.', integrationId: 'int_hubspot_pub' },
    ]},
    { id: 'int_shopify_pub', name: 'Shopify', kind: 'api', description: 'Orders, products, fulfillment.', category: 'finance', color: 'emerald', authorLabel: '@priya', installs: 2103, config: { specUrl: 'https://shopify-community.dev/openapi.json', auth: { type: 'apikey' } }, tools: [
      { id: 'shopify.listOrders', name: 'List orders', description: 'List recent orders.', integrationId: 'int_shopify_pub' },
      { id: 'shopify.fulfillOrder', name: 'Fulfill order', description: 'Mark an order fulfilled.', integrationId: 'int_shopify_pub' },
    ]},
    { id: 'int_calendly_pub', name: 'Calendly', kind: 'api', description: 'Schedule and manage meetings.', category: 'general', color: 'violet', authorLabel: '@dev', installs: 540, config: { specUrl: 'https://calendly-community.dev/openapi.json', auth: { type: 'oauth' } }, tools: [
      { id: 'calendly.listEvents', name: 'List events', description: 'List scheduled events.', integrationId: 'int_calendly_pub' },
    ]},
    { id: 'int_docusign_pub', name: 'DocuSign', kind: 'api', description: 'Send and track documents for e-signature.', category: 'documents', color: 'amber', authorLabel: '@legalco', installs: 410, config: { specUrl: 'https://docusign-community.dev/openapi.json', auth: { type: 'oauth' } }, tools: [
      { id: 'docusign.sendEnvelope', name: 'Send for signature', description: 'Send a document for e-signature.', integrationId: 'int_docusign_pub' },
      { id: 'docusign.envelopeStatus', name: 'Envelope status', description: 'Check signature status.', integrationId: 'int_docusign_pub' },
    ]},
  ]
  const privateInt = { id: 'int_acme_crm', name: 'Acme CRM (private)', kind: 'api', description: 'Your own CRM. Private to you.', category: 'general', color: 'emerald', config: { specUrl: 'https://crm.acme.internal/openapi.json', auth: { type: 'apikey', ref: 'cred_acme_crm' } }, tools: [
    { id: 'acme.getClient', name: 'Get client', description: 'Fetch a client record.', integrationId: 'int_acme_crm' },
    { id: 'acme.logCall', name: 'Log call', description: 'Log a call note.', integrationId: 'int_acme_crm' },
  ]}
  for (const it of [...builtin, ...publicLib, privateInt]) {
    await db.integration.create({ data: { id: it.id, name: it.name, kind: it.kind, description: it.description, category: it.category, color: it.color, status: 'connected', source: (it as { source?: string }).source ?? ((it as { id: string }).id.endsWith('_pub') ? 'public' : 'builtin'), visibility: (it as { visibility?: string }).visibility ?? 'public', authorLabel: (it as { authorLabel?: string }).authorLabel ?? null, installs: (it as { installs?: number }).installs ?? 0, config: JSON.stringify(it.config), tools: JSON.stringify(it.tools) } })
  }

  // ---------------- Agents (workflows) — evocative non-human names ----------------
  // Renamed for AUTH-1: Sorter→Vexa, Herald→Runa, Ledger→Kovo, Compass→Sova.
  // (Ids kept stable so existing references + audit logs still resolve.)
  const agents = [
    {
      id: 'wf_sorter', name: 'Vexa', title: 'Filing Agent', department: 'Filing', workspaceId: wsMain.id, userId: devUser.id,
      description: 'Watches the scanner inbox, figures out which client each PDF belongs to, and files it. Asks before moving anything uncertain.',
      trigger: 'schedule', schedule: 'Every 30 minutes',
      runsCount: 312, itemsProcessed: 4871, automaticCount: 4712, flaggedCount: 159, aiCallsSaved: 2310, estCostSavedCents: 23100,
      steps: { version: 1, steps: [
        { id: 's1', kind: 'tool', label: 'List new scans', tool: 'scanner.listNew', inputs: { folder: '/Scan Inbox' }, note: 'Polls the scanner for unprocessed files.' },
        { id: 's2', kind: 'tool', label: 'Extract text', tool: 'ocr.extract', inputs: { file: '{{s1.files[]}}' }, note: 'OCR each new scan.' },
        { id: 's3', kind: 'reason', label: 'Classify client', prompt: 'Determine which client this scanned document belongs to. Return the client name, document type, and confidence (0-1).', allowedTools: ['ocr.classify'], outputShape: { client: 'string', documentType: 'string', confidence: 'number' }, confidenceThreshold: 0.8, hardened: true, rule: 'If letterhead contains "Smith LLP" \u2192 client = "Smith LLP". If contains "Northwind Co" \u2192 "Northwind Co".', note: 'Hardened after 312 runs.' },
        { id: 's4', kind: 'gate', label: 'Confirm low-confidence', gateMessage: 'Not sure which client \u2014 please confirm before filing.' },
        { id: 's5', kind: 'tool', label: 'File in client folder', tool: 'files.move', inputs: { file: '{{s1.files[]}}', dest: '/Clients/{{s3.client}}/' } },
        { id: 's6', kind: 'tool', label: 'Mark processed', tool: 'scanner.markProcessed', inputs: { file: '{{s1.files[]}}' } },
      ]},
    },
    {
      id: 'wf_digest', name: 'Runa', title: 'Client Digest Writer', department: 'Mailroom', workspaceId: wsMain.id, userId: devUser.id,
      description: 'Every Monday, pulls last week\u2019s activity and drafts a one-paragraph summary email to each active client. Drafts come to you for approval first.',
      trigger: 'schedule', schedule: 'Every Monday at 8:00am',
      runsCount: 14, itemsProcessed: 168, automaticCount: 168, flaggedCount: 0, aiCallsSaved: 0, estCostSavedCents: 0,
      steps: { version: 1, steps: [
        { id: 'd1', kind: 'tool', label: 'List active clients', tool: 'tracker.listActivity', inputs: { range: 'last_7_days' } },
        { id: 'd2', kind: 'tool', label: 'Pull week\u2019s activity', tool: 'tracker.listActivity', inputs: { client: '{{d1.clients[]}}' } },
        { id: 'd3', kind: 'reason', label: 'Summarize per client', prompt: 'Summarize this client\u2019s week of project activity into one professional paragraph. Mention completed milestones and upcoming deadlines.', allowedTools: [], outputShape: { summary: 'string' } },
        { id: 'd4', kind: 'tool', label: 'Create draft email', tool: 'gmail.draft', inputs: { to: '{{d1.clients[].email}}', body: '{{d3.summary}}' } },
        { id: 'd5', kind: 'gate', label: 'Approve drafts', gateMessage: 'Review the week\u2019s client digest drafts before they send.' },
        { id: 'd6', kind: 'tool', label: 'Send approved drafts', tool: 'gmail.send', inputs: { draftId: '{{d4.draftId}}' } },
      ]},
    },
    {
      id: 'wf_audit', name: 'Kovo', title: 'Expense Auditor', department: 'Finance', workspaceId: wsMain.id, userId: devUser.id,
      description: 'Audits new expense reports against policy. Auto-approves compliant ones into QuickBooks; flags anything over $500 or missing a receipt for your review.',
      trigger: 'schedule', schedule: 'Every weekday at 9:00am',
      runsCount: 47, itemsProcessed: 612, automaticCount: 531, flaggedCount: 81, aiCallsSaved: 380, estCostSavedCents: 3800,
      steps: { version: 1, steps: [
        { id: 'a1', kind: 'tool', label: 'List new expense reports', tool: 'files.list', inputs: { folder: '/Finance/Inbox' } },
        { id: 'a2', kind: 'tool', label: 'Extract amounts + receipts', tool: 'ocr.extract', inputs: { file: '{{a1.files[]}}' } },
        { id: 'a3', kind: 'reason', label: 'Audit against policy', prompt: 'Check this expense report against policy: receipts required over $75, no alcohol, per-diem caps. Return compliant (bool), issues[], total.', allowedTools: [], outputShape: { compliant: 'boolean', issues: 'string[]', total: 'number' }, confidenceThreshold: 0.85 },
        { id: 'a4', kind: 'gate', label: 'Review flagged reports', gateMessage: 'Expense reports over $500 or non-compliant need your approval.' },
        { id: 'a5', kind: 'tool', label: 'Record in QuickBooks', tool: 'quickbooks.createExpense', inputs: { report: '{{a1.files[]}}', total: '{{a3.total}}' } },
        { id: 'a6', kind: 'tool', label: 'Notify #finance', tool: 'slack.notify', inputs: { channel: '#finance', message: 'Audited reports.' } },
      ]},
    },
    {
      id: 'wf_invoice', name: 'Sova', title: 'Collections Agent', department: 'Finance', workspaceId: wsMain.id, userId: devUser.id,
      description: 'Checks unpaid invoices daily. Sends a polite reminder for 7+ days overdue; drafts an escalation for 30+ days and gates it on your approval.',
      trigger: 'schedule', schedule: 'Every weekday at 10:00am',
      runsCount: 22, itemsProcessed: 134, automaticCount: 121, flaggedCount: 13, aiCallsSaved: 95, estCostSavedCents: 950,
      steps: { version: 1, steps: [
        { id: 'i1', kind: 'tool', label: 'List unpaid invoices', tool: 'stripe.listInvoices', inputs: { status: 'open' } },
        { id: 'i2', kind: 'tool', label: 'Compute overdue days', tool: 'files.write', inputs: { invoices: '{{i1.invoices}}' }, note: 'Calculates days past due locally.' },
        { id: 'i3', kind: 'reason', label: 'Draft reminder tone', prompt: 'Given an overdue invoice and days past due, draft a reminder email. Polite for 7-29 days; firmer escalation for 30+ days. Return subject and body.', allowedTools: [], outputShape: { subject: 'string', body: 'string' } },
        { id: 'i4', kind: 'gate', label: 'Approve escalations', gateMessage: 'Invoices 30+ days overdue need your sign-off.' },
        { id: 'i5', kind: 'tool', label: 'Send reminder', tool: 'gmail.send', inputs: { to: '{{i1.invoices[].customerEmail}}', subject: '{{i3.subject}}', body: '{{i3.body}}' } },
      ]},
    },
  ]
  for (const a of agents) {
    await db.workflow.create({ data: { id: a.id, userId: a.userId, name: a.name, description: a.description, stepsJson: JSON.stringify(a.steps), trigger: a.trigger, schedule: a.schedule, status: 'active', origin: 'agent', department: a.department, title: a.title, workspaceId: a.workspaceId, runsCount: a.runsCount, itemsProcessed: a.itemsProcessed, automaticCount: a.automaticCount, flaggedCount: a.flaggedCount, aiCallsSaved: a.aiCallsSaved, estCostSavedCents: a.estCostSavedCents } })
  }

  // ---------------- Execution patterns ----------------
  await db.executionPattern.create({ data: { workflowId: 'wf_sorter', stepId: 's3', signature: 'letterhead:smith-llp', outputJson: JSON.stringify({ client: 'Smith LLP', documentType: 'legal', confidence: 1 }), occurrences: 184, hardened: true, ruleJson: JSON.stringify({ match: 'letterhead contains "Smith LLP"', then: { client: 'Smith LLP' } }) } })
  await db.executionPattern.create({ data: { workflowId: 'wf_sorter', stepId: 's3', signature: 'letterhead:northwind-co', outputJson: JSON.stringify({ client: 'Northwind Co', documentType: 'invoice', confidence: 1 }), occurrences: 126, hardened: true, ruleJson: JSON.stringify({ match: 'letterhead contains "Northwind Co"', then: { client: 'Northwind Co' } }) } })
  await db.executionPattern.create({ data: { workflowId: 'wf_audit', stepId: 'a3', signature: 'vendor:travel-airline', outputJson: JSON.stringify({ compliant: true, issues: [], total: 0 }), occurrences: 7, hardened: false } })

  // ---------------- Runs ----------------
  const now = Date.now()
  const mkRun = async (id: string, wfId: string, stats: { items: number; auto: number; flagged: number; aiUsed: number; aiSaved: number; dur: number; minsAgo: number; reportSummary: string; reportItems: { name: string; outcome: 'automatic' | 'flagged' | 'gated'; detail: string }[]; flags: { stepId: string; reason: string; item: string }[] }) => {
    await db.run.create({ data: { id, workflowId: wfId, status: 'completed', trigger: 'schedule', itemsProcessed: stats.items, automaticCount: stats.auto, flaggedCount: stats.flagged, aiCallsUsed: stats.aiUsed, aiCallsSaved: stats.aiSaved, durationMs: stats.dur, reportJson: JSON.stringify({ summary: stats.reportSummary, items: stats.reportItems, flags: stats.flags }), startedAt: new Date(now - 1000 * 60 * stats.minsAgo), finishedAt: new Date(now - 1000 * 60 * stats.minsAgo + stats.dur) } })
  }
  await mkRun('run_1', 'wf_sorter', { items: 47, auto: 44, flagged: 3, aiUsed: 3, aiSaved: 44, dur: 18420, minsAgo: 42, reportSummary: 'Filed 47 documents \u2014 44 automatic, 3 flagged for your review.', reportItems: [
    { name: 'Smith_LLP_contract_v3.pdf', outcome: 'automatic', detail: '\u2192 /Clients/Smith LLP/' },
    { name: 'Untitled_scan_0051.pdf', outcome: 'flagged', detail: 'Confidence 0.62 \u2014 no matching letterhead.' },
  ], flags: [{ stepId: 's4', reason: 'Confidence 0.62 below threshold', item: 'Untitled_scan_0051.pdf' }] })
  await mkRun('run_2', 'wf_audit', { items: 18, auto: 15, flagged: 3, aiUsed: 18, aiSaved: 0, dur: 24300, minsAgo: 300, reportSummary: 'Audited 18 expense reports \u2014 15 auto-approved, 3 flagged.', reportItems: [
    { name: 'expenses_week_37.pdf', outcome: 'automatic', detail: 'Compliant \u2192 QuickBooks ($1,240)' },
    { name: 'travel_reimbursement_oct.pdf', outcome: 'flagged', detail: 'Missing receipt for $612 flight.' },
  ], flags: [{ stepId: 'a4', reason: 'Over $500 requires approval', item: 'travel_reimbursement_oct.pdf' }] })
  await mkRun('run_3', 'wf_invoice', { items: 9, auto: 7, flagged: 2, aiUsed: 9, aiSaved: 0, dur: 11200, minsAgo: 1320, reportSummary: 'Checked 9 invoices \u2014 7 reminders sent, 2 escalations drafted for approval.', reportItems: [
    { name: 'INV-2024-0188 \u2014 Acme Corp', outcome: 'automatic', detail: 'Reminder sent (12 days overdue)' },
    { name: 'INV-2024-0172 \u2014 Globex', outcome: 'gated', detail: 'Escalation drafted (34 days)' },
  ], flags: [{ stepId: 'i4', reason: '30+ days overdue requires sign-off', item: 'INV-2024-0172 \u2014 Globex' }] })

  // ---------------- Credentials ----------------
  // Linked to the dev user so they show up in the user's vault.
  const creds = [
    { id: 'cred_gmail', service: 'gmail', label: 'ops@apical.test \u2014 Gmail', kind: 'oauth', status: 'active', meta: { account: 'ops@apical.test', scopes: ['send', 'read', 'draft'] }, agentProvisioned: false, canPay: false },
    { id: 'cred_stripe', service: 'stripe', label: 'Stripe \u2014 Apical Inc', kind: 'apikey', status: 'active', meta: { mode: 'live', last4: 'ab12', canCharge: true }, agentProvisioned: false, canPay: true },
    { id: 'cred_quickbooks', service: 'quickbooks', label: 'QuickBooks \u2014 Apical Inc', kind: 'oauth', status: 'active', meta: { realm: 'Apical Inc' }, agentProvisioned: false, canPay: false },
    { id: 'cred_tracker', service: 'tracker', label: 'Project Tracker API key', kind: 'apikey', status: 'active', meta: {}, agentProvisioned: false, canPay: false },
    { id: 'cred_slack', service: 'slack', label: 'Slack bot token', kind: 'mcp_token', status: 'active', meta: { bot: 'apical-bot' }, agentProvisioned: false, canPay: false },
    { id: 'cred_local_daemon', service: 'local-daemon', label: 'Local agent daemon key', kind: 'apikey', status: 'active', meta: { machine: 'this-machine' }, agentProvisioned: false, canPay: false },
    { id: 'cred_acme_crm', service: 'acme-crm', label: 'Acme CRM API key (private)', kind: 'apikey', status: 'active', meta: { private: true }, agentProvisioned: false, canPay: false },
    { id: 'cred_sendgrid_sandbox', service: 'sendgrid', label: 'SendGrid \u2014 sandbox (agent-opened)', kind: 'apikey', status: 'active', meta: { provisionedBy: 'agent', tier: 'free' }, agentProvisioned: true, canPay: false },
    { id: 'cred_docusign_prov', service: 'docusign', label: 'DocuSign \u2014 provisioning', kind: 'oauth', status: 'provisioning', meta: { provisionedBy: 'agent', step: 'awaiting_email_verification' }, agentProvisioned: true, canPay: false },
  ]
  for (const c of creds) await db.credential.create({ data: { id: c.id, userId: devUser.id, service: c.service, label: c.label, kind: c.kind, status: c.status, metaJson: JSON.stringify(c.meta), agentProvisioned: c.agentProvisioned, canPay: c.canPay } })

  // ---------------- Conversations (chat history) ----------------
  await db.conversation.create({ data: { id: 'conv_1', userId: devUser.id, title: 'Set up scanner sorting', workspaceId: wsMain.id, pinned: true, updatedAt: new Date(now - 1000 * 60 * 60 * 2) } })
  await db.conversation.create({ data: { id: 'conv_2', userId: devUser.id, title: 'Weekly client digest', workspaceId: wsMain.id, updatedAt: new Date(now - 1000 * 60 * 60 * 26) } })
  await db.conversation.create({ data: { id: 'conv_3', userId: devUser.id, title: 'Invoice chase \u2014 escalation tone', workspaceId: wsMain.id, updatedAt: new Date(now - 1000 * 60 * 60 * 50) } })

  // ---------------- User profile (for custom suggestions + agentNameStyle) ----------------
  await db.userProfile.create({ data: { id: 'profile_main', userId: devUser.id, companyName: 'Apical Inc', industry: 'Small professional services', notes: 'Uses Gmail, QuickBooks, Stripe, Slack. Scans paper docs daily. ~40 clients.', agentNameStyle: 'descriptive', dataSourcesJson: JSON.stringify([
    { label: 'Gmail', kind: 'email', detail: 'ops@apical.test' },
    { label: 'QuickBooks', kind: 'finance', detail: 'Apical Inc realm' },
    { label: 'Stripe', kind: 'payments', detail: 'live mode' },
    { label: 'Scanner', kind: 'files', detail: '/Scan Inbox on this machine' },
    { label: 'Slack', kind: 'messaging', detail: '#finance, #ops' },
  ]) } })

  // ---------------- Sample Personal Access Token (PAT) ----------------
  // A demo PAT for the dev user so the apical-mcp mini-service can auth without
  // the user having to generate one first. The raw token is logged ONCE so you
  // can copy it into your MCP client config during local dev.
  const demoPatRaw = 'ap_pat_demo_' + randomBytes(12).toString('hex')
  await db.personalAccessToken.create({ data: {
    id: 'pat_demo', userId: devUser.id, label: 'Demo (Cursor)',
    tokenHash: createHash('sha256').update(demoPatRaw).digest('hex'),
    tokenPrefix: demoPatRaw.slice(0, 12), status: 'active',
    lastUsedAt: new Date(Date.now() - 1000 * 60 * 30),
  }})

  // ---------------- Legacy SaaS Developer account (kept for backward compat) ----------------
  // The new PersonalAccessToken model (above) replaces this for MCP/REST API auth.
  // We keep the DeveloperAccount/ApiKey seed data so existing /api/dev/* routes
  // don't break during the transition.
  const demoKeyRaw = 'ap_sk_demo_' + randomBytes(12).toString('hex')
  const demoKeyHash = createHash('sha256').update(demoKeyRaw).digest('hex')
  const dev = await db.developerAccount.create({ data: {
    id: 'dev_demo', email: 'dev@apical.test', name: 'Demo Developer',
    plan: 'pro', balanceCents: 2500, billingEmail: 'dev@apical.test',
    workspaceId: 'ws_main', status: 'active',
  }})
  await db.apiKey.create({ data: {
    id: 'key_demo', developerId: dev.id, label: 'Production',
    keyHash: demoKeyHash, keyPrefix: demoKeyRaw.slice(0, 12), status: 'active',
    lastUsedAt: new Date(Date.now() - 1000 * 60 * 15), lastUsedFrom: 'mcp',
  }})
  await db.apiKey.create({ data: {
    id: 'key_demo2', developerId: dev.id, label: 'Local dev',
    keyHash: createHash('sha256').update('ap_sk_demo_localkey123').digest('hex'),
    keyPrefix: 'ap_sk_demo_', status: 'active',
    lastUsedAt: new Date(Date.now() - 1000 * 60 * 60 * 3), lastUsedFrom: 'rest',
  }})
  // Sample audit logs (renamed agents: Vexa, Runa, Kovo, Sova).
  const logActions = [
    { action: 'mcp:deploy', target: 'wf_sorter', success: true, costCents: 0, detail: 'Deployed Vexa (Filing)', source: 'mcp' },
    { action: 'rest:run', target: 'run_1', success: true, costCents: 3, detail: 'Ran Vexa — 47 items', source: 'rest' },
    { action: 'mcp:list_agents', target: '', success: true, costCents: 0, detail: 'Listed 4 agents', source: 'mcp' },
    { action: 'rest:run', target: 'run_2', success: true, costCents: 9, detail: 'Ran Kovo — 18 items', source: 'rest' },
    { action: 'mcp:get_report', target: 'run_1', success: true, costCents: 0, detail: 'Fetched report for run_1', source: 'mcp' },
    { action: 'rest:run', target: 'run_3', success: true, costCents: 5, detail: 'Ran Sova — 9 items', source: 'rest' },
    { action: 'mcp:deploy', target: 'cmqk*', success: false, costCents: 0, detail: 'Invalid workflow JSON: missing steps', source: 'mcp' },
  ]
  for (let i = 0; i < logActions.length; i++) {
    const a = logActions[i]
    await db.mcpAuditLog.create({ data: {
      developerId: dev.id, apiKeyId: i % 2 === 0 ? 'key_demo' : 'key_demo2',
      action: a.action, target: a.target, success: a.success, costCents: a.costCents,
      detail: a.detail, source: a.source,
      createdAt: new Date(Date.now() - 1000 * 60 * (15 + i * 47)),
    }})
  }

  console.log('Apical seed complete.')
  console.log(`  Dev user: ${devUser.email} (id: ${devUser.id})`)
  console.log(`  Workspaces: 3`)
  console.log(`  Integrations: ${builtin.length} builtin + ${publicLib.length} public + 1 private`)
  console.log(`  Agents: ${agents.length} (Vexa, Runa, Kovo, Sova)`)
  console.log(`  Runs: 3, Conversations: 3, Credentials: ${creds.length}`)
  console.log(`  PAT: ${demoPatRaw} (demo — use in MCP client config)`)
  console.log('  Developer account: dev@apical.test (pro, $25.00 balance)')
  console.log('  API keys: 2 (Production, Local dev)')
  console.log('  Audit logs:', logActions.length)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => { await db.$disconnect() })
