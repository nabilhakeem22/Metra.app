'use client';

import { Loader2, LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FieldHint } from '@/components/ui/field-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { usePathname, useRouter } from '@/i18n/routing';
import { updateAccount } from '@/lib/account/actions';
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
  const router = useRouter();
  const pathname = usePathname();
  const [saving, startSaving] = useTransition();

  const [fullName, setFullName] = useState(initialFullName);
  const [locale, setLocale] = useState<Locale>(currentLocale);

  function save() {
    startSaving(async () => {
      const res = await updateAccount({ fullName, locale });
      if (res.ok) {
        toast({ title: t('saved') });
        if (locale !== currentLocale) {
          router.replace(pathname, { locale });
        }
      } else {
        toast({ title: t('errorGeneric'), variant: 'destructive' });
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('profileTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t('emailLabel')}</Label>
            <Input id="email" dir="ltr" value={email} readOnly disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fullName" className="flex items-center">
              {t('fullNameLabel')}
              <FieldHint id="acct-name-hint" hint={th('displayName')} />
            </Label>
            <Input
              id="fullName"
              aria-describedby="acct-name-hint"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
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
          <Button onClick={save} disabled={saving}>
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
            <Button type="submit" variant="outline">
              <LogOut className="size-4" aria-hidden />
              {t('signOut')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
