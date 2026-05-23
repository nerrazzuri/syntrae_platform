import { prisma } from '../db';

type DbLike = any;

export interface MineDraftEditsInput {
    db?: DbLike;
    accountId: string;
    brandId?: string | null;
    platform?: string | null;
    minOccurrences?: number;
    dryRun?: boolean;
}

type PhraseInsight = {
    phrase: string;
    count: number;
    source_feedback_ids: string[];
};

type CandidateDraft = {
    account_id: string;
    brand_id: string | null;
    platform: string | null;
    learning_suggestion_id: string | null;
    learning_apply_plan_id: string | null;
    candidate_type: string;
    status: 'PENDING';
    title: string;
    description: string;
    candidate_payload: Record<string, any>;
    source_feedback_ids: string[];
    risk_level: string;
    created_by: 'SYSTEM';
    metadata: Record<string, any>;
};

const AI_PHRASES = [
    '当然可以',
    '当然啦',
    '非常感谢你的问题',
    '很高兴为你解答',
    '我理解你的感受',
    '完全理解',
    '欢迎访问',
    '探索更多选择',
    '如果你有兴趣',
    '我们可以聊聊',
    '帮你找到最合适的款式',
    '希望能帮助到你',
    '如有任何疑问',
    'Of course',
    'Great question',
    'Happy to help',
    'Thank you for reaching out',
    'I understand your concern',
    'feel free to contact us',
];

const CTA_PHRASES = [
    '欢迎访问我们的店铺',
    '可以到我们店铺看看',
    '点击链接',
    '私信我们',
    '下单',
    '购买',
    'shop now',
    'visit our store',
    'check out our store',
];

const QUESTION_PHRASES = [
    '可以具体描述一下',
    '分享一下你平时的风格吗',
    '你希望找到更适合你脸型的吗',
    '想了解更多吗',
    'would you like to know more',
];

function cleanString(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
}

function requireAccountId(value: unknown): string {
    const accountId = cleanString(value);
    if (!accountId) {
        throw new Error('accountId is required');
    }
    return accountId;
}

function minOccurrenceCount(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 3;
    return Math.max(1, Math.floor(parsed));
}

function isPlainObject(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeForMatch(value: string) {
    return value.toLowerCase();
}

function containsPhrase(text: string, phrase: string) {
    return normalizeForMatch(text).includes(normalizeForMatch(phrase));
}

function editedText(row: any) {
    return cleanString(row.final_sent_text) || cleanString(row.human_edited_text) || '';
}

function meaningfulRows(rows: any[]) {
    return rows.filter((row) =>
        cleanString(row.original_draft_text) && editedText(row),
    );
}

function countRemovedPhrases(rows: any[], phrases: string[]): PhraseInsight[] {
    const counts = new Map<string, Set<string>>();
    for (const row of rows) {
        const original = cleanString(row.original_draft_text) || '';
        const edited = editedText(row);
        for (const phrase of phrases) {
            if (containsPhrase(original, phrase) && !containsPhrase(edited, phrase)) {
                if (!counts.has(phrase)) counts.set(phrase, new Set());
                counts.get(phrase)!.add(String(row.id));
            }
        }
    }
    return Array.from(counts.entries()).map(([phrase, ids]) => ({
        phrase,
        count: ids.size,
        source_feedback_ids: Array.from(ids),
    }));
}

function filteredInsights(insights: PhraseInsight[], minOccurrences: number) {
    return insights
        .filter((insight) => insight.count >= minOccurrences)
        .sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase));
}

function lengthValue(text: string) {
    const compact = text.replace(/\s+/g, '');
    return compact.length;
}

function shortenedRows(rows: any[]) {
    return rows.filter((row) => {
        const originalLength = lengthValue(cleanString(row.original_draft_text) || '');
        const editedLength = lengthValue(editedText(row));
        return originalLength >= 20 && editedLength > 0 && editedLength <= originalLength * 0.65;
    });
}

function uniqueStrings(values: string[]) {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const cleaned = cleanString(value);
        if (!cleaned) continue;
        const key = cleaned.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            result.push(cleaned);
        }
    }
    return result;
}

function extractNameCandidates(row: any) {
    const meta = isPlainObject(row.generation_meta) ? row.generation_meta : {};
    const metadata = isPlainObject(row.metadata) ? row.metadata : {};
    const productContext = isPlainObject(meta.product_context) ? meta.product_context : {};
    return uniqueStrings([
        meta.brand_name,
        meta.product_name,
        productContext.name,
        productContext.product_name,
        metadata.brand_name,
        metadata.product_name,
    ]);
}

