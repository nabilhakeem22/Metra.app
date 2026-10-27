'use client';

import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { OTP_LENGTH } from '@/lib/auth/otp-field-rules';
import { ByLoginMode } from './login-mode';
import { LoginRequestStep } from './login-request-step';
import { LoginVerifyStep } from './login-verify-step';
import { ModeSwitchLink } from './mode-switch-link';
import { useCaptcha } from './use-captcha';
import { useOtpFlow } from './use-otp-flow';

/**
 * Passwordless auth form. A `?mode=signup` / `?mode=signin` (default) search
 * param drives the sign-in vs create-account FRAMING only: heading, subcopy,
 * and the switch link (each a `ByLoginMode`, so the static page carries the
 * whole sign-in form). The switch link rewrites `?mode` in place, so what was
 * typed survives it. The OTP send/verify flow and the post-login routing are
 * identical in both modes: a new email still auto-creates the account and lands
 * on onboarding, an existing one on the dashboard.
 */
export function LoginForm() {
  const t = useTranslations('login');
  const th = useTranslations('hints.auth');
  const captcha = useCaptcha();
  const flow = useOtpFlow(captcha.take);
  const stepRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(stepRef, flow.errors.invalidAttempt);

  const sending = flow.status === 'sending';
  const verifying = flow.status === 'verifying';
  const busy = sending || verifying || flow.status === 'success';

  return (
    <AuthShell showValueProp>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-heading font-bold">
            <ByLoginMode signin={t('signInTitle')} signup={t('signUpTitle')} />
          </h1>
          {flow.phase === 'request' && (
            <p className="text-body text-muted-foreground">
              <ByLoginMode signin={t('signInSubtitle')} signup={t('signUpSubtitle')} />
            </p>
          )}
        </div>

        <div ref={stepRef}>
          {flow.phase === 'request' ? (
            <LoginRequestStep
              t={t}
              th={th}
              channel={flow.channel}
              switchChannel={flow.switchChannel}
              identifier={flow.identifier}
              setIdentifier={flow.setIdentifier}
              identifierError={flow.errors.messageFor(flow.channel)}
              send={flow.send}
              busy={busy}
              sending={sending}
            />
          ) : (
            <LoginVerifyStep
              t={t}
              th={th}
              identifier={flow.identifier}
              changeIdentifier={flow.changeIdentifier}
              code={flow.code}
              setCode={flow.setCode}
              codeError={flow.errors.messageFor('token')}
              verify={flow.verify}
              send={flow.send}
              busy={busy}
              verifying={verifying}
              otpLength={OTP_LENGTH}
              countdown={flow.countdown}
            />
          )}
        </div>

        {/* The sign-in challenge: outside the step switch, so one widget lives across both steps. */}
        {captcha.slotRef && <div ref={captcha.slotRef} className="flex justify-center" />}

        <p
          role="status"
          aria-live="polite"
          className="min-h-[1.25rem] text-body text-destructive"
        >
          {flow.errors.formError}
        </p>

        <p className="text-center text-body text-muted-foreground">
          <ByLoginMode
            signin={
              <>
                {t('switchToSignUpPrompt')}{' '}
                <ModeSwitchLink mode="signup" className="font-medium text-primary hover:underline">
                  {t('switchToSignUpLink')}
                </ModeSwitchLink>
              </>
            }
            signup={
              <>
                {t('switchToSignInPrompt')}{' '}
                <ModeSwitchLink mode="signin" className="font-medium text-primary hover:underline">
                  {t('switchToSignInLink')}
                </ModeSwitchLink>
              </>
            }
          />
        </p>
      </div>
    </AuthShell>
  );
}
