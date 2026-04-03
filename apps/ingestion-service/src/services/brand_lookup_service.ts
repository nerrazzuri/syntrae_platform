import { prisma } from '../db';

export class BrandLookupService {
    /**
     * Resolves and validates a Brand for a given Workspace (Account).
     * 
     * Logic:
     * 1. If brandId is provided:
     *    - Fetch Brand.
     *    - Verify it belongs to workspaceId.
     *    - Verify status is ACTIVE.
     * 2. If brandId is missing:
     *    - Fetch the DEFAULT Brand for the workspace (deterministic lookup).
     *    - Verify status is ACTIVE.
     * 
     * @param workspaceId - The Account ID owning the event.
     * @param requestBrandId - Optional brand_id from the request.
     * @returns The resolved brand_id.
     * @throws Error if Brand not found, mismatch, or inactive.
     */
    static async resolveBrand(workspaceId: string, requestBrandId?: string): Promise<string> {
        if (requestBrandId) {
            // Explicit Brand Resolution
            const brand = await prisma.brand.findUnique({
                where: { id: requestBrandId }
            });

            if (!brand) {
                throw new Error('BRAND_NOT_FOUND');
            }

            if (brand.workspace_id !== workspaceId) {
                throw new Error('BRAND_WORKSPACE_MISMATCH');
            }

            if (brand.status !== 'ACTIVE') {
                throw new Error('BRAND_NOT_ACTIVE');
            }

            return brand.id;
        } else {
            // Default Brand Resolution (Fallback)
            // We assume 1 Default Brand per Workspace for Phase 33.
            // In future, this might need more specific logic (e.g. "Primary" flag).
            // For now, we fetch the first created active brand or look for specific convention if we had one.
            // But better: we Backfilled "Default Brand".
            // Since we didn't add a "is_default" flag, we can lookup by name or simply take the first one.
            // Safety: To be deterministic, order by created_at.

            const brand = await prisma.brand.findFirst({
                where: {
                    workspace_id: workspaceId,
                    status: 'ACTIVE'
                },
                orderBy: { created_at: 'asc' }
            });

            if (!brand) {
                // Should not happen if backfill worked, but safety first.
                throw new Error('BRAND_DEFAULT_MISSING');
            }

            return brand.id;
        }
    }
}
