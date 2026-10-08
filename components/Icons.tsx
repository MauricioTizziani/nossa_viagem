import { Coffee, Compass, Sparkles, type LucideProps } from "lucide-react";
import type { Activity } from "../lib/types";

export function CategoryIcon({ type, ...props }: LucideProps & { type: Activity["type"] }) {
  const Icon = type === "Refeição" ? Coffee : type === "Lazer" ? Sparkles : Compass;
  return <Icon aria-hidden="true" {...props} />;
}

export function CategoryBadge({ type }: { type: Activity["type"] }) {
  const color = type === "Refeição"
    ? "border-[#eadac5] bg-[#fbf3e6] text-[#826141]"
    : type === "Lazer"
      ? "border-[#ead8e0] bg-[#faedf2] text-[#95647a]"
      : "border-[#d7e5f2] bg-[#eef5fc] text-[#3b5f86]";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${color}`}>
      <CategoryIcon type={type} className="h-3.5 w-3.5" />
      {type}
    </span>
  );
}