function directAnswerRows(rows: any[]) {
    return rows.filter((row) => {
        const original = cleanString(row.original_draft_text) || '';
        const edited = editedText(row);
        return extractNameCandidates(row).some((name) =>
            !containsPhrase(original, name) && containsPhrase(edited, name),
        );
    });
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value as Record<string, unknown>)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function evidenceSignature(candidate: Omit<CandidateDraft, 'metadata'>) {
    return stableStringify({
        account_id: candidate.account_id,
        brand_id: candidate.brand_id,
        platform: candidate.platform,
        candidate_type: candidate.candidate_type,
        title: candidate.title,
        payload: candidate.candidate_payload,
        source_feedback_ids: candidate.source_feedback_ids,
    });
}

function makeCandidateDraft(input: {
    accountId: string;
    brandId: string | null;
    platform: string | null;
    candidateType: string;
    title: string;
    description: string;
    candidatePayload: Record<string, any>;
    sourceFeedbackIds: string[];
    riskLevel: string;
}) {
    const withoutMetadata = {
        account_id: input.accountId,
        brand_id: input.brandId,
        platform: input.platform,
        learning_suggestion_id: null,
        learning_apply_plan_id: null,
        candidate_type: input.candidateType,
        status: 'PENDING' as const,
        title: input.title,
        description: input.description,
        candidate_payload: input.candidatePayload,
        source_feedback_ids: input.sourceFeedbackIds,
        risk_level: input.riskLevel,
        created_by: 'SYSTEM' as const,
    };
    return {
        ...withoutMetadata,
        metadata: {
            evidence_signature: evidenceSignature(withoutMetadata),
            source: 'draft_edit_mining',
        },
    };
}

function buildCandidateDrafts(input: {
    accountId: string;
    brandId: string | null;
    platform: string | null;
    minOccurrences: number;
    removedAiPhrases: PhraseInsight[];
    removedCtaPhrases: PhraseInsight[];
    removedQuestions: PhraseInsight[];
    shortenedSourceIds: string[];
    directAnswerSourceIds: string[];
}) {
    const drafts: CandidateDraft[] = [];
    for (const insight of input.removedAiPhrases) {
        drafts.push(makeCandidateDraft({
            accountId: input.accountId,
            brandId: input.brandId,
            platform: input.platform,
            candidateType: 'BANNED_PHRASE',
            title: `Review repeated AI phrase: ${insight.phrase}`,
            description: 'Inactive candidate from shop-owner edits that repeatedly removed an AI/customer-service phrase.',
            candidatePayload: {
                target: 'customer_service_banned_phrases',
                phrase: insight.phrase,
                evidence_count: insight.count,
                requires_code_change: true,
            },
            sourceFeedbackIds: insight.source_feedback_ids,
            riskLevel: 'low',
        }));
    }

    for (const insight of input.removedCtaPhrases) {
        drafts.push(makeCandidateDraft({
            accountId: input.accountId,
            brandId: input.brandId,
            platform: input.platform,
            candidateType: 'DRAFT_QC_TEST_CASE',
            title: 'Review CTA removal pattern',
            description: 'Inactive candidate from shop-owner edits that removed CTA language.',
            candidatePayload: {
                target: 'cta_gating',
                removed_phrase: insight.phrase,
                evidence_count: insight.count,
                expected_behavior: 'avoid CTA unless should_redirect=true',
                requires_code_change: true,
            },
            sourceFeedbackIds: insight.source_feedback_ids,
            riskLevel: 'medium',
        }));
    }

    if (input.shortenedSourceIds.length >= input.minOccurrences) {
        drafts.push(makeCandidateDraft({
            accountId: input.accountId,
            brandId: input.brandId,
            platform: input.platform,
            candidateType: 'STYLE_GUIDANCE',
            title: 'Review shortened reply style pattern',
            description: 'Inactive candidate from repeated edits that significantly shortened AI replies.',
            candidatePayload: {
                target: 'reply_style_guidance',
                candidate_guidance: 'Prefer shorter direct replies for this brand/platform.',
                evidence_count: input.shortenedSourceIds.length,
                requires_code_change: true,
            },
            sourceFeedbackIds: input.shortenedSourceIds,
            riskLevel: 'low',
        }));
    }

    for (const insight of input.removedQuestions) {
        drafts.push(makeCandidateDraft({
            accountId: input.accountId,
            brandId: input.brandId,
            platform: input.platform,
            candidateType: 'STYLE_GUIDANCE',
            title: 'Review unnecessary follow-up question pattern',
            description: 'Inactive candidate from shop-owner edits that removed follow-up questions before answering.',
            candidatePayload: {
                target: 'reply_style_guidance',
                removed_question: insight.phrase,
                evidence_count: insight.count,
                candidate_guidance: 'Avoid asking follow-up questions before answering the user.',
                requires_code_change: true,
            },
            sourceFeedbackIds: insight.source_feedback_ids,
            riskLevel: 'low',
        }));
    }

    if (input.directAnswerSourceIds.length >= input.minOccurrences) {
        drafts.push(makeCandidateDraft({
            accountId: input.accountId,
            brandId: input.brandId,
            platform: input.platform,
            candidateType: 'BRAND_PROFILE_HINT',
            title: 'Review direct brand/product answer pattern',
            description: 'Inactive candidate from edits that added direct brand or product answers.',
            candidatePayload: {
                target: 'brand_reply_profile',
                candidate_hint: 'Answer brand/product identity questions directly before asking follow-up.',
                evidence_count: input.directAnswerSourceIds.length,
                requires_code_change: false,
            },
            sourceFeedbackIds: input.directAnswerSourceIds,
            riskLevel: 'low',
        }));
    }

    return drafts;
}

