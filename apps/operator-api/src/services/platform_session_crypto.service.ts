import crypto from 'crypto';

const DEFAULT_KEY_SOURCE = 'syntrae-dev-xhs-session-encryption-key-32bytes-minimum';

function getKey() {
    const source = process.env.XHS_SESSION_ENCRYPTION_KEY;
    if (!source && process.env.NODE_ENV === 'production') {
        throw new Error('XHS_SESSION_ENCRYPTION_KEY is required in production');
    }
    return crypto.createHash('sha256').update(source || DEFAULT_KEY_SOURCE).digest();
}

export class PlatformSessionCryptoService {
    static hashNonce(value: string) {
        return crypto.createHash('sha256').update(value).digest('hex');
    }

    static encrypt(plaintext: string) {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
        const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return [
            iv.toString('base64'),
            tag.toString('base64'),
            encrypted.toString('base64'),
        ].join('.');
    }

    static decrypt(payload: string) {
        const [ivB64, tagB64, dataB64] = String(payload || '').split('.');
        if (!ivB64 || !tagB64 || !dataB64) {
            throw new Error('Invalid encrypted session payload format');
        }

        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            getKey(),
            Buffer.from(ivB64, 'base64')
        );
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(dataB64, 'base64')),
            decipher.final(),
        ]);

        return decrypted.toString('utf8');
    }
}
