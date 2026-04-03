export interface NormalizationResult {
    ok: boolean;
    normalizedText: string;
    normalizationStatus: string;
    skipReason?: string;
}

export interface LeadPipelineAudit {
    decision: string;
    normalization_status: string;
    ai_invoked: boolean;
    ai_completed_at: string | null;
    skip_reason: string | null;
    error_reason: string | null;
    model_result_raw: any;
    updated_at: string;
}

const TERMINAL_DECISION_PATTERN = /^(QUALIFIED_LEAD|FILTERED_OUT|SKIPPED_[A-Z0-9_]+|ERROR_[A-Z0-9_]+)$/;

export function normalizeCommentForAi(input: unknown): NormalizationResult {
    if (typeof input !== 'string') {
        return {
            ok: false,
            normalizedText: '',
            normalizationStatus: 'MALFORMED_NORMALIZATION',
            skipReason: 'MALFORMED_TEXT'
        };
    }

    const normalized = input.replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return {
            ok: false,
            normalizedText: '',
            normalizationStatus: 'EMPTY_NORMALIZATION',
            skipReason: 'EMPTY_TEXT'
        };
    }

    return {
        ok: true,
        normalizedText: normalized,
        normalizationStatus: 'NORMALIZED'
    };
}

function sanitizeReason(reason: string): string {
    return reason
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
}

export function buildDecision(kind: 'QUALIFIED_LEAD' | 'FILTERED_OUT' | 'SKIPPED' | 'ERROR', reason?: string | null): string {
    if (kind === 'QUALIFIED_LEAD' || kind === 'FILTERED_OUT') {
        return kind;
    }

    const cleaned = sanitizeReason(reason || 'UNKNOWN');
    return `${kind}_${cleaned}`;
}

export function inferSkipReasonFromBrain(resp: any): string | null {
    const trace = (resp?.policy_decisions as any)?.trace || {};
    const explanation = String((resp?.policy_decisions as any)?.explanation || '');
    const strategy = String((resp?.payload as any)?.strategy || '');

    if (trace?.cap_reason) return 'OWNER_CAP';
    if (trace?.mode === 'OBSERVE_ONLY') return 'OWNER_OBSERVE_ONLY';
    if (explanation.includes('Safety Pre-Check Failed')) return 'SAFETY_PRECHECK';
    if (explanation.includes('Safety Post-Check')) return 'SAFETY_POSTCHECK';
    if (strategy === 'IGNORE' && !trace?.intent?.intent) return 'POLICY_IGNORE';

    return null;
}

export function extractTerminalDecision(meta: Record<string, any>): string | null {
    const direct = meta?.lead_pipeline_outcome?.decision;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();

    const qualification = meta?.qualification_outcome?.result;
    if (typeof qualification === 'string' && qualification.trim()) return qualification.trim();

    const valueOutcome = meta?.value_outcome?.result;
    if (typeof valueOutcome === 'string' && valueOutcome.trim()) return valueOutcome.trim();

    return null;
}

export function isDeterministicTerminalDecision(decision: string | null | undefined): boolean {
    if (!decision) return false;
    return TERMINAL_DECISION_PATTERN.test(decision.trim().toUpperCase());
}

export function hasTerminalDecision(meta: Record<string, any>): boolean {
    return isDeterministicTerminalDecision(extractTerminalDecision(meta));
}
