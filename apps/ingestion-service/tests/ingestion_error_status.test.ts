import test from 'node:test';
import assert from 'node:assert/strict';

import { IngestionEventSchema } from '../src/schemas/ingestion_contract';
import { prisma } from '../src/db';
import { IngestionService, IngestStatus } from '../src/services/ingestion/ingestion_service';
import { PlanEnforcer } from '../src/services/product/plan_enforcer';
import { BrandLookupService } from '../src/services/brand_lookup_service';
import { OwnerSettingsService } from '../src/services/owner/owner_settings_service';
import { VideoEventAdapter } from '../src/adapters/video/video_event_adapter';
import { BrainGateway } from '../src/services/brain/brain_gateway';

type RestoreFn = () => void;

function stubMethod<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): RestoreFn {
    const original = target[key];
    Object.defineProperty(target, key, {
        value,
        configurable: true,
        writable: true,
    });
    return () => {
        Object.defineProperty(target, key, {
            value: original,
            configurable: true,
            writable: true,
        });
    };
}

test('pipeline failures mark the event as ERROR instead of RECEIVED', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    const updatedStatuses: string[] = [];

    restores.push(stubMethod(IngestionEventSchema, 'safeParse', ((raw: any) => ({
        success: true,
        data: raw,
    })) as any));
    restores.push(stubMethod(prisma.engagementEvent, 'findUnique', (async () => null) as any));
    restores.push(stubMethod(prisma.engagementEvent, 'create', (async () => ({ id: 'evt-1' })) as any));
    restores.push(stubMethod(prisma.engagementEvent, 'update', (async ({ data }: any) => {
        updatedStatuses.push(data.status);
        return { id: 'evt-1', status: data.status };
    }) as any));
    restores.push(stubMethod(PlanEnforcer, 'assertPlatformAccess', (async () => undefined) as any));
    restores.push(stubMethod(PlanEnforcer, 'consumeLimit', (async () => undefined) as any));
    restores.push(stubMethod(BrandLookupService, 'resolveBrand', (async () => 'brand-1') as any));
    restores.push(stubMethod(OwnerSettingsService, 'getSettings', (async () => ({ mode: 'SUGGEST' })) as any));
    restores.push(stubMethod(VideoEventAdapter, 'toCapabilityRequest', (() => ({ context: {}, input: { query: 'hello' } })) as any));
    restores.push(stubMethod(BrainGateway, 'processCapability', (async () => {
        throw new Error('brain failed');
    }) as any));

    const result = await IngestionService.processEvent({
        event_id: 'evt-raw-1',
        platform: 'REDNOTE',
        platform_video_id: 'video-1',
        platform_comment_id: 'comment-1',
        raw_text: 'hello',
        observed_at: new Date().toISOString(),
        source: 'EXTENSION',
    }, 'install-1', 'account-1', 'corr-1');

    assert.equal(result.status, IngestStatus.ERROR);
    assert.deepEqual(updatedStatuses, ['ERROR']);
});
