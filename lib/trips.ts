import { tripStatus } from './domain';
import type { Trip } from './types';

export type TripPhase = ReturnType<typeof tripStatus>['phase'];
export const TRIP_PHASE_LABELS: Record<TripPhase, string> = { ongoing: 'Em andamento', upcoming: 'Próxima', finished: 'Passada', unplanned: 'Datas a definir' };
export const TRIP_GROUP_LABELS: Record<TripPhase, string> = { ongoing: 'Viagens em andamento', upcoming: 'Nossas próximas aventuras', finished: 'Memórias de viagens passadas', unplanned: 'Datas a definir' };
export const TRIP_PHASE_ORDER: TripPhase[] = ['ongoing', 'upcoming', 'finished', 'unplanned'];

/** Classification is calendar based in each trip's timezone. Archiving is separate. */
export function orderedTrips<T extends Trip>(trips: readonly T[], now: Date = new Date()): T[] {
  return [...trips].sort((a, b) => {
    const phaseA = tripStatus(a, now).phase, phaseB = tripStatus(b, now).phase;
    const phaseOrder = TRIP_PHASE_ORDER.indexOf(phaseA) - TRIP_PHASE_ORDER.indexOf(phaseB);
    if (phaseOrder) return phaseOrder;
    const dateOrder = phaseA === 'finished' ? (b.end_date ?? '').localeCompare(a.end_date ?? '') : (a.start_date ?? '').localeCompare(b.start_date ?? '');
    return dateOrder || a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id);
  });
}

export function tripPeriod(trip: Pick<Trip, 'start_date' | 'end_date'>): string {
  const format = (day: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  if (!trip.start_date && !trip.end_date) return 'Datas a definir';
  if (!trip.start_date) return `Início a definir · até ${format(trip.end_date!)}`;
  if (!trip.end_date) return `${format(trip.start_date)} · término a definir`;
  return trip.start_date === trip.end_date ? format(trip.start_date) : `${format(trip.start_date)} — ${format(trip.end_date)}`;
}
