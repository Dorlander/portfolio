export type Role = 'tester' | 'senior' | 'boss'

export const ROLE_LABELS: Record<Role, string> = {
  tester: 'Тестировщик',
  senior: 'Старший тестировщик',
  boss: 'Начальник',
}

export const ROLE_ORDER: Role[] = ['tester', 'senior', 'boss']
export const atLeast = (role: string, min: Role): boolean =>
  ROLE_ORDER.indexOf(role as Role) >= ROLE_ORDER.indexOf(min)
