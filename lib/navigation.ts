export type TravelTab = 'schedule' | 'expenses' | 'summary' | 'trip';
export const tripTabs: Record<TravelTab, string> = {
  schedule: 'cronograma', expenses: 'gastos', summary: 'resumo', trip: 'detalhes',
};
