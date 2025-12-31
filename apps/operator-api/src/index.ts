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
import { analyticsRouter } from './api/analytics';

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
app.use('/auth', authRouter);
app.use('/workspaces', workspaceRouter);
app.use('/owner', ownerRouter);
app.use('/suggestions', suggestionsRouter);
app.use('/value', valueRouter);
app.use('/leads', leadsRouter);
app.use('/billing', billingRouter);
app.use('/brands', brandRouter);
app.use('/analytics', analyticsRouter);

app.listen(port, () => {
    console.log(`[OperatorAPI] Server running on port ${port}`);
});
