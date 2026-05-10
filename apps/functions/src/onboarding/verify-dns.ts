import { onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getOnboardingService } from './service-factory.js';
import { ensurePost, sendOk, sendErr, sendBadRequest } from './_http.js';

const Body = z.object({
  onboardingId: z.string().min(1),
});

export const onboardingVerifyDns = onRequest(async (req, res) => {
  if (!ensurePost(req, res)) return;
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return sendBadRequest(res, parsed.error.message);

  try {
    const result = await getOnboardingService().verifyDns(parsed.data);
    if (result.ok) return sendOk(res, result.value);
    return sendErr(res, result.error);
  } catch (e) {
    console.error('onboarding/verify-dns unhandled', e);
    res.status(500).json({ type: 'INTERNAL' });
  }
});
