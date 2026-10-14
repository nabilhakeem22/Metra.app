'use client';

import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import type { ProjectWithType } from '@/lib/projects/queries';
import { DetailsFields } from './details-fields';
import { useAddProjectType } from './use-add-project-type';
import { useProjectDetailsForm } from './use-project-details-form';

export interface DetailsOption {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
}

/** The project's Details tab: its fields, Save, and the add-a-type box, each
 *  refusal said under the box it is about. */
export function DetailsTab({
  project,
  clientOptions,
  projectTypes,
  canManage,
}: {
  project: ProjectWithType;
  clientOptions: DetailsOption[];
  projectTypes: DetailsOption[];
  canManage: boolean;
}) {
  const t = useTranslations('projects');
  const details = useProjectDetailsForm(project);
  const addType = useAddProjectType();
  const fieldsRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(fieldsRef, details.errors.invalidAttempt);

  return (
    <Card>
      <CardContent ref={fieldsRef} className="space-y-4 py-4">
        <DetailsFields
          t={t}
          details={details}
          addType={addType}
          canManage={canManage}
          clientOptions={clientOptions}
          projectTypes={projectTypes}
        />
      </CardContent>
    </Card>
  );
}
