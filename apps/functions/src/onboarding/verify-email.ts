import { onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getOnboardingService } from './service-factory.js';
import { ensurePost, sendOk, sendErr, sendBadRequest } from './_http.js';

const StartBody = z.object({
  onboardingId: z.string().min(1),
});

export const onboardingStartEmailVerification = onRequest(async (req, res) => {
  if (!ensurePost(req, res)) return;
  const parsed = StartBody.safeParse(req.body);
  if (!parsed.success) return sendBadRequest(res, parsed.error.message);

  try {
    const result = await getOnboardingService().startEmailVerification(parsed.data);
    if (result.ok) return sendOk(res, result.value);
    return sendErr(res, result.error);
  } catch (e) {
    console.error('onboarding/start-email-verification unhandled', e);
    res.status(500).json({ type: 'INTERNAL' });
  }
});

const VerifyBody = z.object({
  onboardingId: z.string().min(1),
  adminCode: z.string().min(1),
  postmasterCode: z.string().min(1),
});

export const onboardingVerifyEmail = onRequest(async (req, res) => {
  if (!ensurePost(req, res)) return;
  const parsed = VerifyBody.safeParse(req.body);
  if (!parsed.success) return sendBadRequest(res, parsed.error.message);

  try {
    const result = await getOnboardingService().verifyEmailCodes(parsed.data);
    if (result.ok) return sendOk(res, result.value);
    return sendErr(res, result.error);
  } catch (e) {
    console.error('onboarding/verify-email unhandled', e);
    res.status(500).json({ type: 'INTERNAL' });
  }
});
