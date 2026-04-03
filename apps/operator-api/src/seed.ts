import { prisma } from './db';
import * as bcrypt from 'bcrypt'; // Assuming bcrypt is available in package.json

async function main() {
    console.log('Seeding database...');

    // 1. Create Account (Workspace)
    const account = await prisma.account.create({
        data: {
            name: 'Demo Workspace',
            status: 'ACTIVE',
            plan_id: 'PRO',
        },
    });
    console.log('Created Account:', account.id);

    // 2. Create Brand
    const brand = await prisma.brand.create({
        data: {
            workspace_id: account.id,
            name: 'Demo Brand',
            domain: 'demo.com',
            domain_context: { description: 'A demo brand for testing.' },
            status: 'ACTIVE',
        },
    });
    console.log('Created Brand:', brand.id);

    // 3. Create User (Optional, if needed for login)
    // Check if User model exists and has password field
    // const hashedPassword = await bcrypt.hash('password123', 10);
    // const user = await prisma.user.create({
    //   data: {
    //     email: 'admin@demo.com',
    //     password_hash: hashedPassword,
    //     tenant_id: account.id, // schema mismatch risk here, let's skip for now unless essential
    //   }
    // });

    console.log('Seeding finished.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
