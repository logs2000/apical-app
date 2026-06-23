// Apical — OAuth provider catalog seed.
//
// Seeds the OAuthProvider table with ~12 popular providers' real OAuth 2.0
// endpoints + scopes. clientId/clientSecret are left EMPTY so the connection
// flow falls back to either:
//   (a) bring-your-own-credentials (the user supplies their own client id/secret)
//   (b) demo mode (the connection succeeds without real OAuth — used for dev
//       and for the user to preview how a connection would feel).
//
// In production, an operator sets each provider's clientId/clientSecret via
// the DB (or a future /api/oauth/admin route) and the flow uses real OAuth.
//
// Run with: bunx tsx prisma/seed-oauth.ts
import { db } from '../src/lib/db'

interface OAuthProviderSeed {
  key: string
  name: string
  icon: string
  category: string
  description: string
  authorizationUrl: string
  tokenUrl: string
  scopes: string
  supportsCustomCreds?: boolean
  demoMode?: boolean
  status?: 'active' | 'coming_soon'
}

const PROVIDERS: OAuthProviderSeed[] = [
  {
    key: 'google',
    name: 'Google',
    icon: '🔵',
    category: 'email',
    description: 'Gmail + Google Drive. Send/read mail, browse files.',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: 'https://mail.google.com/ https://www.googleapis.com/auth/drive.readonly openid profile',
  },
  {
    key: 'github',
    name: 'GitHub',
    icon: '🐙',
    category: 'dev',
    description: 'Repos, issues, pull requests, commits.',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: 'repo read:user',
  },
  {
    key: 'slack',
    name: 'Slack',
    icon: '💬',
    category: 'messaging',
    description: 'Post messages, read channels, notify teams.',
    authorizationUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: 'chat:write channels:read',
  },
  {
    key: 'notion',
    name: 'Notion',
    icon: '📓',
    category: 'general',
    description: 'Query databases, create pages, update content.',
    authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    scopes: '',
  },
  {
    key: 'linear',
    name: 'Linear',
    icon: '📐',
    category: 'dev',
    description: 'Issues, projects, cycles, sprints.',
    authorizationUrl: 'https://api.linear.app/oauth/authorize',
    tokenUrl: 'https://api.linear.app/oauth/token',
    scopes: 'read write',
  },
  {
    key: 'microsoft',
    name: 'Microsoft',
    icon: '🪟',
    category: 'email',
    description: 'Outlook mail + Microsoft Graph (files, calendar).',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: 'https://graph.microsoft.com/Mail.ReadWrite offline_access',
  },
  {
    key: 'hubspot',
    name: 'HubSpot',
    icon: '🟠',
    category: 'crm',
    description: 'Contacts, deals, pipelines, marketing.',
    authorizationUrl: 'https://app.hubspot.com/oauth/authorize',
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    scopes: 'contacts',
  },
  {
    key: 'atlassian',
    name: 'Atlassian (Jira)',
    icon: '🟦',
    category: 'dev',
    description: 'Jira issues, projects, sprints.',
    authorizationUrl: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    scopes: 'read:jira-user write:jira-work offline_access',
  },
  {
    key: 'shopify',
    name: 'Shopify',
    icon: '🛍️',
    category: 'finance',
    description: 'Orders, products, fulfillment for a Shopify store.',
    authorizationUrl: 'https://SHOP.myshopify.com/admin/oauth/authorize',
    tokenUrl: 'https://SHOP.myshopify.com/admin/oauth/access_token',
    scopes: 'read_orders write_orders',
  },
  {
    key: 'twilio',
    name: 'Twilio',
    icon: '🔴',
    category: 'messaging',
    description: 'Send SMS, voice, verify codes.',
    authorizationUrl: 'https://www.twilio.com/authorize',
    tokenUrl: 'https://api.twilio.com/2010-04-01/Accounts',
    scopes: '',
  },
  {
    key: 'stripe',
    name: 'Stripe',
    icon: '💳',
    category: 'finance',
    description: 'Charges, invoices, customers, subscriptions.',
    authorizationUrl: 'https://connect.stripe.com/oauth/authorize',
    tokenUrl: 'https://connect.stripe.com/oauth/token',
    scopes: 'read_write',
  },
  {
    key: 'dropbox',
    name: 'Dropbox',
    icon: '📦',
    category: 'files',
    description: 'Read/write files in a Dropbox account.',
    authorizationUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scopes: 'files.content.read',
  },
]

async function main() {
  // Wipe the catalog first so re-seeding updates existing rows cleanly.
  await db.oAuthProvider.deleteMany()

  for (const p of PROVIDERS) {
    await db.oAuthProvider.create({
      data: {
        key: p.key,
        name: p.name,
        icon: p.icon,
        category: p.category,
        description: p.description,
        authorizationUrl: p.authorizationUrl,
        tokenUrl: p.tokenUrl,
        scopes: p.scopes,
        clientId: '',
        clientSecret: '',
        supportsCustomCreds: p.supportsCustomCreds ?? true,
        demoMode: p.demoMode ?? true,
        status: p.status ?? 'active',
      },
    })
  }

  console.log(`OAuth provider seed complete — ${PROVIDERS.length} providers.`)
  for (const p of PROVIDERS) {
    console.log(`  ${p.icon}  ${p.name.padEnd(18)} (${p.category.padEnd(9)}) → ${p.authorizationUrl}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
