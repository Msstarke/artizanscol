# Stripe and App Secret Rotation

This runbook covers routine rotation for:
- `StripeSecretArn`
- `StripeWebhookSecretArn`
- `AppSecretArn`

## Frequency
- Rotate Stripe and app secrets every 90 days.
- Rotate immediately after any suspected exposure.

## Preconditions
- You can deploy CloudFormation/Lambda updates.
- You have Stripe dashboard access for webhook endpoint secret rotation.
- You can run smoke tests against `/v1/payments/*` and `/v1/webhooks/stripe`.

## Procedure
1. Create new secret values in AWS Secrets Manager:
   - Keep the same secret ARNs and write new current values.
   - Use version stages (`AWSCURRENT`, `AWSPREVIOUS`) during rollout.
2. Update Stripe webhook endpoint signing secret in Stripe dashboard.
3. Redeploy backend functions so warm Lambda environments reload secret values.
4. Run validation checks:
   - `POST /v1/payments/checkout-session`
   - `POST /v1/payments/refunds`
   - `POST /v1/webhooks/stripe` with a valid test signature
5. Monitor CloudWatch for:
   - spike in `401 INVALID_SIGNATURE`
   - Lambda errors for `payments-api` and `webhook-api`
6. After stable validation, remove outdated secret versions from `AWSPREVIOUS`.

## Rollback
1. Reassign previous secret version to `AWSCURRENT`.
2. Redeploy backend functions.
3. Re-run payment/webhook smoke tests.

## Automation recommendation
- Add Secrets Manager rotation Lambda only after Stripe webhook dual-secret handling is implemented.
- Keep manual rotation until dual-secret verification support exists in webhook code.
