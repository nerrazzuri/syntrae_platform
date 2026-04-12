import { prisma, ProductCatalogDocumentStatus, ProductCatalogStatus } from '../db';

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

function normalizeSearchText(value: unknown): string {
    return String(value || '')
        .toLowerCase()
        .replace(/<[^>]+>/g, ' ')
        .replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractSearchTerms(value: unknown): string[] {
    const normalized = normalizeSearchText(value);
    if (!normalized) return [];

    const asciiTerms = normalized
        .split(' ')
        .map((term) => term.trim())
        .filter((term) => term.length >= 2);

    const cjkRuns = normalized.match(/[\u3400-\u9fff]{2,}/g) || [];
    const cjkTerms = cjkRuns.flatMap((run) => {
        const parts: string[] = [run];
        if (run.length <= 2) return parts;
        for (let i = 0; i <= run.length - 2; i += 1) {
            parts.push(run.slice(i, i + 2));
        }
        return parts;
    });

    return Array.from(new Set([...asciiTerms, ...cjkTerms])).slice(0, 40);
}

function compactList(value: unknown): string[] {
    return list(value).slice(0, 6);
}

function buildItemContent(item: any): string {
    const parts = [
        text(item.name),
        text(item.category),
        text(item.description),
        ...compactList(item.key_benefits),
        text(item.target_buyer),
        text(item.price_label),
    ].filter(Boolean);
    return parts.join(' | ');
}

function itemSearchText(item: any): string {
    const metadata = (item?.metadata && typeof item.metadata === 'object') ? item.metadata as Record<string, unknown> : {};
    const parts = [
        text(item.name),
        text(item.category),
        text(item.description),
        text(item.target_buyer),
        text(item.price_label),
        ...compactList(item.key_benefits),
        ...compactList(item.common_objections),
        text(metadata.product),
        text(metadata.compatible_device),
        text(metadata.sku),
        text(metadata.hook),
        text(metadata.use_case),
    ].filter(Boolean);
    return normalizeSearchText(parts.join(' '));
}

function fieldSearchTexts(item: any): Record<string, string> {
    const metadata = (item?.metadata && typeof item.metadata === 'object') ? item.metadata as Record<string, unknown> : {};
    return {
        name: normalizeSearchText(text(item?.name) || ''),
        category: normalizeSearchText(text(item?.category) || text(metadata.product) || ''),
        description: normalizeSearchText(text(item?.description) || ''),
        target: normalizeSearchText(text(item?.target_buyer) || ''),
        metadata: normalizeSearchText([
            text(metadata.compatible_device),
            text(metadata.use_case),
            text(metadata.hook),
            text(metadata.audience),
            text(metadata.aliases),
            text(metadata.constraints),
            text(metadata.symptoms),
            text(metadata.service_area),
            text(metadata.material),
            text(metadata.variant),
        ].filter(Boolean).join(' ')),
        benefits: normalizeSearchText(compactList(item?.key_benefits).join(' ')),
        objections: normalizeSearchText(compactList(item?.common_objections).join(' ')),
        full: itemSearchText(item),
    };
}

function highSignalTerms(terms: string[]): string[] {
    return terms.filter((term) => {
        if (/[\u3400-\u9fff]/.test(term)) return term.length >= 2;
        if (/\d/.test(term)) return term.length >= 2;
        return term.length >= 4;
    });
}

function scoreTermHits(terms: string[], haystack: string): number {
    let score = 0;
    for (const term of terms) {
        if (!term || !haystack.includes(term)) continue;
        if (/[\u3400-\u9fff]/.test(term)) {
            score += term.length >= 4 ? 2.4 : 1.4;
        } else if (term.length >= 6) {
            score += 2.0;
        } else if (term.length >= 4) {
            score += 1.4;
        } else {
            score += 0.8;
        }
    }
    return score;
}

function scoreCatalogItem(item: any, queryTerms: string[]): number {
    const fields = fieldSearchTexts(item);
    if (!fields.full) return 0;
    const specificTerms = highSignalTerms(queryTerms);

    let score = 0;
    score += scoreTermHits(queryTerms, fields.name) * 3.2;
    score += scoreTermHits(queryTerms, fields.category) * 2.4;
    score += scoreTermHits(queryTerms, fields.metadata) * 2.8;
    score += scoreTermHits(queryTerms, fields.target) * 1.8;
    score += scoreTermHits(queryTerms, fields.benefits) * 1.3;
    score += scoreTermHits(queryTerms, fields.description) * 1.1;
    score += scoreTermHits(queryTerms, fields.full) * 0.8;

    const specificHitCount = specificTerms.filter((term) => fields.full.includes(term)).length;
    score += specificHitCount * 2.4;

    if (specificTerms.length > 0 && specificHitCount === 0) {
        score -= 3;
    }

    score += normalizePriority(item?.priority) / 100;
    return score;
}

function serializeRerankCandidate(item: any) {
    return {
        id: item.id,
        name: item.name,
        category: item.category,
        description: item.description,
        target_buyer: item.target_buyer,
        price_label: item.price_label,
        key_benefits: compactList(item.key_benefits),
        common_objections: compactList(item.common_objections),
        metadata: item.metadata || {},
    };
}

function orderByRerankedIds(items: any[], rankedIds: string[], limit: number) {
    const byId = new Map(items.map((item) => [String(item.id), item]));
    const ordered: any[] = [];
    const seen = new Set<string>();

    for (const id of rankedIds) {
        const match = byId.get(String(id));
        if (!match) continue;
        ordered.push(match);
        seen.add(String(id));
        if (ordered.length >= limit) return ordered;
    }

    for (const item of items) {
        const id = String(item.id);
        if (seen.has(id)) continue;
        ordered.push(item);
        if (ordered.length >= limit) break;
    }

    return ordered;
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
                status: { in: [ProductCatalogStatus.ACTIVE, ProductCatalogStatus.REVIEW_PENDING] },
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
                status: ProductCatalogStatus.ACTIVE,
                metadata: {
                    ...(candidate.metadata || {}),
                    import_source: String((candidate.metadata || {}).import_source || 'document_import'),
                    catalog_document_id: documentId,
                    review_required: false,
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

        const catalogItems = await prisma.productCatalogItem.findMany({
            where: {
                workspace_id: workspaceId,
                brand_id: brandId,
                status: { in: [ProductCatalogStatus.ACTIVE, ProductCatalogStatus.REVIEW_PENDING] },
            },
            orderBy: [
                { priority: 'desc' },
                { updated_at: 'desc' },
            ],
            take: 200,
        });

        if (catalogItems.length === 0) return [];

        const aiCoreUrl = process.env.AI_CORE_BASE_URL || 'http://ai-core:8000';
        const secret = process.env.AI_CORE_INTERNAL_SECRET;
        const queryTerms = extractSearchTerms(trimmed);
        const heuristicRanked = catalogItems
            .map((item) => ({
                item,
                score: scoreCatalogItem(item, queryTerms),
            }))
            .filter((entry) => entry.score > 0.5)
            .sort((left, right) => {
                if (right.score !== left.score) return right.score - left.score;
                return normalizePriority(right.item.priority) - normalizePriority(left.item.priority);
            });

        const shortlist = (
            heuristicRanked.length > 0 ? heuristicRanked.map((entry) => entry.item) : catalogItems
        ).slice(0, catalogItems.length <= 80 ? 80 : 40);

        let orderedItems = shortlist;
        if (secret && shortlist.length > 1) {
            const response = await fetch(`${aiCoreUrl}/v1/internal/catalog/rerank`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Internal-Secret': secret,
                    'X-Account-Id': workspaceId,
                },
                body: JSON.stringify({
                    account_id: workspaceId,
                    query: trimmed,
                    limit: Math.max(1, Math.min(limit, 3)),
                    candidates: shortlist.map(serializeRerankCandidate),
                }),
            });

            const payload = await response.json().catch(() => ({}));
            if (response.ok && Array.isArray(payload.ranked_ids)) {
                orderedItems = orderByRerankedIds(shortlist, payload.ranked_ids, Math.max(1, Math.min(limit, 3)));
            }
        }

        const fallbackLimited = heuristicRanked.slice(0, Math.max(1, Math.min(limit, 3))).map((entry) => entry.item);
        const finalItems = (orderedItems.length > 0 ? orderedItems : fallbackLimited).slice(0, Math.max(1, Math.min(limit, 3)));

        return finalItems.map((item) => ({
            id: item.id,
            name: item.name,
            category: item.category,
            description: item.description,
            price_label: item.price_label,
            target_buyer: item.target_buyer,
            key_benefits: compactList(item.key_benefits),
            common_objections: compactList(item.common_objections),
            cta_url: item.cta_url,
            cta_label: item.cta_label,
            availability_status: item.availability_status,
            priority: item.priority,
            content: buildItemContent(item),
            score: scoreCatalogItem(item, queryTerms),
            meta: item.metadata || {},
        }));
    }
}
