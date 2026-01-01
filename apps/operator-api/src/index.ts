import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@syntrae/prisma-schema';

// Import Routers
import { authRouter } from './api/auth';
import { workspaceRouter } from './api/workspace';
import { ownerRouter } from './api/owner';
import { suggestionsRouter } from './api/suggestions';
import { valueRouter } from './api/value';
import { leadsRouter } from './api/leads';
import { billingRouter } from './api/billing';
import { brandRouter } from './api/brands';
import { policyRouter } from './api/policy';
import { analyticsRouter } from './api/analytics';
import { runsRouter } from './api/runs';
import { draftsRouter } from './api/drafts';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(helmet());

// Proxy Configuration
if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1); // Trust local NGINX
}

// CORS Configuration
app.use(cors({
    origin: [
        'https://app.syntraeai.com',
        'https://syntraeai.com',
        'http://localhost:5173', // Dev
        'http://localhost:3000'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}));

app.use(cookieParser());
app.use(express.json());
app.use(morgan('dev'));

export const prisma = new PrismaClient();

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'operator-api' });
});

// Register Routes
app.use('/api', authRouter);
app.use('/workspaces', workspaceRouter);
app.use('/owner', ownerRouter);
app.use('/suggestions', suggestionsRouter);
app.use('/value', valueRouter);
app.use('/leads', leadsRouter);
app.use('/billing', billingRouter);
app.use('/brands', brandRouter);
app.use('/billing', billingRouter);
app.use('/brands', brandRouter);
app.use('/policies', policyRouter); // Specific mount point
app.use('/analytics', analyticsRouter);
app.use('/runs', runsRouter); // Specific mount point if needed, or keep generic /api? Original plan was generic, but specific is cleaner. Keeping generic for now to minimize breaking changes if client expects it.
// Actually, consistency: most are mounted on root /something.
// Let's assume index.ts convention.
// Original code had: app.use('/api', policyRouter); which means /api/policies if router has /policies prefix, or /api if router is root.
// Checking imports... imports are just routers.
// Let's stick to the existing pattern for now (everything under app, some specific).
// Wait, previous file content showed:
// app.use('/api', policyRouter);
// app.use('/api', analyticsRouter);
// app.use('/api', runsRouter);
// app.use('/api', draftsRouter);
//
// The goal is to ensure they are reachable.
// draftsRouter in drafts.ts is defined as root '/drafts/:id...'.
// So mounting at '/' makes them '/drafts/:id'.
// Mounting at '/api' makes them '/api/drafts/:id'.
// verification used /api/drafts.
// So:
app.use('/api', draftsRouter);

app.listen(port, () => {
    console.log(`[OperatorAPI] Server running on port ${port}`);
});
