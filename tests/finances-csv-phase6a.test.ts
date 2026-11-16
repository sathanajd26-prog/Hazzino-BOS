import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseStatementCsv, categorize, type ParsedRow, type LedgerRow } from '@/lib/statements';
import { openLedger, type Ledger } from '@/lib/ledger';
import { expensesView, net } from '@/lib/finances';
import type { UserRole } from '@/lib/auth/types';

describe('Phase 6A: Finance CSV & Ledger Validation', () => {
  let tmpDir: string;
  let testLedgerPath: string;
  let testAuthPath: string;
  let tokens: Record<UserRole, string>;
  let prevLedgerDb: string | undefined;
  let prevAuthDb: string | undefined;
  let prevEnvLocal: string | undefined;

  beforeAll(async () => {
    prevLedgerDb = process.env.LEDGER_DB;
    prevAuthDb = process.env.HAZZINO_AUTH_DB;
    prevEnvLocal = process.env.GLADOS_ENV_LOCAL;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hazzino-phase6a-'));
    testLedgerPath = path.join(tmpDir, 'test-ledger.db');
    testAuthPath = path.join(tmpDir, 'test-auth.db');
    process.env.LEDGER_DB = testLedgerPath;
    process.env.HAZZINO_AUTH_DB = testAuthPath;
    process.env.GLADOS_ENV_LOCAL = path.join(tmpDir, '.env.local');

    // Initialize Auth DB & create test sessions for all 5 roles
    const { openAuthDb, closeAuthDb } = await import('@/lib/auth/db');
    const { createUser } = await import('@/lib/auth/users');
    const { createSession } = await import('@/lib/auth/sessions');

    closeAuthDb();
    const authDb = openAuthDb(testAuthPath);
    tokens = {} as Record<UserRole, string>;

    const roles: UserRole[] = ['super_admin', 'admin', 'manager', 'employee', 'viewer'];
    for (const role of roles) {
      const u = createUser(authDb, {
        email: `${role}@finance-test.local`,
        name: `Test ${role}`,
        password: 'Password123!',
        role,
        departmentId: 'dept-finance',
      });
      const { rawToken } = createSession(authDb, { userId: u.id });
      tokens[role] = rawToken;
    }
  });

  afterAll(async () => {
    const { closeAuthDb } = await import('@/lib/auth/db');
    closeAuthDb();

    if (prevLedgerDb !== undefined) process.env.LEDGER_DB = prevLedgerDb;
    else delete process.env.LEDGER_DB;

    if (prevAuthDb !== undefined) process.env.HAZZINO_AUTH_DB = prevAuthDb;
    else delete process.env.HAZZINO_AUTH_DB;

    if (prevEnvLocal !== undefined) process.env.GLADOS_ENV_LOCAL = prevEnvLocal;
    else delete process.env.GLADOS_ENV_LOCAL;

    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Multiple Synthetic CSV Formats & Robust Parsing
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Synthetic CSV Format Parsing', () => {
    test('Format 1: Standard signed amount (Chase / BofA single-column style)', () => {
      const csv = [
        'Date,Description,Amount',
        '2026-06-01,Office Depot,-45.50',
        '2026-06-02,Client Retainer,2500.00',
        '2026-06-03,Amazon Web Services,-120.40',
      ].join('\n');

      const rows = parseStatementCsv(csv);
      expect(rows).toEqual([
        { date: '2026-06-01', description: 'Office Depot', amountCents: 4550, direction: 'out' },
        { date: '2026-06-02', description: 'Client Retainer', amountCents: 250000, direction: 'in' },
        { date: '2026-06-03', description: 'Amazon Web Services', amountCents: 12040, direction: 'out' },
      ]);
    });

    test('Format 2: Separate Debit & Credit two-column style (Mercury / Wells Fargo)', () => {
      const csv = [
        'Transaction Date,Merchant,Debit,Credit',
        '06/10/2026,Upwork Contractor,650.00,',
        '06/11/2026,Stripe Payout,,1800.00',
        '06/12/2026,Google Ads,300.00,',
      ].join('\n');

      const rows = parseStatementCsv(csv);
      expect(rows).toEqual([
        { date: '2026-06-10', description: 'Upwork Contractor', amountCents: 65000, direction: 'out' },
        { date: '2026-06-11', description: 'Stripe Payout', amountCents: 180000, direction: 'in' },
        { date: '2026-06-12', description: 'Google Ads', amountCents: 30000, direction: 'out' },
      ]);
    });

    test('Format 3: Modern FinTech Outflow / Inflow & Narrative headers (Brex / Ramp style)', () => {
      const csv = [
        'Post Date,Narrative,Outflow,Inflow',
        '2026-06-15,Vercel Hosting,20.00,',
        '2026-06-16,Partner Dividend,,500.00',
        '2026-06-17,Anthropic Claude API,75.25,',
      ].join('\n');

      const rows = parseStatementCsv(csv);
      expect(rows).toEqual([
        { date: '2026-06-15', description: 'Vercel Hosting', amountCents: 2000, direction: 'out' },
        { date: '2026-06-16', description: 'Partner Dividend', amountCents: 50000, direction: 'in' },
        { date: '2026-06-17', description: 'Anthropic Claude API', amountCents: 7525, direction: 'out' },
      ]);
    });

    test('Format 4: Credit card statement with positive charge convention (Amex style)', () => {
      const csv = [
        'Date,Description,Card Member,Amount,Category',
        '06/18/2026,OpenAI,SAM RIVERA,20.00,Software',
        '06/19/2026,AUTOPAY PAYMENT - THANK YOU,SAM RIVERA,-1000.00,Payment',
        '06/20/2026,Figma Inc,SAM RIVERA,45.00,Software',
      ].join('\n');

      const rows = parseStatementCsv(csv);
      expect(rows).toEqual([
        { date: '2026-06-18', description: 'OpenAI', amountCents: 2000, direction: 'out', sourceCategory: 'Software' },
        { date: '2026-06-19', description: 'AUTOPAY PAYMENT - THANK YOU', amountCents: 100000, direction: 'in', sourceCategory: 'Payment' },
        { date: '2026-06-20', description: 'Figma Inc', amountCents: 4500, direction: 'out', sourceCategory: 'Software' },
      ]);
    });

    test('Format 5: Accounting currency symbols, commas, parentheses, DR/CR, and minus suffixes', () => {
      const csv = [
        'Date,Payee,Total Amount',
        '06/20/2026,"Figma, Inc.","($45.00)"',
        '06/21/2026,Consulting Retainer,"+$3,500.00"',
        '06/22/2026,Slack Technologies,"-$12.50"',
        '06/23/2026,European Server,"€89.99"',
        '06/24/2026,UK Domain Registration,"£15.00"',
        '06/25/2026,Vendor Billing,250.00 DR',
        '06/26/2026,Customer Credit,150.00 CR',
        '06/27/2026,Terminal Fee,35.00-',
      ].join('\n');

      const rows = parseStatementCsv(csv);
      expect(rows).toEqual([
        { date: '2026-06-20', description: 'Figma, Inc.', amountCents: 4500, direction: 'out' },
        { date: '2026-06-21', description: 'Consulting Retainer', amountCents: 350000, direction: 'in' },
        { date: '2026-06-22', description: 'Slack Technologies', amountCents: 1250, direction: 'out' },
        { date: '2026-06-23', description: 'European Server', amountCents: 8999, direction: 'in' },
        { date: '2026-06-24', description: 'UK Domain Registration', amountCents: 1500, direction: 'in' },
        { date: '2026-06-25', description: 'Vendor Billing', amountCents: 25000, direction: 'out' },
        { date: '2026-06-26', description: 'Customer Credit', amountCents: 15000, direction: 'in' },
        { date: '2026-06-27', description: 'Terminal Fee', amountCents: 3500, direction: 'out' },
      ]);
    });

    test('Format 6: Date format normalization across multiple international conventions', () => {
      const csv = [
        'Date,Description,Amount',
        '2026-07-01,ISO Standard,-10.00',
        '07/02/2026,US Slash Standard,-20.00',
        '7/3/26,Short US Slash,-30.00',
        '2026/07/04,ISO Slashes,-40.00',
        '07-05-2026,US Dashed,-50.00',
        '2026.07.06,Dotted Date,-60.00',
        '2026-07-07T14:30:00Z,ISO Timestamp,-70.00',
      ].join('\n');

      const rows = parseStatementCsv(csv);
      expect(rows.map((r) => r.date)).toEqual([
        '2026-07-01',
        '2026-07-02',
        '2026-07-03',
        '2026-07-04',
        '2026-07-05',
        '2026-07-06',
        '2026-07-07',
      ]);
    });

    test('Format 7: Multiline quoted descriptions and embedded quotes ("")', () => {
      const csv = [
        'Date,Description,Amount',
        '2026-06-15,"AWS Cloud Invoice #9981',
        'Extended Description with embedded, commas and ""escaped quotes""",-185.00',
        '2026-06-16,Standard Row,-15.00',
      ].join('\n');

      const rows = parseStatementCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[0].description).toContain('AWS Cloud Invoice #9981');
      expect(rows[0].description).toContain('embedded, commas and "escaped quotes"');
      expect(rows[0].amountCents).toBe(18500);
      expect(rows[0].direction).toBe('out');
      expect(rows[1].description).toBe('Standard Row');
    });

    test('Format 8: Categorization accuracy across spend categories and income', () => {
      const rows: ParsedRow[] = [
        { date: '2026-06-01', description: 'Meta Ads Manager', amountCents: 50000, direction: 'out' },
        { date: '2026-06-01', description: 'Amazon Web Services AWS', amountCents: 12000, direction: 'out' },
        { date: '2026-06-01', description: 'Gusto Payroll Service', amountCents: 350000, direction: 'out' },
        { date: '2026-06-01', description: 'HubSpot CRM Subscription', amountCents: 8000, direction: 'out' },
        { date: '2026-06-01', description: 'OpenAI ChatGPT Plus', amountCents: 2000, direction: 'out' },
        { date: '2026-06-01', description: 'Random Coffee Shop', amountCents: 450, direction: 'out' },
        { date: '2026-06-01', description: 'Hardware Store', amountCents: 1200, direction: 'out', sourceCategory: 'Office Equipment' },
        { date: '2026-06-01', description: 'Client Invoice Payment', amountCents: 500000, direction: 'in' },
      ];

      const categorized = rows.map((r) => ({ ...r, category: categorize(r) }));
      expect(categorized.map((c) => c.category)).toEqual([
        'Advertising',
        'Infrastructure',
        'Contractors',
        'CRM & Revenue',
        'Software',
        'Uncategorized',
        'Office Equipment',
        'Income',
      ]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Malformed Rows & Edge Cases
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Malformed Rows & Edge Cases', () => {
    test('skips blank lines, trailing newlines, and unparseable rows without failing the batch', () => {
      const csv = [
        'Date,Description,Amount',
        '',
        '2026-06-01,Valid First,-10.00',
        'garbage,row,not-a-number',
        '2026-06-02,,',
        '2026-06-03,Valid Second,-20.00',
        '   ',
        '',
      ].join('\n');

      const rows = parseStatementCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[0].description).toBe('Valid First');
      expect(rows[1].description).toBe('Valid Second');
    });

    test('returns empty array when CSV has no valid headers or content', () => {
      expect(parseStatementCsv('')).toEqual([]);
      expect(parseStatementCsv('   \n  \n')).toEqual([]);
      expect(parseStatementCsv('ColA,ColB,ColC\n1,2,3')).toEqual([]);
      expect(parseStatementCsv('Date,Description\n2026-06-01,No amount column')).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Isolated SQLite Ledger Persistence & Deduplication
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Ledger Persistence & Deduplication in Isolated SQLite', () => {
    let ledger: Ledger;

    beforeEach(() => {
      if (fs.existsSync(testLedgerPath)) fs.unlinkSync(testLedgerPath);
      ledger = openLedger(testLedgerPath);
    });

    afterEach(() => {
      ledger?.close();
    });

    test('inserts parsed rows, handles idempotent re-uploads via content hash deduplication', () => {
      const rows: LedgerRow[] = [
        { date: '2026-06-01', description: 'AWS', amountCents: 5000, direction: 'out', category: 'Infrastructure' },
        { date: '2026-06-02', description: 'Google Ads', amountCents: 15000, direction: 'out', category: 'Advertising' },
        { date: '2026-06-03', description: 'Client Retainer', amountCents: 100000, direction: 'in', category: 'Income' },
      ];

      // Initial insert: 3 rows inserted
      const inserted1 = ledger.insertRows(rows);
      expect(inserted1).toBe(3);
      expect(ledger.rowCount()).toBe(3);

      // Re-upload exact same statement: 0 new rows inserted
      const inserted2 = ledger.insertRows(rows);
      expect(inserted2).toBe(0);
      expect(ledger.rowCount()).toBe(3);

      // Partial overlap: 2 existing + 1 new row -> 1 new row inserted
      const mixedRows: LedgerRow[] = [
        rows[0],
        rows[1],
        { date: '2026-06-04', description: 'Cursor AI', amountCents: 2000, direction: 'out', category: 'Software' },
      ];
      const inserted3 = ledger.insertRows(mixedRows);
      expect(inserted3).toBe(1);
      expect(ledger.rowCount()).toBe(4);
    });

    test('monthly() aggregates outbound spend by category for the latest month in descending order', () => {
      const rows: LedgerRow[] = [
        { date: '2026-05-15', description: 'May AWS', amountCents: 4000, direction: 'out', category: 'Infrastructure' },
        { date: '2026-06-01', description: 'June AWS', amountCents: 6000, direction: 'out', category: 'Infrastructure' },
        { date: '2026-06-02', description: 'June Meta Ads', amountCents: 25000, direction: 'out', category: 'Advertising' },
        { date: '2026-06-03', description: 'June GitHub', amountCents: 2100, direction: 'out', category: 'Software' },
        { date: '2026-06-04', description: 'June Client Payment', amountCents: 500000, direction: 'in', category: 'Income' },
      ];

      ledger.insertRows(rows);
      expect(ledger.latestMonth()).toBe('2026-06');

      const monthly = ledger.monthly();
      expect(monthly).toEqual([
        { category: 'Advertising', total: 250 },
        { category: 'Infrastructure', total: 60 },
        { category: 'Software', total: 21 },
      ]);
    });

    test('reconcile() accurately calculates expenses and net cash flow against input revenue', () => {
      const rows: LedgerRow[] = [
        { date: '2026-06-01', description: 'AWS', amountCents: 10000, direction: 'out', category: 'Infrastructure' },
        { date: '2026-06-02', description: 'Ads', amountCents: 30000, direction: 'out', category: 'Advertising' },
      ];
      ledger.insertRows(rows);

      // $400 total outbound expenses in June 2026
      const rec = ledger.reconcile(1000);
      expect(rec).toEqual({ income: 1000, expenses: 400, net: 600 });
    });

    test('spendRows() retrieves only outbound rows, newest first, with optional month filter', () => {
      const rows: LedgerRow[] = [
        { date: '2026-05-10', description: 'May Spend', amountCents: 1000, direction: 'out', category: 'Software' },
        { date: '2026-06-10', description: 'June Spend', amountCents: 2000, direction: 'out', category: 'Software' },
        { date: '2026-06-15', description: 'Income Row', amountCents: 5000, direction: 'in', category: 'Income' },
      ];
      ledger.insertRows(rows);

      const allSpend = ledger.spendRows();
      expect(allSpend).toHaveLength(2);
      expect(allSpend[0].description).toBe('June Spend');
      expect(allSpend[1].description).toBe('May Spend');

      const juneSpend = ledger.spendRows('2026-06');
      expect(juneSpend).toHaveLength(1);
      expect(juneSpend[0].description).toBe('June Spend');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. API Authorization & Ingestion Route (POST /api/finances/statements)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('API Route: POST /api/finances/statements', () => {
    beforeEach(() => {
      if (fs.existsSync(testLedgerPath)) fs.unlinkSync(testLedgerPath);
    });

    const apiReq = (
      method: string,
      roleToken?: string,
      body?: string | FormData,
      contentType?: string,
    ) => {
      const headers: Record<string, string> = { host: 'localhost:4100' };
      if (roleToken) headers.cookie = `hazzino_session=${roleToken}`;
      if (contentType) headers['content-type'] = contentType;

      return new Request('http://localhost/api/finances/statements', {
        method,
        headers,
        body,
      });
    };

    test('rejects unauthenticated requests with 401', async () => {
      const { POST } = await import('@/app/api/finances/statements/route');
      const res = await POST(apiReq('POST', undefined, 'Date,Description,Amount\n2026-06-01,Test,-10', 'text/csv'));
      expect(res.status).toBe(401);
    });

    test('rejects unauthorized roles (viewer, employee, manager) with 403', async () => {
      const { POST } = await import('@/app/api/finances/statements/route');
      const csv = 'Date,Description,Amount\n2026-06-01,Test,-10';

      const viewerRes = await POST(apiReq('POST', tokens.viewer, csv, 'text/csv'));
      expect(viewerRes.status).toBe(403);

      const empRes = await POST(apiReq('POST', tokens.employee, csv, 'text/csv'));
      expect(empRes.status).toBe(403);

      const mgrRes = await POST(apiReq('POST', tokens.manager, csv, 'text/csv'));
      expect(mgrRes.status).toBe(403);
    });

    test('returns 400 for empty body or unparseable CSV', async () => {
      const { POST } = await import('@/app/api/finances/statements/route');

      const emptyRes = await POST(apiReq('POST', tokens.admin, '', 'text/csv'));
      expect(emptyRes.status).toBe(400);
      expect((await emptyRes.json()).error).toMatch(/expected a CSV upload/i);

      const badCsvRes = await POST(apiReq('POST', tokens.admin, 'HeaderA,HeaderB\n1,2', 'text/csv'));
      expect(badCsvRes.status).toBe(400);
      expect((await badCsvRes.json()).error).toMatch(/no parseable rows/i);
    });

    test('admin can upload raw text/csv and receive parsed summary', async () => {
      const { POST } = await import('@/app/api/finances/statements/route');
      const csv = [
        'Date,Description,Amount',
        '2026-06-01,AWS Infrastructure,-85.00',
        '2026-06-02,Client Deposit,1200.00',
        '2026-06-03,Facebook Ads,-150.00',
      ].join('\n');

      const res = await POST(apiReq('POST', tokens.admin, csv, 'text/csv'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.inserted).toBe(3);
      expect(data.parsed).toBe(3);
      expect(data.byCategory).toEqual([
        { category: 'Advertising', total: 150 },
        { category: 'Infrastructure', total: 85 },
      ]);

      // Verify re-upload via API is idempotent
      const dupRes = await POST(apiReq('POST', tokens.admin, csv, 'text/csv'));
      expect(dupRes.status).toBe(200);
      const dupData = await dupRes.json();
      expect(dupData.inserted).toBe(0);
      expect(dupData.parsed).toBe(3);
    });

    test('super_admin can upload multipart/form-data file and populate ledger', async () => {
      const { POST } = await import('@/app/api/finances/statements/route');
      const csvContent = [
        'Date,Merchant,Debit,Credit',
        '06/05/2026,Upwork Contractor,500.00,',
        '06/06/2026,OpenAI API,20.00,',
      ].join('\n');

      const formData = new FormData();
      formData.append('file', new File([csvContent], 'statement.csv', { type: 'text/csv' }));

      const res = await POST(apiReq('POST', tokens.super_admin, formData));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.inserted).toBe(2);
      expect(data.parsed).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Finance UI Display & Zero Demo Data Mixing
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Finance UI Data Isolation & Integrity', () => {
    test('when ledger has imported spend, expensesView displays real uploaded data and ignores demo data', () => {
      const realSpend = [
        { category: 'Advertising', total: 450 },
        { category: 'Infrastructure', total: 120 },
      ];

      const demoFn = () => [
        { category: 'Fake Demo Category', total: 9999 },
      ];

      // In real mode
      const viewReal = expensesView({
        ledgerSpend: realSpend,
        filming: false,
        demo: demoFn,
      });

      expect(viewReal.source).toBe('uploaded');
      expect(viewReal.byCategory).toEqual(realSpend);
      expect(viewReal.total).toBe(570);

      // Even if filming mode is on, uploaded statement ledger takes precedence
      const viewFilmingWithUpload = expensesView({
        ledgerSpend: realSpend,
        filming: true,
        demo: demoFn,
      });

      expect(viewFilmingWithUpload.source).toBe('uploaded');
      expect(viewFilmingWithUpload.byCategory).toEqual(realSpend);
      expect(viewFilmingWithUpload.total).toBe(570);
    });

    test('when ledger is empty and filming is false, expensesView returns source: "none" without inventing data', () => {
      const viewEmpty = expensesView({
        ledgerSpend: [],
        filming: false,
        demo: () => [{ category: 'Demo', total: 100 }],
      });

      expect(viewEmpty.source).toBe('none');
      expect(viewEmpty.byCategory).toEqual([]);
      expect(viewEmpty.total).toBe(0);
    });

    test('net() computes income minus expenses accurately without hidden modifiers', () => {
      expect(net(10000, 3500)).toBe(6500);
      expect(net(2000, 5000)).toBe(-3000);
      expect(net(0, 500)).toBe(-500);
    });
  });
});
