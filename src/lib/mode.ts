/** Client-visible: deploy on Vercel without an external gateway (HTTP + polling only). */
export const IS_VERCEL_DEMO = process.env.NEXT_PUBLIC_BALLOT_MODE === 'vercel';