async function hasPendingDuplicate(db: DbLike, candidate: CandidateDraft) {
    const rows = await db.applyCandidate.findMany({
        where: {
            account_id: candidate.account_id,
            candidate_type: candidate.candidate_type,
            status: 'PENDING',
        },
    });
    const signature = candidate.metadata.evidence_signature;
    return rows.some((row: any) => row?.metadata?.evidence_signature === signature);
}

export async function mineDraftEdits(input: MineDraftEditsInput) {
    const db = input.db || prisma;
    const accountId = requireAccountId(input.accountId);
    const brandId = cleanString(input.brandId);
    const platform = cleanString(input.platform);
    const minOccurrences = minOccurrenceCount(input.minOccurrences);
    const where: Record<string, any> = {
        account_id: accountId,
        feedback_type: 'EDITED_BEFORE_SEND',
    };
    if (brandId) where.brand_id = brandId;
    if (platform) where.platform = platform;

    const rows = await db.draftFeedback.findMany({
        where,
        orderBy: { created_at: 'desc' },
    });
    const analyzedRows = meaningfulRows(rows);
    const removedAiPhrases = filteredInsights(countRemovedPhrases(analyzedRows, AI_PHRASES), minOccurrences);
    const removedCtaPhrases = filteredInsights(countRemovedPhrases(analyzedRows, CTA_PHRASES), minOccurrences);
    const removedQuestions = filteredInsights(countRemovedPhrases(analyzedRows, QUESTION_PHRASES), minOccurrences);
    const shortened = shortenedRows(analyzedRows);
    const directAnswers = directAnswerRows(analyzedRows);
    const shortenedSourceIds = uniqueStrings(shortened.map((row) => row.id));
    const directAnswerSourceIds = uniqueStrings(directAnswers.map((row) => row.id));

    const candidateDrafts = buildCandidateDrafts({
        accountId,
        brandId,
        platform,
        minOccurrences,
        removedAiPhrases,
        removedCtaPhrases,
        removedQuestions,
        shortenedSourceIds,
        directAnswerSourceIds,
    });
    const candidates: any[] = [];
    let skippedDuplicateCount = 0;

    if (!input.dryRun) {
        for (const draft of candidateDrafts) {
            if (await hasPendingDuplicate(db, draft)) {
                skippedDuplicateCount += 1;
                continue;
            }
            candidates.push(await db.applyCandidate.create({ data: draft }));
        }
    }

    return {
        insights: {
            total_feedback: rows.length,
            analyzed_feedback: analyzedRows.length,
            min_occurrences: minOccurrences,
            removed_ai_phrases: removedAiPhrases,
            removed_cta_phrases: removedCtaPhrases,
            removed_unnecessary_questions: removedQuestions,
            shortened_reply_count: shortenedSourceIds.length,
            direct_answer_added_count: directAnswerSourceIds.length,
        },
        candidate_drafts: candidateDrafts,
        candidates,
        persisted_count: candidates.length,
        skipped_duplicate_count: skippedDuplicateCount,
    };
}
