'use client';

import { Loader2, LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { toast } from '@/hooks/use-toast';
import { usePathname, useRouter } from '@/i18n/routing';
import { updateAccount } from '@/lib/account/actions';
import { ACCOUNT_FIELDS, accountFieldErrors } from '@/lib/account/field-rules';
import { signOut } from '@/lib/auth/actions';

type Locale = 'ar-EG' | 'en';

export function AccountClient({
  initialFullName,
  email,
  currentLocale,
}: {
  initialFullName: string;
  email: string;
  currentLocale: Locale;
}) {
  const t = useTranslations('account');
  const th = useTranslations('hints.account');
  const te = useTranslations('errors');
  const router = useRouter();
  const pathname = usePathname();
  const [saving, startSaving] = useTransition();

  const [fullName, setFullName] = useState(initialFullName);
  const [locale, setLocale] = useState<Locale>(currentLocale);
  const errors = useFieldErrors({ fields: ACCOUNT_FIELDS, translate: te });
  const profileRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(profileRef, errors.invalidAttempt);

  function save() {
    if (errors.applyLocal(accountFieldErrors({ fullName }))) return;
    startSaving(async () => {
      try {
        const result = await updateAccount({ fullName, locale });
        if (errors.applyResult(result)) return;
        toast({ title: t('saved') });
        if (locale !== currentLocale) router.replace(pathname, { locale });
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('profileTitle')}</CardTitle>
        </CardHeader>
        <CardContent ref={profileRef} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t('emailLabel')}</Label>
            <Input id="email" dir="ltr" value={email} readOnly disabled />
          </div>
          <FormField id="fullName" label={t('fullNameLabel')} hint={th('displayName')} {...errors.bind('fullName')}>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </FormField>
          <div className="space-y-2">
            <Label htmlFor="locale">{t('languageLabel')}</Label>
            <Select
              value={locale}
              onValueChange={(v) => setLocale(v as Locale)}
            >
              <SelectTrigger id="locale" className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ar-EG">العربية</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {errors.formError && (
            <p className="text-body text-destructive" role="alert">
              {errors.formError}
            </p>
          )}
          <Button variant="default" onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('save')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('sessionTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={signOut}>
            <Button type="submit" variant="secondary">
              <LogOut className="size-4" aria-hidden />
              {t('signOut')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
