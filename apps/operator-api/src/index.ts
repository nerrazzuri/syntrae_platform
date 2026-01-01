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
import marketProfileRouter from './api/market_profile';

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
// Register Routes
app.use('/auth', authRouter); // Was /api, changed to /auth to match Frontend /auth/me
app.use('/workspaces', workspaceRouter);
app.use('/owner', ownerRouter);
app.use('/suggestions', suggestionsRouter);
app.use('/value', valueRouter);
app.use('/leads', leadsRouter);
app.use('/billing', billingRouter);
app.use('/', runsRouter);
app.use('/brands', brandRouter);
app.use('/policies', policyRouter);
app.use('/analytics', analyticsRouter);

app.use('/drafts', draftsRouter);
app.use('/', marketProfileRouter); // Routes are mounted at root level like others (but careful with paths) 
// Actually wait, routes in `market_profile.ts` are `/brands/:id/...` and `/market-profiles/:id`.
// So we should mount it at `/` to let the router handle the full paths, OR mount at `/api` if we were using it.
// Given current pattern: `brandRouter` is at `/brands`.
// `market_profile.ts` has specific paths.
// Let's import it first. 

app.listen(port, () => {
    console.log(`[OperatorAPI] Server running on port ${port}`);
});
