import { onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getOnboardingService } from './service-factory.js';
import { ensurePost, sendOk, sendErr, sendBadRequest } from './_http.js';

const StartBody = z.object({
  onboardingId: z.string().min(1),
  officerEmail: z.string().email(),
  officerName: z.string().optional(),
});

export const onboardingStartKyc = onRequest(async (req, res) => {
  if (!ensurePost(req, res)) return;
  const parsed = StartBody.safeParse(req.body);
  if (!parsed.success) return sendBadRequest(res, parsed.error.message);

  try {
    const result = await getOnboardingService().startOfficerKyc(parsed.data);
    if (result.ok) return sendOk(res, result.value);
    return sendErr(res, result.error);
  } catch (e) {
    console.error('onboarding/start-kyc unhandled', e);
    res.status(500).json({ type: 'INTERNAL' });
  }
});

const ConfirmBody = z.object({
  onboardingId: z.string().min(1),
  vendorSessionId: z.string().min(1),
});

export const onboardingConfirmKyc = onRequest(async (req, res) => {
  if (!ensurePost(req, res)) return;
  const parsed = ConfirmBody.safeParse(req.body);
  if (!parsed.success) return sendBadRequest(res, parsed.error.message);

  try {
    const result = await getOnboardingService().confirmOfficerKyc(parsed.data);
    if (result.ok) return sendOk(res, result.value);
    return sendErr(res, result.error);
  } catch (e) {
    console.error('onboarding/confirm-kyc unhandled', e);
    res.status(500).json({ type: 'INTERNAL' });
  }
});
