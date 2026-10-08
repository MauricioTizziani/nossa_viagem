import AppRouter from '@/components/AppRouter';

// The public shell contains no trip data. Authenticated RPCs and RLS protect every read.
export default function Page() { return <AppRouter/>; }
