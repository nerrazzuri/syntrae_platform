
import { Session, User } from '@syntrae/prisma-schema';

declare global {
    namespace Express {
        interface Request {
            user?: User;
            session?: Session;
            activeWorkspaceId?: string;
        }
    }
}
