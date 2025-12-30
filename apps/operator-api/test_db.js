const { PrismaClient } = require('@syntrae/prisma-schema');
const prisma = new PrismaClient();

async function main() {
    try {
        console.log('Connecting to DB...');
        await prisma.$connect();
        console.log('Connected successfully!');

        const count = await prisma.account.count();
        console.log('Account count:', count);

        await prisma.$disconnect();
    } catch (e) {
        console.error('Connection failed:', e);
        process.exit(1);
    }
}

main();
