import test from 'node:test';
import assert from 'node:assert/strict';

import { PlatformSessionCryptoService } from '../src/services/platform_session_crypto.service';

function withEnv(values: Record<string, string | undefined>, fn: () => void) {
    const original = Object.fromEntries(
        Object.keys(values).map((key) => [key, process.env[key]])
    );

    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    try {
        fn();
    } finally {
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

test('platform session crypto requires an explicit key in production', () => {
    withEnv({ NODE_ENV: 'production', XHS_SESSION_ENCRYPTION_KEY: undefined }, () => {
        assert.throws(
            () => PlatformSessionCryptoService.encrypt('{"ok":true}'),
            /XHS_SESSION_ENCRYPTION_KEY is required in production/
        );
    });
});

test('platform session crypto encrypts and decrypts when a key is configured', () => {
    withEnv({ NODE_ENV: 'production', XHS_SESSION_ENCRYPTION_KEY: 'test-xhs-session-encryption-key-for-production' }, () => {
        const encrypted = PlatformSessionCryptoService.encrypt('{"ok":true}');
        assert.notEqual(encrypted, '{"ok":true}');
        assert.equal(PlatformSessionCryptoService.decrypt(encrypted), '{"ok":true}');
    });
});
