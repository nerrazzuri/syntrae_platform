import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';

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
import { internalRouter } from './api/internal';

dotenv.config();

const port = process.env.PORT || 3001;

export function createApp() {
    const app = express();

    app.use(helmet({
        crossOriginResourcePolicy: { policy: "cross-origin" }
    }));

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

    app.get('/health', (req, res) => {
        res.json({ status: 'ok', service: 'operator-api' });
    });

    app.use('/auth', authRouter);
    app.use('/workspaces', workspaceRouter);
    app.use('/owner', ownerRouter);
    app.use('/suggestions', suggestionsRouter);
    app.use('/value', valueRouter);
    app.use('/leads', leadsRouter);
    app.use('/billing', billingRouter);
    app.use('/', runsRouter);
    app.use('/', policyRouter);
    app.use('/', marketProfileRouter);
    app.use('/internal', internalRouter);
    app.use('/brands', brandRouter);
    app.use('/analytics', analyticsRouter);
    app.use('/drafts', draftsRouter);

    return app;
}

const app = createApp();

if (require.main === module) {
    app.listen(port, () => {
        console.log(`[OperatorAPI] Server running on port ${port}`);
    });
}

export default app;
