
const { PrismaClient } = require('@syntrae/prisma-schema');
const prisma = new PrismaClient();
async function main() {
    try {
        const pending = await prisma.automationRun.count({ where: { status: 'PENDING' } });
        const all = await prisma.automationRun.count();
        console.log(`Pending Runs: ${pending}`);
        console.log(`Total Runs: ${all}`);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
main();
