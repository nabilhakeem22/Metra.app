// Client-portal (P1) stage vocabulary. PURE and SERVER-SAFE: no `@metra/db`
// runtime value, no 'use client'. The session-less delivery portal renders these
// CLIENT-FRIENDLY stage labels — it must NEVER surface the raw machine enum
// (`design_3d`, `boq`, …) to the end client. The `import type` below is erased at
// compile time; it only pins this map to the `DesignState` union so a new state
// can never be added without a portal label (the `Record` is exhaustive, so `tsc`
// fails if one is missing).
import type { DesignState } from './states';

/** A bilingual label pair. Western numerals only; both locales always present. */
export interface PortalLabel {
  ar: string;
  en: string;
}

/**
 * The prominent, client-appropriate stage label for EVERY machine state. Written
 * for the end client's eyes — reassuring, jargon-free, and never the internal
 * trigger/gate language. Owner-approved table; the rest filled from the plan.
 */
export const PORTAL_STAGE_LABEL: Record<DesignState, PortalLabel> = {
  created: { en: 'Getting started', ar: 'قيد الإعداد' },
  design_proposal: { en: 'Proposal ready for you', ar: 'العرض جاهز لمراجعتك' },
  survey: { en: 'Measuring your space', ar: 'جاري رفع المقاسات' },
  layout: { en: 'Working on the layout', ar: 'جاري إعداد التوزيع' },
  concept_review: {
    en: 'Concept ready for your review',
    ar: 'التصميم المبدئي جاهز لمراجعتك',
  },
  negotiation: { en: 'Refining the concept with you', ar: 'جاري تنقيح التصميم معك' },
  design_3d: {
    en: 'Preparing your 3D visuals',
    ar: 'جاري إعداد التصورات ثلاثية الأبعاد',
  },
  final_approval: {
    en: 'Final design ready for approval',
    ar: 'التصميم النهائي جاهز لاعتمادك',
  },
  shop_drawings: {
    en: 'Preparing production drawings',
    ar: 'جاري إعداد رسومات التنفيذ',
  },
  boq: { en: 'Preparing the bill of quantities', ar: 'جاري إعداد حصر الكميات' },
  execution_decision: {
    en: 'Planning the next steps',
    ar: 'جاري تحديد الخطوة التالية',
  },
  design_only_handoff: {
    en: 'Preparing your design handover',
    ar: 'جاري تجهيز تسليم التصميم',
  },
  closed_design_only: { en: 'Design delivered', ar: 'تم تسليم التصميم' },
  execution: { en: 'In construction', ar: 'قيد التنفيذ' },
  abandoned: { en: 'Closed', ar: 'مغلق' },
  change_triage: { en: 'Reviewing as-built changes', ar: 'مراجعة تغييرات التنفيذ' },
};

/**
 * A short, read-only "what's happening / what's next" line for the client — one
 * calm sentence per stage. P1 is read-only: this NEVER instructs the client to
 * act (no accept/pay buttons yet). Kept client-appropriate; never leaks internal
 * gates, cost, or the machine trigger names.
 */
export const PORTAL_STAGE_NOTE: Record<DesignState, PortalLabel> = {
  created: {
    en: 'Your design team is setting up your project.',
    ar: 'فريق التصميم يجهّز مشروعك الآن.',
  },
  design_proposal: {
    en: 'Your design proposal is ready — your team will walk you through the next step.',
    ar: 'عرض التصميم جاهز — سيوضح لك الفريق الخطوة التالية.',
  },
  survey: {
    en: 'We are capturing accurate measurements of your space.',
    ar: 'نقوم برفع مقاسات دقيقة لمساحتك.',
  },
  layout: {
    en: 'We are shaping the layout of your space.',
    ar: 'نعمل على توزيع مساحتك.',
  },
  concept_review: {
    en: 'A first design concept is ready for you to look over.',
    ar: 'التصميم المبدئي جاهز لتطّلع عليه.',
  },
  negotiation: {
    en: 'We are refining the concept based on your feedback.',
    ar: 'نقوم بتنقيح التصميم بناءً على ملاحظاتك.',
  },
  design_3d: {
    en: 'We are preparing 3D visuals so you can picture the result.',
    ar: 'نجهّز تصورات ثلاثية الأبعاد لتتخيّل النتيجة.',
  },
  final_approval: {
    en: 'The final design is ready for your approval.',
    ar: 'التصميم النهائي جاهز لاعتمادك.',
  },
  shop_drawings: {
    en: 'We are preparing the detailed drawings for construction.',
    ar: 'نجهّز الرسومات التفصيلية للتنفيذ.',
  },
  boq: {
    en: 'We are preparing the detailed scope of works.',
    ar: 'نجهّز نطاق الأعمال التفصيلي.',
  },
  execution_decision: {
    en: 'We are planning how your project moves forward.',
    ar: 'نخطط للخطوة التالية في مشروعك.',
  },
  design_only_handoff: {
    en: 'Your design package is being prepared for handover.',
    ar: 'يتم تجهيز حزمة التصميم للتسليم.',
  },
  closed_design_only: {
    en: 'Your design has been delivered. Thank you for working with us.',
    ar: 'تم تسليم تصميمك. شكرًا لتعاملك معنا.',
  },
  execution: {
    en: 'Your project is under construction.',
    ar: 'مشروعك قيد التنفيذ.',
  },
  abandoned: {
    en: 'This project is closed.',
    ar: 'تم إغلاق هذا المشروع.',
  },
  change_triage: {
    en: 'We are reviewing changes found on site.',
    ar: 'نراجع التغييرات التي ظهرت في الموقع.',
  },
};

/** Pick the label for the active locale ('ar…' → Arabic, else English). */
export function pickPortalLabel(label: PortalLabel, locale: string): string {
  return locale.startsWith('ar') ? label.ar : label.en;
}
