import dotenv from 'dotenv';
dotenv.config();

const env = (process.env.NODE_ENV || 'development').toLowerCase();
if (env === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in production');
}

export const config = {
    bcryptRounds: 10,
    jwtSecret: process.env.JWT_SECRET || 'dev_secret_operator_api',
    port: process.env.PORT || 3001,
};
