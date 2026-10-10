import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { FcmService } from './fcm';
import type { Logger } from './logger';

vi.mock('firebase-admin/app', () => ({
    getApps: vi.fn(),
    initializeApp: vi.fn(),
    applicationDefault: vi.fn(),
    cert: vi.fn(),
}));
vi.mock('firebase-admin/messaging', () => ({ getMessaging: vi.fn() }));

const getAppsMock = vi.mocked(getApps);
const initializeAppMock = vi.mocked(initializeApp);
const applicationDefaultMock = vi.mocked(applicationDefault);
const certMock = vi.mocked(cert);
const getMessagingMock = vi.mocked(getMessaging);
const sendEachForMulticastMock = vi.fn();

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

function makeService(overrides = {}) {
    return new FcmService(
        { FCM_ENABLED: false, FCM_PROJECT_ID: '', FCM_DRY_RUN: false, FCM_SERVICE_ACCOUNT_PATH: '', APP_URL: 'https://chatup.test', ...overrides },
        fakeLogger,
    );
}

beforeEach(() => {
    // reset (not just clear): mockImplementationOnce queues set inside a
    // test must not leak into later tests.
    vi.resetAllMocks();
    getAppsMock.mockReturnValue([]);
    initializeAppMock.mockReturnValue({} as never);
    applicationDefaultMock.mockReturnValue({} as never);
    certMock.mockReturnValue({} as never);
    getMessagingMock.mockReturnValue({ sendEachForMulticast: sendEachForMulticastMock } as never);
});

describe('FcmService', () => {
    it('is a no-op when disabled without touching the Admin SDK', async () => {
        const fcm = makeService();
        const result = await fcm.sendPush({ tokens: ['token-1'], notification: { title: 'hi' } });
        expect(result).toEqual({ attempted: 1, succeeded: 0, failed: 0, invalidTargets: [], skippedReason: 'disabled' });
        expect(initializeAppMock).not.toHaveBeenCalled();
    });

    it('skips sends gracefully when init fails', async () => {
        initializeAppMock.mockImplementationOnce(() => {
            throw new Error('no creds');
        });
        const fcm = makeService({ FCM_ENABLED: true });
        const result = await fcm.sendPush({ tokens: ['token-1'] });
        expect(result).toEqual({ attempted: 1, succeeded: 0, failed: 0, invalidTargets: [], skippedReason: 'init-failed' });
        expect(vi.mocked(fakeLogger.error)).toHaveBeenCalled();
    });

    it('sends FID multicast and reports counts', async () => {
        sendEachForMulticastMock.mockResolvedValueOnce({
            successCount: 2,
            failureCount: 0,
            responses: [{ success: true }, { success: true }],
        });
        const fcm = makeService({ FCM_ENABLED: true, FCM_PROJECT_ID: 'demo' });
        const result = await fcm.sendPush({
            tokens: ['token-1', 'token-2'],
            notification: { title: 'New message', body: 'hello' },
            data: { conversationId: 'c1' },
        });
        expect(result).toEqual({ attempted: 2, succeeded: 2, failed: 0, invalidTargets: [] });
        expect(initializeAppMock).toHaveBeenCalledWith(
            expect.objectContaining({ projectId: 'demo' }),
            'chatup-fcm',
        );
        // No webpush.fcmOptions.link: FCM requires https for it, which breaks
        // on http://localhost. Navigation uses data.conversationId instead.
        expect(sendEachForMulticastMock).toHaveBeenCalledWith(
            expect.objectContaining({
                fids: ['token-1', 'token-2'],
                notification: { title: 'New message', body: 'hello' },
                data: { conversationId: 'c1' },
                webpush: expect.objectContaining({
                    headers: expect.objectContaining({ Urgency: 'high' }),
                    notification: expect.objectContaining({
                        icon: 'https://chatup.test/icons/192.png',
                        badge: 'https://chatup.test/icons/192.png',
                    }),
                }),
            }),
            false,
        );
        const sentArg = sendEachForMulticastMock.mock.calls[0]![0] as { webpush?: { fcmOptions?: unknown } };
        expect(sentArg.webpush?.fcmOptions).toEqual({ analyticsLabel: 'chatup_web_push' });
    });

    it('flags dead registrations for pruning', async () => {
        sendEachForMulticastMock.mockResolvedValueOnce({
            successCount: 0,
            failureCount: 1,
            responses: [
                {
                    success: false,
                    error: {
                        code: 'messaging/registration-token-not-registered',
                        message: 'gone',
                    },
                },
            ],
        });
        const fcm = makeService({ FCM_ENABLED: true });
        const result = await fcm.sendPush({ tokens: ['dead-fid'] });
        expect(result.failed).toBe(1);
        expect(result.invalidTargets).toEqual(['dead-fid']);
    });

    it('dedupes targets and skips empty sends', async () => {        sendEachForMulticastMock.mockResolvedValueOnce({
            successCount: 1,
            failureCount: 0,
            responses: [{ success: true }],
        });
        const fcm = makeService({ FCM_ENABLED: true });
        const result = await fcm.sendPush({ tokens: ['a', 'a', ''] });
        expect(result.attempted).toBe(1);
        expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
    });

    it('uses the explicit key file when FCM_SERVICE_ACCOUNT_PATH is set', async () => {
        const keyPath = join(tmpdir(), `chatup-test-key-${Date.now()}.json`);
        const keyObject = { project_id: 'demo', client_email: 'a@b.c', private_key: 'k' };
        writeFileSync(keyPath, JSON.stringify(keyObject));
        sendEachForMulticastMock.mockResolvedValueOnce({
            successCount: 1,
            failureCount: 0,
            responses: [{ success: true }],
        });
        const fcm = makeService({ FCM_ENABLED: true, FCM_SERVICE_ACCOUNT_PATH: keyPath });
        const result = await fcm.sendPush({ tokens: ['fid-1'] });
        expect(result.succeeded).toBe(1);
        expect(certMock).toHaveBeenCalledWith(keyObject);
        expect(applicationDefaultMock).not.toHaveBeenCalled();
    });
});
