
import { PrismaClient } from '@syntrae/prisma-schema';
const prisma = new PrismaClient();
async function main() {
    const pending = await prisma.automationRun.count({ where: { status: 'PENDING' } });
    const all = await prisma.automationRun.count();
    console.log(`Pending Runs: ${pending}`);
    console.log(`Total Runs: ${all}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
