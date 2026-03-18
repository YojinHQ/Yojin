export type SkillCategory = 'RISK' | 'PORTFOLIO' | 'MARKET' | 'RESEARCH';

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  active: boolean;
  source: 'built-in' | 'custom';
  createdBy: string;
  createdAt: string;
}
