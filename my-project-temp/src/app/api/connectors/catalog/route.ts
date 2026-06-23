import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Default connector catalog entries matching the frontend CONNECTOR_CATALOG
const DEFAULT_CATALOG = [
  {
    slug: 'gmail',
    name: 'Gmail',
    kind: 'oauth',
    category: 'email',
    description: 'Read, send, and manage email through Gmail',
    shortDesc: 'Read, send, and manage email',
    icon: 'Inbox',
    configSchemaJson: JSON.stringify({
      authType: 'oauth2',
      fields: [
        { name: 'clientId', label: 'Client ID', type: 'text', required: true },
        { name: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      ],
      endpoints: ['https://gmail.googleapis.com'],
    }),
    toolsJson: JSON.stringify([
      { id: 'gmail.send', name: 'Send Email', description: 'Send an email via Gmail' },
      { id: 'gmail.read', name: 'Read Email', description: 'Read emails from Gmail inbox' },
      { id: 'gmail.search', name: 'Search Email', description: 'Search emails in Gmail' },
      { id: 'gmail.labels', name: 'Manage Labels', description: 'Create, update, and delete labels' },
    ]),
    status: 'live',
    source: 'internal',
    installCount: 0,
    tags: JSON.stringify(['email', 'google', 'communication']),
    supportsByoc: true,
    hasDemoMode: true,
    docsUrl: 'https://developers.google.com/gmail/api',
  },
  {
    slug: 'google-drive',
    name: 'Google Drive',
    kind: 'oauth',
    category: 'files',
    description: 'Access and manage documents on Google Drive',
    shortDesc: 'Access and manage documents',
    icon: 'FolderClosed',
    configSchemaJson: JSON.stringify({
      authType: 'oauth2',
      fields: [
        { name: 'clientId', label: 'Client ID', type: 'text', required: true },
        { name: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      ],
      endpoints: ['https://www.googleapis.com/drive/v3'],
    }),
    toolsJson: JSON.stringify([
      { id: 'drive.list', name: 'List Files', description: 'List files in Google Drive' },
      { id: 'drive.read', name: 'Read File', description: 'Read file contents from Drive' },
      { id: 'drive.write', name: 'Write File', description: 'Create or update files in Drive' },
      { id: 'drive.share', name: 'Share File', description: 'Share a file with others' },
    ]),
    status: 'live',
    source: 'internal',
    installCount: 0,
    tags: JSON.stringify(['files', 'google', 'storage', 'documents']),
    supportsByoc: true,
    hasDemoMode: true,
    docsUrl: 'https://developers.google.com/drive/api',
  },
  {
    slug: 'slack',
    name: 'Slack',
    kind: 'oauth',
    category: 'messaging',
    description: 'Send messages and read channels in Slack',
    shortDesc: 'Send messages and read channels',
    icon: 'Bell',
    configSchemaJson: JSON.stringify({
      authType: 'oauth2',
      fields: [
        { name: 'clientId', label: 'Client ID', type: 'text', required: true },
        { name: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
        { name: 'signingSecret', label: 'Signing Secret', type: 'password', required: true },
      ],
      endpoints: ['https://slack.com/api'],
    }),
    toolsJson: JSON.stringify([
      { id: 'slack.postMessage', name: 'Post Message', description: 'Post a message to a Slack channel' },
      { id: 'slack.readChannel', name: 'Read Channel', description: 'Read messages from a channel' },
      { id: 'slack.listChannels', name: 'List Channels', description: 'List available Slack channels' },
      { id: 'slack.uploadFile', name: 'Upload File', description: 'Upload a file to Slack' },
    ]),
    status: 'live',
    source: 'internal',
    installCount: 0,
    tags: JSON.stringify(['messaging', 'communication', 'chat']),
    supportsByoc: true,
    hasDemoMode: true,
    docsUrl: 'https://api.slack.com',
  },
  {
    slug: 'stripe',
    name: 'Stripe',
    kind: 'api',
    category: 'finance',
    description: 'Process payments and manage invoices with Stripe',
    shortDesc: 'Process payments and manage invoices',
    icon: 'Receipt',
    configSchemaJson: JSON.stringify({
      authType: 'api_key',
      fields: [
        { name: 'apiKey', label: 'Stripe API Key', type: 'password', required: true },
        { name: 'webhookSecret', label: 'Webhook Secret', type: 'password', required: false },
      ],
      endpoints: ['https://api.stripe.com/v1'],
    }),
    toolsJson: JSON.stringify([
      { id: 'stripe.createInvoice', name: 'Create Invoice', description: 'Create a new Stripe invoice' },
      { id: 'stripe.listPayments', name: 'List Payments', description: 'List recent payments' },
      { id: 'stripe.createCustomer', name: 'Create Customer', description: 'Create a new customer in Stripe' },
      { id: 'stripe.getBalance', name: 'Get Balance', description: 'Retrieve account balance' },
    ]),
    status: 'live',
    source: 'internal',
    installCount: 0,
    tags: JSON.stringify(['finance', 'payments', 'billing', 'invoices']),
    supportsByoc: true,
    hasDemoMode: true,
    docsUrl: 'https://stripe.com/docs/api',
  },
  {
    slug: 'notion',
    name: 'Notion',
    kind: 'api',
    category: 'documents',
    description: 'Create and update pages and databases in Notion',
    shortDesc: 'Create and update pages and databases',
    icon: 'FileText',
    configSchemaJson: JSON.stringify({
      authType: 'api_key',
      fields: [
        { name: 'apiKey', label: 'Notion API Key', type: 'password', required: true },
      ],
      endpoints: ['https://api.notion.com/v1'],
    }),
    toolsJson: JSON.stringify([
      { id: 'notion.search', name: 'Search', description: 'Search for pages and databases' },
      { id: 'notion.createPage', name: 'Create Page', description: 'Create a new page' },
      { id: 'notion.updatePage', name: 'Update Page', description: 'Update an existing page' },
      { id: 'notion.queryDatabase', name: 'Query Database', description: 'Query a Notion database' },
    ]),
    status: 'beta',
    source: 'internal',
    installCount: 0,
    tags: JSON.stringify(['documents', 'wiki', 'notes', 'knowledge']),
    supportsByoc: true,
    hasDemoMode: true,
    docsUrl: 'https://developers.notion.com',
  },
  {
    slug: 'salesforce',
    name: 'Salesforce',
    kind: 'oauth',
    category: 'crm',
    description: 'Manage leads, contacts, and deals in Salesforce',
    shortDesc: 'Manage leads, contacts, and deals',
    icon: 'TrendingUp',
    configSchemaJson: JSON.stringify({
      authType: 'oauth2',
      fields: [
        { name: 'clientId', label: 'Consumer Key', type: 'text', required: true },
        { name: 'clientSecret', label: 'Consumer Secret', type: 'password', required: true },
      ],
      endpoints: ['https://login.salesforce.com'],
    }),
    toolsJson: JSON.stringify([
      { id: 'sf.createLead', name: 'Create Lead', description: 'Create a new lead' },
      { id: 'sf.listContacts', name: 'List Contacts', description: 'List contacts in Salesforce' },
      { id: 'sf.getOpportunity', name: 'Get Opportunity', description: 'Retrieve opportunity details' },
      { id: 'sf.updateAccount', name: 'Update Account', description: 'Update an account record' },
    ]),
    status: 'beta',
    source: 'internal',
    installCount: 0,
    tags: JSON.stringify(['crm', 'sales', 'leads', 'contacts']),
    supportsByoc: true,
    hasDemoMode: true,
    docsUrl: 'https://developer.salesforce.com',
  },
  {
    slug: 'github',
    name: 'GitHub',
    kind: 'oauth',
    category: 'dev',
    description: 'Manage repos, issues, and pull requests on GitHub',
    shortDesc: 'Manage repos, issues, and PRs',
    icon: 'Code2',
    configSchemaJson: JSON.stringify({
      authType: 'oauth2',
      fields: [
        { name: 'clientId', label: 'Client ID', type: 'text', required: true },
        { name: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      ],
      endpoints: ['https://api.github.com'],
    }),
    toolsJson: JSON.stringify([
      { id: 'gh.createIssue', name: 'Create Issue', description: 'Create a new issue in a repository' },
      { id: 'gh.listPRs', name: 'List Pull Requests', description: 'List pull requests in a repo' },
      { id: 'gh.getRepo', name: 'Get Repository', description: 'Get repository details' },
      { id: 'gh.searchCode', name: 'Search Code', description: 'Search code across repositories' },
    ]),
    status: 'live',
    source: 'internal',
    installCount: 0,
    tags: JSON.stringify(['development', 'git', 'code', 'issues']),
    supportsByoc: true,
    hasDemoMode: true,
    docsUrl: 'https://docs.github.com/en/rest',
  },
  {
    slug: 'hubspot',
    name: 'HubSpot',
    kind: 'api',
    category: 'marketing',
    description: 'Marketing and sales automation with HubSpot',
    shortDesc: 'Marketing and sales automation',
    icon: 'TrendingUp',
    configSchemaJson: JSON.stringify({
      authType: 'api_key',
      fields: [
        { name: 'apiKey', label: 'HubSpot API Key', type: 'password', required: true },
      ],
      endpoints: ['https://api.hubapi.com'],
    }),
    toolsJson: JSON.stringify([
      { id: 'hs.createContact', name: 'Create Contact', description: 'Create a new contact' },
      { id: 'hs.listDeals', name: 'List Deals', description: 'List deals in pipeline' },
      { id: 'hs.sendEmail', name: 'Send Marketing Email', description: 'Send an email via HubSpot' },
    ]),
    status: 'coming_soon',
    source: 'internal',
    installCount: 0,
    tags: JSON.stringify(['marketing', 'sales', 'automation', 'crm']),
    supportsByoc: true,
    hasDemoMode: false,
    docsUrl: 'https://developers.hubspot.com',
  },
  {
    slug: 'quickbooks',
    name: 'QuickBooks',
    kind: 'oauth',
    category: 'finance',
    description: 'Accounting and bookkeeping with QuickBooks',
    shortDesc: 'Accounting and bookkeeping',
    icon: 'Receipt',
    configSchemaJson: JSON.stringify({
      authType: 'oauth2',
      fields: [
        { name: 'clientId', label: 'Client ID', type: 'text', required: true },
        { name: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      ],
      endpoints: ['https://quickbooks.api.intuit.com'],
    }),
    toolsJson: JSON.stringify([
      { id: 'qb.createInvoice', name: 'Create Invoice', description: 'Create a QuickBooks invoice' },
      { id: 'qb.getReports', name: 'Get Reports', description: 'Retrieve financial reports' },
      { id: 'qb.listExpenses', name: 'List Expenses', description: 'List expense records' },
    ]),
    status: 'coming_soon',
    source: 'internal',
    installCount: 0,
    tags: JSON.stringify(['finance', 'accounting', 'invoices', 'bookkeeping']),
    supportsByoc: true,
    hasDemoMode: false,
    docsUrl: 'https://developer.intuit.com',
  },
  {
    slug: 'jira',
    name: 'Jira',
    kind: 'api',
    category: 'project-mgmt',
    description: 'Track issues and manage projects in Jira',
    shortDesc: 'Track issues and manage projects',
    icon: 'FileText',
    configSchemaJson: JSON.stringify({
      authType: 'api_key',
      fields: [
        { name: 'domain', label: 'Jira Domain', type: 'text', required: true, placeholder: 'your-domain.atlassian.net' },
        { name: 'email', label: 'Email', type: 'text', required: true },
        { name: 'apiToken', label: 'API Token', type: 'password', required: true },
      ],
      endpoints: ['https://{domain}.atlassian.net/rest/api/3'],
    }),
    toolsJson: JSON.stringify([
      { id: 'jira.createIssue', name: 'Create Issue', description: 'Create a new Jira issue' },
      { id: 'jira.listProjects', name: 'List Projects', description: 'List Jira projects' },
      { id: 'jira.searchIssues', name: 'Search Issues', description: 'Search issues using JQL' },
      { id: 'jira.updateStatus', name: 'Update Status', description: 'Transition an issue status' },
    ]),
    status: 'beta',
    source: 'internal',
    installCount: 0,
    tags: JSON.stringify(['project-management', 'issues', 'agile', 'tracking']),
    supportsByoc: true,
    hasDemoMode: true,
    docsUrl: 'https://developer.atlassian.com/cloud/jira/platform/rest',
  },
  {
    slug: 'shopify',
    name: 'Shopify',
    kind: 'oauth',
    category: 'e-commerce',
    description: 'Manage products, orders, and customers on Shopify',
    shortDesc: 'Manage products, orders, and customers',
    icon: 'Globe',
    configSchemaJson: JSON.stringify({
      authType: 'oauth2',
      fields: [
        { name: 'shopDomain', label: 'Shop Domain', type: 'text', required: true, placeholder: 'your-store.myshopify.com' },
        { name: 'apiKey', label: 'API Key', type: 'text', required: true },
        { name: 'apiSecret', label: 'API Secret', type: 'password', required: true },
      ],
      endpoints: ['https://{shop}.myshopify.com/admin/api/2024-01'],
    }),
    toolsJson: JSON.stringify([
      { id: 'shopify.listProducts', name: 'List Products', description: 'List products in the store' },
      { id: 'shopify.getOrders', name: 'Get Orders', description: 'Retrieve order details' },
      { id: 'shopify.createProduct', name: 'Create Product', description: 'Create a new product' },
      { id: 'shopify.manageInventory', name: 'Manage Inventory', description: 'Update inventory levels' },
    ]),
    status: 'coming_soon',
    source: 'internal',
    installCount: 0,
    tags: JSON.stringify(['e-commerce', 'shopping', 'products', 'orders']),
    supportsByoc: true,
    hasDemoMode: false,
    docsUrl: 'https://shopify.dev/docs/api',
  },
  {
    slug: 'mcp-filesystem',
    name: 'File System (MCP)',
    kind: 'mcp',
    category: 'local',
    description: 'Read, write, and search local files via MCP protocol',
    shortDesc: 'Read, write, and search local files',
    icon: 'FolderClosed',
    configSchemaJson: JSON.stringify({
      authType: 'none',
      fields: [
        { name: 'rootPath', label: 'Root Path', type: 'text', required: true, placeholder: '/home/user/documents' },
      ],
      endpoints: [],
    }),
    toolsJson: JSON.stringify([
      { id: 'fs.readFile', name: 'Read File', description: 'Read file contents from local filesystem' },
      { id: 'fs.writeFile', name: 'Write File', description: 'Write content to a local file' },
      { id: 'fs.listFiles', name: 'List Files', description: 'List files in a directory' },
      { id: 'fs.searchFiles', name: 'Search Files', description: 'Search for files by name or content' },
    ]),
    status: 'live',
    source: 'internal',
    installCount: 0,
    tags: JSON.stringify(['local', 'files', 'mcp', 'filesystem']),
    supportsByoc: false,
    hasDemoMode: true,
    mcpServerUrl: 'mcp://filesystem',
  },
];

async function seedCatalog() {
  for (const entry of DEFAULT_CATALOG) {
    await db.connectorCatalogEntry.upsert({
      where: { slug: entry.slug },
      update: {},
      create: entry,
    });
  }
}

export async function GET(request: NextRequest) {
  try {
    // Check if catalog has entries; if not, seed defaults
    const count = await db.connectorCatalogEntry.count();
    if (count === 0) {
      await seedCatalog();
    }

    // Parse optional query parameters
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const kind = searchParams.get('kind');
    const status = searchParams.get('status');
    const search = searchParams.get('search');

    // Build where clause
    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (kind) where.kind = kind;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
        { shortDesc: { contains: search } },
        { slug: { contains: search } },
      ];
    }

    const entries = await db.connectorCatalogEntry.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    return NextResponse.json(entries);
  } catch (error) {
    console.error('[GET /api/connectors/catalog] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch connector catalog' },
      { status: 500 }
    );
  }
}
