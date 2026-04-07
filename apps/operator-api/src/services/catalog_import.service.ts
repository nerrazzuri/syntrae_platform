import { prisma, ProductCatalogDocumentStatus } from '../db';

type ImportedCatalogCandidate = {
    name?: string | null;
    category?: string | null;
    description?: string | null;
    price_label?: string | null;
    target_buyer?: string | null;
    key_benefits?: string[] | null;
    common_objections?: string[] | null;
    cta_url?: string | null;
    cta_label?: string | null;
    availability_status?: string | null;
    forbidden_claims?: string[] | null;
    priority?: number | null;
    metadata?: Record<string, unknown> | null;
};

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

function normalizePriority(value: unknown): number {
    const num = Number(value ?? 50);
    if (!Number.isFinite(num)) return 50;
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
            name: true,
        },
    });

    if (!brand) {
        throw new Error('Brand not found or access denied');
    }

    return brand;
}

async function createImportedCatalogItems(workspaceId: string, brandId: string, candidates: ImportedCatalogCandidate[], documentId: string) {
    let created = 0;
    for (const candidate of candidates.slice(0, 50)) {
        const name = text(candidate.name);
        const description = text(candidate.description);
        if (!name || !description) continue;

        const existing = await prisma.productCatalogItem.findFirst({
            where: {
                workspace_id: workspaceId,
                brand_id: brandId,
                status: 'ACTIVE',
                name: { equals: name, mode: 'insensitive' },
            },
            select: { id: true },
        });

        if (existing) continue;

        await prisma.productCatalogItem.create({
            data: {
                workspace_id: workspaceId,
                brand_id: brandId,
                name,
                category: text(candidate.category),
                description,
                price_label: text(candidate.price_label),
                target_buyer: text(candidate.target_buyer),
                key_benefits: list(candidate.key_benefits),
                common_objections: list(candidate.common_objections),
                cta_url: text(candidate.cta_url),
                cta_label: text(candidate.cta_label),
                availability_status: text(candidate.availability_status) || 'AVAILABLE',
                forbidden_claims: list(candidate.forbidden_claims),
                priority: normalizePriority(candidate.priority),
                metadata: {
                    ...(candidate.metadata || {}),
                    import_source: 'document_import',
                    catalog_document_id: documentId,
                },
            } as any,
        });
        created += 1;
    }

    return created;
}

export class CatalogImportService {
    static async listDocuments(workspaceId: string, brandId: string) {
        await assertBrand(workspaceId, brandId);

        return prisma.productCatalogDocument.findMany({
            where: {
                workspace_id: workspaceId,
                brand_id: brandId,
                status: { not: ProductCatalogDocumentStatus.ARCHIVED },
            },
            orderBy: { created_at: 'desc' },
        });
    }

    static async importDocument(
        workspaceId: string,
        brandId: string,
        params: {
            title: string;
            sourceType?: string;
            file: {
                buffer: Buffer;
                originalname: string;
                mimetype?: string;
                size?: number;
            };
        }
    ) {
        await assertBrand(workspaceId, brandId);

        const title = text(params.title);
        if (!title) throw new Error('Import title is required');
        if (!params.file?.buffer?.length) throw new Error('Import file is required');

        const aiCoreUrl = process.env.AI_CORE_BASE_URL || 'http://ai-core:8000';
        const secret = process.env.AI_CORE_INTERNAL_SECRET;
        if (!secret) throw new Error('AI core secret is not configured');

        const form = new FormData();
        form.append('account_id', workspaceId);
        form.append('brand_id', brandId);
        form.append('title', title);
        form.append('source_type', params.sourceType || 'FILE');
        form.append(
            'file',
            new Blob([new Uint8Array(params.file.buffer)], {
                type: params.file.mimetype || 'application/octet-stream',
            }),
            params.file.originalname || 'catalog-upload'
        );

        const response = await fetch(`${aiCoreUrl}/v1/internal/catalog/import`, {
            method: 'POST',
            headers: {
                'X-Internal-Secret': secret,
                'X-Account-Id': workspaceId,
            },
            body: form,
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(String(payload?.detail || payload?.error || 'Catalog import failed'));
        }

        const document = await prisma.productCatalogDocument.create({
            data: {
                workspace_id: workspaceId,
                brand_id: brandId,
                title,
                original_filename: params.file.originalname,
                mime_type: params.file.mimetype || null,
                source_type: params.sourceType || 'FILE',
                file_size_bytes: params.file.size || params.file.buffer.length,
                ai_core_document_id: text(payload.documentId),
                ai_core_chunk_count: Number.isFinite(Number(payload.chunkCount)) ? Number(payload.chunkCount) : null,
                preview_text: text(payload.previewText),
                status: ProductCatalogDocumentStatus.IMPORTED,
                metadata: {
                    import_candidates: Array.isArray(payload.candidates) ? payload.candidates.length : 0,
                },
            } as any,
        });

        const importedItemCount = Array.isArray(payload.candidates)
            ? await createImportedCatalogItems(workspaceId, brandId, payload.candidates, document.id)
            : 0;

        return {
            document,
            imported_item_count: importedItemCount,
        };
    }

    static async archiveDocument(workspaceId: string, brandId: string, documentId: string) {
        await assertBrand(workspaceId, brandId);
        const doc = await prisma.productCatalogDocument.findFirst({
            where: {
                id: documentId,
                workspace_id: workspaceId,
                brand_id: brandId,
            },
            select: { id: true },
        });

        if (!doc) throw new Error('Imported document not found or access denied');

        return prisma.productCatalogDocument.update({
            where: { id: documentId },
            data: { status: ProductCatalogDocumentStatus.ARCHIVED },
        });
    }

    static async searchKnowledge(workspaceId: string, brandId: string, query: string, limit = 4) {
        await assertBrand(workspaceId, brandId);
        const trimmed = query.trim();
        if (!trimmed) return [];

        const aiCoreUrl = process.env.AI_CORE_BASE_URL || 'http://ai-core:8000';
        const secret = process.env.AI_CORE_INTERNAL_SECRET;
        if (!secret) return [];

        const response = await fetch(`${aiCoreUrl}/v1/internal/catalog/search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Internal-Secret': secret,
                'X-Account-Id': workspaceId,
            },
            body: JSON.stringify({
                account_id: workspaceId,
                brand_id: brandId,
                query: trimmed,
                limit,
            }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            return [];
        }
        return Array.isArray(payload.items) ? payload.items : [];
    }
}
