// Starter Price Book (A3). ~40 real bilingual fit-out items across all 8
// categories — a head-start an org can OPT INTO from the empty state (never
// auto-seeded). Nabil ships the full ~150 as a later data update. Pure data:
// no server deps. Western numerals in both languages (§4.1). Costs < prices.
import type { CostItemCategory, CostItemUnit } from '@metra/db';

export interface StarterItem {
  code: string;
  nameEn: string;
  nameAr: string;
  category: CostItemCategory;
  unit: CostItemUnit;
  defaultUnitCost: string;
  defaultUnitPrice: string;
}

export const STARTER_CATALOGUE: readonly StarterItem[] = [
  // civil — أعمال مدنية
  { code: 'CIV-001', nameEn: 'Brick wall 12cm', nameAr: 'حائط طوب 12 سم', category: 'civil', unit: 'sqm', defaultUnitCost: '180', defaultUnitPrice: '250' },
  { code: 'CIV-002', nameEn: 'Brick wall 25cm', nameAr: 'حائط طوب 25 سم', category: 'civil', unit: 'sqm', defaultUnitCost: '320', defaultUnitPrice: '430' },
  { code: 'CIV-003', nameEn: 'Cement plaster', nameAr: 'بياض محارة', category: 'civil', unit: 'sqm', defaultUnitCost: '95', defaultUnitPrice: '140' },
  { code: 'CIV-004', nameEn: 'Plain concrete screed', nameAr: 'خرسانة عادية (صبة نظافة)', category: 'civil', unit: 'sqm', defaultUnitCost: '120', defaultUnitPrice: '170' },
  { code: 'CIV-005', nameEn: 'Waterproofing membrane', nameAr: 'عزل مائي', category: 'civil', unit: 'sqm', defaultUnitCost: '110', defaultUnitPrice: '165' },

  // gypsum — جبس
  { code: 'GYP-001', nameEn: 'Gypsum board ceiling', nameAr: 'سقف جبس بورد', category: 'gypsum', unit: 'sqm', defaultUnitCost: '220', defaultUnitPrice: '310' },
  { code: 'GYP-002', nameEn: 'Gypsum board partition', nameAr: 'قاطع جبس بورد', category: 'gypsum', unit: 'sqm', defaultUnitCost: '260', defaultUnitPrice: '360' },
  { code: 'GYP-003', nameEn: 'Gypsum cornice', nameAr: 'كرنيش جبس', category: 'gypsum', unit: 'linear_meter', defaultUnitCost: '45', defaultUnitPrice: '70' },
  { code: 'GYP-004', nameEn: 'Gypsum bulkhead', nameAr: 'بروز جبس ساقط', category: 'gypsum', unit: 'linear_meter', defaultUnitCost: '130', defaultUnitPrice: '190' },
  { code: 'GYP-005', nameEn: 'Decorative gypsum panel', nameAr: 'لوح جبس ديكور', category: 'gypsum', unit: 'pcs', defaultUnitCost: '90', defaultUnitPrice: '140' },

  // electrical — كهرباء
  { code: 'ELE-001', nameEn: 'Power outlet point', nameAr: 'نقطة بريزة كهرباء', category: 'electrical', unit: 'pcs', defaultUnitCost: '120', defaultUnitPrice: '180' },
  { code: 'ELE-002', nameEn: 'Lighting point', nameAr: 'نقطة إنارة', category: 'electrical', unit: 'pcs', defaultUnitCost: '100', defaultUnitPrice: '150' },
  { code: 'ELE-003', nameEn: 'Distribution board 12-way', nameAr: 'لوحة توزيع 12 خط', category: 'electrical', unit: 'pcs', defaultUnitCost: '900', defaultUnitPrice: '1300' },
  { code: 'ELE-004', nameEn: 'Cable tray', nameAr: 'حامل كابلات', category: 'electrical', unit: 'linear_meter', defaultUnitCost: '85', defaultUnitPrice: '130' },
  { code: 'ELE-005', nameEn: 'Data / network point', nameAr: 'نقطة شبكة داتا', category: 'electrical', unit: 'pcs', defaultUnitCost: '140', defaultUnitPrice: '210' },

  // plumbing — سباكة
  { code: 'PLM-001', nameEn: 'Water supply point', nameAr: 'نقطة تغذية مياه', category: 'plumbing', unit: 'pcs', defaultUnitCost: '160', defaultUnitPrice: '240' },
  { code: 'PLM-002', nameEn: 'Drainage point', nameAr: 'نقطة صرف', category: 'plumbing', unit: 'pcs', defaultUnitCost: '180', defaultUnitPrice: '260' },
  { code: 'PLM-003', nameEn: 'PPR pipe 1/2 inch', nameAr: 'ماسورة PPR نصف بوصة', category: 'plumbing', unit: 'linear_meter', defaultUnitCost: '55', defaultUnitPrice: '85' },
  { code: 'PLM-004', nameEn: 'Floor drain', nameAr: 'بالوعة أرضية', category: 'plumbing', unit: 'pcs', defaultUnitCost: '130', defaultUnitPrice: '200' },
  { code: 'PLM-005', nameEn: 'Water heater installation', nameAr: 'تركيب سخان مياه', category: 'plumbing', unit: 'pcs', defaultUnitCost: '350', defaultUnitPrice: '520' },

  // joinery — نجارة
  { code: 'JOI-001', nameEn: 'MDF door', nameAr: 'باب MDF', category: 'joinery', unit: 'pcs', defaultUnitCost: '1800', defaultUnitPrice: '2600' },
  { code: 'JOI-002', nameEn: 'Kitchen base cabinet', nameAr: 'وحدة مطبخ سفلية', category: 'joinery', unit: 'linear_meter', defaultUnitCost: '2200', defaultUnitPrice: '3200' },
  { code: 'JOI-003', nameEn: 'Wardrobe', nameAr: 'دولاب ملابس', category: 'joinery', unit: 'sqm', defaultUnitCost: '1600', defaultUnitPrice: '2400' },
  { code: 'JOI-004', nameEn: 'Wooden skirting', nameAr: 'وزر خشب', category: 'joinery', unit: 'linear_meter', defaultUnitCost: '60', defaultUnitPrice: '95' },
  { code: 'JOI-005', nameEn: 'Reception desk', nameAr: 'مكتب استقبال', category: 'joinery', unit: 'lump_sum', defaultUnitCost: '8000', defaultUnitPrice: '12000' },

  // finishes — تشطيبات
  { code: 'FIN-001', nameEn: 'Ceramic floor tiling', nameAr: 'تركيب سيراميك أرضيات', category: 'finishes', unit: 'sqm', defaultUnitCost: '130', defaultUnitPrice: '190' },
  { code: 'FIN-002', nameEn: 'Porcelain wall tiling', nameAr: 'تركيب بورسلين حوائط', category: 'finishes', unit: 'sqm', defaultUnitCost: '150', defaultUnitPrice: '220' },
  { code: 'FIN-003', nameEn: 'Plastic wall paint', nameAr: 'دهان بلاستيك', category: 'finishes', unit: 'sqm', defaultUnitCost: '45', defaultUnitPrice: '70' },
  { code: 'FIN-004', nameEn: 'Duco paint', nameAr: 'دهان دوكو', category: 'finishes', unit: 'sqm', defaultUnitCost: '120', defaultUnitPrice: '180' },
  { code: 'FIN-005', nameEn: 'Wallpaper', nameAr: 'ورق حائط', category: 'finishes', unit: 'sqm', defaultUnitCost: '90', defaultUnitPrice: '140' },

  // furniture — أثاث
  { code: 'FUR-001', nameEn: 'Office chair', nameAr: 'كرسي مكتب', category: 'furniture', unit: 'pcs', defaultUnitCost: '1200', defaultUnitPrice: '1750' },
  { code: 'FUR-002', nameEn: 'Workstation desk', nameAr: 'مكتب عمل', category: 'furniture', unit: 'pcs', defaultUnitCost: '2500', defaultUnitPrice: '3600' },
  { code: 'FUR-003', nameEn: 'Meeting table', nameAr: 'طاولة اجتماعات', category: 'furniture', unit: 'pcs', defaultUnitCost: '4500', defaultUnitPrice: '6500' },
  { code: 'FUR-004', nameEn: 'Sofa (3-seat)', nameAr: 'كنبة 3 مقاعد', category: 'furniture', unit: 'pcs', defaultUnitCost: '5000', defaultUnitPrice: '7200' },
  { code: 'FUR-005', nameEn: 'Storage cabinet', nameAr: 'خزانة تخزين', category: 'furniture', unit: 'pcs', defaultUnitCost: '1800', defaultUnitPrice: '2600' },

  // preliminaries — أعمال تمهيدية
  { code: 'PRE-001', nameEn: 'Site mobilization', nameAr: 'تجهيز الموقع', category: 'preliminaries', unit: 'lump_sum', defaultUnitCost: '5000', defaultUnitPrice: '7000' },
  { code: 'PRE-002', nameEn: 'Site supervision (daily)', nameAr: 'إشراف موقع (يومي)', category: 'preliminaries', unit: 'day', defaultUnitCost: '800', defaultUnitPrice: '1200' },
  { code: 'PRE-003', nameEn: 'Waste removal', nameAr: 'إزالة مخلفات', category: 'preliminaries', unit: 'lump_sum', defaultUnitCost: '2000', defaultUnitPrice: '3000' },
  { code: 'PRE-004', nameEn: 'Scaffolding', nameAr: 'سقالات', category: 'preliminaries', unit: 'sqm', defaultUnitCost: '40', defaultUnitPrice: '65' },
  { code: 'PRE-005', nameEn: 'Final cleaning', nameAr: 'نظافة نهائية', category: 'preliminaries', unit: 'lump_sum', defaultUnitCost: '1500', defaultUnitPrice: '2200' },
];
