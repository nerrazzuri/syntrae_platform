import { Router, Request, Response } from 'express';
import { requireSession, requireWorkspace } from '../middleware/session_auth';
import {
    generateLearningApplyPlan,
    listLearningApplyPlans,
    updateLearningApplyPlanStatus,
} from '../services/learningApplyPlan.service';
import {
    getLearningReviewDashboard,
    getLearningReviewDetail,
} from '../services/learningReview.service';
import {
    updateLearningSuggestionStatus,
} from '../services/learningSuggestion.service';
import {
    generateApplyCandidatesFromPlan,
    listApplyCandidates,
    updateApplyCandidateStatus,
} from '../services/applyCandidate.service';
import { mineDraftEdits } from '../services/draftEditMining.service';

const router = Router();

router.use(requireSession);
router.use(requireWorkspace);

function accountId(req: Request) {
    return req.activeWorkspaceId!;
}

function errorStatus(message: string) {
    if (message.includes('not found')) return 404;
    if (message.includes('scope mismatch')) return 403;
    if (
        message.includes('required') ||
        message.includes('Invalid') ||
        message.includes('ACCEPTED') ||
        message.includes('REVIEWED')
    ) {
        return 400;
    }
    return 500;
}

function handleError(res: Response, fallback: string, error: any) {
    const message = String(error?.message || fallback);
    return res.status(errorStatus(message)).json({ error: message });
}

router.get('/dashboard', async (req: Request, res: Response) => {
    try {
        const dashboard = await getLearningReviewDashboard({
            accountId: accountId(req),
            brandId: String(req.query.brand_id || ''),
            platform: String(req.query.platform || ''),
            suggestionStatus: String(req.query.suggestion_status || ''),
            planStatus: String(req.query.plan_status || ''),
            limit: Number(req.query.limit || ''),
        });
        return res.json({ dashboard });
    } catch (error) {
        console.error('[LearningReview] Dashboard failed:', error);
        return handleError(res, 'Failed to load learning review dashboard', error);
    }
});

router.get('/suggestions/:id', async (req: Request, res: Response) => {
    try {
        const detail = await getLearningReviewDetail({
            accountId: accountId(req),
            learningSuggestionId: req.params.id,
        });
        return res.json({ detail });
    } catch (error) {
        console.error(`[LearningReview] Detail failed for ${req.params.id}:`, error);
        return handleError(res, 'Failed to load learning review detail', error);
    }
});

router.post('/suggestions/:id/status', async (req: Request, res: Response) => {
    try {
        const suggestion = await updateLearningSuggestionStatus({
            accountId: accountId(req),
            suggestionId: req.params.id,
            status: req.body?.status,
            reviewedBy: req.user?.id,
            reviewNote: req.body?.review_note,
        });
        return res.json({ suggestion });
    } catch (error) {
        console.error(`[LearningReview] Suggestion status failed for ${req.params.id}:`, error);
        return handleError(res, 'Failed to update learning suggestion status', error);
    }
});

router.post('/suggestions/:id/apply-plan', async (req: Request, res: Response) => {
    try {
        const result = await generateLearningApplyPlan({
            accountId: accountId(req),
            learningSuggestionId: req.params.id,
            force: req.body?.force === true,
        });
        return res.status(result.generated ? 201 : 200).json(result);
    } catch (error) {
        console.error(`[LearningReview] Generate apply plan failed for ${req.params.id}:`, error);
        return handleError(res, 'Failed to generate learning apply plan', error);
    }
});

router.post('/apply-plans/:id/status', async (req: Request, res: Response) => {
    try {
        const plan = await updateLearningApplyPlanStatus({
            accountId: accountId(req),
            planId: req.params.id,
            status: req.body?.status,
            reviewedBy: req.user?.id,
            reviewNote: req.body?.review_note,
        });
        return res.json({ plan });
    } catch (error) {
        console.error(`[LearningReview] Apply plan status failed for ${req.params.id}:`, error);
        return handleError(res, 'Failed to update learning apply plan status', error);
    }
});

router.post('/apply-plans/:id/candidates', async (req: Request, res: Response) => {
    try {
        const result = await generateApplyCandidatesFromPlan({
            accountId: accountId(req),
            learningApplyPlanId: req.params.id,
            force: req.body?.force === true,
        });
        return res.json(result);
    } catch (error) {
        console.error(`[LearningReview] Generate candidates failed for ${req.params.id}:`, error);
        return handleError(res, 'Failed to generate apply candidates', error);
    }
});

router.get('/apply-candidates', async (req: Request, res: Response) => {
    try {
        const candidates = await listApplyCandidates({
            accountId: accountId(req),
            brandId: String(req.query.brand_id || ''),
            platform: String(req.query.platform || ''),
            status: String(req.query.status || ''),
            candidateType: String(req.query.candidate_type || ''),
            limit: Number(req.query.limit || ''),
        });
        return res.json({ candidates });
    } catch (error) {
        console.error('[LearningReview] Candidate list failed:', error);
        return handleError(res, 'Failed to list apply candidates', error);
    }
});

router.post('/apply-candidates/:id/status', async (req: Request, res: Response) => {
    try {
        const candidate = await updateApplyCandidateStatus({
            accountId: accountId(req),
            candidateId: req.params.id,
            status: req.body?.status,
            reviewedBy: req.user?.id,
            reviewNote: req.body?.review_note,
        });
        return res.json({ candidate });
    } catch (error) {
        console.error(`[LearningReview] Candidate status failed for ${req.params.id}:`, error);
        return handleError(res, 'Failed to update apply candidate status', error);
    }
});

router.post('/edit-mining/run', async (req: Request, res: Response) => {
    try {
        const result = await mineDraftEdits({
            accountId: accountId(req),
            brandId: req.body?.brand_id,
            platform: req.body?.platform,
            minOccurrences: Number(req.body?.min_occurrences || ''),
            dryRun: req.body?.dry_run !== false,
        });
        return res.json(result);
    } catch (error) {
        console.error('[LearningReview] Edit mining failed:', error);
        return handleError(res, 'Failed to run draft edit mining', error);
    }
});

export const learningReviewRouter = router;
