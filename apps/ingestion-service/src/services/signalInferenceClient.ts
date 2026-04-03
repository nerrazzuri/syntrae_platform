import { DetectedSignal, EngagementIntent, IntentCategory } from './brain/types';

export interface InferenceRequest {
    text: string;
    existing_signals: DetectedSignal[];
}

export interface InferenceResponse {
    inferred_signals?: Array<{ type: string; confidence: number }>;
    intent_hint?: string;
    intent_category?: string;
    intent_confidence?: number;
}

export interface InferenceResult {
    inferredSignals: DetectedSignal[];
    intentHint?: EngagementIntent;
    intentCategory?: IntentCategory;
    intentConfidence?: number;
}

export class SignalInferenceClient {
    private baseUrl: string;
    private timeoutMs: number = 60000;

    constructor() {
        this.baseUrl = process.env.AI_CORE_BASE_URL || process.env.AI_CORE_URL || 'http://localhost:8000';
    }

    async inferSignals(text: string, existingSignals: DetectedSignal[], context?: any): Promise<InferenceResult> {
        const url = `${this.baseUrl}/v1/internal/signal-inference`;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Internal-Secret': process.env.AI_CORE_INTERNAL_SECRET || '',
                    'X-Tenant-Id': context?.account_id || context?.workspaceId || 'system'
                },
                body: JSON.stringify({
                    text,
                    existing_signals: existingSignals,
                    language: context?.language || 'en',
                    domain: context?.platform || 'unknown',
                    context
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                console.warn(`[SignalInference] Failed: ${response.status} ${response.statusText}`);
                return { inferredSignals: [] };
            }

            const data = await response.json() as InferenceResponse;

            const rawSignals = Array.isArray(data.inferred_signals) ? data.inferred_signals : [];

            // Adapter: AI-Core Types -> Brain Categories
            const inferredSignals = rawSignals.map((s: any) => {
                let category: any = 'CONTEXT'; // Default
                let signal = s.type ? s.type.toLowerCase() : 'unknown';

                // Heuristic Mapping
                if (s.type === 'VALUE_EVALUATION') {
                    category = 'ATTRIBUTE';
                    signal = 'value'; // Triggers Latent Purchase if Conditional present
                } else if (s.type === 'COST_BENEFIT_HESITATION') {
                    category = 'CONDITIONAL';
                    signal = 'hesitation';
                } else if (s.type === 'SIZE_FIT_ISSUE') {
                    category = 'ATTRIBUTE';
                    signal = 'size';
                } else if (s.type === 'AESTHETIC_PREFERENCE') {
                    category = 'PREFERENCE';
                    signal = 'aesthetic';
                }

                return {
                    category: category,
                    signal: signal,
                    id: `ai_${signal}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`
                } as DetectedSignal;
            });

            const intentHint = this.mapIntentHint(data.intent_hint);
            const intentCategory = this.mapIntentCategory(data.intent_category);
            const intentConfidence = typeof data.intent_confidence === 'number'
                ? Math.max(0, Math.min(1, data.intent_confidence))
                : undefined;

            return {
                inferredSignals,
                intentHint,
                intentCategory,
                intentConfidence
            };

        } catch (err: any) {
            // SILENT FAIL (Logs only)
            if (err.name === 'AbortError') {
                console.warn(`[SignalInference] Timeout exceeded (${this.timeoutMs}ms)`);
            } else {
                console.warn(`[SignalInference] Network Error: ${err.message}`);
            }
            return { inferredSignals: [] };
        }
    }

    private mapIntentHint(raw?: string): EngagementIntent | undefined {
        const allowed: EngagementIntent[] = [
            'NOISE',
            'UNKNOWN',
            'PRODUCT_INQUIRY',
            'PROBLEM_SOLUTION',
            'FIT_SUITABILITY',
            'LATENT_PURCHASE',
            'POST_PURCHASE_REGRET'
        ];

        if (!raw) return undefined;
        return allowed.includes(raw as EngagementIntent) ? (raw as EngagementIntent) : undefined;
    }

    private mapIntentCategory(raw?: string): IntentCategory | undefined {
        const allowed: IntentCategory[] = ['high intent', 'mid intent', 'low intent', 'junk'];
        if (!raw) return undefined;
        const normalized = raw.trim().toLowerCase() as IntentCategory;
        return allowed.includes(normalized) ? normalized : undefined;
    }
}

export const signalInferenceClient = new SignalInferenceClient();
