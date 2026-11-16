import readline from 'node:readline';
import { getAuthDb } from '@/lib/auth/db';
import { createUser, listUsers } from '@/lib/auth/users';
import { validatePasswordShape } from '@/lib/auth/crypto';
import { recordAuditLog } from '@/lib/auth/audit';
import type { SafeUser } from '@/lib/auth/types';

/**
 * Prompts the user on stdout/stdin with hidden input (no echo) for passwords.
 */
function askHidden(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Write the prompt query
    process.stdout.write(query);

    let password = '';
    const stdin = process.stdin;

    const onData = (char: Buffer) => {
      const str = char.toString('utf8');
      switch (str) {
        case '\n':
        case '\r':
        case '\u0004': // EOT
          stdin.removeListener('data', onData);
          if (stdin.isTTY) stdin.setRawMode(false);
          process.stdout.write('\n');
          rl.close();
          resolve(password);
          break;
        case '\u0003': // Ctrl+C
          if (stdin.isTTY) stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(1);
          break;
        case '\u007F': // Backspace
        case '\b':
          if (password.length > 0) {
            password = password.slice(0, -1);
          }
          break;
        default:
          password += str;
          break;
      }
    };

    if (stdin.isTTY) {
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on('data', onData);
    } else {
      // Non-interactive / piped fallback
      rl.question('', (ans) => {
        rl.close();
        resolve(ans.trim());
      });
    }
  });
}

function askText(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function bootstrapSuperAdmin(options?: {
  name?: string;
  email?: string;
  password?: string;
}): Promise<SafeUser> {
  const db = getAuthDb();

  // 1. Check if a Super Admin already exists
  const existingSuperAdmins = listUsers({ role: 'super_admin' });
  if (existingSuperAdmins.length > 0) {
    throw new Error('A Super Admin already exists on this system. Bootstrap can only run once on an uninitialized system.');
  }

  // 2. Resolve credentials from options, environment variables, or interactive input
  let name = options?.name || process.env.BOOTSTRAP_ADMIN_NAME || '';
  let email = options?.email || process.env.BOOTSTRAP_ADMIN_EMAIL || '';
  let password = options?.password || process.env.BOOTSTRAP_ADMIN_PASSWORD || '';

  if (!name && process.stdin.isTTY) {
    name = await askText('Super Admin Full Name: ');
  }
  if (!email && process.stdin.isTTY) {
    email = await askText('Super Admin Email: ');
  }
  if (!password && process.stdin.isTTY) {
    password = await askHidden('Super Admin Password (min 8 chars, hidden): ');
    const confirm = await askHidden('Confirm Super Admin Password: ');
    if (password !== confirm) {
      throw new Error('Passwords do not match.');
    }
  }

  // 3. Validate inputs
  name = name.trim();
  email = email.trim().toLowerCase();

  if (!name || name.length < 2) {
    throw new Error('Name must be at least 2 characters.');
  }
  if (!email || !EMAIL_REGEX.test(email)) {
    throw new Error(`Invalid email address: ${email}`);
  }
  const passwordError = validatePasswordShape(password);
  if (passwordError) {
    throw new Error(passwordError);
  }

  // 4. Concurrency-safe atomic insert
  let createdUser: SafeUser | null = null;

  const tx = db.transaction(() => {
    const checkCount = db.prepare(`SELECT count(*) as count FROM users WHERE role = 'super_admin'`).get() as { count: number };
    if (checkCount.count > 0) {
      throw new Error('A Super Admin was already created concurrently.');
    }

    createdUser = createUser({
      name,
      email,
      role: 'super_admin',
      password,
    });

    recordAuditLog({
      action: 'bootstrap_super_admin',
      userId: createdUser.id,
      resource: 'auth',
      details: {
        email: createdUser.email,
        role: createdUser.role,
      },
    });
  });

  tx.immediate();

  if (!createdUser) {
    throw new Error('Failed to create Super Admin.');
  }

  return createdUser;
}

// Direct CLI execution check
if (require.main === module) {
  (async () => {
    console.log('========================================================');
    console.log('Hazzino BOS — First Super Admin Bootstrap Utility');
    console.log('========================================================\n');

    try {
      const user = await bootstrapSuperAdmin();
      console.log('\n Super Admin created successfully:');
      console.log(`  ID:    ${user.id}`);
      console.log(`  Name:  ${user.name}`);
      console.log(`  Email: ${user.email}`);
      console.log(`  Role:  ${user.role}`);
      console.log('\nYou can now log in using these credentials.');
      process.exit(0);
    } catch (err) {
      console.error(`\n Bootstrap failed: ${(err as Error).message}`);
      process.exit(1);
    }
  })();
}
