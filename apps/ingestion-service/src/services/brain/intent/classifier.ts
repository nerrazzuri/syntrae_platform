import * as fs from 'fs';
import * as path from 'path';
import { EngagementIntent, IntentClassificationResult, SignalCategory, SignalDef, DetectedSignal, BuyerIntentStrength, IntentCategory } from '../types';
import { signalInferenceClient, InferenceResult } from '../../signalInferenceClient';

export class IntentClassifier {
    private signals: Map<SignalCategory, SignalDef[]> = new Map();
    private isReady: boolean = false;
    private static instance: IntentClassifier;

    constructor() {
        this.loadSignals();
    }

    public static getInstance(): IntentClassifier {
        if (!this.instance) {
            this.instance = new IntentClassifier();
        }
        return this.instance;
    }

    public static async classify(text: string, context?: any): Promise<IntentClassificationResult> {
        return this.getInstance().classify(text, context);
    }

    private loadSignals() {
        // Map filename to Category
        const categoryMap: Record<string, SignalCategory> = {
            'evaluative.json': 'EVALUATIVE',
            'context.json': 'CONTEXT',
            'attribute.json': 'ATTRIBUTE',
            'conditional.json': 'CONDITIONAL',
            'product_ref.json': 'PRODUCT_REF',
            'pronoun.json': 'PRONOUN',
            'problem.json': 'PROBLEM',
            'regret.json': 'REGRET',
            'interrogative_word.json': 'INTERROGATIVE_WORD',
            'interrogative_punct.json': 'INTERROGATIVE_PUNCT',
            'source.json': 'SOURCE',
            'praise.json': 'PRAISE',
            'social.json': 'SOCIAL',
            'hostile.json': 'HOSTILE',
            'preference.json': 'PREFERENCE',
            'usage_context.json': 'USAGE_CONTEXT'
        };

        const rulesDir = path.join(__dirname, 'signals', 'en');
        if (!fs.existsSync(rulesDir)) {
            console.warn(`[IntentClassifier] Signal directory not found: ${rulesDir}`);
            return;
        }

        try {
            const files = fs.readdirSync(rulesDir);
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                const category = categoryMap[file];
                if (!category) continue;

                const content = fs.readFileSync(path.join(rulesDir, file), 'utf-8');
                const defs: SignalDef[] = JSON.parse(content);
                this.signals.set(category, defs);
            }
            this.isReady = true;
            console.log(`[IntentClassifier] Loaded signals from ${files.length} files.`);
        } catch (err) {
            console.error('[IntentClassifier] Failed to load signals:', err);
        }
    }

    private normalize(text: string): string {
        return text.toLowerCase().trim();
    }

    public async classify(text: string, context?: any): Promise<IntentClassificationResult> {
        if (!this.isReady || !text) {
            return this.emptyResult();
        }

        const normalized = this.normalize(text);
        const isRednote = context?.platform === 'rednote';
        const rednoteHeuristic = isRednote
            ? this.classifyRednoteHeuristic(text, normalized)
            : null;

        const detectedSignals = this.scanSignals(normalized);

        // DEBUG LOGGING
        console.log(`[Classifier] Text: "${text}"`);
        console.log(`[Classifier] Signals: ${detectedSignals.map(s => `${s.category}:${s.signal}`).join(', ')}`);

        let composition = this.composeIntent(detectedSignals);
        console.log(`[Classifier] Intent (Initial): ${composition.intent}, Strength: ${composition.strength}`);

        console.log('[Classifier] Triggering AI-Core Signal Inference...');
        const start = Date.now();
        const inferred = await signalInferenceClient.inferSignals(text, detectedSignals, context);
        const aiClassification = this.tryUseAiClassification(
            detectedSignals,
            inferred,
            isRednote ? 'zh' : 'en'
        );

        if (aiClassification) {
            console.log(
                `[Classifier] AI classification accepted: ${aiClassification.intent}` +
                ` (${inferred.intentCategory ?? 'uncategorized'}, ${inferred.intentConfidence ?? 'n/a'})`
            );
            return aiClassification;
        }

        if (inferred.inferredSignals.length > 0) {
            console.log(`[Classifier] Inference Received (${Date.now() - start}ms): ${inferred.inferredSignals.map(s => s.signal).join(', ')}`);

            const ids = new Set(detectedSignals.map(s => s.id));
            let newSignalsAdded = false;
            for (const s of inferred.inferredSignals) {
                if (!ids.has(s.id)) {
                    detectedSignals.push(s);
                    ids.add(s.id);
                    newSignalsAdded = true;
                }
            }

            if (newSignalsAdded) {
                const newComposition = this.composeIntent(detectedSignals);
                console.log(`[Classifier] Intent (Post-Inference Fallback): ${newComposition.intent}`);
                composition = newComposition;
            }
        } else {
            console.log('[Classifier] No usable AI classification or signals. Falling back to heuristics.');
        }

        // Fallback only: if AI did not produce a usable intent for rednote,
        // keep a lightweight heuristic so obvious intent comments are still captured.
        if (isRednote && rednoteHeuristic) {
            console.log(`[Classifier] Rednote heuristic fallback matched: ${rednoteHeuristic.intent}`);
            return {
                ...rednoteHeuristic,
                confidence: 0.7
            };
        }

        return {
            intent: composition.intent,
            confidence: 1.0, // Deterministic
            detected_intents: [], // Deprecated
            strength: composition.strength,
            signals: detectedSignals,
            evidence: {
                matched_families: [],
                matched_signals: detectedSignals.map(s => s.signal),
                language: isRednote ? 'zh' : 'en',
                scores: {} as any
            }
        };
    }

    private tryUseAiClassification(
        detectedSignals: DetectedSignal[],
        inferred: InferenceResult,
        language: 'en' | 'zh'
    ): IntentClassificationResult | null {
        const aiIntent = inferred.intentHint;
        const aiCategory = inferred.intentCategory;
        const aiConfidence = inferred.intentConfidence ?? this.defaultAiConfidence(aiCategory, aiIntent);

        if (aiCategory === 'junk') {
            return this.buildAiClassificationResult(
                'NOISE',
                Math.max(aiConfidence, 0.85),
                'NONE',
                detectedSignals,
                aiCategory,
                language
            );
        }

        if (aiIntent && aiIntent !== 'UNKNOWN' && aiIntent !== 'NOISE') {
            return this.buildAiClassificationResult(
                aiIntent,
                aiConfidence,
                this.strengthForAiIntent(aiIntent, aiConfidence),
                detectedSignals,
                aiCategory,
                language
            );
        }

        if (aiIntent === 'NOISE' && aiCategory === 'low intent') {
            return this.buildAiClassificationResult(
                'NOISE',
                Math.max(aiConfidence, 0.7),
                'NONE',
                detectedSignals,
                aiCategory,
                language
            );
        }

        if (aiIntent === 'UNKNOWN' && aiCategory === 'low intent') {
            return this.buildAiClassificationResult(
                'UNKNOWN',
                Math.max(aiConfidence, 0.6),
                'LOW',
                detectedSignals,
                aiCategory,
                language
            );
        }

        return null;
    }

    private buildAiClassificationResult(
        intent: EngagementIntent,
        confidence: number,
        strength: BuyerIntentStrength,
        detectedSignals: DetectedSignal[],
        intentCategory: IntentCategory | undefined,
        language: 'en' | 'zh'
    ): IntentClassificationResult {
        const aiSignals = [...detectedSignals];
        aiSignals.push({
            category: 'CONTEXT',
            signal: `ai_intent_${intent.toLowerCase()}`,
            id: `ai_intent_${Date.now()}`
        });

        if (intentCategory) {
            aiSignals.push({
                category: 'CONTEXT',
                signal: `ai_category_${intentCategory.replace(/\s+/g, '_')}`,
                id: `ai_category_${Date.now()}`
            });
        }

        return {
            intent,
            confidence,
            detected_intents: [],
            strength,
            signals: aiSignals,
            evidence: {
                matched_families: [],
                matched_signals: aiSignals.map(s => s.signal),
                language,
                scores: {} as any
            }
        };
    }

    private defaultAiConfidence(
        intentCategory?: IntentCategory,
        intent?: EngagementIntent
    ): number {
        if (intentCategory === 'high intent') return 0.82;
        if (intentCategory === 'mid intent') return 0.72;
        if (intentCategory === 'low intent') return intent === 'NOISE' ? 0.75 : 0.62;
        if (intentCategory === 'junk') return 0.9;
        if (intent && intent !== 'UNKNOWN' && intent !== 'NOISE') return 0.72;
        return 0.6;
    }

    private scanSignals(text: string): DetectedSignal[] {
        const results: DetectedSignal[] = [];

        this.signals.forEach((defs, category) => {
            for (const def of defs) {
                // Determine if match
                // Simple inclusion check
                if (text.includes(def.signal.toLowerCase())) {
                    results.push({
                        category,
                        signal: def.signal,
                        id: def.id
                    });
                }
            }
        });
        return results;
    }

    private composeIntent(signals: DetectedSignal[]): { intent: EngagementIntent; strength: BuyerIntentStrength } {
        // Helper to check presence
        const has = (cat: SignalCategory) => signals.some(s => s.category === cat);

        // 1. POST_PURCHASE_REGRET
        // Logic: REGRET
        if (has('REGRET')) {
            return { intent: 'POST_PURCHASE_REGRET', strength: 'IMMEDIATE' };
        }

        // 2. LATENT_PURCHASE
        // Logic: (CONDITIONAL OR PREFERENCE) AND (PRODUCT_REF OR (PRONOUN AND ATTRIBUTE))
        // Constraint: Pronoun requires Attribute.
        // Update 17H: Preference implies latent.
        if (has('CONDITIONAL') || has('PREFERENCE')) {
            const hasProduct = has('PRODUCT_REF');
            const hasPronoun = has('PRONOUN');
            const hasAttribute = has('ATTRIBUTE');

            // Keep strict anchor to avoid "I wish" (abstract)
            // Update: Relax to (PROD or ATTR) to catch "not in this size" where pronoun might be ambiguous or missing.
            // Risk: "I wish I was taller" -> Silent Capture (Acceptable).
            if (hasProduct || hasAttribute || hasPronoun) {
                return { intent: 'LATENT_PURCHASE', strength: 'VERY_HIGH' };
            }
        }

        // 3. FIT_SUITABILITY
        // Logic: (EVALUATIVE) AND (CONTEXT OR USAGE_CONTEXT) AND (ATTRIBUTE OR PRODUCT_REF OR PRONOUN)
        // Update 17H: Allow "Strong/Relational" Evaluatives (suitable, fit, appropriate) to trigger without explicit anchor.
        if (has('EVALUATIVE')) {
            const hasContext = has('CONTEXT') || has('USAGE_CONTEXT');

            if (hasContext) {
                // Check for Strong Evaluatives
                const evaluativeSignals = signals.filter(s => s.category === 'EVALUATIVE');
                const strongKeywords = ['suitable', 'fit', 'appropriate'];
                const hasStrongEval = evaluativeSignals.some(s => strongKeywords.some(k => s.signal.includes(k)));

                if (hasStrongEval) {
                    return { intent: 'FIT_SUITABILITY', strength: 'HIGH' };
                }

                // Strict check for weak evaluatives (e.g. "Good", "Perfect", "Nice")
                if (has('ATTRIBUTE') || has('PRODUCT_REF') || has('PRONOUN')) {
                    return { intent: 'FIT_SUITABILITY', strength: 'HIGH' };
                }
            }
        }

        // 4. PROBLEM_SOLUTION
        // Logic: PROBLEM AND PRODUCT_REF
        if (has('PROBLEM') && has('PRODUCT_REF')) {
            return { intent: 'PROBLEM_SOLUTION', strength: 'HIGH' };
        }

        // 5. PRODUCT_INQUIRY
        // Logic: INTERROGATIVE_WORD AND (PRODUCT_REF OR PRONOUN) AND SOURCE
        // Constraint: Interrogative Word Required.
        if (has('INTERROGATIVE_WORD') && has('SOURCE')) {
            if (has('PRODUCT_REF') || has('PRONOUN')) {
                return { intent: 'PRODUCT_INQUIRY', strength: 'HIGH' };
            }
        }

        // 6. UNKNOWN CANDIDATE (vs NOISE)
        // Logic: Signals > 0 AND NOT (SOCIAL OR HOSTILE)
        // Praise Logic: Override IGNORE if Context exists.
        if (signals.length > 0) {
            const isHostile = has('HOSTILE') || has('SOCIAL'); // Social tracked as Ignore for now
            if (isHostile) return { intent: 'NOISE', strength: 'NONE' };

            const isPraise = has('PRAISE');
            if (isPraise) {
                // Check if context saves it
                const hasContext = has('CONTEXT') || has('USAGE_CONTEXT') || has('CONDITIONAL') || has('PREFERENCE');
                if (!hasContext) {
                    return { intent: 'NOISE', strength: 'NONE' }; // Pure Praise -> Ignore
                }
                // If Context exists + Praise -> It fell through FIT/LATENT, so it's UNKNOWN Intent (Candidate)
                return { intent: 'UNKNOWN', strength: 'LOW' };
            }

            // Default Unknown (Non-praise signals present)
            return { intent: 'UNKNOWN', strength: 'LOW' };
        }

        // Default NOISE
        return { intent: 'NOISE', strength: 'NONE' };
    }

    private emptyResult(): IntentClassificationResult {
        return {
            intent: 'NOISE',
            confidence: 0,
            detected_intents: [],
            strength: 'NONE',
            signals: [],
            evidence: { matched_families: [], matched_signals: [], language: 'en', scores: {} as any }
        };
    }

    private classifyRednoteHeuristic(text: string, normalized: string): IntentClassificationResult | null {
        const hasQuestion = /[?？吗呢呀嘛么]/.test(text);
        const hasProductTerm = /(链接|link|面霜|精油|产品|牌子|色号|美瞳|粉底|粉底液|乳|乳液|芦荟胶|精华|护肤|衣服|哪款|什么.*(用|牌|产品)|what .*use|what she uses)/i.test(normalized);
        const hasUsageTerm = /(每天|几天|多久|一次|频率|怎么用|如何用|可不可以|可以不|有(什么)?区别|区别)/i.test(normalized);
        const hasProblemTerm = /(痘|敏感|泛红|干皮|油皮|毛孔|闭口|水光针|过敏|适合|刺痛|脱皮|fit|suitable)/i.test(normalized);
        const hasPurchaseIntent = /(求|想买|买吗|入吗|值得吗|推荐吗|种草|可以涂脸上吗)/i.test(normalized);
        const isPureSocial = /^(谢谢|謝謝|好白呀你|好漂亮|好美|姐姐好美|太美了|爱了|好看)$/.test(normalized.trim());

        if (isPureSocial) {
            return null;
        }

        if (hasQuestion && hasProductTerm) {
            return this.rednoteResult('PRODUCT_INQUIRY', 'HIGH', ['product_inquiry', 'question']);
        }

        if (hasProblemTerm && (hasQuestion || hasUsageTerm)) {
            return this.rednoteResult('PROBLEM_SOLUTION', 'HIGH', ['problem_solution']);
        }

        if (hasUsageTerm && hasQuestion) {
            return this.rednoteResult('FIT_SUITABILITY', 'MEDIUM', ['usage_question']);
        }

        if (hasPurchaseIntent || (hasQuestion && /(推荐|求推荐|链接|买吗|入吗|值得)/i.test(normalized))) {
            return this.rednoteResult('LATENT_PURCHASE', 'HIGH', ['purchase_intent']);
        }

        return null;
    }

    private rednoteResult(intent: EngagementIntent, strength: BuyerIntentStrength, signalNames: string[]): IntentClassificationResult {
        const signals: DetectedSignal[] = signalNames.map((signal, index) => ({
            category: 'CONTEXT',
            signal,
            id: `rednote_${intent.toLowerCase()}_${index}`
        }));

        return {
            intent,
            confidence: 0.85,
            detected_intents: [],
            strength,
            signals,
            evidence: {
                matched_families: [],
                matched_signals: signalNames,
                language: 'zh',
                scores: {} as any
            }
        };
    }

    private strengthForAiIntent(intent: EngagementIntent, confidence: number): BuyerIntentStrength {
        if (intent === 'POST_PURCHASE_REGRET') return 'IMMEDIATE';
        if (intent === 'LATENT_PURCHASE') return confidence >= 0.8 ? 'VERY_HIGH' : 'HIGH';
        if (intent === 'PRODUCT_INQUIRY' || intent === 'PROBLEM_SOLUTION' || intent === 'FIT_SUITABILITY') {
            return confidence >= 0.75 ? 'HIGH' : 'MEDIUM';
        }
        return confidence >= 0.6 ? 'LOW' : 'NONE';
    }

}
