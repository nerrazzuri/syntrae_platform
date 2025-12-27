import { Session, User } from '@syntrae/prisma-schema';

declare global {
    namespace Express {
        interface Request {
            session?: Session;
            user?: User;
            activeWorkspaceId?: string;
        }
    }
}
