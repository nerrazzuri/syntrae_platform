import { prisma, ProductCatalogStatus } from '../db';

type CatalogList = string[];

export interface CatalogItemInput {
    name?: string;
    category?: string | null;
    description?: string;
    price_label?: string | null;
    target_buyer?: string | null;
    key_benefits?: CatalogList;
    common_objections?: CatalogList;
    cta_url?: string | null;
    cta_label?: string | null;
    availability_status?: string | null;
    forbidden_claims?: CatalogList;
    priority?: number | null;
    status?: ProductCatalogStatus;
}

function text(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const clean = value.trim();
    return clean.length > 0 ? clean : null;
}

function list(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => text(item))
        .filter((item): item is string => Boolean(item))
        .slice(0, 20);
}

function priority(value: unknown): number {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(100, Math.round(num)));
}

async function assertBrand(workspaceId: string, brandId: string) {
    const brand = await prisma.brand.findFirst({
        where: {
            id: brandId,
            workspace_id: workspaceId,
        },
        select: {
            id: true,
            workspace_id: true,
        },
    });

    if (!brand) {
        throw new Error('Brand not found or access denied');
    }

    return brand;
}

function buildWritePayload(input: CatalogItemInput, partial = false) {
    const payload: Record<string, any> = {};

    if (!partial || input.name !== undefined) {
        const name = text(input.name);
        if (!name) throw new Error('Catalog item name is required');
        payload.name = name;
    }

    if (!partial || input.description !== undefined) {
        const description = text(input.description);
        if (!description) throw new Error('Catalog item description is required');
        payload.description = description;
    }

    if (!partial || input.category !== undefined) payload.category = text(input.category);
    if (!partial || input.price_label !== undefined) payload.price_label = text(input.price_label);
    if (!partial || input.target_buyer !== undefined) payload.target_buyer = text(input.target_buyer);
    if (!partial || input.cta_url !== undefined) payload.cta_url = text(input.cta_url);
    if (!partial || input.cta_label !== undefined) payload.cta_label = text(input.cta_label);
    if (!partial || input.availability_status !== undefined) {
        payload.availability_status = text(input.availability_status) || 'AVAILABLE';
    }
    if (!partial || input.key_benefits !== undefined) payload.key_benefits = list(input.key_benefits);
    if (!partial || input.common_objections !== undefined) payload.common_objections = list(input.common_objections);
    if (!partial || input.forbidden_claims !== undefined) payload.forbidden_claims = list(input.forbidden_claims);
    if (!partial || input.priority !== undefined) payload.priority = priority(input.priority);

    if (input.status !== undefined) {
        if (![ProductCatalogStatus.ACTIVE, ProductCatalogStatus.REVIEW_PENDING, ProductCatalogStatus.ARCHIVED].includes(input.status)) {
            throw new Error('Invalid catalog status');
        }
        payload.status = input.status;
    }

    return payload;
}

export class CatalogService {
    static async listItems(workspaceId: string, brandId: string) {
        await assertBrand(workspaceId, brandId);

        return prisma.productCatalogItem.findMany({
            where: {
                workspace_id: workspaceId,
                brand_id: brandId,
                status: { not: ProductCatalogStatus.ARCHIVED },
            },
            orderBy: [
                { priority: 'desc' },
                { updated_at: 'desc' },
            ],
        });
    }

    static async createItem(workspaceId: string, brandId: string, input: CatalogItemInput) {
        await assertBrand(workspaceId, brandId);
        const payload = buildWritePayload(input);

        return prisma.productCatalogItem.create({
            data: {
                workspace_id: workspaceId,
                brand_id: brandId,
                name: payload.name,
                description: payload.description,
                category: payload.category,
                price_label: payload.price_label,
                target_buyer: payload.target_buyer,
                key_benefits: payload.key_benefits,
                common_objections: payload.common_objections,
                cta_url: payload.cta_url,
                cta_label: payload.cta_label,
                availability_status: payload.availability_status,
                forbidden_claims: payload.forbidden_claims,
                priority: payload.priority,
                status: payload.status || ProductCatalogStatus.ACTIVE,
                metadata: {},
            } as any,
        });
    }

    static async updateItem(workspaceId: string, brandId: string, itemId: string, input: CatalogItemInput) {
        await assertBrand(workspaceId, brandId);

        const item = await prisma.productCatalogItem.findFirst({
            where: {
                id: itemId,
                workspace_id: workspaceId,
                brand_id: brandId,
            },
            select: { id: true },
        });

        if (!item) throw new Error('Catalog item not found or access denied');

        return prisma.productCatalogItem.update({
            where: { id: itemId },
            data: buildWritePayload(input, true),
        });
    }

    static async archiveItem(workspaceId: string, brandId: string, itemId: string) {
        return this.updateItem(workspaceId, brandId, itemId, {
            status: ProductCatalogStatus.ARCHIVED,
        });
    }

    static async activateItem(workspaceId: string, brandId: string, itemId: string) {
        return this.updateItem(workspaceId, brandId, itemId, {
            status: ProductCatalogStatus.ACTIVE,
        });
    }
}
