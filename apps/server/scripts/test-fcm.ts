import { FcmService } from '../src/platform/fcm';

const loggerMock = {
  info: console.log,
  warn: console.warn,
  error: console.error,
  debug: console.log,
} as any;

const configMock = {
  FCM_ENABLED: true,
  FCM_PROJECT_ID: 'chatup-dev',
  FCM_DRY_RUN: false,
  FCM_SERVICE_ACCOUNT_PATH: 'serviceAccountKey.json',
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
};

async function run() {
  const fcm = new FcmService(configMock, loggerMock);

  // Paste a real token generated from your browser client here for direct verification
  const testToken = process.env.TEST_FCM_TOKEN || 'YOUR_CLIENT_FCM_TOKEN_HERE';

  console.log('--- Testing FCM Push Notification Dispatch ---');
  const result = await fcm.sendPush({
    tokens: [testToken],
    notification: {
      title: 'ChatUp Test Notification',
      body: 'If you see this, FCM integration is working correctly!',
    },
    data: {
      conversationId: 'test-conversation',
      senderId: 'test-sender',
    },
  });

  console.log('Result:', JSON.stringify(result, null, 2));
}

run().catch(console.error);
