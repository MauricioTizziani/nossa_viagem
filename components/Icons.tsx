import { BedDouble, Car, Coffee, Compass, Ellipsis, Fuel, ShoppingBag, Sparkles, Ticket, UtensilsCrossed, type LucideIcon, type LucideProps } from "lucide-react";
import type { Activity, ExpenseCategory } from "../lib/types";

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

/* Expense categories keep their own discreet icons; they never reuse the schedule types. */
const EXPENSE_ICONS: Record<ExpenseCategory, LucideIcon> = {
  "Combustível": Fuel, "Hospedagem": BedDouble, "Alimentação": UtensilsCrossed, "Transporte": Car,
  "Passeios e lazer": Ticket, "Compras": ShoppingBag, "Outros": Ellipsis,
};
const EXPENSE_STYLES: Record<ExpenseCategory, { badge: string; tile: string; bar: string }> = {
  "Combustível": { badge: "border-[#eadac5] bg-[#fbf3e6] text-[#826141]", tile: "bg-[#fbf1e1] text-[#a3845f]", bar: "#d9b98a" },
  "Hospedagem": { badge: "border-[#d7e5f2] bg-[#eef5fc] text-[#3b5f86]", tile: "bg-[#eaf2fb] text-[#5c7fa3]", bar: "#8fb0d2" },
  "Alimentação": { badge: "border-[#d7e6dc] bg-[#edf5ef] text-[#51755f]", tile: "bg-[#edf5ef] text-[#5f8470]", bar: "#9cc0a9" },
  "Transporte": { badge: "border-[#dadff0] bg-[#eef1f8] text-[#5c6890]", tile: "bg-[#eef1f8] text-[#66719a]", bar: "#a7b0d6" },
  "Passeios e lazer": { badge: "border-[#ead8e0] bg-[#faedf2] text-[#95647a]", tile: "bg-[#f9eaf0] text-[#ae8197]", bar: "#d7a9bd" },
  "Compras": { badge: "border-[#e3d9ef] bg-[#f4eefa] text-[#6f5d8c]", tile: "bg-[#f4eefa] text-[#7c6a98]", bar: "#bda9d8" },
  "Outros": { badge: "border-[#dfe6ee] bg-[#f1f4f7] text-[#5f7389]", tile: "bg-[#f1f4f7] text-[#6b7f94]", bar: "#b4c0cd" },
};

export function expenseCategoryStyle(category: ExpenseCategory) {
  return EXPENSE_STYLES[category] ?? EXPENSE_STYLES["Outros"];
}

export function ExpenseCategoryIcon({ category, ...props }: LucideProps & { category: ExpenseCategory }) {
  const Icon = EXPENSE_ICONS[category] ?? Ellipsis;
  return <Icon aria-hidden="true" {...props} />;
}

export function ExpenseCategoryBadge({ category }: { category: ExpenseCategory }) {
  return (
    <span className={`inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${expenseCategoryStyle(category).badge}`}>
      <ExpenseCategoryIcon category={category} className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{category}</span>
    </span>
  );
}
